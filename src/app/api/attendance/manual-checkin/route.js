import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import {
  saveManualCheckin,
  decideManualCheckin,
  saveAttendanceCorrection,
  saveAttendanceLogAdjustment,
  saveScheduleOverride,
} from '@/lib/supabaseDb';
import { shiftKstDateKey } from '@/lib/kstDate';
import { isLeaderPosition } from '@/lib/roleUtils';
import { sendPushNotification } from '@/lib/pushService';

const MANUAL_PREFIX = '수정요청-';

const normalizeType = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith(MANUAL_PREFIX)) return text.slice(MANUAL_PREFIX.length).trim();
  if (text.startsWith('수정 요청-')) return text.slice('수정 요청-'.length).trim();
  if (text.includes('근무일정') && text.includes('조정')) return '근무일정조정';
  return text;
};

const getIsoTimeForWorkDate = (workDate, timeValue) => {
  const value = String(timeValue || '').trim();
  if (!value) return `${workDate}T00:00:00+09:00`;
  if (value.includes('T')) {
    return value.includes('+09:00') || value.includes('Z')
      ? value
      : `${value.substring(0, 19)}+09:00`;
  }
  if (value.includes(' ')) {
    const base = value.replace(' ', 'T').substring(0, 19);
    return `${base}+09:00`;
  }
  return `${workDate}T${value.substring(0, 5)}:00+09:00`;
};

const getKstTimePart = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    if (raw.includes('T')) return raw.split('T')[1].substring(0, 5);
    if (raw.includes(' ')) return raw.split(' ')[1].substring(0, 5);
    return raw.substring(0, 5);
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getDatePartFromIsoLike = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('T')) return raw.split('T')[0];
  if (raw.includes(' ')) return raw.split(' ')[0];
  return raw.substring(0, 10);
};

const parseRequestNote = (note) => {
  const raw = String(note || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // plain text memo
  }
  return { reason: raw };
};

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const {
      checkType,
      checkTime,
      workDate,
      note,
      currentScheduleStart,
      currentScheduleEnd,
    } = await request.json();

    if (!checkType || !workDate) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    const empNo = session.empNo;
    if (!empNo) {
      return NextResponse.json({ error: '사원번호를 찾을 수 없습니다.' }, { status: 400 });
    }

    const requestTypeText = String(checkType || '').trim();
    const isCheckoutRequest = requestTypeText.includes('퇴근');

    let timePart = '';
    const rawTime = String(checkTime || '').trim();
    if (rawTime.includes('T')) {
      timePart = rawTime.split('T')[1].substring(0, 5);
    } else if (rawTime.includes(' ')) {
      timePart = rawTime.split(' ')[1].substring(0, 5);
    } else {
      timePart = rawTime.substring(0, 5) || '00:00';
    }

    let targetDate = workDate;
    if (isCheckoutRequest) {
      const [hours = 0, minutes = 0] = timePart.split(':').map(Number);
      const totalMinutes = hours * 60 + minutes;
      if (totalMinutes < 6 * 60) {
        targetDate = shiftKstDateKey(workDate, 1);
      }
    }

    const normalizedCheckTime = `${targetDate}T${timePart}:00+09:00`;

    const isScheduleRequest = requestTypeText.includes('근무일정') || requestTypeText.includes('일정');
    const parsedNote = parseRequestNote(note);

    if (isScheduleRequest) {
      const scheduleStart = String(parsedNote.scheduleStart || '').trim();
      const scheduleEnd = String(parsedNote.scheduleEnd || '').trim();
      const reason = String(parsedNote.reason || '').trim();
      const existingStart = String(currentScheduleStart || parsedNote.currentScheduleStart || '').trim();
      const existingEnd = String(currentScheduleEnd || parsedNote.currentScheduleEnd || '').trim();

      if (!reason) {
        return NextResponse.json({ error: '근무일정 조정 사유를 반드시 입력해주세요.' }, { status: 400 });
      }

      if (!scheduleStart || !scheduleEnd) {
        return NextResponse.json({ error: '근무일정 시작/종료 시간을 모두 선택해주세요.' }, { status: 400 });
      }

      if (existingStart && existingEnd && existingStart === scheduleStart && existingEnd === scheduleEnd) {
        return NextResponse.json({ error: '현재 근무일정과 동일한 값은 요청할 수 없습니다.' }, { status: 400 });
      }
    }

    const normalizedNote = isScheduleRequest
      ? JSON.stringify({
          scheduleStart: String(parsedNote.scheduleStart || '').trim(),
          scheduleEnd: String(parsedNote.scheduleEnd || '').trim(),
          allowOvertime: parsedNote.allowOvertime !== false,
          reason: String(parsedNote.reason || '').trim(),
          currentScheduleStart: String(currentScheduleStart || parsedNote.currentScheduleStart || '').trim() || null,
          currentScheduleEnd: String(currentScheduleEnd || parsedNote.currentScheduleEnd || '').trim() || null,
        })
      : (note || '');

    await saveManualCheckin({
      empNo,
      checkType,
      checkTime: normalizedCheckTime,
      workDate,
      note: normalizedNote,
    });

    try {
      const supabase = getAdminClient();
      const { data: requestor } = await supabase
        .from('sa_employees')
        .select('name, dept')
        .eq('emp_no', empNo)
        .single();

      if (requestor?.dept) {
        const { data: deptMembers } = await supabase
          .from('sa_employees')
          .select('emp_no, position')
          .eq('dept', requestor.dept)
          .eq('is_active', true);

        const { data: admins } = await supabase
          .from('sa_profiles')
          .select('emp_no')
          .eq('is_admin', true);

        const leaders = (deptMembers || []).filter(member => isLeaderPosition(member.position));

        const targetEmpNos = new Set([
          ...leaders.map(l => l.emp_no),
          ...(admins || []).map(a => a.emp_no)
        ]);
        
        targetEmpNos.delete(empNo); // Don't notify themselves

        const pushTitle = '새로운 조정 요청';
        const pushBody = `${requestor.name} 님의 ${requestTypeText} 요청이 등록되었습니다.`;

        targetEmpNos.forEach(targetEmpNo => {
          sendPushNotification(targetEmpNo, pushTitle, pushBody, '/?tab=MANUAL_APPROVAL').catch(err => {
            console.error('Background push notification failed:', err);
          });
        });
      }
    } catch (pushErr) {
      console.error('Failed to initiate push notification to leader:', pushErr);
    }

    return NextResponse.json({
      success: true,
      message: '출퇴근 기록이 등록되었습니다. 관리자 확인 대기 중입니다.',
    });
  } catch (err) {
    console.error('[Manual Checkin API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    if (!session.isAdmin && !isLeaderPosition(session.position)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const { id, decision } = await request.json();
    if (!id || !decision) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: targetCheckin, error: targetError } = await supabase
      .from('sa_manual_checkins')
      .select('emp_no, check_type, check_time, work_date, note')
      .eq('id', id)
      .single();

    if (targetError || !targetCheckin?.emp_no) {
      return NextResponse.json({ error: '요청 정보를 확인할 수 없습니다.' }, { status: 404 });
    }

    if (!session.isAdmin) {
      const { data: targetEmployee, error: employeeError } = await supabase
        .from('sa_employees')
        .select('dept')
        .eq('emp_no', targetCheckin.emp_no)
        .single();

      if (employeeError || !targetEmployee?.dept) {
        return NextResponse.json({ error: '요청자 정보를 확인할 수 없습니다.' }, { status: 404 });
      }

      const requestDept = String(targetEmployee.dept || '').trim().replace(/\s+/g, '');
      const leaderDept = String(session.team || '').trim().replace(/\s+/g, '');
      if (!leaderDept || requestDept !== leaderDept) {
        return NextResponse.json({ error: '본인 부서 요청만 처리할 수 있습니다.' }, { status: 403 });
      }
    }

    const rawType = String(targetCheckin.check_type || '').trim();
    const requestType = normalizeType(rawType);
    const requestMeta = parseRequestNote(targetCheckin.note);
    const approvalTime = getKstTimePart(targetCheckin.check_time);
    const isScheduleRequest = requestType.includes('근무일정') || requestType.includes('일정');

    if (decision === 'approved') {
      if (requestType === '출근') {
        const nextWorkDate = shiftKstDateKey(targetCheckin.work_date, 1);
        const { data: dayLogs, error: dayLogsError } = await supabase
          .from('sa_attendance')
          .select('id, emp_no, log_time')
          .eq('emp_no', targetCheckin.emp_no)
          .gte('log_time', `${targetCheckin.work_date}T00:00:00+09:00`)
          .lt('log_time', getIsoTimeForWorkDate(nextWorkDate, '00:00'))
          .order('log_time', { ascending: true })
          .limit(20);

        if (dayLogsError) throw dayLogsError;

        await Promise.all((dayLogs || []).map((log) => saveAttendanceLogAdjustment({
          attendanceId: log.id,
          empNo: targetCheckin.emp_no,
          workDate: getDatePartFromIsoLike(log.log_time) || targetCheckin.work_date,
          adjustedRole: '무시처리',
          note: `MANUAL_CHECKIN:${targetCheckin.id}:${targetCheckin.note || '출근 수정 요청 승인'}`,
          userId: session.userId,
        })));
      } else if (requestType === '퇴근') {
        await saveAttendanceCorrection({
          empNo: targetCheckin.emp_no,
          workDate: targetCheckin.work_date,
          correctedOutTime: getIsoTimeForWorkDate(targetCheckin.work_date, approvalTime),
          reason: `MANUAL_CHECKIN:${targetCheckin.id}:${targetCheckin.note || ''}`,
          userId: session.userId,
        });
      } else if (isScheduleRequest) {
        const scheduleStart = String(requestMeta.scheduleStart || requestMeta.start || '').trim();
        const scheduleEnd = String(requestMeta.scheduleEnd || requestMeta.end || '').trim();
        if (scheduleStart && scheduleEnd) {
          await saveScheduleOverride({
            empNo: targetCheckin.emp_no,
            workDate: targetCheckin.work_date,
            scheduleStart,
            scheduleEnd,
            allowOvertime: requestMeta.allowOvertime !== false,
            note: requestMeta.reason || '',
            userId: session.userId,
            removed: false,
          });
        }
      }
    }

    await decideManualCheckin({
      id,
      decision,
      userId: session.userId,
    });

    if (requestType === '출근' || requestType === '퇴근' || isScheduleRequest) {
      const updatePayload = {
        check_type: rawType,
        check_time: targetCheckin.check_time,
      };
      if (isScheduleRequest && requestMeta.scheduleStart) {
        updatePayload.check_time = getIsoTimeForWorkDate(targetCheckin.work_date, requestMeta.scheduleStart);
      }

      const { error: normalizeError } = await supabase
        .from('sa_manual_checkins')
        .update(updatePayload)
        .eq('id', id);

      if (normalizeError) {
        throw normalizeError;
      }
    }

    try {
      const decisionStr = decision === 'approved' ? '승인' : '반려';
      const pushTitle = '조정 요청 결과';
      const pushBody = `${targetCheckin.work_date} 일자의 ${requestType} 요청이 ${decisionStr}되었습니다.`;
      // Run asynchronously to avoid blocking the response
      sendPushNotification(targetCheckin.emp_no, pushTitle, pushBody, '/?tab=TRACKER').catch(err => {
        console.error('Background push notification failed:', err);
      });
    } catch (pushErr) {
      console.error('Failed to initiate push notification:', pushErr);
    }

    return NextResponse.json({ success: true, message: '처리가 완료되었습니다.' });
  } catch (err) {
    console.error('[Manual Checkin Decide API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}
