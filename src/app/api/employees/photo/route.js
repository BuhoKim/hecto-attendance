import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { getAccessToken, isNaverWorksConfigured } from '@/lib/naverWorks';

// Proxies NAVER WORKS profile photos; the photo URL itself requires a bearer token.
export async function GET(request) {
  const session = await verifySession(request);
  if (!session) return new NextResponse(null, { status: 401 });

  const empNo = new URL(request.url).searchParams.get('empNo');
  if (!empNo || !isNaverWorksConfigured()) return new NextResponse(null, { status: 404 });

  const { data: employee } = await getAdminClient()
    .from('sa_employees')
    .select('email')
    .eq('emp_no', empNo)
    .maybeSingle();
  if (!employee?.email) return new NextResponse(null, { status: 404 });

  try {
    const token = await getAccessToken();
    const res = await fetch(`https://www.worksapis.com/v1.0/users/${encodeURIComponent(employee.email)}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } });
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
