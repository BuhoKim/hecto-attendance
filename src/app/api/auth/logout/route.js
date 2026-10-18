import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });

  const cookieOpts = { path: '/', maxAge: 0 };
  response.cookies.set('sb-access-token',      '', cookieOpts);
  response.cookies.set('sb-refresh-token',      '', cookieOpts);
  response.cookies.set('sa-auth-mode',           '', cookieOpts);
  response.cookies.set('must-change-password',  '', cookieOpts);
  response.cookies.set('user-emp-no',           '', cookieOpts);
  response.cookies.set('user-is-admin',         '', cookieOpts);
  response.cookies.set('user-position',         '', cookieOpts);
  response.cookies.set('user-rank',             '', cookieOpts);
  response.cookies.set('user-name',             '', cookieOpts);
  response.cookies.set('user-login-id',         '', cookieOpts);
  response.cookies.set('user-team',              '', cookieOpts);

  return response;
}
