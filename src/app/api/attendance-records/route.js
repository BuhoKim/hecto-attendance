import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { getKstDateKey, shiftKstDateKey, getKstDateTimeKey } from '@/lib/kstDate';
import { deleteAttendanceLogAdjustment, saveAttendanceLogAdjustment } from '@/lib/supabaseDb';
import { isAdminRole, isExecutivePosition, isLeaderPosition } from '@/lib/roleUtils';

export const dynamic = 'force-dynamic';

const parseDateInput = (value, fallback) => {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
};

const shiftDate = (dateStr, days) => shiftKstDateKey(dateStr, days);

const formatAttendanceLogTime = (row = {}) => {
  if (row.a_time && String(row.a_time).length >= 14) {
    const aTime = String(row.a_time);
    return `${aTime.substring(0, 4)}-${aTime.substring(4, 6)}-${aTime.substring(6, 8)} ${aTime.substring(8, 10)}:${aTime.substring(10, 12)}:${aTime.substring(12, 14)}`;
  }

  if (row.log_time) {
    const date = new Date(row.log_time);
    return getKstDateTimeKey(date);
  }

  return getKstDateTimeKey();
};

const eventTypeFromFlag = (flag1) => {
  if (String(flag1 || '') === '1') return '출근';
  if (String(flag1 || '') === '4') return '퇴근';
  return '출입';
};

const isAllowed = (session) =>
  !!session && (session.isAdmin || isLeaderPosition(session.position) || isExecutivePosition(session.position) || isAdminRole(session));

const normalizeRole = (value) => {
  const text = String(value || '').trim();
  if (text === '출근' || text === '퇴근' || text === '무시하기') return text;
  return '';
};

const canViewAllEmployees = (session) => !!session?.isAdmin;

const canAccessEmployee = (session, employee) => {
  if (!session || !employee) return false;
  if (canViewAllEmployees(session)) return true;
  if (isLeaderPosition(session.position)) {
    return String(employee.dept || '').trim() === String(session.team || '').trim();
  }
  return false;
};

async function loadEmployeesForSession(supabase, session) {
  let employeeQuery = supabase
    .from('sa_employees')
    .select('emp_no, name, dept, is_active')
    .eq('is_active', true)
    .order('dept', { ascending: true })
    .order('name', { ascending: true });

  if (!canViewAllEmployees(session) && isLeaderPosition(session.position)) {
    employeeQuery = employeeQuery.eq('dept', session.team || '__no_team__');
  }

  return employeeQuery;
}

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!isAllowed(session)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const empNo = String(searchParams.get('empNo') || '').trim();
    const today = getKstDateKey(new Date());
    const from = parseDateInput(searchParams.get('from'), today);
    const to = parseDateInput(searchParams.get('to'), today);

    const supabase = getAdminClient();

    const { data: employeeRows, error: employeeErr } = await loadEmployeesForSession(supabase, session);

    if (employeeErr) {
      return NextResponse.json({ error: `직원 조회 실패: ${employeeErr.message}` }, { status: 500 });
    }

    if (!empNo) {
      return NextResponse.json({
        success: true,
        employees: employeeRows || [],
        logs: [],
        adjustments: [],
        range: { from, to },
      });
    }

    const selectedEmployee = (employeeRows || []).find((employee) => String(employee.emp_no) === empNo) || null;
    if (!canAccessEmployee(session, selectedEmployee)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const actualFrom = shiftDate(from, -1);
    const actualTo = shiftDate(to, 1);
    const logFrom = `${actualFrom}T00:00:00+09:00`;
    const logTo = `${actualTo}T23:59:59+09:00`;

    const { data: rawLogs, error: logErr } = await supabase
      .from('sa_attendance')
      .select('id, sabun, emp_no, card_no, a_time, log_time, eq_code, gate_name, flag1, event_type, source')
      .eq('emp_no', empNo)
      .gte('log_time', logFrom)
      .lte('log_time', logTo)
      .order('log_time', { ascending: true });

    if (logErr) {
      return NextResponse.json({ error: `출입기록 조회 실패: ${logErr.message}` }, { status: 500 });
    }

    const attendanceIds = (rawLogs || []).map((log) => log.id).filter(Boolean);
    let adjustments = [];
    if (attendanceIds.length > 0) {
      const { data: rawAdjustments, error: adjustErr } = await supabase
        .from('sa_attendance_log_adjustments')
        .select('id, attendance_id, emp_no, work_date, adjusted_role, note, adjusted_by, created_at, updated_at')
        .in('attendance_id', attendanceIds);

      if (adjustErr) {
        const message = String(adjustErr.message || '').toLowerCase();
        if (!message.includes('sa_attendance_log_adjustments') && String(adjustErr.code || '').toLowerCase() !== '42p01') {
          return NextResponse.json({ error: `귀속 기록 조회 실패: ${adjustErr.message}` }, { status: 500 });
        }
      } else {
        adjustments = rawAdjustments || [];
      }
    }

    const adjustmentMap = new Map((adjustments || []).map((row) => [String(row.attendance_id), row]));

    const logs = (rawLogs || [])
      .map((row) => {
        const logTime = formatAttendanceLogTime(row);
        const rawWorkDate = logTime.split(' ')[0];
        const adjustment = adjustmentMap.get(String(row.id));
        const workDate = adjustment?.work_date || rawWorkDate;
        const adjustedRole = normalizeRole(adjustment?.adjusted_role);

        return {
          id: row.id,
          empNo: row.emp_no,
          cardNo: row.card_no || '',
          logTime,
          rawWorkDate,
          workDate,
          gateName: row.gate_name || '',
          flag1: row.flag1 || '',
          source: row.source || 'secom',
          eventType: adjustedRole || row.event_type || eventTypeFromFlag(row.flag1),
          adjustedRole,
          adjustmentId: adjustment?.id || null,
          adjustmentNote: adjustment?.note || '',
          isAdjusted: !!adjustment,
        };
      })
      .filter((row) => row.workDate >= from && row.workDate <= to);

    return NextResponse.json({
      success: true,
      employees: employeeRows || [],
      logs,
      adjustments,
      range: { from, to },
    });
  } catch (err) {
    console.error('[Attendance Records GET]', err);
    return NextResponse.json({ error: publicErrorMessage(err, '조회 중 오류가 발생했습니다.') }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!isAllowed(session)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const attendanceId = Number(body.attendanceId);
    const empNo = String(body.empNo || '').trim();
    const workDate = parseDateInput(body.workDate, '');
    const rawAdjustedRole = String(body.adjustedRole || '').trim();
    const adjustedRole = normalizeRole(rawAdjustedRole) || (
      rawAdjustedRole === '출근'
      || rawAdjustedRole === '퇴근'
      || rawAdjustedRole === '무시하기'
        ? rawAdjustedRole
        : ''
    );
    const note = String(body.note || '').trim();

    if (!attendanceId || !empNo || !workDate) {
      return NextResponse.json({ error: '필수값이 누락되었습니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: employeeRows, error: employeeErr } = await loadEmployeesForSession(supabase, session);
    if (employeeErr) {
      return NextResponse.json({ error: `직원 조회 실패: ${employeeErr.message}` }, { status: 500 });
    }

    const selectedEmployee = (employeeRows || []).find((employee) => String(employee.emp_no) === empNo) || null;
    if (!canAccessEmployee(session, selectedEmployee)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    if (!adjustedRole) {
      await deleteAttendanceLogAdjustment({ attendanceId });
      return NextResponse.json({ success: true, message: '귀속을 삭제했습니다.' });
    }

    const saved = await saveAttendanceLogAdjustment({
      attendanceId,
      empNo,
      workDate,
      adjustedRole,
      note,
      userId: session.userId,
    });

    return NextResponse.json({
      success: true,
      message: '귀속을 저장했습니다.',
      adjustment: saved?.[0] || saved || null,
    });
  } catch (err) {
    console.error('[Attendance Records POST]', err);
    if (err?.code === 'MISSING_ATTENDANCE_LOG_ADJUSTMENTS_TABLE') {
      return NextResponse.json({ error: publicErrorMessage(err, '근태 기록 구조가 준비되지 않았습니다.') }, { status: 409 });
    }
    return NextResponse.json({ error: publicErrorMessage(err, '저장 중 오류가 발생했습니다.') }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!isAllowed(session)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const attendanceId = Number(body.attendanceId);
    if (!attendanceId) {
      return NextResponse.json({ error: 'attendanceId가 필요합니다.' }, { status: 400 });
    }

    await deleteAttendanceLogAdjustment({ attendanceId });
    return NextResponse.json({ success: true, message: '귀속을 삭제했습니다.' });
  } catch (err) {
    console.error('[Attendance Records DELETE]', err);
    if (err?.code === 'MISSING_ATTENDANCE_LOG_ADJUSTMENTS_TABLE') {
      return NextResponse.json({ error: publicErrorMessage(err, '근태 기록 구조가 준비되지 않았습니다.') }, { status: 409 });
    }
    return NextResponse.json({ error: publicErrorMessage(err, '삭제 중 오류가 발생했습니다.') }, { status: 500 });
  }
}
