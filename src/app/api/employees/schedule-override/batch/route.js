import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { saveScheduleOverridesBatch } from '@/lib/supabaseDb';
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

    const body = await request.json();
    const empNo = String(body?.empNo || '').trim();
    const workDates = Array.isArray(body?.workDates)
      ? body.workDates.map((date) => String(date || '').trim()).filter(Boolean)
      : [];
    const scheduleStart = String(body?.scheduleStart || '').trim();
    const scheduleEnd = String(body?.scheduleEnd || '').trim();
    const allowOvertime = body?.allowOvertime !== false;
    const note = String(body?.note || '').trim();
    const removed = Boolean(body?.removed);

    if (!empNo || workDates.length === 0 || (!scheduleStart && !removed)) {
      return NextResponse.json({ error: '직원, 날짜, 시작시간이 필요합니다.' }, { status: 400 });
    }

    await saveScheduleOverridesBatch({
      empNo,
      workDates,
      scheduleStart: scheduleStart || '00:00',
      scheduleEnd: scheduleEnd || null,
      allowOvertime,
      note,
      userId: session.userId,
      removed,
    });

    clearAttendanceCache();

    return NextResponse.json({
      success: true,
      message: removed ? '근무일정 없음으로 처리되었습니다.' : '근무일정이 저장되었습니다.',
    });
  } catch (err) {
    console.error('[Schedule Override Batch API]', err);
    return NextResponse.json({ error: publicErrorMessage(err, '근무일정 저장 중 오류가 발생했습니다.') }, { status: 500 });
  }
}
