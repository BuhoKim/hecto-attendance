// Source and target must use exactly the same overlap window. Never infer
// cancellations from a failed query or a truncated Supabase response.
const PAGE = 500;
const text = (value) => String(value ?? '').trim();
const key = (row) => JSON.stringify([text(row.emp_no), text(row.start_date), text(row.leave_code)]);
const fields = ['emp_name', 'end_date', 'leave_name', 'leave_days', 'status'];

function getLeaveReconciliationWindow(now = new Date()) {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const compact = (offset) => new Date(midnight + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
  return { from: compact(-1), to: compact(7) };
}

async function readAll(query) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await query().range(offset, offset + PAGE - 1);
    if (error || !Array.isArray(data)) throw new Error(`휴가 대조 조회 실패: ${error?.message || '응답 오류'}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function reconcileHrLeaves({ conn, supabase, companyCode, empNo = null, now = new Date(), fullHistory = false }) {
  if (!companyCode) throw new Error('휴가 대조 회사코드 없음');
  // Only an explicit historical backfill opts out of the normal daily window.
  const window = fullHistory ? null : getLeaveReconciliationWindow(now);
  const [roster] = await conn.execute(
    'SELECT I_EMPLOY_NO AS emp_no FROM hr_employee WHERE I_COMPANY = ?' + (empNo ? ' AND I_EMPLOY_NO = ?' : ''),
    empNo ? [companyCode, empNo] : [companyCode],
  );
  if (!Array.isArray(roster) || !roster.length) throw new Error('원본 직원 범위가 비어 있어 휴가 대조 중단');
  const [source] = await conn.execute(`
    SELECT y.I_EMPLOY_NO AS emp_no, e.N_EMPLOY_NAME AS emp_name,
      d.N_DEPT AS dept, y.D_START_DATE AS start_date, y.D_END_DATE AS end_date,
      y.I_CODE AS leave_code, CAST(y.I_CODE AS CHAR) AS leave_name,
      CAST(y.O_ANNLEV_CNT AS CHAR) AS leave_days, y.I_STATUS AS status
    FROM hr_yuncha_use y
    LEFT JOIN hr_employee e ON e.I_COMPANY = y.I_COMPANY AND e.I_EMPLOY_NO = y.I_EMPLOY_NO
    LEFT JOIN hr_department d ON d.I_COMPANY = e.I_COMPANY AND d.I_DEPT = e.I_DEPT
    WHERE y.I_COMPANY = ? AND y.I_STATUS = '40'
    ${window ? 'AND y.D_END_DATE >= ? AND y.D_START_DATE <= ?' : ''}
    ${empNo ? 'AND y.I_EMPLOY_NO = ?' : ''}
  `, [companyCode, ...(window ? [window.from, window.to] : []), ...(empNo ? [empNo] : [])]);
  if (!Array.isArray(source)) throw new Error('원본 휴가 응답 오류');

  const employees = await readAll(() => {
    let query = supabase.from('sa_employees').select('emp_no').eq('company_code', companyCode);
    if (empNo) query = query.eq('emp_no', empNo);
    return query.order('emp_no', { ascending: true });
  });
  const scope = new Set([...roster, ...employees, ...source].map((row) => text(row.emp_no)));
  if (scope.has('') || (empNo && [...scope].some((value) => value !== text(empNo)))) {
    throw new Error('휴가 대조 직원 범위 오류');
  }
  const sourceMap = new Map();
  const stamp = now.toISOString();
  for (const row of source) {
    const record = { emp_no: text(row.emp_no), emp_name: row.emp_name,
      start_date: text(row.start_date), end_date: text(row.end_date),
      leave_code: text(row.leave_code), leave_name: text(row.leave_name),
      leave_days: Number.parseFloat(row.leave_days) || 0, status: text(row.status),
      dept: row.dept, synced_at: stamp };
    if (!/^\d{8}$/.test(record.start_date) || !/^\d{8}$/.test(record.end_date)
      || record.end_date < record.start_date || !record.leave_code || record.status !== '40'
      || (window && (record.end_date < window.from || record.start_date > window.to))) {
      throw new Error('원본 휴가 형식 오류: 대조 중단');
    }
    const previous = sourceMap.get(key(record));
    if (previous && fields.some((field) => text(previous[field]) !== text(record[field]))) {
      throw new Error('동일 휴가 키의 승인 원본이 서로 달라 대조 중단');
    }
    sourceMap.set(key(record), record);
  }
  const existing = [];
  const employeeNos = [...scope];
  for (let start = 0; start < employeeNos.length; start += 100) {
    existing.push(...await readAll(() => {
      let query = supabase.from('sa_leaves').select('*').in('emp_no', employeeNos.slice(start, start + 100));
      if (window) query = query.gte('end_date', window.from).lte('start_date', window.to);
      return query.order('id', { ascending: true });
    }));
  }
  const existingMap = new Map(existing.map((row) => [key(row), row]));
  const approved = [...sourceMap.values()];
  const changed = approved.filter((row) => {
    const old = existingMap.get(key(row));
    return !old || fields.some((field) => field === 'leave_days'
      ? Number(old[field]) !== Number(row[field]) : text(old[field]) !== text(row[field]));
  });
  const revoked = existing.filter((row) => text(row.status) === '40' && !sourceMap.has(key(row)));
  // Only after every source/target read and validation has succeeded may writes start.
  for (let start = 0; start < changed.length; start += 200) {
    const { error } = await supabase.from('sa_leaves').upsert(
      changed.slice(start, start + 200).map(({ dept, ...row }) => row),
      { onConflict: 'emp_no,start_date,leave_code' },
    );
    if (error) throw new Error(`휴가 갱신 실패: ${error.message}`);
  }
  for (let start = 0; start < revoked.length; start += 200) {
    const { error } = await supabase.from('sa_leaves').update({ status: 'CANCELLED', synced_at: stamp })
      .in('id', revoked.slice(start, start + 200).map((row) => row.id)).eq('status', '40');
    if (error) throw new Error(`휴가 취소 반영 실패: ${error.message}`);
  }
  // Include prior cancellations too, so failed external cleanup is retried next cycle.
  const cancelled = existing.filter((row) => !sourceMap.has(key(row)))
    .map((row) => ({ ...row, status: 'CANCELLED' }));
  const result = { approved, cancelled, window, total: approved.length,
    changed: changed.length, revoked: revoked.length, unchanged: approved.length - changed.length };
  return result;
}

module.exports = { reconcileHrLeaves, getLeaveReconciliationWindow };
