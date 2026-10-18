import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import {
  deleteTeamSchedulePattern,
  fetchTeamSchedulePatterns,
  saveTeamSchedulePattern,
} from '@/lib/supabaseDb';
import { canManageTeamSchedule } from '@/lib/nightScheduleRules';

const parseMonthRange = (yearMonth) => {
  const [year, month] = String(yearMonth || '').split('-');
  if (!year || !month) return null;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
};

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!canManageTeamSchedule(session)) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';
    const range = parseMonthRange(month);
    const rows = await fetchTeamSchedulePatterns({
      from: range?.from,
      to: range?.to,
    });

    return NextResponse.json({ success: true, patterns: rows });
  } catch (error) {
    console.error('[Team Schedule GET]', error);
    return NextResponse.json({ success: false, error: publicErrorMessage(error, '조회 중 오류가 발생했습니다.') }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!canManageTeamSchedule(session)) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const deptName = String(body?.deptName || '').trim();
    const workDate = String(body?.workDate || '').trim();
    const patternCode = String(body?.patternCode || '').trim();
    const patternName = String(body?.patternName || '').trim();
    const scheduleStart = String(body?.scheduleStart || '').trim();
    const scheduleEnd = String(body?.scheduleEnd || '').trim();
    const note = String(body?.note || '').trim();

    if (!deptName) {
      return NextResponse.json({ success: false, error: '부서를 선택해주세요.' }, { status: 400 });
    }
    if (!workDate || !patternCode || !patternName) {
      return NextResponse.json({ success: false, error: '적용 날짜와 패턴을 입력해주세요.' }, { status: 400 });
    }

    await saveTeamSchedulePattern({
      deptName,
      workDate,
      patternCode,
      patternName,
      scheduleStart: scheduleStart || null,
      scheduleEnd: scheduleEnd || null,
      note,
      userId: session.userId,
    });

    const range = parseMonthRange(workDate.slice(0, 7));
    const rows = await fetchTeamSchedulePatterns({
      from: range?.from,
      to: range?.to,
    });

    return NextResponse.json({
      success: true,
      message: '스케줄이 저장되었습니다.',
      patterns: rows,
    });
  } catch (error) {
    console.error('[Team Schedule POST]', error);
    const status = error?.code === 'MISSING_TEAM_SCHEDULE_TABLE' ? 503 : 500;
    return NextResponse.json({ success: false, error: publicErrorMessage(error, '팀 스케줄 저장 중 오류가 발생했습니다.') }, { status });
  }
}

export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!canManageTeamSchedule(session)) {
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const deptName = String(body?.deptName || '').trim();
    const workDate = String(body?.workDate || '').trim();

    if (!deptName) {
      return NextResponse.json({ success: false, error: '부서를 선택해주세요.' }, { status: 400 });
    }
    if (!workDate) {
      return NextResponse.json({ success: false, error: '삭제할 날짜를 입력해주세요.' }, { status: 400 });
    }

    await deleteTeamSchedulePattern({ deptName, workDate });
    return NextResponse.json({ success: true, message: '스케줄이 삭제되었습니다.' });
  } catch (error) {
    console.error('[Team Schedule DELETE]', error);
    const status = error?.code === 'MISSING_TEAM_SCHEDULE_TABLE' ? 503 : 500;
    return NextResponse.json({ success: false, error: publicErrorMessage(error, '팀 스케줄 삭제 중 오류가 발생했습니다.') }, { status });
  }
}
