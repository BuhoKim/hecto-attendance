const { createClient } = require('@supabase/supabase-js');
const { loadSyncEnv } = require('./loadEnv');

const COMPANY_PROJECT_REF = 'qcpqcuzvirmbjzqjzapt';
const COMPANY_SUPABASE_URL = `https://${COMPANY_PROJECT_REF}.supabase.co`;

function getCompanySupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (url !== COMPANY_SUPABASE_URL) {
    throw new Error(`SUPABASE_URL을 회사 DB ${COMPANY_SUPABASE_URL}로 설정하세요. PM2 환경변수도 확인하세요 (--update-env).`);
  }

  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY에 회사 DB의 서버 전용 서비스 키를 입력하세요. 키를 Git에 저장하지 마세요.');
  }

  // Modern secret keys are opaque; actual validity is checked by the Data API.
  // JWT claims are only a local configuration guard, not signature verification.
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) {
    let claims;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error('invalid JWT');
      const parts = key.split('.');
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY의 서비스 키 형식이 올바르지 않습니다. 회사 DB의 secret 또는 service_role 키를 입력하세요.');
    }
    if (claims?.role !== 'service_role' || claims?.ref !== COMPANY_PROJECT_REF) {
      throw new Error('서비스 키가 회사 DB의 service_role 키가 아닙니다. 회사 키로 바꾸고 PM2 환경변수도 갱신하세요 (--update-env).');
    }
  }

  return { url, key };
}

function createSyncSupabaseClient() {
  loadSyncEnv();
  const { url, key } = getCompanySupabaseConfig();
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

module.exports = { getCompanySupabaseConfig, createSyncSupabaseClient };
