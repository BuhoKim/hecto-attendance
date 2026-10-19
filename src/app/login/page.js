'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const SSO_ERRORS = {
  state: '네이버웍스 로그인이 만료되었습니다. 다시 시도해 주세요.',
  not_employee: '근태 시스템 사용 대상 직원이 아닙니다. 관리자에게 문의해 주세요.',
  no_account: '근태 시스템 계정이 없습니다. 관리자에게 문의해 주세요.',
  server: '네이버웍스 로그인 중 오류가 발생했습니다.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('next') || searchParams.get('redirect') || '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState(SSO_ERRORS[searchParams.get('sso_error')] || '');
  const [loading, setLoading]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        return;
      }

      if (typeof window !== 'undefined' && data.user) {
        localStorage.setItem('user-is-admin', String(!!data.user.isAdmin));
        localStorage.setItem('user-position', data.user.position || '');
        localStorage.setItem('user-emp-no', data.user.empNo || '');
        localStorage.setItem('user-name', data.user.name || '');
        localStorage.setItem('user-rank', data.user.rank || '');
        localStorage.setItem('user-login-id', data.user.loginId || '');
        localStorage.setItem('user-team', data.user.team || '');
      }

      if (data.user?.mustChangePassword) {
        window.location.assign('/login/change-password');
      } else {
        window.location.assign(redirect);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <div className="form-group">
        <label htmlFor="identifier" className="form-label">아이디</label>
        <input
          id="identifier"
          type="text"
          className="form-input"
          placeholder="아이디 입력"
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          autoComplete="username"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="password" className="form-label">비밀번호</label>
        <input
          id="password"
          type="password"
          className="form-input"
          placeholder="비밀번호 입력"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <div className="login-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4.5zm0 6a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z"/>
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        className="login-btn"
        disabled={loading}
      >
        {loading ? (
          <span className="login-btn-loading">
            <span className="spinner" />
            로그인 중...
          </span>
        ) : '로그인'}
      </button>

      <div className="login-divider"><span>또는</span></div>

      <a
        href={`/api/auth/naverworks?next=${encodeURIComponent(redirect)}`}
        className="login-sso-btn"
      >
        네이버웍스로 로그인
      </a>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        {/* 로고/타이틀 */}
        <div className="login-header">
          <div className="login-logo">
            <img
              src="/HQ.png"
              alt="HECTO Q&M Logo"
              style={{ width: 'auto', height: '160px', objectFit: 'contain' }}
            />
          </div>
          <h1 className="login-title">헥토큐앤엠 근태 시스템</h1>
          <p className="login-subtitle">아이디와 비밀번호로 로그인하세요</p>
        </div>

        {/* 로그인 폼 */}
        <Suspense fallback={
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <span className="spinner" />
          </div>
        }>
          <LoginForm />
        </Suspense>

        <p className="login-footer">
          계정이 없으신가요? 관리자에게 문의하세요.
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f8fafc;
          font-family: 'Inter', -apple-system, sans-serif;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .login-page::before {
          content: '';
          position: absolute;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(249, 115, 22, 0.08) 0%, rgba(255, 255, 255, 0) 70%);
          top: -200px;
          right: -200px;
          z-index: 0;
        }

        .login-page::after {
          content: '';
          position: absolute;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(249, 115, 22, 0.05) 0%, rgba(255, 255, 255, 0) 70%);
          bottom: -150px;
          left: -150px;
          z-index: 0;
        }

        .login-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 48px 40px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
          position: relative;
          z-index: 1;
        }

        .login-header {
          text-align: center;
          margin-bottom: 36px;
        }

        .login-logo {
          display: inline-flex;
          margin-bottom: 20px;
          align-items: center;
          justify-content: center;
        }

        .login-title {
          font-size: 1.625rem;
          font-weight: 800;
          color: #1e293b;
          margin: 0 0 8px;
          letter-spacing: -0.5px;
        }

        .login-subtitle {
          font-size: 0.875rem;
          color: #64748b;
          margin: 0;
          font-weight: 500;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 0.8125rem;
          font-weight: 700;
          color: #475569;
          letter-spacing: 0.3px;
        }

        .form-input {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          padding: 12px 16px;
          font-size: 0.9375rem;
          color: #1e293b;
          outline: none;
          transition: all 0.2s;
          width: 100%;
          box-sizing: border-box;
        }

        .form-input::placeholder {
          color: #94a3b8;
        }

        .form-input:focus {
          border-color: #f97316;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12);
        }

        .login-error {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fef2f2;
          border: 1px solid #fee2e2;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 0.8125rem;
          color: #ef4444;
          font-weight: 600;
        }

        .login-btn {
          background: #ea580c;
          border: none;
          border-radius: 10px;
          padding: 14px;
          font-size: 0.9375rem;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 4px;
          box-shadow: 0 4px 12px rgba(234, 88, 12, 0.2);
        }

        .login-btn:hover:not(:disabled) {
          background: #d97706;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(234, 88, 12, 0.3);
        }

        .login-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .login-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .login-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 0.75rem;
          color: #94a3b8;
          font-weight: 600;
        }

        .login-divider::before,
        .login-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e2e8f0;
        }

        .login-sso-btn {
          display: block;
          text-align: center;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          padding: 13px;
          font-size: 0.9375rem;
          font-weight: 700;
          color: #1e293b;
          text-decoration: none;
          transition: all 0.2s;
        }

        .login-sso-btn:hover {
          border-color: #00c73c;
          background: #f0fdf4;
        }

        .login-btn-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .login-footer {
          text-align: center;
          font-size: 0.8125rem;
          color: #64748b;
          margin: 24px 0 0;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
