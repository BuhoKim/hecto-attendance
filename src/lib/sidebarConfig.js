import {
  LayoutDashboard,
  CalendarDays,
  Calendar,
  Users,
  CheckCircle,
  Download,
  Clock,
  CarTaxiFront,
  LogOut,
  Sun,
  Moon,
  User,
} from 'lucide-react';
import { canViewOvertimeMenu, canViewManualApprovalMenu, isExecutivePosition } from './overtimeRules';

const GENERAL_ITEMS = [
  { href: '/?tab=DASHBOARD', label: '대시보드', icon: LayoutDashboard, iconStyle: { color: 'var(--blue)' }, category: '일반' },
  { href: '/?tab=TRACKER', label: '근무 트래커', icon: Calendar, iconStyle: { color: 'var(--green)' }, category: '일반' },
  { href: '/?tab=LEAVES', label: '연차 현황', icon: CalendarDays, iconStyle: { color: 'var(--purple)' }, category: '일반' },
];

const LEADER_ITEMS = [
  { href: '/?tab=MONTHLY', label: '월간 근태보고', icon: CalendarDays, iconStyle: { color: 'var(--green)' }, category: '부서' },
  // { href: '/?tab=EMPLOYEES', label: '직원 일정관리', icon: Users, iconStyle: { color: 'var(--orange)' }, category: '부서' },
  { href: '/team/taxi-audit', label: '팀원 택시 소명 내역', icon: CarTaxiFront, iconStyle: { color: 'var(--cyan)' }, activeHref: '/team/taxi-audit', category: '부서' },
  { href: '/team/taxi-report', label: '카카오T 이용 분석', icon: CarTaxiFront, iconStyle: { color: 'var(--amber)' }, activeHref: '/team/taxi-report', category: '부서' },
  { href: '/attendance-records', label: '출입기록 조회 및 조정', icon: Clock, iconStyle: { color: 'var(--blue)' }, category: '부서' },
  { href: '/admin/ical-subscriptions', label: '캘린더 링크 생성', icon: CalendarDays, iconStyle: { color: 'var(--purple)' }, activeHref: '/admin/ical-subscriptions', category: '부서' },
  { href: '/?tab=MANUAL_APPROVAL', label: '수동 요청 내역', icon: CheckCircle, iconStyle: { color: 'var(--red)' }, category: '부서' },
];


const OVERTIME_ITEM = { href: '/?tab=OVERTIME', label: '초과근무 관리', icon: Clock, iconStyle: { color: 'var(--amber)' }, category: '부서' };

const ADMIN_ITEMS = [
  { href: '/?tab=ATTENDANCE_EXPORT', label: '근태기록 저장', icon: Download, iconStyle: { color: 'var(--green)' }, category: '관리자' },
  { href: '/admin/taxi-audit', label: '택시 소명관리', icon: CarTaxiFront, iconStyle: { color: 'var(--pink)' }, activeHref: '/admin/taxi-audit', category: '관리자' },
  { href: '/admin/employees', label: '직원 관리', icon: Users, iconStyle: { color: 'var(--indigo)' }, activeHref: '/admin/employees', category: '관리자' },
  { href: '/admin/terminal-attendance', label: '석식 출입 조회', icon: Clock, iconStyle: { color: 'var(--cyan)' }, activeHref: '/admin/terminal-attendance', category: '관리자' },
  { href: '/admin/naver-calendars', label: '네이버웍스 캘린더', icon: CalendarDays, iconStyle: { color: 'var(--green)' }, activeHref: '/admin/naver-calendars', category: '관리자' },
];

function canSeeLeaderItems({ isAdmin, isLeader, position }) {
  return isAdmin || isLeader || isExecutivePosition(position);
}

export function getMainSidebarItems({ isAdmin = false, isLeader = false, dept = '', position = '' } = {}) {
  const items = [...GENERAL_ITEMS];

  if (canSeeLeaderItems({ isAdmin, isLeader, position })) {
    const leaderItems = LEADER_ITEMS.filter((item) => {
      if (item.href === '/?tab=MANUAL_APPROVAL') {
        return canViewManualApprovalMenu({ isAdmin, isLeader, position, dept });
      }
      return true;
    });
    items.push(...leaderItems);
  }

  if (canViewOvertimeMenu({ isAdmin, isLeader, position, dept })) {
    items.push(OVERTIME_ITEM);
  }

  if (isAdmin) {
    items.push(...ADMIN_ITEMS);
  }

  return items.filter(Boolean);
}

export function getMyPageSidebarItems({ isAdmin = false, isLeader = false, dept = '', position = '' } = {}) {
  return getMainSidebarItems({ isAdmin, isLeader, dept, position });
}

export function getAdminEmployeeSidebarItems() {
  return [
    ...GENERAL_ITEMS,
    ...LEADER_ITEMS,
    OVERTIME_ITEM,
    ...ADMIN_ITEMS,
  ];
}

export const sidebarActionIcons = {
  logout: LogOut,
  light: Sun,
  dark: Moon,
  mypage: User,
};

export const sidebarCategories = ['일반 팀원', '팀장', '관리자'];
