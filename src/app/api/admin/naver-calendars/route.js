import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import {
  createNaverCalendar,
  updateNaverCalendar,
  deleteNaverCalendar,
  syncDepartmentCalendarEvents,
  isNaverWorksConfigured,
  getAccessToken,
  listNaverCalendarMonth,
} from '@/lib/naverWorks';
import {
  filterCalendarMembers,
  buildNaverCalendarMembersPayload,
  validateCalendarConfigPayload,
  normalizeCalendarSourceDepts,
  buildCalendarDepartmentRoster,
  parseCalendarMemberConfig,
  calendarRosterExclusions,
} from '@/lib/naverCalendarRules.mjs';
import { getCalendarDirectoryUsers } from '@/lib/naverCalendarDirectory.mjs';

const CALENDAR_SCOPE = 'naver-works-calendar';

/**
 * GET: 부서별 네이버웍스 캘린더 생성 현황 및 구성원(MySQL 정직원 기준) 목록 반환
 */
export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin && !session.isLeader) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const supabase = getAdminClient();

    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'events') {
      if (!session.isAdmin) return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
      const dept = params.get('dept');
      const month = params.get('month') || '';
      if (!dept || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900 || Number(month.slice(0, 4)) > 2200) {
        return NextResponse.json({ error: '부서와 조회 월을 확인해 주세요.' }, { status: 400 });
      }
      const { data: records, error } = await supabase.from('sa_ical_subscriptions').select('token, depts').eq('scope', CALENDAR_SCOPE);
      if (error) throw new Error('캘린더 설정 조회에 실패했습니다.');
      const record = (records || []).find((r) => r.depts?.[0] === dept);
      if (!record?.token) return NextResponse.json({ error: '생성된 캘린더가 없습니다.' }, { status: 404 });
      const events = await listNaverCalendarMonth(record.token, month);
      return NextResponse.json({ dept, month, events, checkedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // 1. sa_employees (MySQL hr_employee에서 동기화된 정직원 목록)
    // 2. sa_ical_subscriptions (scope: naver-works-calendar 에 저장된 캘린더 매핑)
    const [empRes, calRes] = await Promise.all([
      supabase
        .from('sa_employees')
        .select('emp_no, name, dept, email, status, is_active')
        .order('name', { ascending: true }),
      supabase
        .from('sa_ical_subscriptions')
        .select('*')
        .eq('scope', CALENDAR_SCOPE),
    ]);

    if (empRes.error) {
      return NextResponse.json({ error: `직원 목록 조회 실패: ${empRes.error.message}` }, { status: 500 });
    }
    if (calRes.error) throw new Error(`캘린더 설정 조회 실패: ${calRes.error.message}`);

    const token = isNaverWorksConfigured() ? await getAccessToken() : null;
    const users = token ? await getCalendarDirectoryUsers(token) : [];
    // 퇴사/비활성 직원은 관리 화면에 표시하지 않는다.
    const employees = buildCalendarDepartmentRoster(empRes.data || [], users)
      .filter((e) => e.is_active !== false && e.status !== 'resigned');
    const calendarRecords = calRes.data || [];

    // 부서별 캘린더 매핑 (depts[0] 기준)
    const calMap = new Map();
    for (const rec of calendarRecords) {
      const dept = rec.depts?.[0] || rec.label?.replace('[연차] ', '').trim();
      if (dept) {
        calMap.set(dept, rec);
      }
    }

    // 부서별 정직원 그룹화
    const deptMap = {};
    for (const emp of employees) {
      const dept = emp.dept || '기타';
      if (!deptMap[dept]) {
        deptMap[dept] = [];
      }
      deptMap[dept].push(emp);
    }

    const departments = Object.keys(deptMap).sort().map((dept) => {
      const allEmps = deptMap[dept];
      const activeEmps = allEmps.filter((e) => e.is_active !== false && e.status !== 'resigned');
      const calRecord = calMap.get(dept) || null;

      let excludedEmpNos = [];
      let extraLeaveEmpNos = [];
      let calendarId = null;
      if (calRecord) {
        calendarId = calRecord.token; // 네이버웍스 calendarId
        try {
          const config = parseCalendarMemberConfig(calRecord.calendar_config || calRecord.owner_emp_no);
          excludedEmpNos = calendarRosterExclusions(allEmps, config);
          extraLeaveEmpNos = config.extraLeaveEmpNos;
        } catch {
          excludedEmpNos = [];
        }
      }
      if (!calRecord) excludedEmpNos = calendarRosterExclusions(allEmps, parseCalendarMemberConfig(null));

      return {
        dept,
        calendarId,
        isCreated: !!calendarId,
        isActive: calRecord ? calRecord.is_active : false,
        totalEmployees: allEmps.length,
        activeEmployees: activeEmps.length,
        excludedEmpNos,
        extraLeaveEmpNos,
        sourceDepts: normalizeCalendarSourceDepts(dept, calRecord?.depts),
        employees: allEmps.map((e) => ({
          empNo: String(e.emp_no),
          name: e.name,
          email: e.email,
          isActive: e.is_active !== false && e.status !== 'resigned',
          status: e.status || (e.is_active ? 'active' : 'inactive'),
          isExcluded: excludedEmpNos.includes(String(e.emp_no)),
          isConcurrent: e.isConcurrent,
          primaryDept: e.primaryDept,
        })),
        updatedAt: calRecord?.updated_at || null,
      };
    });

    return NextResponse.json({
      configured: isNaverWorksConfigured(),
      departments,
    });
  } catch (err) {
    console.error('[Admin Naver Calendars GET Error]', err);
    return NextResponse.json({ error: err.message || '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

/**
 * POST: 특정 부서의 캘린더 생성, 멤버 구성원 업데이트 및 일정 자동 동기화
 */
export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { dept, excludedEmpNos, extraLeaveEmpNos, sourceDepts } = validateCalendarConfigPayload(body);

    const supabase = getAdminClient();

    // 1. 해당 부서의 활성 직원 조회 (MySQL 정직원 목록 기반)
    const { data: emps, error: empErr } = await supabase
      .from('sa_employees')
      .select('emp_no, name, dept, email, status, is_active');

    if (empErr) {
      return NextResponse.json({ error: `직원 조회 실패: ${empErr.message}` }, { status: 500 });
    }
    const directoryUsers = await getCalendarDirectoryUsers(await getAccessToken());
    const roster = buildCalendarDepartmentRoster(emps || [], directoryUsers);
    const deptRoster = roster.filter((emp) => emp.dept === dept);
    const includedConcurrentEmpNos = deptRoster.filter((emp) => emp.isConcurrent && !excludedEmpNos.includes(String(emp.emp_no))).map((emp) => String(emp.emp_no));
    const knownDepts = new Set(roster.map((emp) => emp.dept));
    if (sourceDepts.some((name) => !knownDepts.has(name))) {
      return NextResponse.json({ error: '직원 명단에 없는 조직은 선택할 수 없습니다.' }, { status: 400 });
    }
    const knownEmpNos = new Set((emps || []).map((emp) => String(emp.emp_no)));
    if (extraLeaveEmpNos.some((no) => !knownEmpNos.has(no))) {
      return NextResponse.json({ error: '직원 명단에 없는 사번은 추가할 수 없습니다.' }, { status: 400 });
    }

    // 2. 제외 사번을 반영한 실제 네이버웍스 등록 대상 필터링
    // Individually added staff also get read access (two-way sharing).
    const extraMembers = (emps || []).filter((emp) => extraLeaveEmpNos.includes(String(emp.emp_no)));
    const targetMembers = filterCalendarMembers([...deptRoster, ...extraMembers], excludedEmpNos);
    const membersPayload = buildNaverCalendarMembersPayload(targetMembers);

    // 3. 기존 등록 캘린더 레코드 조회
    const { data: existingRecords, error: configError } = await supabase
      .from('sa_ical_subscriptions')
      .select('*')
      .eq('scope', CALENDAR_SCOPE);
    if (configError) throw new Error(`캘린더 설정 조회 실패: ${configError.message}`);

    const existing = (existingRecords || []).find((r) => r.depts?.[0] === dept);

    let calendarId = existing?.token || null;
    const calendarName = `[연차] ${dept}`;

    if (calendarId) {
      // 이미 캘린더가 존재하면 멤버 목록 업데이트
      {
        await updateNaverCalendar(calendarId, {
          calendarName,
          members: membersPayload,
        });

        // DB 레코드 업데이트
        const { error: saveError } = await supabase
          .from('sa_ical_subscriptions')
          .update({
            label: calendarName,
            depts: sourceDepts,
            calendar_config: { excludedEmpNos, includedConcurrentEmpNos, extraLeaveEmpNos },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (saveError) throw new Error(`설정 저장 실패: ${saveError.message}`);
      }
    } else {
      // 신규 생성
      const created = await createNaverCalendar({
        calendarName,
        description: `${dept} 연차 및 근태 공유 캘린더`,
        members: membersPayload,
      });

      calendarId = created.calendarId;

      const { error: saveError } = await supabase
        .from('sa_ical_subscriptions')
        .insert({
          token: calendarId,
          label: calendarName,
          depts: sourceDepts,
          scope: CALENDAR_SCOPE,
          calendar_config: { excludedEmpNos, includedConcurrentEmpNos, extraLeaveEmpNos },
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (saveError) throw new Error(`설정 저장 실패: ${saveError.message}`);
    }

    // 4. 연차 일정 자동 동기화
    let syncResult = null;
    let syncError = null;
    try {
      syncResult = await syncDepartmentCalendarEvents({
        calendarId,
        dept,
        sourceDepts,
        additionalEmpNos: [...includedConcurrentEmpNos, ...extraLeaveEmpNos],
        excludedEmpNos,
        supabase,
      });
    } catch (syncErr) {
      syncError = syncErr.message;
      console.warn('[Calendar Event Sync Warning]', syncErr.message);
    }

    return NextResponse.json({
      success: true,
      dept,
      calendarId,
      includedCount: targetMembers.length,
      excludedCount: excludedEmpNos.length,
      syncResult,
      syncError,
    });
  } catch (err) {
    console.error('[Admin Naver Calendars POST Error]', err);
    return NextResponse.json({ error: err.message || '캘린더 생성/수정 실패' }, { status: 500 });
  }
}

/**
 * DELETE: 부서 캘린더 삭제 (네이버웍스 캘린더 및 DB 레코드 제거)
 */
export async function DELETE(request) {
  try {
    const session = await verifySession(request);
    if (!session || !session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const dept = searchParams.get('dept');
    if (!dept) {
      return NextResponse.json({ error: '부서명이 필요합니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: records } = await supabase
      .from('sa_ical_subscriptions')
      .select('*')
      .eq('scope', CALENDAR_SCOPE);

    const target = (records || []).find((r) => r.depts?.[0] === dept);
    if (!target) {
      return NextResponse.json({ error: '등록된 캘린더를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 네이버웍스 API로 캘린더 삭제
    if (target.token) {
      try {
        await deleteNaverCalendar(target.token);
      } catch (e) {
        console.warn(`[NaverWorks Calendar Delete Warning] ${e.message}`);
      }
    }

    // DB 레코드 삭제
    await supabase.from('sa_ical_subscriptions').delete().eq('id', target.id);

    return NextResponse.json({ success: true, dept });
  } catch (err) {
    console.error('[Admin Naver Calendars DELETE Error]', err);
    return NextResponse.json({ error: err.message || '캘린더 삭제 실패' }, { status: 500 });
  }
}
