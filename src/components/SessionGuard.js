'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const PUBLIC_PATHS = ['/login', '/taxi-audit/explain'];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function shouldRedirectForResponse(input) {
  const url = typeof input === 'string' ? input : input?.url || '';
  return !url.includes('/api/auth/login') && !url.includes('/api/auth/logout');
}

export default function SessionGuard() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isPublicPath(pathname)) return undefined;

    let cancelled = false;
    let redirecting = false;

    const redirectToLogin = async () => {
      if (cancelled || redirecting) return;
      redirecting = true;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      if (!cancelled) router.replace('/login');
    };

    const handleSessionExpired = () => {
      redirectToLogin();
    };

    const originalFetch = window.fetch;
    const guardedFetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401 && shouldRedirectForResponse(args[0])) {
        window.dispatchEvent(new Event('session-expired'));
      }
      return response;
    };

    window.fetch = guardedFetch;
    window.addEventListener('session-expired', handleSessionExpired);
    return () => {
      cancelled = true;
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
      window.removeEventListener('session-expired', handleSessionExpired);
    };
  }, [pathname, router]);

  return null;
}
