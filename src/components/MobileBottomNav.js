'use client';

import React, { useState } from 'react';
import EmployeePhoto from './EmployeePhoto';
import { canViewOvertimeMenu, canViewManualApprovalMenu } from '../lib/overtimeRules';
import {
  LayoutDashboard,
  CalendarDays,
  Calendar,
  Users,
  MoreHorizontal,
  X,
  CheckCircle,
  Clock,
  Download,
  User,
  LogOut,
  CarTaxiFront,
} from 'lucide-react';

const MOBILE_PRIMARY_TABS = [
  { key: 'DASHBOARD', label: '대시보드', icon: LayoutDashboard, href: '/?tab=DASHBOARD' },
  { key: 'MONTHLY', label: '근태보고', icon: CalendarDays, href: '/?tab=MONTHLY', leaderOnly: true },
  { key: 'TRACKER', label: '트래커', icon: Calendar, href: '/?tab=TRACKER' },
  // { key: 'EMPLOYEES', label: '일정관리', icon: Users, href: '/?tab=EMPLOYEES', leaderOnly: true },
  { key: 'MORE', label: '더보기', icon: MoreHorizontal, href: null },
];

const MOBILE_MORE_ITEMS = [
  { key: 'LEAVES', label: '연차 현황', icon: CalendarDays, href: '/?tab=LEAVES', category: '일반' },
  { key: 'ICAL_SUBSCRIPTIONS', label: '캘린더 링크 생성', icon: CalendarDays, href: '/admin/ical-subscriptions', category: '부서', leaderOnly: true },
  { key: 'OVERTIME', label: '초과근무 관리', icon: Clock, href: '/?tab=OVERTIME', category: '부서', leaderOnly: true },
  { key: 'MANUAL_APPROVAL', label: '수동 요청 내역', icon: CheckCircle, href: '/?tab=MANUAL_APPROVAL', category: '부서', leaderOnly: true },
  { key: 'ATTENDANCE_EXPORT', label: '근태기록 저장', icon: Download, href: '/?tab=ATTENDANCE_EXPORT', category: '관리자', adminOnly: true },
  { key: 'TAXI_AUDIT', label: '택시 소명관리', icon: CarTaxiFront, href: '/admin/taxi-audit', category: '관리자', adminOnly: true },
  { key: 'EMPLOYEE_ADMIN', label: '직원 관리', icon: Users, href: '/admin/employees', category: '관리자', adminOnly: true },
  { key: 'TERMINAL_ATTENDANCE', label: '석식 출입 조회', icon: Clock, href: '/admin/terminal-attendance', category: '관리자', adminOnly: true },
];

export default function MobileBottomNav({
  activeTab,
  onNavigate,
  isAdmin = false,
  isLeader = false,
  profile = {},
  onLogout,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const visiblePrimary = MOBILE_PRIMARY_TABS.filter((tab) => {
    if (tab.leaderOnly && !isAdmin && !isLeader) return false;
    return true;
  });

  // If leader items are filtered out, we have fewer tabs. Fill in LEAVES for non-leaders
  const primaryTabs = visiblePrimary.length < 4
    ? [
        { key: 'DASHBOARD', label: '대시보드', icon: LayoutDashboard, href: '/?tab=DASHBOARD' },
        { key: 'TRACKER', label: '트래커', icon: Calendar, href: '/?tab=TRACKER' },
        { key: 'LEAVES', label: '연차', icon: CalendarDays, href: '/?tab=LEAVES' },
        { key: 'MORE', label: '더보기', icon: MoreHorizontal, href: null },
      ]
    : visiblePrimary;

  const visibleMore = MOBILE_MORE_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.leaderOnly && !isAdmin && !isLeader) return false;
    const userDept = profile?.dept || profile?.team || '';
    if (item.key === 'OVERTIME' && !canViewOvertimeMenu({ isAdmin, isLeader, dept: userDept, position: profile?.position })) {
      return false;
    }
    if (item.key === 'MANUAL_APPROVAL' && !canViewManualApprovalMenu({ isAdmin, isLeader, dept: userDept, position: profile?.position })) {
      return false;
    }
    // Don't show items already in primary tabs
    if (primaryTabs.some((pt) => pt.key === item.key)) return false;
    return true;
  });

  const handleTabClick = (tab) => {
    if (tab.key === 'MORE') {
      setMoreOpen((prev) => !prev);
      return;
    }
    setMoreOpen(false);
    if (onNavigate && tab.href) {
      onNavigate(tab.href, tab.key);
    }
  };

  const handleMoreItemClick = (item) => {
    setMoreOpen(false);
    if (onNavigate && item.href) {
      onNavigate(item.href, item.key);
    }
  };

  return (
    <>
      {/* Overlay backdrop when more panel is open */}
      {moreOpen && (
        <div
          className="mobile-more-backdrop"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* "More" slide-up panel */}
      <div className={`mobile-more-panel ${moreOpen ? 'mobile-more-panel--open' : ''}`}>
        <div className="mobile-more-panel__header">
          <div className="mobile-more-panel__profile">
            <div className="mobile-more-panel__avatar" style={{ background: 'var(--blue)', overflow: 'hidden' }}>
              <EmployeePhoto empNo={profile.empNo} fallback={profile.name ? profile.name.slice(0, 1) : '?'} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-1)' }}>
                {`${profile.name || '사용자'}${profile.rank ? ` ${profile.rank}` : ''}`}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                {profile.team || profile.dept || ''}
              </div>
            </div>
          </div>
          <button
            className="mobile-more-panel__close"
            onClick={() => setMoreOpen(false)}
            aria-label="닫기"
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <div className="mobile-more-panel__items">
          {visibleMore.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                className={`mobile-more-item ${isActive ? 'mobile-more-item--active' : ''}`}
                onClick={() => handleMoreItemClick(item)}
              >
                <Icon style={{ width: 18, height: 18 }} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mobile-more-panel__footer">
          <button className="mobile-more-item mobile-more-item--action" onClick={() => { if (onNavigate) onNavigate('/mypage', 'MYPAGE'); setMoreOpen(false); }}>
            <User style={{ width: 18, height: 18, color: 'var(--blue)' }} />
            <span>마이페이지</span>
          </button>
          <button className="mobile-more-item mobile-more-item--action mobile-more-item--danger" onClick={onLogout}>
            <LogOut style={{ width: 18, height: 18 }} />
            <span>로그아웃</span>
          </button>
        </div>
      </div>

      {/* Bottom navigation bar */}
      <nav className="mobile-bottom-nav">
        {primaryTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.key === 'MORE'
            ? moreOpen
            : activeTab === tab.key || (tab.key === 'TRACKER' && activeTab === 'MY_PORTAL');
          return (
            <button
              key={tab.key}
              className={`mobile-nav-item ${isActive ? 'mobile-nav-item--active' : ''}`}
              onClick={() => handleTabClick(tab)}
              aria-label={tab.label}
            >
              <Icon style={{ width: 20, height: 20 }} />
              <span className="mobile-nav-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
