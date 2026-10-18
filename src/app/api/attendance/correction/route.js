import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import {
  deleteAttendanceCorrection,
  deleteAttendanceLogAdjustmentsByNotePrefix,
  deleteManualCheckin,
  deleteManualCheckinById,
  deleteScheduleOverride,
  saveAttendanceCorrection,
  saveManualCheckin,
} from '@/lib/supabaseDb';
import { isLeaderPosition } from '@/lib/roleUtils';

const MANUAL_PREFIX = '수정요청-';

const requireManager = (session) => !!session && (session.isAdmin || isLeaderPosition(session.position));

const normalizeType = (value = '') => {
  const text = String(value || '').trim();
  if (text.startsWith(MANUAL_PREFIX)) return text.slice(MANUAL_PREFIX.length).trim();
  if (text.startsWith('수정 요청-')) return text.slice('수정 요청-'.length).trim();
  if (text === '일정조정') return '근무일정조정';
  return text;
};

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!requireManager(session)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const empNo = String(body.empNo || '').trim();
    const workDate = String(body.workDate || '').trim();
    const correctionType = normalizeType(body.correctionType || body.type || '');
    const correctionTime = String(body.correctionTime || '').trim();
    const reason = String(body.reason || body.note || '').trim();

    if (!empNo || !workDate || !correctionType || !correctionTime) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    let timePart = '';
    if (correctionTime.includes('T')) {
      timePart = correctionTime.split('T')[1].substring(0, 5);
    } else {
      timePart = correctionTime.substring(0, 5);
    }

    let targetDate = workDate;
    if (correctionType === '퇴근') {
      const [hours = 0, minutes = 0] = timePart.split(':').map(Number);
      const totalMinutes = hours * 60 + minutes;
      if (totalMinutes < 6 * 60) {
        const date = new Date(`${workDate}T12:00:00+09:00`);
        date.setDate(date.getDate() + 1);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        targetDate = `${y}-${m}-${d}`;
      }
    }

    const isoString = `${targetDate}T${timePart}:00+09:00`;

    if (correctionType === '출근') {
      await saveManualCheckin({
        empNo,
        checkType: `${MANUAL_PREFIX}출근`,
        checkTime: isoString,
        workDate,
        note: reason,
        adminDecision: 'approved',
        decidedBy: session.userId,
      });
    } else if (correctionType === '퇴근') {
      await deleteAttendanceCorrection({ empNo, workDate }).catch(() => null);
      await saveManualCheckin({
        empNo,
        checkType: `${MANUAL_PREFIX}퇴근`,
        checkTime: isoString,
        workDate,
        note: reason,
        adminDecision: 'approved',
        decidedBy: session.userId,
      });
    } else if (correctionType === '근무일정조정') {
      await saveManualCheckin({
        empNo,
        checkType: `${MANUAL_PREFIX}근무일정조정`,
        checkTime: isoString,
        workDate,
        note: reason,
        adminDecision: 'approved',
        decidedBy: session.userId,
      });
    }

    return NextResponse.json({ success: true, message: '근태 보정이 저장되었습니다.' });
  } catch (err) {
    console.error('[Correction API]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!requireManager(session)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
    const manualCheckinId = String(body.manualCheckinId || '').trim();
    const empNo = String(body.empNo || '').trim();
    const workDate = String(body.workDate || '').trim();
    const correctionType = normalizeType(body.correctionType || body.type || '');

    const supabase = getAdminClient();

    const removeManualRow = async (row) => {
      const rowType = normalizeType(row.check_type);
      if (rowType === '출근') {
        await deleteAttendanceLogAdjustmentsByNotePrefix({ notePrefix: `MANUAL_CHECKIN:${row.id}:` }).catch(() => null);
      }
      if (rowType === '퇴근') {
        await deleteAttendanceCorrection({ empNo: row.emp_no, workDate: row.work_date }).catch(() => null);
      }
      if (rowType === '근무일정조정') {
        await deleteScheduleOverride({ empNo: row.emp_no, workDate: row.work_date }).catch(() => null);
      }
      await deleteManualCheckinById({ id: row.id });
    };

    if (ids.length > 0) {
      const { data: rows, error } = await supabase
        .from('sa_manual_checkins')
        .select('id, emp_no, work_date, check_type')
        .in('id', ids);
      if (error) throw error;

      for (const row of rows || []) {
        await removeManualRow(row);
      }

      return NextResponse.json({ success: true, message: '선택한 수동 기록이 삭제되었습니다.' });
    }

    if (manualCheckinId) {
      const { data: row, error } = await supabase
        .from('sa_manual_checkins')
        .select('id, emp_no, work_date, check_type')
        .eq('id', manualCheckinId)
        .single();
      if (error || !row?.id) {
        return NextResponse.json({ error: '삭제할 수동 기록을 찾을 수 없습니다.' }, { status: 404 });
      }
      await removeManualRow(row);
      return NextResponse.json({ success: true, message: '수동 기록이 삭제되었습니다.' });
    }

    if (!empNo || !workDate || !correctionType) {
      return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 });
    }

    await deleteManualCheckin({ empNo, workDate, checkType: `${MANUAL_PREFIX}${correctionType}` });

    if (correctionType === '퇴근') {
      await deleteAttendanceCorrection({ empNo, workDate }).catch(() => null);
    }
    if (correctionType === '근무일정조정') {
      await deleteScheduleOverride({ empNo, workDate }).catch(() => null);
    }

    return NextResponse.json({ success: true, message: '근태 보정이 삭제되었습니다.' });
  } catch (err) {
    console.error('[Correction API DELETE]', err);
    return NextResponse.json({ error: publicErrorMessage(err) }, { status: 500 });
  }
}
