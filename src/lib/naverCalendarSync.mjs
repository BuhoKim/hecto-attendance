import { buildLeaveEventPayload, filterCalendarMembers, formatCalendarDate, getManagedEventKey, normalizeCalendarSourceDepts } from './naverCalendarRules.mjs';

// Shared by the admin API and the CommonJS worker, so both honor saved sources.
export async function syncCalendarLeaveSources({ calendarId, dept, sourceDepts, additionalEmpNos = [], excludedEmpNos = [], supabase, token, serviceAccount, labels = {}, fetchImpl = fetch, now = new Date() }) {
  const { data: employees, error: employeeError } = await supabase.from('sa_employees')
    .select('emp_no, name, dept, status, is_active');
  if (employeeError) throw new Error(`직원 목록 조회 실패: ${employeeError.message}`);
  const sources = new Set(normalizeCalendarSourceDepts(dept, sourceDepts));
  const members = filterCalendarMembers((employees || []).filter((emp) => sources.has(emp.dept) || additionalEmpNos.includes(String(emp.emp_no))), excludedEmpNos);
  const empMap = new Map(members.map((emp) => [emp.empNo, emp]));
  const future = new Date(now.getTime() + 180 * 86400000);
  const untilDay = new Date(future.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  // Every past approved leave is included; only future leave is bounded.
  const leaves = [];
  if (members.length) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('sa_leaves').select('*')
        .in('emp_no', members.map((emp) => emp.empNo)).eq('status', '40')
        .gte('end_date', '19000101').lte('start_date', untilDay.replaceAll('-', ''))
        .order('id', { ascending: true }).range(offset, offset + 499);
      if (error) throw new Error(`휴가 목록 조회 실패: ${error.message}`);
      leaves.push(...(data || []));
      if ((data || []).length < 500) break;
    }
  }
  // Read existing events from the earliest leave (at least the last 60 days).
  const earliest = leaves.reduce((min, leave) => {
    const day = formatCalendarDate(leave.start_date || leave.startDate);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < min ? day : min;
  }, new Date(now.getTime() - 60 * 86400000 + 9 * 3600000).toISOString().slice(0, 10));
  const from = new Date(`${earliest}T00:00:00+09:00`);
  const until = new Date(`${untilDay}T23:59:59+09:00`);
  const desired = new Map();
  for (const leave of leaves) {
    const emp = empMap.get(String(leave.emp_no).trim());
    if (!emp) continue;
    const { leaveKey: _leaveKey, ...payload } = buildLeaveEventPayload({ empNo: emp.empNo, empName: leave.emp_name || emp.name, dept: emp.dept, leave });
    const label = labels[String(leave.leave_code || '').trim()];
    if (label) {
      payload.eventComponents[0].summary = `${leave.emp_name || emp.name} · ${label}`;
      payload.eventComponents[0].description = payload.eventComponents[0].description.replace(/^휴가종류: .*$/m, `휴가종류: ${label}`);
    }
    desired.set(getManagedEventKey(payload.eventComponents[0]), payload);
  }

  const baseUrl = `https://www.worksapis.com/v1.0/users/${encodeURIComponent(serviceAccount)}/calendars/${encodeURIComponent(calendarId)}/events`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const existing = new Map();
  // Complete the read before any writes. A failed read must never cause duplicates
  // or removal of events based on an incomplete snapshot.
  for (let time = from.getTime(); time < until.getTime(); time += 28 * 86400000) {
    const params = new URLSearchParams({ fromDateTime: new Date(time).toISOString(), untilDateTime: new Date(Math.min(time + 28 * 86400000, until.getTime())).toISOString() });
    const res = await fetchImpl(`${baseUrl}?${params}`, { headers });
    if (!res.ok) throw new Error(`기존 일정 조회 실패 (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data.events)) throw new Error('기존 일정 응답이 올바르지 않습니다.');
    for (const event of data.events) {
      const components = event.eventComponents || [];
      // This integration creates one non-recurring component per managed event.
      if (components.length !== 1 || components[0].recurrence?.length) continue;
      const component = components[0];
      const key = getManagedEventKey(component);
      if (key && component.eventId) existing.set(component.eventId, { key, component });
    }
  }
  const result = { success: true, totalLeaves: leaves.length, created: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 };
  const retained = new Set();
  const write = async (url, method, payload) => {
    try {
      const res = await fetchImpl(url, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`일정 ${method} 실패 (${res.status})`);
      return true;
    } catch {
      result.failed++;
      result.success = false;
      return false;
    }
  };
  for (const [eventId, { key, component }] of existing) {
    const payload = desired.get(key);
    const url = `${baseUrl}/${encodeURIComponent(eventId)}`;
    if (!payload || retained.has(key)) {
      if (await write(`${url}?sendNotification=false`, 'DELETE')) result.deleted++;
      continue;
    }
    retained.add(key);
    const expected = payload.eventComponents[0];
    if (['summary', 'description', 'start', 'end'].every((field) => JSON.stringify(component[field]) === JSON.stringify(expected[field]))) {
      result.skipped++;
    } else if (await write(url, 'PUT', { ...payload, eventComponents: [{ ...expected, eventId }] })) {
      result.updated++;
    }
  }
  for (const [key, payload] of desired) {
    if (!retained.has(key) && await write(baseUrl, 'POST', payload)) result.created++;
  }
  return result;
}
