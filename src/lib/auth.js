import { cookies } from 'next/headers';
import { getAdminClient } from './supabaseClient';
import { isAdminRole } from './roleUtils';
import { AUTH_MODE_COOKIE, MASTER_LOGIN_EMAIL, verifyAuthModeCookie } from './authMode';

const refreshes = new Map();
const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
};

async function refreshAuthSession(refreshToken) {
  if (!refreshes.has(refreshToken)) {
    // Use a separate client: refreshSession changes its authorization context.
    const pending = getAdminClient().auth.refreshSession({ refresh_token: refreshToken });
    refreshes.set(refreshToken, pending);
    const release = () => {
      const timer = setTimeout(() => refreshes.delete(refreshToken), 3000);
      timer.unref?.();
    };
    pending.then(release, release);
  }
  const { data, error } = await refreshes.get(refreshToken);
  if (error?.status >= 500) throw error;
  return error ? null : data?.session;
}

async function persistRefreshedSession(session) {
  if (!session) return;
  const store = await cookies();
  store.set('sb-access-token', session.access_token, authCookieOptions);
  store.set('sb-refresh-token', session.refresh_token, authCookieOptions);
}

const getHeaderCookie = (request, name) => {
  const header = request?.headers?.get?.('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
};

async function getRequestCookie(request, name) {
  const fromHeader = getHeaderCookie(request, name);
  if (fromHeader) return fromHeader;
  try {
    return (await cookies()).get(name)?.value || null;
  } catch {
    return null;
  }
}

export async function verifySession(request) {
  const accessToken = await getRequestCookie(request, 'sb-access-token');
  const supabase = getAdminClient();
  const { data: userData, error: userError } = accessToken
    ? await supabase.auth.getUser(accessToken)
    : { data: null, error: null };
  if (userError?.status >= 500) throw userError;
  let authUser = userError ? null : userData?.user;
  let refreshedSession = null;
  if (!authUser?.id) {
    const refreshToken = await getRequestCookie(request, 'sb-refresh-token');
    if (!refreshToken) return null;
    refreshedSession = await refreshAuthSession(refreshToken);
    authUser = refreshedSession?.user;
    if (!authUser?.id) return null;
  }

  const authMode = verifyAuthModeCookie(
    authUser.id,
    await getRequestCookie(request, AUTH_MODE_COOKIE)
  );
  const isMasterAccount = authUser.email?.toLowerCase() === MASTER_LOGIN_EMAIL;

  if (isMasterAccount && authMode !== 'master') {
    const { data: employee, error: employeeError } = await supabase
      .from('sa_employees')
      .select('emp_no,name,dept,email,login_id,is_active,company_code')
      .eq('email', authUser.email)
      .eq('is_active', true)
      .maybeSingle();
    if (employeeError || !employee) return null;

    await persistRefreshedSession(refreshedSession);

    return {
      userId: authUser.id,
      empNo: employee.emp_no,
      name: employee.name || authUser.user_metadata?.display_name || employee.login_id,
      loginId: employee.login_id || authUser.email.split('@')[0],
      email: authUser.email,
      isAdmin: false,
      isGlobalAdmin: false,
      isLeader: false,
      position: '',
      team: employee.dept || '',
      dept: employee.dept || '',
      rank: '',
      companyCode: employee.company_code || '1600',
      mustChangePassword: false,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('sa_profiles')
    .select('id,emp_no,is_admin,position,rank,must_change_password')
    .eq('id', authUser.id)
    .maybeSingle();
  if (profileError || !profile) return null;

  const { data: employee, error: employeeError } = await supabase
    .from('sa_employees')
    .select('dept,name,email,login_id,company_code,is_active')
    .eq('emp_no', profile.emp_no)
    .maybeSingle();

  const isMaster = isMasterAccount && authMode === 'master';
  if (employeeError || (!isMaster && employee?.is_active !== true)) return null;
  const isAdmin = isMaster || isAdminRole(profile);
  await persistRefreshedSession(refreshedSession);
  return {
    userId: authUser.id,
    empNo: employee ? profile.emp_no : null,
    name: employee?.name
      || authUser.user_metadata?.name
      || authUser.user_metadata?.display_name
      || authUser.email?.split('@')[0]
      || '',
    loginId: employee?.login_id || authUser.email?.split('@')[0] || '',
    email: authUser.email || employee?.email || '',
    isAdmin,
    isGlobalAdmin: isMaster,
    isLeader: isAdmin || profile.position === '팀장' || profile.position === '실장' || profile.position === '대표이사',
    position: isMaster ? '시스템 관리자' : (profile.position || ''),
    team: employee?.dept || (isMaster ? '시스템 관리' : ''),
    dept: employee?.dept || (isMaster ? '시스템 관리' : ''),
    rank: profile.rank || '',
    companyCode: '1600',
    mustChangePassword: !!profile.must_change_password,
  };
}
