'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  Users,
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
        ? ` (등록 일정: ${result.syncResult.created}건, 유지: ${result.syncResult.skipped}건)`
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
    if (!confirm(`[${dept}] 캘린더를 삭제하시겠습니까?\n네이버웍스에서도 캘린더가 제거됩니다.`)) {
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

  // 통계 계산
  const totalDepts = departments.length;
  const createdDepts = departments.filter((d) => d.isCreated).length;
  const totalActiveEmps = departments.reduce((acc, d) => acc + d.activeEmployees, 0);
  const totalExcluded = Object.values(excludedMap).reduce((acc, set) => acc + set.size, 0);

  return (
    <EmployeeAdminShell
      title="네이버웍스 캘린더 관리"
      subtitle="MySQL 정직원 명단을 기반으로 부서별 캘린더를 생성하고 특정 인원 권한 및 연차 일정을 자동 관리합니다."
      activeHref="/admin/naver-calendars"
    >
      <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
        {/* 상단 통계 카드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              background: 'var(--card-bg, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>전체 대상 부서</div>
            <div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '8px', color: '#f8fafc' }}>
              {totalDepts}
              <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: '6px' }}>개 부서</span>
            </div>
          </div>

          <div
            style={{
              background: 'var(--card-bg, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>캘린더 생성 완료</div>
            <div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '8px', color: '#10b981' }}>
              {createdDepts}
              <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: '6px', color: '#94a3b8' }}>
                / {totalDepts}
              </span>
            </div>
          </div>

          <div
            style={{
              background: 'var(--card-bg, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>동기화 정직원 수</div>
            <div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '8px', color: '#38bdf8' }}>
              {totalActiveEmps}
              <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: '6px' }}>명 (프리랜서 제외)</span>
            </div>
          </div>

          <div
            style={{
              background: 'var(--card-bg, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>권한 제외 지정 인원</div>
            <div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '8px', color: '#f59e0b' }}>
              {totalExcluded}
              <span style={{ fontSize: '14px', fontWeight: 'normal', marginLeft: '6px' }}>명 (대표이사 등)</span>
            </div>
          </div>
        </div>

        {/* 안내 메시지 및 필터 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
            <Search
              size={18}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
              }}
            />
            <input
              type="text"
              placeholder="부서명 또는 직원 이름 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                background: 'var(--input-bg, #0f172a)',
                border: '1px solid var(--border-color, #334155)',
                borderRadius: '8px',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            />
          </div>

          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              background: 'var(--button-secondary-bg, #334155)',
              border: 'none',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>

        {/* 알림 메시지 */}
        {message && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '20px',
              background: message.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: message.type === 'error' ? '1px solid #ef4444' : '1px solid #10b981',
              color: message.type === 'error' ? '#fca5a5' : '#6ee7b7',
              fontSize: '14px',
            }}
          >
            {message.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* 부서 목록 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <RefreshCw size={32} style={{ margin: '0 auto 12px' }} />
            <div>네이버웍스 캘린더 정보를 불러오는 중입니다...</div>
          </div>
        ) : filteredDepts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            검색 조건에 맞는 부서가 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredDepts.map((d) => {
              const isExpanded = expandedDept === d.dept;
              const excludedSet = excludedMap[d.dept] || new Set();
              const includedCount = d.employees.filter(
                (e) => e.isActive && !excludedSet.has(e.empNo)
              ).length;
              const isSaving = savingDept === d.dept;

              return (
                <div
                  key={d.dept}
                  style={{
                    background: 'var(--card-bg, #1e293b)',
                    border: '1px solid var(--border-color, #334155)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  {/* 부서 카드 헤더 */}
                  <div
                    style={{
                      padding: '16px 20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                      cursor: 'pointer',
                      background: isExpanded ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
                    }}
                    onClick={() => setExpandedDept(isExpanded ? null : d.dept)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {isExpanded ? <ChevronDown size={20} color="#94a3b8" /> : <ChevronRight size={20} color="#94a3b8" />}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '17px', fontWeight: '600', color: '#f8fafc' }}>
                            {d.dept}
                          </span>
                          {d.isCreated ? (
                            <span
                              style={{
                                fontSize: '12px',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: 'rgba(16, 185, 129, 0.2)',
                                color: '#10b981',
                                fontWeight: '500',
                              }}
                            >
                              캘린더 생성완료
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '12px',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: 'rgba(148, 163, 184, 0.2)',
                                color: '#94a3b8',
                                fontWeight: '500',
                              }}
                            >
                              미생성
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                          정직원 {d.activeEmployees}명 중 {includedCount}명 캘린더 멤버 포함 (제외 {excludedSet.size}명)
                          {d.calendarId && (
                            <span style={{ marginLeft: '10px', color: '#64748b' }}>
                              ID: {d.calendarId.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 액션 버튼 */}
                    <div
                      style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleSaveCalendar(d.dept, 'save')}
                        disabled={isSaving}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 14px',
                          background: '#2563eb',
                          border: 'none',
                          borderRadius: '6px',
                          color: '#ffffff',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: isSaving ? 'not-allowed' : 'pointer',
                          opacity: isSaving ? 0.7 : 1,
                        }}
                      >
                        <Check size={15} />
                        {d.isCreated ? '멤버 설정 저장' : '캘린더 생성'}
                      </button>

                      {d.isCreated && (
                        <button
                          type="button"
                          onClick={() => handleSaveCalendar(d.dept, 'sync-events')}
                          disabled={isSaving}
                          title="부서원들의 최근 승인 휴가를 네이버웍스 캘린더에 즉시 동기화합니다"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 12px',
                            background: '#059669',
                            border: 'none',
                            borderRadius: '6px',
                            color: '#ffffff',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: isSaving ? 'not-allowed' : 'pointer',
                            opacity: isSaving ? 0.7 : 1,
                          }}
                        >
                          <RefreshCw size={14} />
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
                            padding: '8px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '6px',
                            color: '#ef4444',
                            cursor: isSaving ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 펼침 영역: 구성원 제외 설정 체크박스 테이블 */}
                  {isExpanded && (
                    <div
                      style={{
                        borderTop: '1px solid var(--border-color, #334155)',
                        padding: '16px 20px',
                        background: 'rgba(15, 23, 42, 0.5)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '13px',
                          color: '#94a3b8',
                          marginBottom: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <AlertCircle size={15} color="#f59e0b" />
                        <span>
                          체크박스를 선택하면 해당 직원은 네이버웍스 캘린더 멤버 및 일정 동기화에서 제외됩니다 (예: 대표이사, 겸직 임원).
                        </span>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                              <th style={{ padding: '8px 12px', width: '120px' }}>권한 제외</th>
                              <th style={{ padding: '8px 12px' }}>사번</th>
                              <th style={{ padding: '8px 12px' }}>이름</th>
                              <th style={{ padding: '8px 12px' }}>네이버웍스 이메일</th>
                              <th style={{ padding: '8px 12px' }}>상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.employees.map((emp) => {
                              const isExcluded = excludedSet.has(emp.empNo);
                              return (
                                <tr
                                  key={emp.empNo}
                                  style={{
                                    borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
                                    background: isExcluded ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '10px 12px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={isExcluded}
                                        onChange={() => toggleExclude(d.dept, emp.empNo)}
                                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                      />
                                      <span style={{ fontSize: '12px', color: isExcluded ? '#f87171' : '#94a3b8' }}>
                                        {isExcluded ? '제외됨' : '포함'}
                                      </span>
                                    </label>
                                  </td>
                                  <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{emp.empNo}</td>
                                  <td style={{ padding: '10px 12px', fontWeight: '500', color: '#f8fafc' }}>
                                    {emp.name}
                                  </td>
                                  <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                                    {emp.email || '-'}
                                  </td>
                                  <td style={{ padding: '10px 12px' }}>
                                    {emp.isActive ? (
                                      <span style={{ color: '#10b981', fontSize: '12px' }}>정상 (재직)</span>
                                    ) : (
                                      <span style={{ color: '#ef4444', fontSize: '12px' }}>퇴사/비활성</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </EmployeeAdminShell>
  );
}
