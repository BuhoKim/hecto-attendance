import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { fetchHolidayWork, saveHolidayWork } from '@/lib/supabaseDb';
import { getKstMonthKey } from '@/lib/kstDate';

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getKstMonthKey();

    const holidayWorks = await fetchHolidayWork(month);
    return NextResponse.json({ success: true, holidayWorks });
  } catch (err) {
    console.error('[Holiday Work GET API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { empNo, workDate, clockIn, clockOut, workHours, compLeaveHours, isConfirmed } = await request.json();
    if (!empNo || !workDate) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    await saveHolidayWork({
      empNo,
      workDate,
      clockIn: clockIn || null,
      clockOut: clockOut || null,
      workHours: workHours || 0,
      compLeaveHours: compLeaveHours || 0,
      isConfirmed: isConfirmed ?? false,
      userId: session.userId
    });

    return NextResponse.json({ success: true, message: '휴일근무 대체휴가 처리가 업데이트되었습니다.' });
  } catch (err) {
    console.error('[Holiday Work POST API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}
