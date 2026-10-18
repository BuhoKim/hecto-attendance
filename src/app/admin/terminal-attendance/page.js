'use client';

import { useMemo, useState } from 'react';
import { Building2, CalendarDays, Download, Search } from 'lucide-react';
import EmployeeAdminShell from '../employees/EmployeeAdminShell';
import { EXTERNAL_DEPARTMENTS } from '@/lib/terminalAttendanceQuery';
import { getKstDateKey, shiftKstDateKey } from '@/lib/kstDate';

export default function TerminalAttendancePage() {
  const today = getKstDateKey();
  const [from, setFrom] = useState(shiftKstDateKey(today, -30));
  const [to, setTo] = useState(today);
  const [fromTime, setFromTime] = useState('17:00');
  const [toTime, setToTime] = useState('18:30');
  const [departments, setDepartments] = useState(EXTERNAL_DEPARTMENTS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const next = new URLSearchParams({ from, to, fromTime, toTime, mode: 'overnight-missing' });
    departments.forEach((value) => next.append('department', value));
    return next;
  }, [from, to, fromTime, toTime, departments]);

  const toggle = (setter, value) => setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const quickRange = (type) => {
    if (type === '7') setFrom(shiftKstDateKey(today, -6));
    if (type === '30') setFrom(shiftKstDateKey(today, -29));
    if (type === 'month') setFrom(`${today.slice(0, 7)}-01`);
    if (type === 'lastMonth') { const last = shiftKstDateKey(`${today.slice(0, 7)}-01`, -1); setFrom(`${last.slice(0, 7)}-01`); setTo(shiftKstDateKey(`${today.slice(0, 7)}-01`, -1)); }
    if (type !== 'lastMonth') setTo(today);
  };

  const search = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin/terminal-attendance?${params}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '조회에 실패했습니다.');
      setRows(json.rows || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const download = () => { window.location.href = `/api/admin/terminal-attendance?${params}&download=csv`; };

  return <EmployeeAdminShell title="석식 출입 조회" subtitle="17:00~18:30 채움 단말기 인증 후 야간 기록이 없는 직원을 확인합니다." activeHref="/admin/terminal-attendance">
    <section className="card" style={{ padding: '16px 20px', borderRadius: 16, position: 'relative', zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, whiteSpace: 'nowrap' }}><CalendarDays size={18} color="var(--blue)" />조회 기간:</span>
        <input className="ui-input" style={{ width: 132 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">~</span>
        <input className="ui-input" style={{ width: 132 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, marginLeft: 10, whiteSpace: 'nowrap' }}><Building2 size={18} color="var(--purple)" />부서:</span>
        <details style={{ position: 'relative', zIndex: 30 }}>
          <summary style={{ listStyle: 'none', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 28px 9px 12px', minWidth: 150, background: 'var(--surface-2)', fontWeight: 700 }}>{departments.length === EXTERNAL_DEPARTMENTS.length ? '전체 부서 (All)' : `${departments.length}개 부서 선택`}</summary>
          <div style={{ position: 'absolute', zIndex: 100, top: 'calc(100% + 6px)', left: 0, width: 230, padding: 12, background: '#fff', color: '#172033', border: '1px solid #d8dee9', borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,.15)' }}>{EXTERNAL_DEPARTMENTS.map((dept) => <label key={dept} style={{ display: 'flex', gap: 7, padding: '5px 2px', alignItems: 'center' }}><input type="checkbox" checked={departments.includes(dept)} onChange={() => toggle(setDepartments, dept)} />{dept}</label>)}</div>
        </details>
        <button className="btn primary" style={{ padding: '9px 16px' }} onClick={search} disabled={loading}><Search size={16} />{loading ? '조회 중...' : '조회'}</button>
        <span className="muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>빠른 선택:</span>
        {[['7', '최근 7일'], ['30', '최근 30일'], ['month', '이번 달'], ['lastMonth', '지난 달']].map(([key, label]) => <button key={key} className="btn secondary" style={{ padding: '8px 11px', fontSize: 12 }} onClick={() => quickRange(key)}>{label}</button>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}><span className="muted">기준: 17:00~18:30 채움 단말기 인증 후 20:00~익일 04:00 기록 없음 · KST</span><button className="btn secondary" style={{ marginLeft: 'auto', padding: '8px 12px' }} onClick={download} disabled={!rows.length}><Download size={15} />CSV 다운로드</button><span className="badge blue">{rows.length.toLocaleString()}건</span></div>
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
    </section>
    <section className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}><table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['날짜', '이름', '채움 단말기 인증시간', '그날 최종 출입시간'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.empNo}-${row.date}-${index}`}><td>{row.date}</td><td>{row.name}</td><td>{row.candidateTimes || '-'}</td><td>{row.lastTime || '-'}</td></tr>) : <tr><td colSpan="4" style={{ textAlign: 'center', padding: 32 }}>조회 결과가 없습니다.</td></tr>}</tbody></table></div>
    </section>
  </EmployeeAdminShell>;
}
