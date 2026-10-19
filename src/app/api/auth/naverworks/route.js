import { NextResponse } from 'next/server';
import { SSO_STATE_COOKIE, buildAuthorizeUrl } from '@/lib/naverWorksSso';

export async function GET(request) {
  const { origin, searchParams } = new URL(request.url);
  const { url, cookie } = buildAuthorizeUrl(origin, searchParams.get('next'));
  const response = NextResponse.redirect(url);
  response.cookies.set(SSO_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
