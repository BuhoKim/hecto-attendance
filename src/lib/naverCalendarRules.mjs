/**
 * 네이버웍스 부서별 캘린더 멤버 및 일정 연동 규칙
 */

export const LEAVE_CODE_LABELS = {
  '12': '연차',
  '13': '오전반차',
  '14': '오후반차',
  '16': '4시간휴가 [오전]',
  '17': '4시간휴가 [오후]',
  '18': '반일휴가',
  '19': '2시간휴가 [07-09]',
  '20': '2시간휴가 [08-10]',
  '21': '2시간휴가 [09-11]',
  '22': '2시간휴가 [10-12]',
  '23': '2시간휴가 [11-13]',
  '24': '2시간휴가 [13-15]',
  '25': '2시간휴가 [14-16]',
  '26': '2시간휴가 [15-17]',
  '27': '2시간휴가 [16-18]',
  '28': '2시간휴가 [17-19]',
  '51': '포상휴가',
  '60': '1년미만',
  '61': '1년미만 4시간휴가 [오전]',
  '62': '1년미만 4시간휴가 [오후]',
};

/**
 * 부서 직원 목록에서 비활성/퇴사자 및 제외 사번 필터링
 * @param {Array} employees - sa_employees 레코드 ({ emp_no, name, dept, email, is_active, status })
 * @param {Array|Set} excludedEmpNos - 제외 사번 목록/Set
 * @returns {Array} 활성 정직원 목록
 */
export function filterCalendarMembers(employees = [], excludedEmpNos = []) {
  const excludedSet = new Set((excludedEmpNos || []).map((no) => String(no).trim()));

  return (employees || [])
    .filter((emp) => {
      if (!emp || emp.is_active === false || emp.status === 'resigned') {
        return false;
      }
      const empNo = String(emp.emp_no || '').trim();
      if (!empNo) return false;
      return !excludedSet.has(empNo);
    })
    .map((emp) => ({
      empNo: String(emp.emp_no).trim(),
      name: String(emp.name || '').trim(),
      dept: String(emp.dept || '').trim(),
      email: String(emp.email || '').trim(),
    }));
}

/**
 * 네이버웍스 API members payload 생성
 * @param {Array} members - filterCalendarMembers 반환 목록
 * @returns {Array} [{ id: email, type: 'USER', role: 'EVENT_READ' }]
 */
export function buildNaverCalendarMembersPayload(members = []) {
  const result = [];
  const seenEmails = new Set();

  for (const m of members) {
    const email = String(m.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || seenEmails.has(email)) {
      continue;
    }
    seenEmails.add(email);
    result.push({
      id: email,
      type: 'USER',
      role: 'EVENT_READ',
    });
  }

  return result;
}

/**
 * 캘린더 설정 저장 payload 검증
 */
export function validateCalendarConfigPayload(payload = {}) {
  const dept = String(payload.dept || '').trim();
  if (!dept) {
    throw new Error('부서명을 입력해주세요.');
  }

  const excludedEmpNos = Array.isArray(payload.excludedEmpNos)
    ? [...new Set(payload.excludedEmpNos.map((no) => String(no).trim()).filter(Boolean))]
    : [];

  return {
    dept,
    excludedEmpNos,
    sourceDepts: normalizeCalendarSourceDepts(dept, payload.sourceDepts),
    isActive: payload.isActive !== false,
  };
}

// depts[0] is always the calendar's owning department; the rest are optional
// leave sources. Selecting sources never grants their staff calendar access.
export function normalizeCalendarSourceDepts(dept, sourceDepts = []) {
  return [...new Set([dept, ...(Array.isArray(sourceDepts) ? sourceDepts : [])]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim()).filter(Boolean))];
}

export function parseCalendarMemberConfig(value) {
  const config = typeof value === 'string' ? JSON.parse(value) : value || [];
  return Array.isArray(config)
    ? { excludedEmpNos: config.map(String), includedConcurrentEmpNos: [] }
    : { excludedEmpNos: (config.excludedEmpNos || []).map(String), includedConcurrentEmpNos: (config.includedConcurrentEmpNos || []).map(String) };
}

export function buildCalendarDepartmentRoster(employees = [], users = []) {
  const byEmail = new Map(users.map((user) => [String(user.email || '').trim().toLowerCase(), user]));
  const byNumber = new Map(users.filter((user) => user.employeeNumber).map((user) => [String(user.employeeNumber).trim(), user]));
  const roster = [];
  for (const emp of employees) {
    roster.push({ ...emp, primaryDept: emp.dept, isConcurrent: false });
    const user = byEmail.get(String(emp.email || '').trim().toLowerCase()) || byNumber.get(String(emp.emp_no).trim());
    if (!user) continue;
    const seen = new Set([emp.dept]);
    for (const org of user.organizations || []) {
      if (org.domainId !== user.domainId) continue;
      for (const unit of org.orgUnits || []) {
        if (unit.primary !== false || !unit.orgUnitName || seen.has(unit.orgUnitName)) continue;
        seen.add(unit.orgUnitName);
        roster.push({ ...emp, dept: unit.orgUnitName, primaryDept: emp.dept, isConcurrent: true });
      }
    }
  }
  return roster;
}

export function calendarRosterExclusions(roster, config) {
  return [...new Set([...config.excludedEmpNos, ...roster
    .filter((emp) => emp.isConcurrent && !config.includedConcurrentEmpNos.includes(String(emp.emp_no)))
    .map((emp) => String(emp.emp_no))])];
}

/**
 * 날짜 형식 변환 (YYYYMMDD -> YYYY-MM-DD)
 */
export function formatCalendarDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (s.length === 8 && !s.includes('-')) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s.slice(0, 10);
}

/**
 * 다음 날짜 계산 (종일 일정의 exclusive end.date용)
 * 타임존 영향 없는 UTC 기준 일자 가산
 */
export function getNextCalendarDay(dateStr) {
  if (!dateStr) return '';
  const clean = formatCalendarDate(dateStr);
  if (!clean || clean.length !== 10) return clean;
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * 휴가 코드/이름에 따른 표시용 라벨 반환
 */
export function getLeaveLabel(leave = {}) {
  const code = String(leave?.leave_code || '').trim();
  const rawName = String(leave?.leave_name || '').trim();
  if (LEAVE_CODE_LABELS[code]) return LEAVE_CODE_LABELS[code];
  if (LEAVE_CODE_LABELS[rawName]) return LEAVE_CODE_LABELS[rawName];
  if (/^\d+$/.test(rawName)) return '연차';
  return rawName || '연차';
}

/**
 * 네이버웍스 캘린더 이벤트 생성용 payload 빌더
 * (RFC 5545 표준에 따라 종일 일정의 end.date는 exclusive 종료일 + 1일로 설정하여
 *  종료일 당일까지 온전히 달력에 표시되도록 함)
 */
export function buildLeaveEventPayload({ empNo, empName, dept, leave }) {
  const label = getLeaveLabel(leave);
  const startDate = formatCalendarDate(leave.start_date || leave.startDate);
  const rawEndDate = formatCalendarDate(leave.end_date || leave.endDate || leave.start_date || leave.startDate);
  const exclusiveEndDate = getNextCalendarDay(rawEndDate);
  const cleanEmpNo = String(empNo || leave.emp_no || '').trim();
  const cleanCode = String(leave.leave_code || '').trim();
  const leaveKey = `${cleanEmpNo}_${startDate}_${cleanCode}`;

  const summary = `${empName} · ${label}`;
  const description = [
    `이름: ${empName}`,
    `부서: ${dept}`,
    `휴가종류: ${label}`,
    `기간: ${startDate} ~ ${rawEndDate}`,
    `일수: ${leave.leave_days || 1}일`,
    `[KEY: ${leaveKey}]`,
  ].join('\n');

  return {
    eventComponents: [
      {
        summary,
        description,
        start: { date: startDate },
        end: { date: exclusiveEndDate },
        transparency: 'TRANSPARENT',
        visibility: 'PUBLIC',
      },
    ],
    sendNotification: false,
    leaveKey,
  };
}

/**
 * 이벤트 설명에서 고유 leaveKey 파싱
 */
export function parseLeaveKeyFromDescription(description = '') {
  if (!description) return null;
  const match = description.match(/\[KEY:\s*([^\]]+)\]/);
  return match ? match[1].trim() : null;
}
