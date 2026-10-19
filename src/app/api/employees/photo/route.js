import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { getAccessToken, isNaverWorksConfigured } from '@/lib/naverWorks';

const DIRECTORY_TTL_MS = 10 * 60 * 1000;
let directoryCache = { at: 0, byName: null };

// Some employees have no email in the DB; map them by unique NAVER WORKS name.
async function getDirectoryByName(headers) {
  if (directoryCache.byName && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) return directoryCache.byName;
  const counts = new Map();
  const byName = new Map();
  let cursor = '';
  do {
    const res = await fetch(`https://www.worksapis.com/v1.0/users?count=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers });
    if (!res.ok) throw new Error(`users ${res.status}`);
    const body = await res.json();
    for (const user of body.users || []) {
      const name = String(user.userName?.lastName || '') + String(user.userName?.firstName || '');
      if (!name || !user.email || user.isDeleted) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
      byName.set(name, user.email);
    }
    cursor = body.responseMetaData?.nextCursor || '';
  } while (cursor);
  for (const [name, count] of counts) if (count > 1) byName.delete(name);
  directoryCache = { at: Date.now(), byName };
  return byName;
}

// Proxies NAVER WORKS profile photos; the photo URL itself requires a bearer token.
export async function GET(request) {
  const session = await verifySession(request);
  if (!session) return new NextResponse(null, { status: 401 });

  const empNo = new URL(request.url).searchParams.get('empNo');
  const notFound = (reason) => {
    console.warn('[Employee photo] miss', reason);
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Photo-Reason': reason } });
  };
  if (!empNo) return notFound('emp_no');
  if (!isNaverWorksConfigured()) return notFound('config');

  const { data: employee } = await getAdminClient()
    .from('sa_employees')
    .select('email,name')
    .eq('emp_no', empNo)
    .maybeSingle();
  if (!employee) return notFound('employee');

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const email = employee.email || (await getDirectoryByName(headers)).get(String(employee.name || '').trim());
    if (!email) {
      const directory = await getDirectoryByName(headers);
      console.warn('[Employee photo] no email', { hasName: !!employee.name, nameLength: String(employee.name || '').length, directorySize: directory.size });
      return notFound('email');
    }

    // The API redirects to a different host; fetch drops Authorization on
    // cross-origin redirects, so follow it manually with the token.
    const redirect = await fetch(`https://www.worksapis.com/v1.0/users/${encodeURIComponent(email)}/photo`, {
      headers,
      redirect: 'manual',
    });
    const location = redirect.headers.get('location');
    const res = location ? await fetch(location, { headers }) : redirect;
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
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
