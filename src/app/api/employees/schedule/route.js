import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { fetchEmployeeSchedules, saveEmployeeSchedules } from '@/lib/supabaseDb';
import { isAdminRole, isLeaderPosition } from '@/lib/roleUtils';
import { clearAttendanceCache } from '@/lib/attendanceCache';

const isManager = (session) => !!session && (isAdminRole(session) || isLeaderPosition(session.position));

const toScheduleMap = (rows = []) => rows.reduce((acc, row) => {
  const empNo = String(row?.emp_no || '').trim();
  if (!empNo) return acc;
  acc[empNo] = {
    scheduleStart: String(row?.schedule_time || '08:00').substring(0, 5),
    scheduleEnd: String(row?.schedule_end_time || '').substring(0, 5),
  };
  return acc;
}, {});

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!isManager(session)) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 });
    }

    const rows = await fetchEmployeeSchedules();
    return NextResponse.json({
      success: true,
      schedules: toScheduleMap(rows),
      rows
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: publicErrorMessage(err, '일정 조회 중 오류가 발생했습니다.')
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!isManager(session)) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const payload = body?.empNo
      ? {
          [body.empNo]: {
            scheduleTime: body.scheduleStart || body.schedule || '',
            scheduleEndTime: body.scheduleEnd || null,
          },
        }
      : (body?.schedules || {});

    if (!payload || Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, error: '저장할 일정이 없습니다.' }, { status: 400 });
    }

    await saveEmployeeSchedules(payload, session.userId);
    clearAttendanceCache();
    const rows = await fetchEmployeeSchedules();

    return NextResponse.json({
      success: true,
      schedules: toScheduleMap(rows),
      rows
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: publicErrorMessage(err, '일정 저장 중 오류가 발생했습니다.')
    }, { status: 500 });
  }
}
