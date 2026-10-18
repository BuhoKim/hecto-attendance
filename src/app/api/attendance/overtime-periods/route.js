import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { fetchOvertimePeriods, saveOvertimePeriod, deleteOvertimePeriod } from '@/lib/supabaseDb';
import { isAdminRole } from '@/lib/roleUtils';

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const periods = await fetchOvertimePeriods();
    return NextResponse.json({ success: true, periods });
  } catch (err) {
    console.error('[Overtime Periods GET API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!isAdminRole(session)) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { name, startDate, endDate, note } = await request.json();
    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    await saveOvertimePeriod({
      name,
      startDate,
      endDate,
      note: note || '',
      userId: session.userId
    });

    return NextResponse.json({ success: true, message: '초과시간 관리 기간이 등록되었습니다.' });
  } catch (err) {
    console.error('[Overtime Periods POST API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!isAdminRole(session)) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '삭제할 ID가 누락되었습니다.' }, { status: 400 });
    }

    await deleteOvertimePeriod(id);

    return NextResponse.json({ success: true, message: '초과시간 관리 기간이 삭제되었습니다.' });
  } catch (err) {
    console.error('[Overtime Periods DELETE API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}
