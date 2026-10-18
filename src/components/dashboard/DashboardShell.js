'use client';

import React, { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, RefreshCw, Sun, Moon } from 'lucide-react';
import Image from 'next/image';
import AppSidebar from '../AppSidebar';
import MobileBottomNav from '../MobileBottomNav';
import { getMainSidebarItems, sidebarActionIcons } from '../../lib/sidebarConfig';
import { canViewOvertimeMenu } from '../../lib/overtimeRules';
import dynamic from 'next/dynamic';

const DashboardTab = dynamic(() => import('../tabs/DashboardTab'), { ssr: false });
const MonthlyTab = dynamic(() => import('../tabs/MonthlyTab'), { ssr: false });
const TrackerTab = dynamic(() => import('../tabs/TrackerTab'), { ssr: false });
const ScheduleTab = dynamic(() => import('../tabs/ScheduleTab'), { ssr: false });
const LeaveTab = dynamic(() => import('../tabs/LeaveTab'), { ssr: false });
const OvertimeTab = dynamic(() => import('../tabs/OvertimeTab'), { ssr: false });
const AdminPanelTabs = dynamic(() => import('../tabs/AdminPanelTabs'), { ssr: false });
const EmployeeAdminTab = dynamic(() => import('../tabs/EmployeeAdminTab'), { ssr: false });
const AttendanceExportTab = dynamic(() => import('../tabs/AttendanceExportTab'), { ssr: false });

function DashboardTabSync({ setActiveTab }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    setActiveTab(searchParams.get('tab') || 'DASHBOARD');
  }, [searchParams, setActiveTab]);
  return null;
}

const pageTitles = {
  DASHBOARD: '실시간 직원 상태 모니터링',
  MONTHLY: '기간별 직원 상태 현황',
  TRACKER: '개인 상세 근무 트래커',
  EMPLOYEES: '직원 근무일정 및 휴가 관리',
  EMPLOYEE_ADMIN: '직원 정보 수정 및 비밀번호 초기화',
  MY_PORTAL: '개인 근태 포털',
  LEAVES: '연차 사용 현황',
  OVERTIME: '초과근무 관리',
  MANUAL_APPROVAL: '수동 요청 내역',
  USER_REGISTER: '사용자 계정 등록',
  CAPS_UPLOAD: '캡스 출입기록 업로드',
  ATTENDANCE_EXPORT: '근태기록 저장',
};

const pageSubtitles = {
  DASHBOARD: '오늘 기준 출근, 부서 현황, 실시간 직원 상태를 집계합니다.',
  MONTHLY: '선택한 월의 출퇴근 및 근태 현황을 확인합니다.',
  TRACKER: '개인별 출근, 퇴근, 근무시간을 조회하고 조정합니다.',
  EMPLOYEES: '고정 근무일정과 일자별 휴가 및 조정을 관리합니다.',
  EMPLOYEE_ADMIN: '직원 기본 정보와 계정 초기 비밀번호를 관리합니다.',
  MY_PORTAL: '본인의 출퇴근 기록과 근무 현황을 확인합니다.',
  LEAVES: '직원들의 연차 및 휴가 사용 현황을 확인합니다.',
  OVERTIME: '지정 기간 동안 직원별 초과근무를 관리합니다.',
  MANUAL_APPROVAL: '출퇴근 수정 요청과 근무일정 조정 요청을 함께 심사합니다.',
  USER_REGISTER: '로그인 계정과 사원번호 정보를 연결해 등록합니다.',
  CAPS_UPLOAD: '캡스 출입기록 파일을 업로드해 월간 기록에 반영합니다.',
  ATTENDANCE_EXPORT: '연도, 월, 부서를 선택해 월간 근태현황을 엑셀로 저장합니다.',
};

export default function DashboardShell({
  authChecking,
  loading,
  data,
  activeTab,
  setActiveTab,
  theme,
  toggleTheme,
  time,
  refreshing,
  fetchTodayData,
  viewDeptFilter,
  setViewDeptFilter,
  hasFullAccess,
  resolvedDeptFilterValue,
  deptOptions,
  myName,
  myRank,
  myLoginId,
  myEmpNo,
  myDept,
  isAdmin,
  isLeader,
  myPosition,
  selectedMonth,
  setSelectedMonth,
  selectedEmployee,
  setSelectedEmployee,
  monthlyData,
  monthlyLoading,
  calendarMonth,
  setCalendarMonth,
  selectedCalendarDate,
  setSelectedCalendarDate,
  leaveCalendarDate,
  setLeaveCalendarDate,
  visibleDashboardLeaves,
  visibleMonthlyEmployees,
  visibleTrackerEmployees,
  visibleScheduleEmployees,
  visibleLeaves,
  calendarEmployeeNameLookup,
  refreshAllData,
  refreshEmployeeData,
  children,
}) {
  const router = useRouter();

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleMobileNavigate = useCallback((href, tabKey) => {
    if (href) {
      const tabMatch = href.match(/\?tab=([A-Z_]+)/);
      const tab = tabMatch ? tabMatch[1] : null;
      if (tab === 'TRACKER') setSelectedEmployee(myEmpNo);
      router.push(href);
    }
  }, [myEmpNo, router, setSelectedEmployee]);

  const handleRefreshData = useCallback(async (opts) => {
    if (opts?.empNo && refreshEmployeeData) {
      await refreshEmployeeData(opts.empNo, opts?.month);
    } else if (refreshAllData) {
      await refreshAllData();
    }
  }, [refreshEmployeeData, refreshAllData]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('user-is-admin');
      localStorage.removeItem('user-position');
      localStorage.removeItem('user-emp-no');
      localStorage.removeItem('user-name');
      localStorage.removeItem('user-rank');
      localStorage.removeItem('user-login-id');
      localStorage.removeItem('user-team');
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed:', e);
    }
  }, []);

  const sidebarItems = useMemo(() => {
    const sourceItems = isAdmin
      ? getMainSidebarItems({ isAdmin: true, isLeader: false })
      : getMainSidebarItems({ isAdmin, isLeader, dept: myDept, position: myPosition });

    return sourceItems.map((item) => {
      const tabMatch = item.href?.match(/\?tab=([A-Z_]+)/);
      const itemTab = tabMatch ? tabMatch[1] : null;
      return {
        ...item,
        active: itemTab ? itemTab === activeTab : item.href === '/admin/employees' && activeTab === 'EMPLOYEE_ADMIN',
        onClick: () => {
          if (item.href) {
            if (itemTab === 'TRACKER') setSelectedEmployee(myEmpNo);
            router.push(item.href);
          }
        },
        href: itemTab ? undefined : item.href,
      };
    });
  }, [activeTab, isAdmin, isLeader, myDept, myEmpNo, myPosition, router, setSelectedEmployee]);

  const footerActions = useMemo(() => ([
    {
      label: '로그아웃',
      icon: sidebarActionIcons.logout,
      onClick: async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
          localStorage.removeItem('user-is-admin');
          localStorage.removeItem('user-position');
          localStorage.removeItem('user-emp-no');
          localStorage.removeItem('user-name');
          localStorage.removeItem('user-rank');
          localStorage.removeItem('user-login-id');
          localStorage.removeItem('user-team');
          window.location.href = '/login';
        } catch (e) {
          console.error('Logout failed:', e);
        }
      },
      color: 'var(--red)',
    },
    {
      label: '마이페이지',
      icon: sidebarActionIcons.mypage,
      href: '/mypage',
      color: 'var(--blue)',
    },
  ]), []);

  if (authChecking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '12px', background: '#090f1e', color: '#fff' }}>
        <RefreshCw style={{ width: 32, height: 32, color: 'var(--blue)', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '15px', fontWeight: 600 }}>인증 정보를 확인 중입니다...</span>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '12px', background: '#090f1e', color: '#fff' }}>
        <RefreshCw style={{ width: 32, height: 32, color: 'var(--blue)', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '15px', fontWeight: 600 }}>시스템 데이터를 불러오는 중입니다...</span>
      </div>
    );
  }

  const mobileProfile = {
    name: myName || (isAdmin ? '관리자' : '직원'),
    rank: myRank,
    team: myDept,
    dept: myDept,
    position: myPosition,
  };

  return (
    <div className="ga-theme">
      <AppSidebar
        items={sidebarItems}
        profile={{
          name: myName || (isAdmin ? '관리자' : '직원'),
          rank: myRank,
          loginId: myLoginId,
          empNo: myEmpNo,
          team: myDept,
          dept: myDept,
        }}
        profileBadges={[
          ...(isAdmin ? [{ label: 'ADMIN', background: 'var(--red)', color: '#fff' }] : []),
          ...(isLeader ? [{ label: 'LEADER', background: 'var(--amber)', color: '#111' }] : []),
        ]}
        version="v2.1.0"
        footerActions={footerActions}
      />

      {/* Mobile header */}
      <div className="mobile-header">
        <Image
          src="/HQ.png"
          alt="HECTO"
          width={120}
          height={32}
          className="mobile-header__logo"
          priority
          style={{ objectFit: 'contain' }}
        />
        <div className="mobile-header__actions">
          <button className="icon-btn" onClick={() => refreshAllData()} disabled={refreshing} title="새로고침">
            <RefreshCw style={{ width: 15, height: 15, ...(refreshing ? { animation: 'spin 1s linear infinite' } : {}) }} />
          </button>
          <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '라이트 모드' : '다크 모드'}>
            {theme === 'dark' ? <Sun style={{ width: 15, height: 15 }} /> : <Moon style={{ width: 15, height: 15 }} />}
          </button>
        </div>
      </div>

      <Suspense fallback={null}>
        <DashboardTabSync setActiveTab={setActiveTab} />
      </Suspense>

      <main className="main-content">
        {activeTab !== 'DASHBOARD' ? (
        <div className="top-bar">
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-1)' }}>
              {pageTitles[activeTab] || '근태 관리'}
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', fontWeight: '500', marginTop: '2px' }}>
              {pageSubtitles[activeTab] || '근태 시스템을 관리합니다.'}
            </p>
          </div>

          <div className="top-actions">
            {data?.isDemo && (
              <div className="db-indicator" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                <AlertTriangle style={{ width: 14, height: 14 }} />
                <span className="db-name">데모 모드</span>
              </div>
            )}
            {['DASHBOARD', 'MONTHLY', 'TRACKER', 'LEAVES', 'OVERTIME'].includes(activeTab) && hasFullAccess && (
              <select
                className="ui-select"
                value={resolvedDeptFilterValue}
                onChange={(e) => setViewDeptFilter(e.target.value)}
                aria-label="부서 선택"
              >
                {deptOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept === 'ALL' ? '전체 부서' : dept}
                  </option>
                ))}
              </select>
            )}
            <button className="icon-btn" onClick={() => refreshAllData()} disabled={refreshing} title="새로고침">
              <RefreshCw style={{ width: 15, height: 15, ...(refreshing ? { animation: 'spin 1s linear infinite' } : {}) }} />
            </button>
            <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '라이트 모드' : '다크 모드'}>
              {theme === 'dark' ? <Sun style={{ width: 15, height: 15 }} /> : <Moon style={{ width: 15, height: 15 }} />}
            </button>
            <div className="time-display">{time}</div>
          </div>
        </div>
        ) : null}

        {activeTab === 'DASHBOARD' && data && (
          <DashboardTab
            data={data}
            loading={refreshing}
            viewDeptFilter={resolvedDeptFilterValue}
            isAdmin={isAdmin}
            isLeader={isLeader}
            myDept={myDept}
            myEmpNo={myEmpNo}
            resolvedDeptFilterValue={resolvedDeptFilterValue}
            deptOptions={deptOptions}
            hasFullAccess={hasFullAccess}
            time={time}
            theme={theme}
            toggleTheme={toggleTheme}
            setViewDeptFilter={setViewDeptFilter}
            calendarMonth={calendarMonth}
            setCalendarMonth={setCalendarMonth}
            selectedCalendarDate={selectedCalendarDate}
            setSelectedCalendarDate={setSelectedCalendarDate}
            visibleDashboardLeaves={visibleDashboardLeaves}
            calendarEmployeeNameLookup={calendarEmployeeNameLookup}
          />
        )}

        {activeTab === 'MONTHLY' && (
          <MonthlyTab
            monthlyLoading={monthlyLoading}
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            visibleMonthlyEmployees={visibleMonthlyEmployees}
            monthlyData={monthlyData}
            refreshData={handleRefreshData}
          />
        )}

        {(activeTab === 'TRACKER' || activeTab === 'MY_PORTAL') && (
          <TrackerTab
            activeTab={activeTab}
            myEmpNo={myEmpNo}
            myDept={myDept}
            isAdmin={isAdmin}
            isLeader={isLeader}
            selectedEmployee={selectedEmployee}
            setSelectedEmployee={setSelectedEmployee}
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            monthlyLoading={monthlyLoading}
            monthlyData={monthlyData}
            visibleTrackerEmployees={visibleTrackerEmployees}
            refreshData={handleRefreshData}
          />
        )}

        {activeTab === 'EMPLOYEES' && (isAdmin || isLeader) && (
          <ScheduleTab
            isAdmin={isAdmin}
            isLeader={isLeader}
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            monthlyData={monthlyData}
            visibleScheduleEmployees={visibleScheduleEmployees}
            refreshData={handleRefreshData}
          />
        )}

        {activeTab === 'LEAVES' && (
          <LeaveTab
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            calendarMonth={calendarMonth}
            visibleLeaves={visibleLeaves}
            calendarEmployeeNameLookup={calendarEmployeeNameLookup}
            leaveCalendarDate={leaveCalendarDate}
            setLeaveCalendarDate={setLeaveCalendarDate}
          />
        )}

        {activeTab === 'OVERTIME' && canViewOvertimeMenu({ isAdmin, isLeader, position: myPosition, dept: myDept }) && (
          <OvertimeTab
            isAdmin={isAdmin}
            visibleMonthlyEmployees={visibleMonthlyEmployees}
            monthlyData={monthlyData}
            myPosition={myPosition}
            myDept={myDept}
            refreshData={handleRefreshData}
            selectedMonth={selectedMonth}
          />
        )}

        {activeTab === 'ATTENDANCE_EXPORT' && isAdmin && (
          <AttendanceExportTab data={data} myDept={myDept} />
        )}

        {['MANUAL_APPROVAL', 'USER_REGISTER', 'CAPS_UPLOAD'].includes(activeTab) && (isAdmin || isLeader) && (
          <AdminPanelTabs
            activeTab={activeTab}
            isAdmin={isAdmin}
            isLeader={isLeader}
            myDept={myDept}
            monthlyData={monthlyData}
            data={data}
            theme={theme}
            refreshData={handleRefreshData}
          />
        )}

        {activeTab === 'EMPLOYEE_ADMIN' && isAdmin && (
          <EmployeeAdminTab
            isAdmin={isAdmin}
            data={data}
            monthlyData={monthlyData}
            theme={theme}
            refreshData={handleRefreshData}
          />
        )}
      </main>

      {children}

      {/* Mobile bottom navigation */}
      <MobileBottomNav
        activeTab={activeTab}
        onNavigate={handleMobileNavigate}
        isAdmin={isAdmin}
        isLeader={isLeader}
        profile={mobileProfile}
        onLogout={handleLogout}
      />
    </div>
  );
}
