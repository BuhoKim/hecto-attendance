import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await verifySession(request);
    if (!user) return NextResponse.json({ success: false, user: null }, { status: 401 });
    return NextResponse.json({ success: true, user }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[Auth Me]', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
