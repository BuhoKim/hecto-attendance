import { NextResponse } from 'next/server';
import {
  SSO_STATE_COOKIE,
  createEmployeeSession,
  fetchNaverWorksUser,
  safeNextPath,
  setSessionCookies,
} from '@/lib/naverWorksSso';

export async function GET(request) {
  const { origin, searchParams } = new URL(request.url);
  const fail = (reason) => {
    const response = NextResponse.redirect(`${origin}/login?sso_error=${reason}`);
    response.cookies.delete(SSO_STATE_COOKIE);
    return response;
  };

  const [expectedState, next] = String(request.cookies.get(SSO_STATE_COOKIE)?.value || '').split('|');
  const code = searchParams.get('code');
  if (!code || !expectedState || searchParams.get('state') !== expectedState) return fail('state');

  try {
    const me = await fetchNaverWorksUser(code, origin);
    const result = await createEmployeeSession(me.email);
    if (result.error) return fail(result.error);

    const response = NextResponse.redirect(`${origin}${safeNextPath(next)}`);
    setSessionCookies(response, result);
    return response;
  } catch (err) {
    console.error('[NAVER WORKS SSO]', err);
    return fail('server');
  }
}
