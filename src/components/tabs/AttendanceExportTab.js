'use client';

import { useMemo, useState } from 'react';
import { Download, Search, RefreshCw } from 'lucide-react';
import { buildAttendanceTableRows } from '../../lib/attendanceExport';
import { applyAttendanceSheetStyles, ATTENDANCE_WORKBOOK_COLUMN_WIDTHS, getAttendanceWorkbookRows } from '../../lib/attendanceWorkbook';
import { shiftMonthKey } from '../../lib/kstDate';
import { getCurrentMonthKey, matchesDeptFilter } from '../../lib/dashboardUtils';

const EMPTY = [];
const getToday = () => new Date().toISOString().slice(0, 10);

const getMonthsBetween = (fromDate, toDate) => {
  const months = [];
  let cursor = `${fromDate.slice(0, 7)}-01`;
  const end = `${toDate.slice(0, 7)}-01`;
  while (cursor <= end) {
    months.push(cursor.slice(0, 7));
    cursor = `${shiftMonthKey(cursor.slice(0, 7), 1)}-01`;
  }
  return months;
};

export default function AttendanceExportTab({ data }) {
  const currentMonth = getCurrentMonthKey();
  const [fromDate, setFromDate] = useState(`${currentMonth}-01`);
  const [toDate, setToDate] = useState(getToday);
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [resultSheets, setResultSheets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('조회할 기간과 부서를 선택해주세요.');
  const [error, setError] = useState('');

  const employees = data?.allEmployees || EMPTY;
  const departments = useMemo(() => [...new Set(employees.map((employee) => employee.dept).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'ko')), [employees]);
  const allDepartmentsSelected = selectedDepartments.length === 0 || selectedDepartments.length === departments.length;

  const toggleDepartment = (department) => {
    setSelectedDepartments((current) => {
      if (department === 'ALL') return [];
      return current.includes(department)
        ? current.filter((item) => item !== department)
        : [...current, department].sort((a, b) => String(a).localeCompare(String(b), 'ko'));
    });
  };

  const isDepartmentVisible = (employee) => allDepartmentsSelected
    || selectedDepartments.some((department) => matchesDeptFilter(employee.dept, department));

  const handleQuery = async () => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setError('시작일과 종료일을 올바르게 선택해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('근태 기록을 조회하는 중입니다...');
    try {
      const months = getMonthsBetween(fromDate, toDate);
      const responses = await Promise.all(months.map(async (month) => {
        const response = await fetch(`/api/attendance?month=${month}`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(`${month} 기록을 조회하지 못했습니다.`);
        const monthEmployees = (json.allEmployees || employees).filter(isDepartmentVisible);
        return {
          month,
          rows: buildAttendanceTableRows({ fromDate, toDate, employees: monthEmployees, logs: json.allLogs || [], leaves: json.leaves || [] }),
        };
      }));
      setResultSheets(responses);
      const count = responses.reduce((total, sheet) => total + sheet.rows.length, 0);
      setMessage(`${count.toLocaleString()}건 조회 완료 · ${months.length}개 월`);
    } catch (queryError) {
      setResultSheets([]);
      setError(queryError.message || '근태 기록 조회에 실패했습니다.');
      setMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (resultSheets.length === 0) {
      setError('먼저 조회를 실행해주세요.');
      return;
    }
    try {
      const xlsxModule = await import('xlsx-js-style');
      const XLSX = xlsxModule.default || xlsxModule;
      const workbook = XLSX.utils.book_new();
      resultSheets.forEach(({ month, rows }) => {
        const workbookRows = getAttendanceWorkbookRows(rows);
        const sheet = XLSX.utils.json_to_sheet(workbookRows);
        sheet['!cols'] = ATTENDANCE_WORKBOOK_COLUMN_WIDTHS.map((wch) => ({ wch }));
        applyAttendanceSheetStyles(sheet, { rowCount: workbookRows.length + 1, columnCount: 7 });
        XLSX.utils.book_append_sheet(workbook, sheet, month);
      });
      const deptName = allDepartmentsSelected ? '전체부서' : selectedDepartments.join('_');
      XLSX.writeFile(workbook, `근태현황_${fromDate}_${toDate}_${deptName}.xlsx`);
      setMessage(`${resultSheets.length}개 월별 시트로 다운로드했습니다.`);
    } catch (downloadError) {
      setError(downloadError.message || '엑셀 다운로드에 실패했습니다.');
    }
  };

  const fieldStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-1)', fontSize: 14 };
  const visibleRows = resultSheets.flatMap((sheet) => sheet.rows.map((row) => ({ ...row, _month: sheet.month })));

  return (
    <div className="card" style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <div className="card-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
        <div>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Download style={{ width: 19, color: 'var(--green)' }} />근태기록 저장</h3>
          <p className="card-subtitle">연월일과 부서를 선택하고 조회한 뒤, 결과를 엑셀로 다운로드할 수 있습니다.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 20 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7, color: 'var(--text-2)', fontSize: 13, fontWeight: 700 }}>
          시작일
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7, color: 'var(--text-2)', fontSize: 13, fontWeight: 700 }}>
          종료일
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={fieldStyle} />
        </label>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-2)', fontSize: 13, fontWeight: 700 }}>부서 선택 <small style={{ fontWeight: 500 }}>({allDepartmentsSelected ? '전체' : `${selectedDepartments.length}개`})</small></span>
          <button type="button" onClick={() => setSelectedDepartments([])} style={{ border: 0, background: 'transparent', color: 'var(--blue)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>전체 선택</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-overlay-sm)' }}>
          <label style={{ ...fieldStyle, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: allDepartmentsSelected ? 'var(--blue)' : 'var(--bg-input)', color: allDepartmentsSelected ? '#fff' : 'var(--text-1)' }}>
            <input type="checkbox" checked={allDepartmentsSelected} onChange={() => toggleDepartment('ALL')} /> 전체 부서
          </label>
          {departments.map((department) => {
            const selected = !allDepartmentsSelected && selectedDepartments.includes(department);
            return <label key={department} style={{ ...fieldStyle, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: selected ? 'var(--blue)' : 'var(--bg-input)', color: selected ? '#fff' : 'var(--text-1)' }}><input type="checkbox" checked={selected} onChange={() => toggleDepartment(department)} />{department}</label>;
          })}
          {departments.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>부서 데이터를 불러오는 중입니다.</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="login-btn" onClick={handleQuery} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, opacity: loading ? 0.7 : 1 }}>
          {loading ? <RefreshCw style={{ width: 16, animation: 'spin 1s linear infinite' }} /> : <Search style={{ width: 16 }} />} {loading ? '조회 중...' : '조회'}
        </button>
        <button type="button" className="form-btn secondary" onClick={handleDownload} disabled={loading || resultSheets.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Download style={{ width: 16 }} /> 엑셀 다운로드</button>
        {message && <span style={{ color: 'var(--text-2)', fontSize: 13, fontWeight: 600 }}>{message}</span>}
        {error && <span style={{ color: 'var(--red)', fontSize: 13, fontWeight: 700 }}>{error}</span>}
      </div>

      <div style={{ marginTop: 22 }}>
        {resultSheets.length > 0 && visibleRows.length > 0 ? (
          <div className="table-wrapper" style={{ maxHeight: 560, overflow: 'auto' }}>
            <table className="table attendance-export-table">
              <thead><tr><th>월</th><th>날짜</th><th>이름</th><th>부서</th><th>출근</th><th>퇴근</th><th>상태</th><th>비고</th></tr></thead>
              <tbody>{visibleRows.map((row, index) => <tr className={row.상태 === '지각' ? 'attendance-export-row--late' : ''} key={`${row._month}-${row.날짜}-${row.이름}-${index}`}><td>{row._month}</td><td>{row.날짜}</td><td className="attendance-export-name">{row.이름}</td><td>{row.부서}</td><td>{row.출근 || '-'}</td><td>{row.퇴근 || '-'}</td><td><span className={`attendance-export-status attendance-export-status--${row.상태 === '지각' ? 'late' : 'normal'}`}>{row.상태}</span></td><td>{row.비고 || '-'}</td></tr>)}</tbody>
            </table>
          </div>
        ) : resultSheets.length > 0 ? <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-2)' }}>선택한 조건에 해당하는 근태 기록이 없습니다.</div> : <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-3)', border: '1px dashed var(--border)', borderRadius: 10 }}>조회 버튼을 누르면 근태 기록이 여기에 표시됩니다.</div>}
      </div>
    </div>
  );
}
