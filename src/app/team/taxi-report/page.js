'use client';

import { useEffect, useMemo, useState } from 'react';
import EmployeeAdminShell from '@/app/admin/employees/EmployeeAdminShell';
import {
  CarTaxiFront,
  Calendar,
  Search,
  Download,
  RefreshCcw,
  Building2,
  Clock,
  Banknote,
  Coins,
  FileText,
  Filter,
  ArrowUpDown,
  LayoutGrid,
  Table as TableIcon,
  AlertCircle,
  TrendingUp,
  Award,
  Sparkles,
  Zap,
  Users,
} from 'lucide-react';
import { getKstDateKey, shiftKstDateKey } from '@/lib/kstDate';
import { downloadTaxiReportPdf } from '@/lib/taxiReportPdf';

function formatCurrency(val) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('ko-KR').format(Math.round(num));
}

function formatRideTimeTwoLines(rideTimeStr) {
  if (!rideTimeStr || rideTimeStr === '-') return { date: '-', time: '' };
  const parts = String(rideTimeStr).trim().split(' ');
  if (parts.length >= 2) {
    return { date: parts[0], time: parts[1] };
  }
  return { date: rideTimeStr, time: '' };
}

function StatBadge({ tone = 'blue', children }) {
  const tones = {
    purple: { bg: 'rgba(157, 123, 216, 0.16)', color: 'var(--purple, #9d7bd8)', border: 'rgba(157, 123, 216, 0.35)' },
    amber: { bg: 'rgba(201, 150, 75, 0.16)', color: 'var(--amber, #c9964b)', border: 'rgba(201, 150, 75, 0.35)' },
    blue: { bg: 'rgba(91, 136, 214, 0.16)', color: 'var(--blue, #5b88d6)', border: 'rgba(91, 136, 214, 0.35)' },
    green: { bg: 'rgba(95, 169, 113, 0.16)', color: 'var(--green, #5fa971)', border: 'rgba(95, 169, 113, 0.35)' },
    rose: { bg: 'rgba(208, 107, 107, 0.16)', color: 'var(--red, #d06b6b)', border: 'rgba(208, 107, 107, 0.35)' },
    gray: { bg: 'var(--bg-input)', color: 'var(--text-2)', border: 'var(--border)' },
  };

  const current = tones[tone] || tones.gray;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: current.bg,
        color: current.color,
        border: `1px solid ${current.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default function TaxiReportPage() {
  const today = getKstDateKey();
  const initialStart = shiftKstDateKey(today, -29);

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(today);
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState(null);
  const [meta, setMeta] = useState({ permissionScope: 'SINGLE_DEPT', userDept: '', allowedDepts: null });

  // 부서별 현황 View 모드: 'both' | 'kpi' | 'table'
  const [deptViewMode, setDeptViewMode] = useState('both');

  // 전체 이용내역 검색어
  const [tableSearch, setTableSearch] = useState('');

  const fetchReport = async (start = startDate, end = endDate, deptFilter = selectedDept) => {
    try {
      setLoading(true);
      setError('');

      const res = await fetch('/api/team/taxi-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: start, endDate: end, dept: deptFilter }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '리포트 데이터를 불러오지 못했습니다.');

      setReportData(json.data || null);
      if (json.meta) {
        setMeta(json.meta);
      }
    } catch (err) {
      console.error('[Taxi Report Fetch Error]', err);
      setError(err?.message || '리포트 데이터를 불러오는 도중 오류가 발생했습니다.');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport(initialStart, today, 'ALL');
  }, []);

  // Quick Date presets
  const handleQuickPreset = (days) => {
    const end = getKstDateKey();
    let start = end;

    if (days === 'thisMonth') {
      start = `${end.slice(0, 7)}-01`;
    } else if (days === 'lastMonth') {
      const parts = end.split('-');
      let y = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10) - 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
      const lastMonthStr = `${y}-${String(m).padStart(2, '0')}`;
      start = `${lastMonthStr}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const lastMonthEnd = `${lastMonthStr}-${String(lastDay).padStart(2, '0')}`;
      setStartDate(start);
      setEndDate(lastMonthEnd);
      fetchReport(start, lastMonthEnd, selectedDept);
      return;
    } else {
      start = shiftKstDateKey(end, -days + 1);
    }

    setStartDate(start);
    setEndDate(end);
    fetchReport(start, end, selectedDept);
  };

  const handleDeptChange = (e) => {
    const deptVal = e.target.value;
    setSelectedDept(deptVal);
    fetchReport(startDate, endDate, deptVal);
  };

  const handlePdfDownload = async () => {
    if (!reportData?.rows?.length) {
      setError('다운로드할 이용내역이 없습니다.');
      return;
    }
    try {
      setPdfLoading(true);
      setError('');
      await downloadTaxiReportPdf(reportData.rows, { startDate, endDate, dept: selectedDept === 'ALL' ? '전체부서' : selectedDept });
    } catch (downloadError) {
      console.error('[Taxi Report PDF Error]', downloadError);
      setError(downloadError?.message || 'PDF 다운로드에 실패했습니다.');
    } finally {
      setPdfLoading(false);
    }
  };

  // Filtered rows for full transaction table
  const filteredRows = useMemo(() => {
    if (!reportData?.rows) return [];
    const query = tableSearch.trim().toLowerCase();
    if (!query) return reportData.rows;

    return reportData.rows.filter((r) => {
      const haystack = [
        r.employeeName,
        r.dept,
        r.reason,
        r.pickup,
        r.dropoff,
        r.rideTime,
        r.orderId,
        r.verticalProductName,
        r.taxiKind,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [reportData?.rows, tableSearch]);

  const summary = reportData?.summary;
  const deptStats = reportData?.deptStats || [];
  const timeWindowStats = reportData?.timeWindowStats;
  const extraFeeStats = reportData?.extraFeeStats;
  const excludedSummary = reportData?.excludedSummary;
  const excludedStatusStats = reportData?.excludedStatusStats || [];
  const reasonStats = reportData?.reasonStats || [];
  const dailyStats = reportData?.dailyStats || [];
  const availableDepts = reportData?.availableDepts || [];
  const displayDeptName = meta.userDept || availableDepts[0] || deptStats[0]?.dept || '소속팀';

  return (
    <EmployeeAdminShell activeHref="/team/taxi-report">
      <div style={{ paddingBottom: 60, maxWidth: 1300, margin: '0 auto' }}>
        {/* Header Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-1)' }}>
              <CarTaxiFront size={28} style={{ color: 'var(--amber)' }} />
              카카오T 이용 분석 리포트
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '4px 0 0 0' }}>
              기간별 카카오T 택시 이용 현황, 부서별/시간대별 패턴, 추가 호출비 및 이용사유 집계 리포트입니다.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => fetchReport()}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                minHeight: 34,
                borderRadius: 8,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-card-2)',
                color: 'var(--text-1)',
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: 'none',
              }}
            >
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
              새로고침
            </button>
            <button
              type="button"
              onClick={handlePdfDownload}
              disabled={loading || pdfLoading || !reportData?.rows?.length}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                minHeight: 34,
                borderRadius: 8,
                border: '1px solid var(--amber)',
                backgroundColor: 'var(--amber)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: (loading || pdfLoading || !reportData?.rows?.length) ? 'not-allowed' : 'pointer',
                opacity: (loading || pdfLoading || !reportData?.rows?.length) ? 0.65 : 1,
                boxShadow: 'none',
              }}
            >
              <Download size={14} />
              {pdfLoading ? 'PDF 생성 중...' : 'PDF 다운로드'}
            </button>
          </div>
        </div>

        {/* 1. 최상단 날짜 및 부서 선택바 (Date & Dept Range Picker Bar) */}
        <div
          className="taxi-report-section-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            padding: '16px 20px',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Calendar size={18} style={{ color: 'var(--blue)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>조회 기간:</span>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="taxi-report-input"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-1)',
                fontSize: 13.5,
                fontWeight: 500,
                outline: 'none',
                colorScheme: 'dark light',
              }}
            />
            <span style={{ color: 'var(--text-3)' }}>~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="taxi-report-input"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-1)',
                fontSize: 13.5,
                fontWeight: 500,
                outline: 'none',
                colorScheme: 'dark light',
              }}
            />

            {/* 부서 필터 선택 (권한별 구분) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <Building2 size={16} style={{ color: 'var(--purple)' }} />
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>부서:</span>
              {meta.permissionScope === 'SINGLE_DEPT' ? (
                <span
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(91, 136, 214, 0.12)',
                    border: '1px solid rgba(91, 136, 214, 0.28)',
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--blue)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {displayDeptName}
                </span>
              ) : (
                <select
                  value={selectedDept}
                  onChange={handleDeptChange}
                  className="taxi-report-select"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-1)',
                    fontSize: 13,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="ALL">
                    {meta.permissionScope === 'ADMIN' ? '전체 부서 (All)' : '외부사업팀 전체 (4개 부서)'}
                  </option>
                  {meta.permissionScope === 'EXTERNAL_BIZ' ? (
                    <>
                      <option value="사업개발팀">사업개발팀</option>
                      <option value="사업관리1팀">사업관리1팀</option>
                      <option value="사업관리2팀">사업관리2팀</option>
                      <option value="사업관리3팀">사업관리3팀</option>
                    </>
                  ) : (
                    availableDepts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={() => fetchReport()}
              disabled={loading}
              style={{
                padding: '8px 18px',
                minHeight: 34,
                borderRadius: 8,
                backgroundColor: 'var(--blue)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginLeft: 4,
                boxShadow: '0 2px 8px rgba(91, 136, 214, 0.3)',
              }}
            >
              <Search size={15} />
              조회
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginRight: 4 }}>빠른 선택:</span>
            <button
              type="button"
              onClick={() => handleQuickPreset(7)}
              className="taxi-report-quick-btn"
              style={{
                padding: '6px 11px',
                minHeight: 28,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              최근 7일
            </button>
            <button
              type="button"
              onClick={() => handleQuickPreset(30)}
              className="taxi-report-quick-btn"
              style={{
                padding: '6px 11px',
                minHeight: 28,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              최근 30일
            </button>
            <button
              type="button"
              onClick={() => handleQuickPreset('thisMonth')}
              className="taxi-report-quick-btn"
              style={{
                padding: '6px 11px',
                minHeight: 28,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              이번 달
            </button>
            <button
              type="button"
              onClick={() => handleQuickPreset('lastMonth')}
              className="taxi-report-quick-btn"
              style={{
                padding: '6px 11px',
                minHeight: 28,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              지난 달
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              backgroundColor: 'rgba(208, 107, 107, 0.12)',
              border: '1px solid rgba(208, 107, 107, 0.28)',
              color: 'var(--red)',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <AlertCircle size={18} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{error}</span>
          </div>
        )}

        {/* Global Summary KPI Grid */}
        {summary && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              className="taxi-report-kpi-card"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderRadius: 12,
                padding: 18,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-2)', fontSize: 13, marginBottom: 6 }}>
                <span>총 이용건수</span>
                <CarTaxiFront size={18} style={{ color: 'var(--blue)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)' }}>{summary.totalCount.toLocaleString()}건</div>
            </div>

            <div
              className="taxi-report-kpi-card"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderRadius: 12,
                padding: 18,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-2)', fontSize: 13, marginBottom: 6 }}>
                <span>총 이용금액</span>
                <Coins size={18} style={{ color: 'var(--amber)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)' }}>{formatCurrency(summary.totalAmount)}원</div>
            </div>

            <div
              className="taxi-report-kpi-card"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderRadius: 12,
                padding: 18,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-2)', fontSize: 13, marginBottom: 6 }}>
                <span>건당 평균 금액</span>
                <TrendingUp size={18} style={{ color: 'var(--purple)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)' }}>{formatCurrency(summary.avgAmount)}원</div>
            </div>

            <div
              className="taxi-report-kpi-card"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderRadius: 12,
                padding: 18,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-2)', fontSize: 13, marginBottom: 6 }}>
                <span>이용 부서 / 사원 수</span>
                <Building2 size={18} style={{ color: 'var(--green)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)' }}>
                {summary.activeDeptsCount}개 부서 <span style={{ fontSize: 16, color: 'var(--text-2)', fontWeight: 500 }}>({summary.activeEmployeesCount}명)</span>
              </div>
            </div>
          </div>
        )}

        {excludedSummary?.totalCount > 0 && (
          <div
            className="taxi-report-section-card"
            style={{
              backgroundColor: 'rgba(148, 163, 184, 0.08)',
              borderRadius: 12,
              padding: '14px 18px',
              border: '1px solid var(--border)',
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>취소·환불 등 제외 내역</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
                  정상 이용 통계에서 제외하고 별도로 집계한 카카오T 주문입니다.
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
                {excludedSummary.totalCount.toLocaleString()}건 · {formatCurrency(excludedSummary.totalAmount)}원
              </div>
            </div>
            {excludedStatusStats.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {excludedStatusStats.map((item) => (
                  <span key={item.status} style={{ fontSize: 12, color: 'var(--text-2)', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 9px' }}>
                    {item.status}: {item.count}건 ({formatCurrency(item.amount)}원)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. 부서별 이용 현황 (Department Breakdown: Both KPI & Table view options) */}
        <div
          className="taxi-report-section-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            padding: '20px 24px',
            border: '1px solid var(--border)',
            marginBottom: 24,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
                <Building2 size={20} style={{ color: 'var(--purple)' }} />
                기간 내 부서별 이용 현황
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 0 0' }}>
                부서명, 이용건수, 총 이용금액, 이용건수 비중(%), 이용금액 비중(%)을 보여줍니다.
              </p>
            </div>

            {/* View Mode Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                backgroundColor: 'var(--bg-input)',
                padding: 4,
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}
            >
              <button
                type="button"
                onClick={() => setDeptViewMode('both')}
                className={`taxi-report-toggle-btn ${deptViewMode === 'both' ? 'active' : ''}`}
                style={{
                  padding: '6px 12px',
                  minHeight: 28,
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: deptViewMode === 'both' ? 700 : 500,
                  backgroundColor: deptViewMode === 'both' ? 'var(--bg-card)' : 'transparent',
                  color: deptViewMode === 'both' ? 'var(--text-1)' : 'var(--text-2)',
                  cursor: 'pointer',
                  boxShadow: deptViewMode === 'both' ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                }}
              >
                둘 다 함께 보기 (비교용)
              </button>
              <button
                type="button"
                onClick={() => setDeptViewMode('kpi')}
                className={`taxi-report-toggle-btn ${deptViewMode === 'kpi' ? 'active' : ''}`}
                style={{
                  padding: '6px 12px',
                  minHeight: 28,
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: deptViewMode === 'kpi' ? 700 : 500,
                  backgroundColor: deptViewMode === 'kpi' ? 'var(--bg-card)' : 'transparent',
                  color: deptViewMode === 'kpi' ? 'var(--text-1)' : 'var(--text-2)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: deptViewMode === 'kpi' ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                }}
              >
                <LayoutGrid size={14} />
                KPI 카드 뷰
              </button>
              <button
                type="button"
                onClick={() => setDeptViewMode('table')}
                className={`taxi-report-toggle-btn ${deptViewMode === 'table' ? 'active' : ''}`}
                style={{
                  padding: '6px 12px',
                  minHeight: 28,
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: deptViewMode === 'table' ? 700 : 500,
                  backgroundColor: deptViewMode === 'table' ? 'var(--bg-card)' : 'transparent',
                  color: deptViewMode === 'table' ? 'var(--text-1)' : 'var(--text-2)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: deptViewMode === 'table' ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                }}
              >
                <TableIcon size={14} />
                테이블 뷰
              </button>
            </div>
          </div>

          {deptStats.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
              해당 기간의 부서별 이용 데이터가 없습니다.
            </div>
          ) : (
            <div>
              {/* Option A: KPI Card View */}
              {(deptViewMode === 'both' || deptViewMode === 'kpi') && (
                <div style={{ marginBottom: deptViewMode === 'both' ? 24 : 0 }}>
                  {deptViewMode === 'both' && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <LayoutGrid size={15} /> [형식 A] KPI 카드형 뷰
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {deptStats.map((item, idx) => (
                      <div
                        key={item.dept || idx}
                        className="taxi-report-sub-card"
                        style={{
                          backgroundColor: 'var(--bg-card-2)',
                          borderRadius: 12,
                          padding: 16,
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{item.dept}</span>
                          <StatBadge tone={idx === 0 ? 'purple' : idx === 1 ? 'blue' : 'gray'}>
                            {idx + 1}위
                          </StatBadge>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>이용건수 (비중)</div>
                            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: 'var(--text-1)' }}>
                              {item.count}건 <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 700 }}>({item.countRatio}%)</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>총 이용금액 (비중)</div>
                            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: 'var(--text-1)' }}>
                              {formatCurrency(item.amount)}원 <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>({item.amountRatio}%)</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--bg-input)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, item.amountRatio)}%`,
                              backgroundColor: idx === 0 ? 'var(--purple)' : idx === 1 ? 'var(--blue)' : 'var(--green)',
                              borderRadius: 3,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Option B: Table View */}
              {(deptViewMode === 'both' || deptViewMode === 'table') && (
                <div>
                  {deptViewMode === 'both' && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <TableIcon size={15} /> [형식 B] 테이블 집계 뷰
                    </div>
                  )}

                  <div className="taxi-report-table-container" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, backgroundColor: 'var(--bg-card)' }}>
                    <table className="taxi-report-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-card-2)', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-2)' }}>부서명</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>이용건수</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>이용건수 비중 (%)</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>총 이용금액</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>이용금액 비중 (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptStats.map((item, idx) => (
                          <tr key={item.dept || idx} style={{ borderBottom: '1px solid var(--border-row)' }}>
                            <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-1)' }}>{item.dept}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-1)' }}>{item.count.toLocaleString()}건</td>
                            <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--blue)', fontWeight: 700 }}>{item.countRatio}%</td>
                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-1)' }}>{formatCurrency(item.amount)}원</td>
                            <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--amber)', fontWeight: 700 }}>{item.amountRatio}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. 일자별 시간대별 이용 현황 & 4. 추가 호출비 발생 현황 (2 Columns Grid) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, marginBottom: 24 }}>
          {/* 3. 시간대별 이용 현황 (19:00~24:00 & 00:00~06:00) */}
          <div
            className="taxi-report-section-card"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 14,
              padding: '20px 24px',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
              marginBottom: 0,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
              <Clock size={20} style={{ color: 'var(--amber)' }} />
              시간대별 이용 현황
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px 0' }}>
              저녁/야근(19~24시)과 심야/새벽(00~06시) 핵심 시간대 이용 패턴입니다.
            </p>

            {timeWindowStats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* 저녁/야근 (19:00 - 24:00) */}
                <div style={{ backgroundColor: 'rgba(201, 150, 75, 0.1)', borderRadius: 10, padding: 16, border: '1px solid rgba(201, 150, 75, 0.28)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      🌆 {timeWindowStats.evening.label}
                    </span>
                    <StatBadge tone="amber">{timeWindowStats.evening.countRatio}%</StatBadge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-1)' }}>
                    <span>이용건수: <strong style={{ color: 'var(--text-1)' }}>{timeWindowStats.evening.count}건</strong></span>
                    <span>이용금액: <strong style={{ color: 'var(--text-1)' }}>{formatCurrency(timeWindowStats.evening.amount)}원</strong></span>
                  </div>
                </div>

                {/* 심야/새벽 (00:00 - 06:00) */}
                <div style={{ backgroundColor: 'rgba(157, 123, 216, 0.1)', borderRadius: 10, padding: 16, border: '1px solid rgba(157, 123, 216, 0.28)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      🌙 {timeWindowStats.lateNight.label}
                    </span>
                    <StatBadge tone="purple">{timeWindowStats.lateNight.countRatio}%</StatBadge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-1)' }}>
                    <span>이용건수: <strong style={{ color: 'var(--text-1)' }}>{timeWindowStats.lateNight.count}건</strong></span>
                    <span>이용금액: <strong style={{ color: 'var(--text-1)' }}>{formatCurrency(timeWindowStats.lateNight.amount)}원</strong></span>
                  </div>
                </div>

                {/* 주간/기타 (06:00 - 19:00) */}
                <div
                  className="taxi-report-sub-card"
                  style={{
                    backgroundColor: 'var(--bg-card-2)',
                    borderRadius: 10,
                    padding: 14,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-2)' }}>
                      ☀️ {timeWindowStats.daytime.label}
                    </span>
                    <StatBadge tone="gray">{timeWindowStats.daytime.countRatio}%</StatBadge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
                    <span>이용건수: {timeWindowStats.daytime.count}건</span>
                    <span>이용금액: {formatCurrency(timeWindowStats.daytime.amount)}원</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 4. 추가 호출비 발생 현황 분석 */}
          <div
            className="taxi-report-section-card"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 14,
              padding: '20px 24px',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
              marginBottom: 0,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
              <Zap size={20} style={{ color: 'var(--red)' }} />
              추가 호출비 발생 현황 분석
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px 0' }}>
              플랫폼 이용료, 기본/스마트 호출료 등 추가비용이 발생한 건의 통계입니다.
            </p>

            {extraFeeStats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    backgroundColor: 'rgba(208, 107, 107, 0.1)',
                    border: '1px solid rgba(208, 107, 107, 0.28)',
                    borderRadius: 12,
                    padding: 18,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
                    추가 호출비 발생건 비중
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--red)' }}>
                    {extraFeeStats.tripCount}건 <span style={{ fontSize: 18 }}>({extraFeeStats.tripRatio}%)</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div
                    className="taxi-report-sub-card"
                    style={{
                      backgroundColor: 'var(--bg-card-2)',
                      borderRadius: 10,
                      padding: 14,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>추가 호출비 총 금액</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: 'var(--red)' }}>
                      {formatCurrency(extraFeeStats.totalFeeAmount)}원
                    </div>
                  </div>

                  <div
                    className="taxi-report-sub-card"
                    style={{
                      backgroundColor: 'var(--bg-card-2)',
                      borderRadius: 10,
                      padding: 14,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>전체 결제액 대비 비중</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: 'var(--red)' }}>
                      {extraFeeStats.amountRatio}%
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-2)', backgroundColor: 'var(--bg-card-2)', border: '1px solid var(--border)', padding: 12, borderRadius: 8, lineHeight: 1.5 }}>
                  💡 <strong>참고:</strong> 빠른 배차를 위해 스마트호출/플랫폼 사용료가 부과된 이용건에 대한 추가 비용 집계입니다.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. 주요 이용사유 현황 (TOP 4만 1행 카드 형태) */}
        <div
          className="taxi-report-section-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            padding: '20px 24px',
            border: '1px solid var(--border)',
            marginBottom: 24,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
            <FileText size={20} style={{ color: 'var(--blue)' }} />
            주요 이용사유 현황 (TOP 4)
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px 0' }}>
            카카오T 승차 시 선택한 용도/사유 상위 4개 항목의 이용 건수 및 금액 집계입니다.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {reasonStats.slice(0, 4).map((item, idx) => (
              <div
                key={item.reason || idx}
                className="taxi-report-sub-card"
                style={{
                  backgroundColor: 'var(--bg-card-2)',
                  borderRadius: 10,
                  padding: 14,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{item.reason}</span>
                  <StatBadge tone={idx === 0 ? 'purple' : idx === 1 ? 'blue' : 'gray'}>{item.countRatio}%</StatBadge>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
                  <span>{item.count}건</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{formatCurrency(item.amount)}원</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 6. 일자별 이용 현황 (Daily Breakdown Table) */}
        <div
          className="taxi-report-section-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            padding: '20px 24px',
            border: '1px solid var(--border)',
            marginBottom: 24,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
            <Calendar size={20} style={{ color: 'var(--green)' }} />
            일자별 이용 현황
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 16px 0' }}>
            선택된 기간 내 각 일자별 이용 건수, 총 금액, 평균 금액 및 시간대 집계입니다.
          </p>

          <div className="taxi-report-table-container" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, maxHeight: 350, backgroundColor: 'var(--bg-card)' }}>
            <table className="taxi-report-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: 'var(--bg-card-2)' }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-2)' }}>일자 (Date)</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>이용건수</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>총 이용금액</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>건당 평균금액</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right' }}>야근/심야 건수</th>
                </tr>
              </thead>
              <tbody>
                {dailyStats.map((row) => (
                  <tr key={row.date} style={{ borderBottom: '1px solid var(--border-row)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-1)' }}>{row.date}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-1)' }}>{row.count}건</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: 'var(--text-1)' }}>{formatCurrency(row.amount)}원</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-2)' }}>{formatCurrency(row.avgAmount)}원</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      {(row.eveningCount > 0 || row.lateNightCount > 0) ? (
                        <StatBadge tone="amber">
                          야근 {row.eveningCount}건 / 심야 {row.lateNightCount}건
                        </StatBadge>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 7. 최하단 전체 이용내역 상세 표 (Full Transactions Table) */}
        <div
          className="taxi-report-section-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            padding: '20px 24px',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
                <CarTaxiFront size={20} style={{ color: 'var(--purple)' }} />
                전체 이용내역 상세 목록 ({filteredRows.length}건)
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 0 0' }}>
                선택 기간 동안의 카카오T 이용내역 전체 상세 목록입니다.
              </p>
            </div>

            {/* Table Search input */}
            <div style={{ position: 'relative', minWidth: 260 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-3)' }} />
              <input
                type="text"
                placeholder="사원명, 부서, 사유, 출발/도착지 검색..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="taxi-report-input"
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 34px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-1)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div className="taxi-report-table-container" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, backgroundColor: 'var(--bg-card)' }}>
            <table className="taxi-report-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-card-2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap', minWidth: 100 }}>승차 일시</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap', minWidth: 100 }}>부서</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap', minWidth: 90 }}>사원명</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', minWidth: 200 }}>출발지 ➔ 도착지</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', minWidth: 160 }}>이용목적</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 105 }}>결제금액</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-2)', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 105 }}>추가호출비</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)' }}>
                      조회된 이용내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const { date, time } = formatRideTimeTwoLines(row.rideTime);
                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--border-row)' }}>
                        {/* 1. 승차 일시 (2줄 표시) */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{date}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{time}</div>
                        </td>

                        {/* 2. 부서 */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <StatBadge tone="gray">{row.dept}</StatBadge>
                        </td>

                        {/* 3. 사원명 */}
                        <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                          {row.employeeName}
                        </td>

                        {/* 4. 출발지 -> 도착지 (2줄 표시) */}
                        <td style={{ padding: '10px 14px', fontSize: 12 }}>
                          <div
                            style={{ color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}
                            title={row.pickup}
                          >
                            {row.pickup || '-'}
                          </div>
                          <div
                            style={{ color: 'var(--text-2)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240, fontSize: 11 }}
                            title={row.dropoff}
                          >
                            <span style={{ color: 'var(--blue)', fontWeight: 700, marginRight: 4 }}>➔</span>
                            {row.dropoff || '-'}
                          </div>
                        </td>

                        {/* 5. 이용목적 */}
                        <td style={{ padding: '10px 14px', minWidth: 160 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{row.reason}</div>
                          {(row.verticalProductName || row.taxiKind) && (
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                              {row.verticalProductName || row.taxiKind}
                            </div>
                          )}
                        </td>

                        {/* 6. 결제금액 */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                          {formatCurrency(row.amount)}원
                        </td>

                        {/* 7. 추가호출비 */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {row.hasExtraFee ? (
                            <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                              +{formatCurrency(row.platformFee)}원
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-3)' }}>-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </EmployeeAdminShell>
  );
}
