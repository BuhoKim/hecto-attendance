import { randomBytes } from 'node:crypto';
import { getAdminClient } from './supabaseClient';
import { isAdminRole } from './roleUtils';
import { AUTH_MODE_COOKIE, createAuthModeCookie } from './authMode';

export const SSO_STATE_COOKIE = 'nw-sso-state';
const AUTHORIZE_URL = 'https://auth.worksmobile.com/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';
const ME_URL = 'https://www.worksapis.com/v1.0/users/me';
const SSO_SCOPE = 'user.profile.read';

export const getRedirectUri = (origin) => `${process.env.NAVER_WORKS_SSO_REDIRECT_ORIGIN || origin}/api/auth/naverworks/callback`;

// Only same-site relative paths may be used as the post-login destination.
export const safeNextPath = (value) => {
  const next = String(value || '/');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

export function buildAuthorizeUrl(origin, next) {
  const state = randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.NAVER_WORKS_CLIENT_ID || '',
    redirect_uri: getRedirectUri(origin),
    scope: SSO_SCOPE,
    response_type: 'code',
    state,
  });
  return { url: `${AUTHORIZE_URL}?${params}`, cookie: `${state}|${safeNextPath(next)}` };
}

export async function fetchNaverWorksUser(code, origin) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.NAVER_WORKS_CLIENT_ID || '',
      client_secret: process.env.NAVER_WORKS_CLIENT_SECRET || '',
      redirect_uri: getRedirectUri(origin),
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new Error(`token ${tokenRes.status}`);

  const meRes = await fetch(ME_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.email) throw new Error(`users/me ${meRes.status}`);
  return me;
}

// Maps a NAVER WORKS account to an active MySQL-synced employee and issues a
// Supabase session for that employee's existing auth user.
export async function createEmployeeSession(email) {
  const supabase = getAdminClient();
  const { data: employee, error: employeeError } = await supabase
    .from('sa_employees')
    .select('emp_no,name,dept,login_id,is_active')
    .ilike('email', email)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee || employee.is_active !== true) return { error: 'not_employee' };

  const { data: profile, error: profileError } = await supabase
    .from('sa_profiles')
    .select('id,emp_no,is_admin,must_change_password,rank,position')
    .eq('emp_no', employee.emp_no)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { error: 'no_account' };

  const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(profile.id);
  if (userError || !authUser?.user?.email) return { error: 'no_account' };

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email,
  });
  if (linkError) throw linkError;

  // verifyOtp changes the client's authorization context; keep it separate.
  const { data: verified, error: verifyError } = await getAdminClient().auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError || !verified?.session) throw verifyError || new Error('session');

  return { session: verified.session, employee, profile };
}

export function setSessionCookies(response, { session, employee, profile }) {
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  };
  const isAdmin = isAdminRole(profile);
  const position = profile.position || '';
  const publicOpts = { ...cookieOpts, httpOnly: false };

  response.cookies.set('sb-access-token', session.access_token, cookieOpts);
  response.cookies.set('sb-refresh-token', session.refresh_token, cookieOpts);
  response.cookies.set(AUTH_MODE_COOKIE, createAuthModeCookie(session.user.id, 'employee'), cookieOpts);
  response.cookies.set('must-change-password', 'false', publicOpts);
  response.cookies.set('user-emp-no', employee.emp_no, publicOpts);
  response.cookies.set('user-login-id', employee.login_id || '', publicOpts);
  response.cookies.set('user-is-admin', String(isAdmin), publicOpts);
  response.cookies.set('user-position', encodeURIComponent(position), publicOpts);
  response.cookies.set('user-rank', encodeURIComponent(profile.rank || ''), publicOpts);
  response.cookies.set('user-name', encodeURIComponent(employee.name || ''), publicOpts);
  response.cookies.set('user-team', encodeURIComponent(employee.dept || ''), publicOpts);
  response.cookies.delete(SSO_STATE_COOKIE);
}
