import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import mysql from 'mysql2/promise';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { syncLeavesToNaverWorks } from '@/lib/naverWorks';

export const dynamic = 'force-dynamic';

const MY_COMPANY_CODE = '1600';

const MYSQL_CONFIG = {
  host:           process.env.MYSQL_HOST,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  database:       process.env.MYSQL_DATABASE,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  connectTimeout: 10000,
};

// 부서 필터 (스타팅빌딩 근무 부서)
const DEPT_FILTER_SQL = `(
  d.N_DEPT = '플랫폼서비스실'
  OR d.N_DEPT = '사업개발팀'
  OR d.N_DEPT REGEXP '사업관리 ?[123]팀'
)`;

const GATE_MAPPING = {
  '0001': '태광_11층정문',  '0002': '태광_11층비상문', '0003': '태광_10층정문',
  '0007': '태광_12층정문',  '0008': '태광_12층비상문', '0009': '태광_13층정문',
  '0010': '태광_13층비상문','0011': '태광_10층비상문', '0013': '태광_9층정문',
  '0014': '태광_9층비상문', '0015': '태광_14층',
  '1001': '큰길_1101호',   '1002': '큰길_3층 자동문', '1003': '큰길_3층 후문',
  '1004': '큰길_1102호',   '1005': '큰길_20층 이노(IN)', '1006': '큰길_20층 이노(OUT)',
  '1007': '큰길_20층 파이(IN)', '1008': '큰길_20층 파이(OUT)', '1009': '큰길_3층 헥토',
  '2001': '큰길_10층 우측', '2002': '큰길_10층 좌측', '2003': '큰길_5층 연구소',
  '3001': '큰길_5층',
  '4000': '헥토큐앤엠',
  '5001': '채움_외부문',   '5002': '채움_후문',       '5003': '채움_화장실',
  '5004': '채움_내부문',   '5005': '채움_식수1',      '5006': '채움_식수2',
  '6000': '드림베이',
  '9000': '큰길_10층 이노',
  '1000': '큰길_10층',
};

function parseATime(aTime) {
  if (!aTime || aTime.length < 14) return null;
  const y  = aTime.substring(0, 4);
  const mo = aTime.substring(4, 6);
  const d  = aTime.substring(6, 8);
  const h  = aTime.substring(8, 10);
  const mi = aTime.substring(10, 12);
  const s  = aTime.substring(12, 14);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

function flag1ToEventType(flag1) {
  // flag1=1: 명시적 출근, flag1=4: 명시적 퇴근, flag1=0/null: 일반 통문 (출입 중립)
  if (flag1 === '1') return '출근';
  if (flag1 === '4') return '퇴근';
  return '출입'; // flag1=0, null 등 → 방향 미구분 통문 통과
}

function stripAttendanceSource(rows = []) {
  return rows.map(({ source, ...rest }) => rest);
}

function isMissingAttendanceSourceColumn(error) {
  return String(error?.code || '') === 'PGRST204'
    || String(error?.message || '').toLowerCase().includes('source');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function pickFirstValue(row, keys = []) {
  for (const key of keys) {
    const value = normalizeText(row?.[key]);
    if (value) return value;
  }
  return '';
}

function extractEmployeeEmail(row) {
  const value = pickFirstValue(row, ['email', 'EMAIL', 'I_EMAIL', 'N_EMAIL', 'EMAIL_ADDRESS', 'email_address']);
  return value.includes('@') ? value : '';
}

function extractEmployeeLoginId(row) {
  return pickFirstValue(row, ['login_id', 'LOGIN_ID', 'user_id', 'USER_ID', 'userid', 'USERID', 'loginid'])
    || (extractEmployeeEmail(row).split('@')[0] || '');
}

export async function GET(request) {
  let conn = null;
  try {
    const session = await verifySession(request);
    if (!session?.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const supabase = getAdminClient();

    // 1. MySQL Connection
    conn = await mysql.createConnection(MYSQL_CONFIG);

    // ──────── 직원 정보 동기화 ────────
    const [empRows] = await conn.execute(`
      SELECT
        e.*,
        e.I_EMPLOY_NO  AS emp_no,
        e.N_EMPLOY_NAME AS name,
        d.N_DEPT        AS dept
      FROM hr_employee e
      INNER JOIN hr_department d ON
        d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE e.I_COMPANY = ?
        AND COALESCE(e.I_RETIRE_YN, '0') <> '1'
      ORDER BY d.N_DEPT, e.N_EMPLOY_NAME
    `, [MY_COMPANY_CODE, MY_COMPANY_CODE]);

    if (empRows.length > 0) {
      const { data: existingEmps } = await supabase
        .from('sa_employees')
        .select('emp_no, is_active, status');
      const existingMap = new Map((existingEmps || []).map(e => [e.emp_no, e]));

      const records = empRows.map(r => {
        const existing = existingMap.get(r.emp_no);
        return {
          emp_no:       r.emp_no,
          name:         r.name,
          dept:         r.dept,
          email:        extractEmployeeEmail(r) || null,
          login_id:     extractEmployeeLoginId(r) || null,
          company_code: MY_COMPANY_CODE,
          is_active:    existing ? existing.is_active : true,
          status:       existing ? (existing.status || 'active') : 'active',
          synced_at:    new Date().toISOString(),
        };
      });
      await supabase.from('sa_employees').upsert(records, { onConflict: 'emp_no' });
    }

    // ──────── 출입 로그 동기화 (최근 3개월) ────────
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const fromStr = `${threeMonthsAgo.getFullYear()}${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const [attRows] = await conn.execute(`
      SELECT
        e.I_EMPLOY_NO       AS emp_no,
        t.Sabun             AS sabun,
        t.CardNo            AS card_no,
        t.ATime             AS a_time,
        CAST(t.EqCode AS CHAR) AS eq_code,
        t.Flag1             AS flag1
      FROM t_secom_alarm t
      INNER JOIN hr_employee e ON
        e.I_COMPANY = ?
        AND t.Sabun IS NOT NULL AND t.Sabun <> ''
        AND e.I_COMPANY = LEFT(t.Sabun, 4)
        AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
      INNER JOIN hr_department d ON
        d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
        AND t.ATime >= '${fromStr}00000000'
      ORDER BY t.ATime DESC
    `, [MY_COMPANY_CODE, MY_COMPANY_CODE]);

    if (attRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < attRows.length; i += BATCH) {
        const batch = attRows.slice(i, i + BATCH).map(r => ({
          sabun:      r.sabun,
          emp_no:     r.emp_no,
          card_no:    r.card_no,
          a_time:     r.a_time,
          log_time:   parseATime(r.a_time),
          eq_code:    r.eq_code,
          gate_name:  GATE_MAPPING[r.eq_code] || `게이트(${r.eq_code})`,
          flag1:      r.flag1,
          event_type: flag1ToEventType(r.flag1),
          source:     'secom',
          synced_at:  new Date().toISOString(),
        }));
        let { error } = await supabase.from('sa_attendance').upsert(batch, { onConflict: 'sabun,a_time' });
        if (error && isMissingAttendanceSourceColumn(error)) {
          ({ error } = await supabase.from('sa_attendance').upsert(stripAttendanceSource(batch), { onConflict: 'sabun,a_time' }));
        }
        if (error) throw error;
      }
    }

    // ──────── 휴가 승인 내역 동기화 (±6개월) ────────
    const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const toDate = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
    const fromDateStr = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, '0')}${String(fromDate.getDate()).padStart(2, '0')}`;
    const toDateStr   = `${toDate.getFullYear()}${String(toDate.getMonth() + 1).padStart(2, '0')}${String(toDate.getDate()).padStart(2, '0')}`;

    const [leaveRows] = await conn.execute(`
      SELECT
        y.I_EMPLOY_NO          AS emp_no,
        e.N_EMPLOY_NAME        AS emp_name,
        d.N_DEPT               AS dept,
        y.D_START_DATE         AS start_date,
        y.D_END_DATE           AS end_date,
        y.I_CODE               AS leave_code,
        CAST(y.I_CODE AS CHAR) AS leave_name,
        CAST(y.O_ANNLEV_CNT AS CHAR) AS leave_days,
        y.I_STATUS             AS status
      FROM hr_yuncha_use y
      INNER JOIN hr_employee e ON
        e.I_COMPANY = y.I_COMPANY AND e.I_EMPLOY_NO = y.I_EMPLOY_NO
      INNER JOIN hr_department d ON
        d.I_COMPANY = e.I_COMPANY AND d.I_DEPT = e.I_DEPT
      WHERE y.I_COMPANY = ?
        AND y.D_END_DATE >= ?
        AND y.D_START_DATE <= ?
    `, [MY_COMPANY_CODE, fromDateStr, toDateStr]);

    let uniqueLeaveCount = 0;
    if (leaveRows.length > 0) {
      const records = leaveRows.map(r => ({
        emp_no:     r.emp_no,
        emp_name:   r.emp_name,
        start_date: r.start_date,
        end_date:   r.end_date,
        leave_code: r.leave_code,
        leave_name: r.leave_name,
        leave_days: parseFloat(r.leave_days) || 0,
        status:     r.status,
        synced_at:  new Date().toISOString(),
      }));

      const uniqueRecords = [];
      const seen = new Set();
      for (const r of records) {
        const key = `${r.emp_no}_${r.start_date}_${r.leave_code}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueRecords.push(r);
        }
      }

      const sourceKeys = new Set(uniqueRecords.map((r) => `${r.emp_no}_${r.start_date}_${r.leave_code}`));
      const { data: existingLeaves, error: existingLeavesError } = await supabase
        .from('sa_leaves')
        .select('emp_no, start_date, end_date, leave_code')
        .gte('end_date', fromDateStr)
        .lte('start_date', toDateStr);
      if (existingLeavesError) throw existingLeavesError;
      const revokedRecords = (existingLeaves || [])
        .filter((r) => !sourceKeys.has(`${r.emp_no}_${r.start_date}_${r.leave_code}`))
        .map((r) => ({ ...r, status: 'CANCELLED', synced_at: new Date().toISOString() }));

      const syncRecords = [...uniqueRecords, ...revokedRecords];
      await supabase.from('sa_leaves').upsert(syncRecords, { onConflict: 'emp_no,start_date,leave_code' });
      uniqueLeaveCount = uniqueRecords.length;

      // 네이버웍스 프로필 상태 동기화
      try {
        const empNos = [...new Set(uniqueRecords.map(r => r.emp_no))];
        const { data: emps } = await supabase
          .from('sa_employees')
          .select('emp_no, email, dept')
          .in('emp_no', empNos);

        const empMap = new Map((emps || []).map(e => [e.emp_no, e]));
        const leavesWithEmails = uniqueRecords.map(r => {
          const emp = empMap.get(r.emp_no);
          return {
            ...r,
            dept: emp?.dept || null,
            email: emp?.email || null,
          };
        });

        await syncLeavesToNaverWorks(leavesWithEmails.filter((leave) => String(leave.status || '') === '40'));
      } catch (nwErr) {
        console.error('[Sync API Trigger NaverWorks Error]', nwErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: '동기화가 성공적으로 완료되었습니다.',
      stats: {
        employees: empRows.length,
        attendance: attRows.length,
        leaves: uniqueLeaveCount
      }
    });

  } catch (err) {
    console.error('[Sync API Trigger Error]', err);
    return NextResponse.json({
      success: false,
      error: publicErrorMessage(err, '동기화 중 오류가 발생했습니다.')
    }, { status: 500 });
  } finally {
    if (conn) await conn.end();
  }
}
