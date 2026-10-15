/**
 * ================================================================
 * CAPS 출입기록 특정 이름 기준 백필 스크립트 (사번 등록 지연 해결용)
 * ================================================================
 * 
 * [설명]
 * CAPS 프로그램에 사번을 늦게 등록하거나, 특정 시점 이전 로그에 사번(E_IDNO)이 누락되어
 * 일반 동기화 쿼리(INNER JOIN hr_employee)로 연동되지 않은 기록을 이름 매칭을 통해 강제 연동합니다.
 * 
 * [실행 준비]
 * 1. VPN이 연결되어 있어야 AWS MySQL DB에 접속할 수 있습니다.
 * 
 * [실행 방법]
 * node backfill-caps-by-name.js
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();

// --- 백필 대상 설정 ---
const TARGET_NAME = '최준희';
const TARGET_EMP_NO = '20260012';
const TARGET_COMPANY_CODE = '1600';
const START_DATE_YMD = '20260701'; // 조회 시작일 (YYYYMMDD)
const END_DATE_YMD = '20260714';   // 조회 종료일 (YYYYMMDD)

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  connectTimeout: 15000,
};

const supabase = createSyncSupabaseClient();

function parseATime(eDate, eTime) {
  const s = `${String(eDate).replace(/\D/g, '')}${String(eTime).replace(/\D/g, '').padStart(6, '0')}`;
  if (s.length < 14) return null;
  return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T${s.substring(8, 10)}:${s.substring(10, 12)}:${s.substring(12, 14)}+09:00`;
}

function buildGateName(row) {
  const parts = [row.e_group, row.e_mode, row.e_type, row.e_result]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '출입';
}

async function run() {
  console.log(`[Backfill] 이름: ${TARGET_NAME}, 사번: ${TARGET_EMP_NO}, 기간: ${START_DATE_YMD} ~ ${END_DATE_YMD} 백필 시작...`);
  
  let conn;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);
    console.log('MySQL 연결 성공.');

    // 1. tenter 테이블에서 이름 매칭으로 쿼리 (기간 조회)
    const [rows] = await conn.execute(`
      SELECT
        E_IDNO      AS idno,
        E_CARD      AS card_no,
        E_DATE      AS e_date,
        E_TIME      AS e_time,
        G_ID        AS gate_code,
        E_GROUP     AS e_group,
        E_MODE      AS e_mode,
        E_TYPE      AS e_type,
        E_RESULT    AS e_result,
        E_NAME      AS e_name
      FROM tenter
      WHERE E_NAME LIKE ?
        AND E_DATE >= ?
        AND E_DATE <= ?
      ORDER BY E_DATE ASC, E_TIME ASC
    `, [`%${TARGET_NAME}%`, START_DATE_YMD, END_DATE_YMD]);

    console.log(`MySQL에서 검색된 로그: ${rows.length}건`);
    if (rows.length === 0) {
      console.log('대상 로그가 존재하지 않습니다.');
      return;
    }

    const sabun = `${TARGET_COMPANY_CODE}${TARGET_EMP_NO.padStart(8, '0')}`;

    // 2. Supabase 포맷에 맞게 변환
    const batch = rows.map((row) => {
      const aTime = `${row.e_date}${row.e_time}`;
      const logTime = parseATime(row.e_date, row.e_time);

      return {
        sabun,
        emp_no: TARGET_EMP_NO,
        card_no: row.card_no ? String(row.card_no) : null,
        a_time: aTime,
        log_time: logTime,
        eq_code: row.gate_code ? String(row.gate_code) : null,
        gate_name: buildGateName(row) || '출입',
        flag1: null,
        event_type: '출입',
        source: 'caps-backfill-manual',
        synced_at: new Date().toISOString(),
      };
    });

    console.log('--- 백필할 데이터 상세 목록 ---');
    batch.forEach(b => {
      console.log(`[${b.log_time}] 사번: ${b.sabun} (${TARGET_NAME}) | 게이트코드: ${b.eq_code}`);
    });

    // 3. Supabase upsert
    console.log('\nSupabase로 전송 중...');
    const { error } = await supabase
      .from('sa_attendance')
      .upsert(batch, { onConflict: 'sabun,a_time' });

    if (error) {
      throw new Error(`Supabase upsert 실패: ${error.message}`);
    }

    console.log('백필이 완료되었습니다!');

  } catch (error) {
    console.error('오류 발생:', error.message);
  } finally {
    if (conn) await conn.end();
  }
}

run();
