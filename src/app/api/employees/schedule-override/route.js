import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { deleteScheduleOverride, saveScheduleOverride } from '@/lib/supabaseDb';
import { isAdminRole, isLeaderPosition } from '@/lib/roleUtils';
import { clearAttendanceCache } from '@/lib/attendanceCache';

const canManageOverrides = (session) => isAdminRole(session) || isLeaderPosition(session?.position);

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!canManageOverrides(session)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const { empNo, workDate, scheduleStart, scheduleEnd, allowOvertime, note, removed } = await request.json();
    if (!empNo || !workDate || !scheduleStart) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    await saveScheduleOverride({
      empNo,
      workDate,
      scheduleStart,
      scheduleEnd: scheduleEnd || null,
      allowOvertime: allowOvertime !== false,
      note: note || '',
      userId: session.userId,
      removed: Boolean(removed),
    });

    clearAttendanceCache();

    return NextResponse.json({ success: true, message: '근무시간이 저장되었습니다.' });
  } catch (err) {
    console.error('[Schedule Override API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!canManageOverrides(session)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const { empNo, workDate } = await request.json();
    if (!empNo || !workDate) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    await deleteScheduleOverride({ empNo, workDate });

    clearAttendanceCache();

    return NextResponse.json({ success: true, message: '근무시간 예외가 삭제되었습니다.' });
  } catch (err) {
    console.error('[Schedule Override API DELETE]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}
