import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_MODE_COOKIE = 'sa-auth-mode';
export const MASTER_LOGIN_EMAIL = 'hqadmin@hecto.co.kr';

const getSecret = () => process.env.AUTH_MODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (userId, mode) => createHmac('sha256', getSecret())
  .update(`${userId}:${mode}`)
  .digest('base64url');

export function createAuthModeCookie(userId, mode = 'employee') {
  if (!userId || !getSecret()) throw new Error('인증 모드 서명 설정이 없습니다.');
  const safeMode = mode === 'master' ? 'master' : 'employee';
  return `${safeMode}.${sign(userId, safeMode)}`;
}

export function verifyAuthModeCookie(userId, value) {
  const [mode, providedSignature] = String(value || '').split('.');
  if (!userId || !['master', 'employee'].includes(mode) || !providedSignature || !getSecret()) return 'employee';
  const expected = Buffer.from(sign(userId, mode));
  const provided = Buffer.from(providedSignature);
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? mode : 'employee';
}
