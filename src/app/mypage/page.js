'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Save, KeyRound, BadgeInfo, Sun, Moon } from 'lucide-react';
import { formatClockTime } from '../../lib/clock';
import { usePersistentTheme } from '../../lib/usePersistentTheme';
import AppSidebar from '../../components/AppSidebar';
import { getMainSidebarItems, sidebarActionIcons } from '../../lib/sidebarConfig';
import { rankOptions } from '../../lib/employeeOptions';
import { uiText } from '../../lib/uiText';
import { isAdminRole, isLeaderPosition } from '../../lib/roleUtils';

const APP_COPY = uiText.app;
const SIDEBAR_COPY = uiText.sidebar;
const COMMON_COPY = uiText.common;

const pageCopy = {
  title: '마이페이지',
  subtitle: '사번, 이름, 로그인 아이디는 읽기 전용입니다.',
  infoTitle: '내 정보',
  infoSubtitle: '사번, 이름, 로그인 아이디는 읽기 전용입니다. 부서와 직급만 직접 수정할 수 있습니다.',
  profileBadge: '프로필',
  passwordBadge: '비밀번호',
  reloadTooltip: '새로고침',
  lightModeTooltip: '라이트 모드',
  darkModeTooltip: '다크 모드',
  loading: '프로필 정보를 불러오는 중...',
  loadFail: '마이페이지 정보를 불러오지 못했습니다.',
  nameLabel: '이름',
  empNoLabel: '사원번호',
  loginIdLabel: '로그인 아이디',
  deptLabel: '부서',
  rankLabel: '직급',
  selectPrompt: '선택하세요',
  saveProfile: '프로필 정보 저장',
  saveSuccess: '프로필이 저장되었습니다.',
  saveFail: '프로필 저장에 실패했습니다.',
  saveError: '프로필 저장에 실패했습니다.',
  passwordTitle: '비밀번호 변경',
  passwordSubtitle: '새 비밀번호를 입력하면 즉시 반영됩니다.',
  newPasswordLabel: '새 비밀번호',
  confirmPasswordLabel: '새 비밀번호 확인',
  newPasswordPlaceholder: '8자 이상',
  confirmPasswordPlaceholder: '다시 입력',
  passwordSave: '비밀번호 변경',
  shortPasswordError: '비밀번호는 8자 이상이어야 합니다.',
  mismatchError: '비밀번호와 확인 비밀번호가 일치하지 않습니다.',
  passwordSuccess: '비밀번호가 변경되었습니다.',
  passwordFail: '비밀번호 변경에 실패했습니다.',
  passwordError: '비밀번호 변경에 실패했습니다.',
  adminProfileName: COMMON_COPY.adminProfileName || '최고관리자',
  employeeProfileName: COMMON_COPY.employeeProfileName || '직원',
};

export default function MyPage() {
  const router = useRouter();
  const [time, setTime] = useState('');
  const [theme, setTheme] = usePersistentTheme('dark');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deptOptions, setDeptOptions] = useState([]);
  const [sidebarProfile, setSidebarProfile] = useState(() => {
    if (typeof window === 'undefined') {
      return { name: '', rank: '', loginId: '', empNo: '', team: '' };
    }
    return {
      name: localStorage.getItem('user-name') || '',
      rank: localStorage.getItem('user-rank') || '',
      loginId: localStorage.getItem('user-login-id') || '',
      empNo: localStorage.getItem('user-emp-no') || '',
      team: localStorage.getItem('user-team') || '',
    };
  });
  const [profile, setProfile] = useState({
    name: '',
    empNo: '',
    loginId: '',
    dept: '',
    rank: '',
    position: '',
    mustChangePassword: false,
  });
  const [profileDraft, setProfileDraft] = useState({ dept: '', rank: '' });
  const [passwordDraft, setPasswordDraft] = useState({ newPassword: '', confirmPassword: '' });

  useEffect(() => {
    const tick = () => setTime(formatClockTime(new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/auth/profile');
        const json = await res.json();
        if (!json.success) {
          if (res.status === 401) {
            window.location.assign('/login');
            return;
          }
          throw new Error(json.error || pageCopy.loadFail);
        }

        setProfile(json.profile);
        setProfileDraft({
          dept: json.profile.dept || '',
          rank: json.profile.rank || '',
        });
        setSidebarProfile({
          name: json.profile.name || '',
          rank: json.profile.rank || '',
          loginId: json.profile.loginId || '',
          empNo: json.profile.empNo || '',
          team: json.profile.dept || '',
        });
        setDeptOptions(json.deptOptions || []);
        localStorage.setItem('user-is-admin', String(!!json.profile.isAdmin));
        localStorage.setItem('user-position', json.profile.position || '');
        localStorage.setItem('user-name', json.profile.name || '');
        localStorage.setItem('user-rank', json.profile.rank || '');
        localStorage.setItem('user-login-id', json.profile.loginId || '');
        localStorage.setItem('user-emp-no', json.profile.empNo || '');
        localStorage.setItem('user-team', json.profile.dept || '');
      } catch (err) {
        setError(err.message || pageCopy.loadFail);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('user-is-admin');
      localStorage.removeItem('user-position');
      localStorage.removeItem('user-emp-no');
      localStorage.removeItem('user-name');
      localStorage.removeItem('user-rank');
      localStorage.removeItem('user-login-id');
      localStorage.removeItem('user-team');
      window.location.assign('/login');
    }
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dept: profileDraft.dept,
          rank: profileDraft.rank,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || pageCopy.saveFail);
      }

      setProfile((prev) => ({ ...prev, dept: profileDraft.dept, rank: profileDraft.rank }));
      setSidebarProfile((prev) => ({ ...prev, rank: profileDraft.rank, team: profileDraft.dept }));
      localStorage.setItem('user-rank', profileDraft.rank);
      localStorage.setItem('user-team', profileDraft.dept);
      document.cookie = `user-rank=${encodeURIComponent(profileDraft.rank)}; path=/; max-age=604800; SameSite=Lax`;
      document.cookie = `user-team=${encodeURIComponent(profileDraft.dept)}; path=/; max-age=604800; SameSite=Lax`;
      setMessage(json.message || pageCopy.saveSuccess);
    } catch (err) {
      setError(err.message || pageCopy.saveError);
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async (e) => {
    e.preventDefault();
    setSavingPassword(true);
    setMessage('');
    setError('');
    try {
      if (passwordDraft.newPassword.length < 8) {
        throw new Error(pageCopy.shortPasswordError);
      }
      if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
        throw new Error(pageCopy.mismatchError);
      }

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: passwordDraft.newPassword }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || pageCopy.passwordFail);
      }

      setPasswordDraft({ newPassword: '', confirmPassword: '' });
      setMessage(json.message || pageCopy.passwordSuccess);
    } catch (err) {
      setError(err.message || pageCopy.passwordError);
    } finally {
      setSavingPassword(false);
    }
  };

  const userIsAdmin = !!profile?.isAdmin || (typeof window !== 'undefined' && localStorage.getItem('user-is-admin') === 'true') || isAdminRole(profile || {});
  const userIsLeader = isLeaderPosition(profile.position) || (typeof window !== 'undefined' && isLeaderPosition(localStorage.getItem('user-position') || ''));

  const sidebarItems = getMainSidebarItems({
    isAdmin: userIsAdmin,
    isLeader: userIsLeader,
    dept: profile.dept,
    position: profile.position,
  }).map((item) => {
    const tabMatch = item.href.match(/\?tab=([A-Z_]+)/);
    const itemTab = tabMatch ? tabMatch[1] : null;
    return {
      ...item,
      active: false,
      onClick: () => router.push(item.href),
      href: itemTab ? undefined : item.href,
    };
  });

  const footerActions = [
    {
      label: SIDEBAR_COPY.logout,
      icon: sidebarActionIcons.logout,
      onClick: handleLogout,
      color: 'var(--red)',
    },
    {
      label: SIDEBAR_COPY.mypage,
      icon: sidebarActionIcons.mypage,
      href: '/mypage',
      active: true,
      color: 'var(--blue)',
    },
  ];

  const profileBadges = [];
  if (userIsAdmin) profileBadges.push({ label: SIDEBAR_COPY.adminBadge, background: 'var(--red)', color: '#fff' });
  if (userIsLeader) profileBadges.push({ label: SIDEBAR_COPY.leaderBadge, background: 'var(--amber)', color: '#111' });

  return (
    <div className="ga-theme">
      <AppSidebar
        brandLabel={APP_COPY.brand}
        items={sidebarItems}
        profile={{
          name: sidebarProfile.name || (userIsAdmin ? pageCopy.adminProfileName : pageCopy.employeeProfileName),
          rank: sidebarProfile.rank,
          loginId: sidebarProfile.loginId,
          empNo: sidebarProfile.empNo,
          team: sidebarProfile.team
        }}
        profileBadges={profileBadges}
        footerActions={footerActions}
        version={APP_COPY.version}
      />

      <main className="main-content">
        <div className="top-bar">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)' }}>{pageCopy.title}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, marginTop: 2 }}>{pageCopy.subtitle}</p>
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => window.location.reload()} title={pageCopy.reloadTooltip}>
              <RefreshCw style={{ width: 15, height: 15 }} />
            </button>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? pageCopy.lightModeTooltip : pageCopy.darkModeTooltip}
            >
              {theme === 'dark' ? <Sun style={{ width: 15, height: 15 }} /> : <Moon style={{ width: 15, height: 15 }} />}
            </button>
            <div className="time-display">{time}</div>
          </div>
        </div>

        <div
          className="card"
          style={{
            maxWidth: '1120px',
            margin: '0 auto',
          }}
        >
          <div className="card-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BadgeInfo style={{ width: 18, height: 18, color: 'var(--blue)' }} />
                  <span>{pageCopy.infoTitle}</span>
                </h3>
                <p className="card-subtitle">{pageCopy.infoSubtitle}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge blue">{pageCopy.profileBadge}</span>
                <span className="badge amber">{pageCopy.passwordBadge}</span>
              </div>
            </div>
          </div>

          <div className="card-body" style={{ display: 'grid', gap: 16 }}>
            {loading ? (
              <div style={{ padding: 28, color: 'var(--text-2)' }}>{pageCopy.loading}</div>
            ) : (
              <>
                {message && <div className="success-banner">{message}</div>}
                {error && <div className="error-banner">{error}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: 16, alignItems: 'stretch' }}>
                  <section className="card" style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <div className="form-label">{pageCopy.nameLabel}</div>
                        <input className="form-input" value={profile.name} readOnly />
                      </div>
                      <div>
                        <div className="form-label">{pageCopy.empNoLabel}</div>
                        <input className="form-input" value={profile.empNo} readOnly />
                      </div>
                    </div>

                    <div>
                      <div className="form-label">{pageCopy.loginIdLabel}</div>
                      <input className="form-input" value={profile.loginId} readOnly />
                    </div>

                    <form onSubmit={handleProfileSave} style={{ display: 'grid', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div className="form-label">{pageCopy.rankLabel}</div>
                          <select className="ui-select" value={profileDraft.rank} onChange={(e) => setProfileDraft((prev) => ({ ...prev, rank: e.target.value }))}>
                            <option value="">{pageCopy.selectPrompt}</option>
                            {rankOptions.map((rank) => (
                              <option key={rank} value={rank}>
                                {rank}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="form-label">{pageCopy.deptLabel}</div>
                          <select className="ui-select" value={profileDraft.dept} disabled={!profile?.isAdmin} title={!profile?.isAdmin ? '소속 변경은 관리자에게 요청해 주세요.' : undefined} onChange={(e) => setProfileDraft((prev) => ({ ...prev, dept: e.target.value }))}>
                            <option value="">{pageCopy.selectPrompt}</option>
                            {deptOptions.map((dept) => (
                              <option key={dept} value={dept}>
                                {dept}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button type="submit" className="login-btn" disabled={savingProfile}>
                        <Save style={{ width: 16, height: 16 }} />
                        {savingProfile ? '저장 중...' : pageCopy.saveProfile}
                      </button>
                    </form>
                  </section>

                  <section className="card" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                    <div>
                      <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <KeyRound style={{ width: 18, height: 18, color: 'var(--amber)' }} />
                        <span>{pageCopy.passwordTitle}</span>
                      </h3>
                      <p className="card-subtitle">{pageCopy.passwordSubtitle}</p>
                    </div>

                    <form onSubmit={handlePasswordSave} style={{ display: 'grid', gap: 12 }}>
                      <div>
                        <div className="form-label">{pageCopy.newPasswordLabel}</div>
                        <input
                          type="password"
                          className="form-input"
                          value={passwordDraft.newPassword}
                          onChange={(e) => setPasswordDraft((prev) => ({ ...prev, newPassword: e.target.value }))}
                          placeholder={pageCopy.newPasswordPlaceholder}
                        />
                      </div>
                      <div>
                        <div className="form-label">{pageCopy.confirmPasswordLabel}</div>
                        <input
                          type="password"
                          className="form-input"
                          value={passwordDraft.confirmPassword}
                          onChange={(e) => setPasswordDraft((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                          placeholder={pageCopy.confirmPasswordPlaceholder}
                        />
                      </div>
                      <button type="submit" className="login-btn" disabled={savingPassword}>
                        {savingPassword ? '변경 중...' : pageCopy.passwordSave}
                      </button>
                    </form>
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
