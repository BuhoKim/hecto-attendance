import { getAdminClient } from './supabaseClient';
import {
  MANAGEMENT_DEPTS,
  addDaysToDateStr,
  buildICS,
  normalizeDeptName,
} from './ical';
import { getLeaveDisplayLabel } from './leaveRules';

const normalizeSet = (values = []) => new Set(values.map((value) => normalizeDeptName(value)));

const isInDeptSet = (dept, deptSet) => deptSet.has(normalizeDeptName(dept));
const LEAVE_PAGE_SIZE = 500;

function toAllDayEndExclusive(endDate) {
  return addDaysToDateStr(endDate, 1);
}

function getDefaultWindow() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localToday = new Date(today.getTime() - offset * 60 * 1000).toISOString().split('T')[0];
  return {
    from: addDaysToDateStr(localToday, -30),
    to: addDaysToDateStr(localToday, 365),
  };
}

export async function buildLeaveIcsForDepartments({
  departments = MANAGEMENT_DEPTS,
  subscriptionOwnerId = null,
  subscriptionOwnerEmpNo = null,
  from,
  to,
  calendarName = '연차 현황',
  calendarDescription = '',
} = {}) {
  const supabase = getAdminClient();
  if (subscriptionOwnerEmpNo || subscriptionOwnerId) {
    let ownerEmpNo = subscriptionOwnerEmpNo;
    if (!ownerEmpNo) {
    const { data: profile } = await supabase.from('sa_profiles').select('emp_no').eq('id', subscriptionOwnerId).maybeSingle();
      ownerEmpNo = profile?.emp_no;
    }
    const { data: owner } = ownerEmpNo
      ? await supabase.from('sa_employees').select('dept, is_active').eq('emp_no', ownerEmpNo).maybeSingle()
      : { data: null };
    departments = owner?.is_active !== false && owner?.dept ? [owner.dept] : [];
  }
  const window = from && to ? { from, to } : getDefaultWindow();
  const deptSet = normalizeSet(departments);

  const { data: employees, error: empError } = await supabase
    .from('sa_employees')
    .select('emp_no, name, dept, is_active')
    .eq('is_active', true);

  if (empError) {
    throw new Error(`직원 목록 조회 실패: ${empError.message}`);
  }

  const targetEmployees = (employees || []).filter((emp) => isInDeptSet(emp.dept, deptSet));
  const targetEmpNos = targetEmployees.map((emp) => String(emp.emp_no || '').trim()).filter(Boolean);

  if (targetEmpNos.length === 0) {
    return buildICS({
      calendarName,
      calendarDescription,
      events: [],
    });
  }

  const leaves = [];
  for (let offset = 0; ; offset += LEAVE_PAGE_SIZE) {
    let query = supabase
      .from('sa_leaves')
      .select('emp_no, emp_name, start_date, end_date, leave_code, leave_name, leave_days, status')
      .eq('status', '40')
      .in('emp_no', targetEmpNos);

    if (from) {
      query = query.gte('end_date', from);
    }
    if (to) {
      query = query.lte('start_date', to);
    }

    // A unique order keeps page boundaries stable, including same-day leaves.
    const { data: page, error: leaveError } = await query
      .order('id', { ascending: true })
      .range(offset, offset + LEAVE_PAGE_SIZE - 1);

    if (leaveError) {
      throw new Error(`휴가 목록 조회 실패: ${leaveError.message}`);
    }
    leaves.push(...(page || []));
    if (!page || page.length < LEAVE_PAGE_SIZE) break;
  }

  const employeeMap = new Map(targetEmployees.map((emp) => [String(emp.emp_no || '').trim(), emp]));

  const events = (leaves || [])
    .filter((leave) => leave.start_date && leave.end_date)
    .map((leave) => {
      const emp = employeeMap.get(String(leave.emp_no || '').trim());
      const empName = leave.emp_name || emp?.name || String(leave.emp_no || '');
      const dept = emp?.dept || '';
      const leaveName = getLeaveDisplayLabel(leave) || '연차';
      const startDate = String(leave.start_date).substring(0, 10);
      const endDate = String(leave.end_date).substring(0, 10);

      return {
        uid: `leave-${leave.emp_no}-${startDate}-${endDate}-${leave.leave_code || '0'}@hecto-qnm`,
        startDate,
        endDate: toAllDayEndExclusive(endDate),
        summary: `${empName} · ${leaveName}`,
        description: [
          `이름: ${empName}`,
          `부서: ${dept}`,
          `휴가 종류: ${leaveName}`,
          `기간: ${startDate} ~ ${endDate}`,
        ].join('\n'),
        categories: '휴가,연차',
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.summary.localeCompare(b.summary));

  return buildICS({
    calendarName,
    calendarDescription,
    events,
  });
}
