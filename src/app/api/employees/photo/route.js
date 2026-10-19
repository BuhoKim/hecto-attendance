import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { getAccessToken, isNaverWorksConfigured } from '@/lib/naverWorks';

// Proxies NAVER WORKS profile photos; the photo URL itself requires a bearer token.
export async function GET(request) {
  const session = await verifySession(request);
  if (!session) return new NextResponse(null, { status: 401 });

  const empNo = new URL(request.url).searchParams.get('empNo');
  const notFound = (reason) => (console.warn('[Employee photo] miss', reason), new NextResponse)(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Photo-Reason': reason } });
  if (!empNo) return notFound('emp_no');
  if (!isNaverWorksConfigured()) return notFound('config');

  const { data: employee } = await getAdminClient()
    .from('sa_employees')
    .select('email')
    .eq('emp_no', empNo)
    .maybeSingle();
  if (!employee?.email) return notFound('email');

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    // The API redirects to a different host; fetch drops Authorization on
    // cross-origin redirects, so follow it manually with the token.
    const redirect = await fetch(`https://www.worksapis.com/v1.0/users/${encodeURIComponent(employee.email)}/photo`, {
      headers,
      redirect: 'manual',
    });
    const location = redirect.headers.get('location');
    const res = location ? await fetch(location, { headers }) : redirect;
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
      console.warn('[Employee photo] upstream', redirect.status, res.status);
      return notFound(`upstream_${redirect.status}_${res.status}`);
    }
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': res.headers.get('content-type'),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[Employee photo]', err.message);
    return new NextResponse(null, { status: 502 });
  }
}
