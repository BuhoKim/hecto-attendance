'use client';

import Image from 'next/image';
import Link from 'next/link';
import { sidebarCategories } from '../lib/sidebarConfig';
import EmployeePhoto from './EmployeePhoto';

function SidebarAction({ action }) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon ? <Icon style={{ width: 13, height: 13 }} /> : null}
      <span>{action.label}</span>
    </>
  );

  if (action.href) {
    return (
      <Link
        key={action.key || action.href || action.label}
        href={action.href}
        className="sidebar-util-btn"
        style={{ textDecoration: 'none', color: action.color || 'var(--text-1)' }}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      key={action.key || action.label}
      type="button"
      className="sidebar-util-btn"
      onClick={action.onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: action.color || 'var(--text-1)',
      }}
    >
      {content}
    </button>
  );
}

export default function AppSidebar({
  items = [],
  profile = { name: '', rank: '', loginId: '', empNo: '', team: '', dept: '' },
  profileBadge = null,
  profileBadges = [],
  version = 'v2.1.0',
  footerActions = [],
  logoSrc = '/HQ.png',
  logoAlt = 'HECTO',
}) {
  const badges = [
    ...(profileBadge ? [profileBadge] : []),
    ...(Array.isArray(profileBadges) ? profileBadges : []),
  ];

  const groupedItems = items.reduce((acc, item) => {
    const key = item.category || '기타';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const categoryOrder = ['일반', '부서', '관리자', ...Object.keys(groupedItems).filter((key) => !['일반', '부서', '관리자'].includes(key))];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo" aria-label={logoAlt}>
          <Image
            src={logoSrc}
            alt={logoAlt}
            width={220}
            height={80}
            priority
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center center' }}
          />
        </div>
      </div>

      <nav className="tab-menu">
        {categoryOrder.map((category) => {
          const sectionItems = groupedItems[category];
          if (!sectionItems?.length) return null;

          return (
            <div key={category} className="sidebar-section">
              <div className="sidebar-section-title">{category}</div>
              <div className="sidebar-section-items">
                {sectionItems.map((item) => {
                  const Icon = item.icon;
                  const className = `tab-btn${item.active ? ' active' : ''}`;
                  const icon = Icon ? <Icon className="h-4 w-4" style={item.iconStyle} /> : null;
                  const label = <span>{item.label}</span>;

                  if (item.href) {
                    return (
                      <Link key={item.key || item.href || item.label} href={item.href} className={className} style={{ textDecoration: 'none' }}>
                        {icon}
                        {label}
                      </Link>
                    );
                  }

                  return (
                    <button
                      key={item.key || item.label}
                      type="button"
                      className={className}
                      onClick={item.onClick}
                      aria-pressed={item.active ? 'true' : 'false'}
                    >
                      {icon}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="user-avatar" style={{ background: 'var(--blue)', overflow: 'hidden' }}>
            <EmployeePhoto empNo={profile.empNo} fallback={profile.name ? profile.name.slice(0, 1) : '?'} />
          </div>
          <div className="user-info">
            <div className="user-name" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span>{`${profile.name || '로그인 사용자'}${profile.rank ? ` ${profile.rank}` : ''}`}</span>
              {badges.map((badge, index) => (
                <span
                  key={`${badge.label || 'badge'}-${index}`}
                  className="sidebar-badge"
                  style={{
                    background: badge.background || 'rgba(208, 107, 107, 0.14)',
                    color: badge.color || 'var(--text-1)',
                    fontSize: 10,
                    padding: '1px 5px',
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
            <div className="user-role">({profile.team || profile.dept || '소속 없음'})</div>
          </div>
        </div>

        <div className="sidebar-utils">
          {footerActions.map((action) => (
            <SidebarAction key={action.key || action.href || action.label} action={action} />
          ))}
          <span className="sidebar-ver">{version}</span>
        </div>
      </div>
    </aside>
  );
}
