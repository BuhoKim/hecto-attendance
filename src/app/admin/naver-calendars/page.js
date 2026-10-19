'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Search,
} from 'lucide-react';
import EmployeeAdminShell from '../employees/EmployeeAdminShell';

export default function AdminNaverCalendarsPage() {
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedDept, setExpandedDept] = useState(null);
  const [excludedMap, setExcludedMap] = useState({});
  const [savingDept, setSavingDept] = useState(null);
  const [message, setMessage] = useState(null);

  const fetchStatus = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/naver-calendars');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '조회 실패');
      }
      const data = await res.json();
      setDepartments(data.departments || []);

      // 초기 제외 사번 맵 설정
      const map = {};
      for (const d of data.departments || []) {
        map[d.dept] = new Set((d.excludedEmpNos || []).map(String));
      }
      setExcludedMap(map);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const filteredDepts = useMemo(() => {
    if (!search.trim()) return departments;
    const q = search.trim().toLowerCase();
    return departments.filter(
      (d) =>
        d.dept.toLowerCase().includes(q) ||
        d.employees.some((e) => e.name.toLowerCase().includes(q) || e.empNo.includes(q))
    );
  }, [departments, search]);

  const toggleExclude = (dept, empNo) => {
    const curSet = new Set(excludedMap[dept] || []);
    if (curSet.has(empNo)) {
      curSet.delete(empNo);
    } else {
      curSet.add(empNo);
    }
    setExcludedMap((prev) => ({ ...prev, [dept]: curSet }));
  };

  const handleSaveCalendar = async (dept, action = 'save') => {
    setSavingDept(dept);
    setMessage(null);
    try {
      const excludedList = Array.from(excludedMap[dept] || []);
      const res = await fetch('/api/admin/naver-calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dept,
          excludedEmpNos: excludedList,
          action,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || '저장 실패');
      }

      const syncMsg = result.syncResult
        ? ` (등록: ${result.syncResult.created}건, 유지: ${result.syncResult.skipped}건)`
        : '';

      setMessage({
        type: 'success',
        text: `[${dept}] 캘린더 설정이 저장되었습니다. (포함: ${result.includedCount}명, 제외: ${result.excludedCount}명)${syncMsg}`,
      });
      await fetchStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSavingDept(null);
    }
  };

  const handleDeleteCalendar = async (dept) => {
    if (!confirm(`[${dept}] 캘린더를 삭제하시겠습니까?\n네이버웍스에서도 공유 캘린더가 제거됩니다.`)) {
      return;
    }

    setSavingDept(dept);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/naver-calendars?dept=${encodeURIComponent(dept)}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || '삭제 실패');
      }

      setMessage({
        type: 'success',
        text: `[${dept}] 캘린더가 정상적으로 삭제되었습니다.`,
      });
      await fetchStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSavingDept(null);
    }
  };

  const totalDepts = departments.length;
  const createdDepts = departments.filter((d) => d.isCreated).length;
  const totalExcluded = Object.values(excludedMap).reduce((acc, set) => acc + set.size, 0);

  return (
    <EmployeeAdminShell
      title="네이버웍스 캘린더 관리"
      subtitle="MySQL 정직원 명단을 기반으로 부서별 공유 캘린더를 생성하고 인원별 권한 및 연차 일정을 자동 연동합니다."
      activeHref="/admin/naver-calendars"
    >
      <div className="card">
        {/* 상단 툴바: 검색 및 통계 배지 */}
        <div
          className="card-header"
          style={{
            borderBottom: '1px solid var(--border)',
            padding: '16px 18px',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="부서명 또는 직원 이름 검색..."
              className="search-input"
            />
            <Search size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-2)' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge blue">전체 {totalDepts}개 부서</span>
            <span className="badge green">생성 완료 {createdDepts}</span>
            {totalExcluded > 0 && <span className="badge amber">권한 제외 {totalExcluded}명</span>}
            <button
              type="button"
              onClick={fetchStatus}
              disabled={loading}
              className="login-btn"
              style={{
                marginTop: 0,
                padding: '8px 13px',
                background: 'var(--bg-card-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
                fontSize: 12,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>

        {/* 안내 메시지 */}
        {message && (
          <div
            style={{
              margin: '14px 18px 0',
              padding: '10px 14px',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: message.type === 'error' ? 'rgba(208, 107, 107, 0.12)' : 'rgba(95, 169, 113, 0.12)',
              color: message.type === 'error' ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${message.type === 'error' ? 'rgba(208, 107, 107, 0.25)' : 'rgba(95, 169, 113, 0.25)'}`,
            }}
          >
            {message.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* 부서 목록 테이블 */}
        <div className="table-wrapper" style={{ margin: '14px 18px 18px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
              네이버웍스 캘린더 정보를 불러오는 중입니다...
            </div>
          ) : filteredDepts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
              검색 조건에 맞는 부서가 없습니다.
            </div>
          ) : (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>부서명</th>
                  <th>캘린더 상태</th>
                  <th>구성원 현황</th>
                  <th>캘린더 ID</th>
                  <th style={{ textAlign: 'right' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredDepts.map((d) => {
                  const isExpanded = expandedDept === d.dept;
                  const excludedSet = excludedMap[d.dept] || new Set();
                  const includedCount = d.employees.filter(
                    (e) => e.isActive && !excludedSet.has(e.empNo)
                  ).length;
                  const isSaving = savingDept === d.dept;

                  return (
                    <tr
                      key={d.dept}
                      onClick={() => setExpandedDept(isExpanded ? null : d.dept)}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--row-hover)' : 'transparent',
                      }}
                    >
                      <td style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ fontWeight: 800, color: 'var(--text-1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <CalendarDays size={15} color={d.isCreated ? 'var(--green)' : 'var(--text-3)'} />
                          <span>{d.dept}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${d.isCreated ? 'green' : 'gray'}`}>
                          {d.isCreated ? '생성완료' : '미생성'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-2)', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{includedCount}명</span> 포함
                        {excludedSet.size > 0 && (
                          <span style={{ color: 'var(--amber)', marginLeft: 6 }}>({excludedSet.size}명 제외)</span>
                        )}
                        <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>/ 총 {d.activeEmployees}명</span>
                      </td>
                      <td className="time-display" style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        {d.calendarId ? `${d.calendarId.slice(0, 8)}...` : '-'}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleSaveCalendar(d.dept, 'save')}
                            disabled={isSaving}
                            style={{
                              padding: '5px 11px',
                              borderRadius: 'var(--r-sm)',
                              background: d.isCreated ? 'var(--bg-card-2)' : 'var(--blue)',
                              color: d.isCreated ? 'var(--text-1)' : '#fff',
                              border: d.isCreated ? '1px solid var(--border)' : 'none',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: isSaving ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Check size={13} />
                            {d.isCreated ? '멤버 저장' : '캘린더 생성'}
                          </button>

                          {d.isCreated && (
                            <button
                              type="button"
                              onClick={() => handleSaveCalendar(d.dept, 'sync-events')}
                              disabled={isSaving}
                              title="최근 승인 연차 일정을 네이버웍스 캘린더에 즉시 동기화합니다"
                              style={{
                                padding: '5px 10px',
                                borderRadius: 'var(--r-sm)',
                                background: 'var(--bg-card-2)',
                                color: 'var(--green)',
                                border: '1px solid var(--border)',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <RefreshCw size={12} className={isSaving ? 'animate-spin' : ''} />
                              일정 동기화
                            </button>
                          )}

                          {d.isCreated && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCalendar(d.dept)}
                              disabled={isSaving}
                              title="캘린더 삭제"
                              style={{
                                padding: '5px 8px',
                                borderRadius: 'var(--r-sm)',
                                background: 'rgba(208, 107, 107, 0.12)',
                                color: 'var(--red)',
                                border: '1px solid rgba(208, 107, 107, 0.25)',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 펼쳐진 부서의 구성원 제외 설정 패널 */}
        {expandedDept && (() => {
          const d = departments.find((dept) => dept.dept === expandedDept);
          if (!d) return null;
          const excludedSet = excludedMap[d.dept] || new Set();

          return (
            <div
              style={{
                margin: '0 18px 18px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--bg-card-2)',
                padding: '14px 18px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
                  <span>[{d.dept}] 구성원 상세 설정</span>
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>
                    (체크 시 캘린더 멤버 및 일정 동기화에서 제외)
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  ※ 프리랜서는 MySQL 정직원 명단에 없으므로 자동 제외됩니다.
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 10px', width: 90 }}>권한 제외</th>
                      <th style={{ padding: '6px 10px' }}>이름</th>
                      <th style={{ padding: '6px 10px' }}>사번</th>
                      <th style={{ padding: '6px 10px' }}>네이버웍스 이메일</th>
                      <th style={{ padding: '6px 10px' }}>재직상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.employees.map((emp) => {
                      const isExcluded = excludedSet.has(emp.empNo);
                      return (
                        <tr
                          key={emp.empNo}
                          style={{
                            borderBottom: '1px solid var(--border-row)',
                            background: isExcluded ? 'rgba(208, 107, 107, 0.05)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '8px 10px' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={isExcluded}
                                onChange={() => toggleExclude(d.dept, emp.empNo)}
                                style={{ cursor: 'pointer' }}
                              />
                              <span style={{ color: isExcluded ? 'var(--red)' : 'var(--text-3)', fontWeight: isExcluded ? 700 : 400 }}>
                                {isExcluded ? '제외됨' : '포함'}
                              </span>
                            </label>
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 800, color: 'var(--text-1)' }}>{emp.name}</td>
                          <td className="time-display" style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{emp.empNo}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{emp.email || '-'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span className={`badge ${emp.isActive ? 'green' : 'resigned'}`}>
                              {emp.isActive ? '재직' : '퇴사/비활성'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </EmployeeAdminShell>
  );
}
