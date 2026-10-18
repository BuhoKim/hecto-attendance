import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { isAdminRole } from '@/lib/roleUtils';
import { EXTERNAL_DEPARTMENTS, buildATimeBounds, filterTerminalRows, formatTerminalRow, summarizeMissingOvernightRows } from '@/lib/terminalAttendanceQuery';
import { shiftKstDateKey } from '@/lib/kstDate';

export const dynamic = 'force-dynamic';

const csv = (rows) => {
  const headers = ['날짜', '이름', '채움 단말기 인증시간', '최종 출입시간'];
  const lines = [headers, ...rows.map((r) => [r.date, r.name, r.candidateTimes, r.lastTime])];
  return '\ufeff' + lines.map((line) => line.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
};

async function fetchAll(query) {
  const all = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await query.range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session || !(session.isAdmin || isAdminRole(session))) return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const from = params.get('from');
    const to = params.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return NextResponse.json({ error: '조회 기간을 입력해 주세요.' }, { status: 400 });
    const departments = params.getAll('department').filter((v) => EXTERNAL_DEPARTMENTS.includes(v));
    const terminalCodes = params.getAll('terminal').map((v) => v.trim()).filter(Boolean);
    const mode = params.get('mode') || 'overnight-missing';
    const bounds = mode === 'overnight-missing'
      ? { from: buildATimeBounds({ from, to: from, fromTime: '17:00', toTime: '17:00' }).from, to: buildATimeBounds({ from: shiftKstDateKey(to, 1), to: shiftKstDateKey(to, 1), fromTime: '04:00', toTime: '04:00' }).to }
      : buildATimeBounds({ from, to, fromTime: params.get('fromTime'), toTime: params.get('toTime') });
    const supabase = getAdminClient();
    const { data: employees, error: employeeError } = await supabase.from('sa_employees').select('emp_no,name,dept').eq('is_active', true).in('dept', departments.length ? departments : EXTERNAL_DEPARTMENTS);
    if (employeeError) throw employeeError;
    const employeeMap = new Map((employees || []).map((row) => [String(row.emp_no), row]));
    const employeeNos = [...employeeMap.keys()];
    if (!employeeNos.length) return NextResponse.json({ success: true, rows: [], count: 0 });
    const query = supabase.from('sa_attendance').select('id,emp_no,sabun,a_time,eq_code,gate_name,flag1,event_type').in('emp_no', employeeNos).gte('a_time', bounds.from).lte('a_time', bounds.to).order('a_time', { ascending: true });
    const rawRows = await fetchAll(query);
    const selectedRows = mode === 'overnight-missing'
      ? summarizeMissingOvernightRows(rawRows, employeeMap, { candidateTerminals: ['5005', '5006'], candidateStart: params.get('fromTime') || '17:00', candidateEnd: params.get('toTime') || '18:30' })
      : filterTerminalRows(rawRows, { terminalCodes, fromTime: params.get('fromTime'), toTime: params.get('toTime') });
    const rows = mode === 'overnight-missing' ? selectedRows : selectedRows.map((row) => formatTerminalRow(row, employeeMap));
    if (params.get('download') === 'csv') return new NextResponse(csv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="terminal-attendance-${from}-${to}.csv"` } });
    return NextResponse.json({ success: true, rows, count: rows.length, range: { from, to }, departments, terminalCodes });
  } catch (error) {
    return NextResponse.json({ error: `단말기 출입기록 조회 실패: ${error.message}` }, { status: 500 });
  }
}
