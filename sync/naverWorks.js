function getNextCalendarDay(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.length === 8 && !dateStr.includes('-')
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : String(dateStr).slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * ================================================================
 * 네이버웍스(NAVER WORKS) API 연동 모듈 (CommonJS - 데몬용)
 * ================================================================
 * - OAuth 2.0 (JWT Assertion) Access Token 발급 및 메모리 캐싱
 * - 구성원 프로필 상태(휴가/부재) 설정 API 호출
 * ================================================================
 */

const crypto = require('crypto');

let cachedToken = null;
let tokenExpiresAt = 0;

function base64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePrivateKey(rawKey) {
  if (!rawKey) return '';
  let str = String(rawKey).trim();

  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1);
  }

  str = str.replace(/\\n/g, '\n').replace(/\r/g, '');

  const match = str.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:RSA )?PRIVATE KEY-----/);
  if (match) {
    const rawBody = match[1].replace(/\s+/g, '');
    const formattedBody = rawBody.match(/.{1,64}/g)?.join('\n') || rawBody;
    return `-----BEGIN PRIVATE KEY-----\n${formattedBody}\n-----END PRIVATE KEY-----`;
  }

  return str;
}

function getEnvConfig() {
  return {
    clientId: process.env.NAVER_WORKS_CLIENT_ID || '',
    clientSecret: process.env.NAVER_WORKS_CLIENT_SECRET || '',
    serviceAccount: process.env.NAVER_WORKS_SERVICE_ACCOUNT || '',
    privateKey: normalizePrivateKey(process.env.NAVER_WORKS_PRIVATE_KEY),
  };
}

/**
 * 네이버웍스 credentials가 제대로 구성되었는지 확인
 */
function isNaverWorksConfigured() {
  const cfg = getEnvConfig();
  return !!(cfg.clientId && cfg.clientSecret && cfg.serviceAccount && cfg.privateKey);
}

/**
 * RS256 JWT 생성
 */
function createJwtAssertion(clientId, serviceAccount, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientId,
    sub: serviceAccount,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(header);
  const encodedPayload = base64url(payload);
  const signInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(privateKey, 'base64');
  const encodedSignature = signature
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signInput}.${encodedSignature}`;
}

/**
 * Access Token 발급 (메모리 캐시 적용)
 */
async function getAccessToken() {
  if (!isNaverWorksConfigured()) {
    return null;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const cfg = getEnvConfig();
  const jwt = createJwtAssertion(cfg.clientId, cfg.serviceAccount, cfg.privateKey);

  const bodyParams = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'calendar directory',
  });

  const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[NaverWorks Token Error ${res.status}] ${errText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('[NaverWorks Token Error] access_token이 응답에 없습니다.');
  }

  cachedToken = data.access_token;
  const expiresInMs = (data.expires_in || 86400) * 1000;
  tokenExpiresAt = now + expiresInMs;

  return cachedToken;
}

/**
 * 2시간 휴가(반반차) 코드별 시간대 매핑
 */
const TWO_HOUR_LEAVE_TIMES = {
  '19': { start: '07:00:00', end: '09:00:00', label: '2시간 휴가 [07-09]' },
  '20': { start: '08:00:00', end: '10:00:00', label: '2시간 휴가 [08-10]' },
  '21': { start: '09:00:00', end: '11:00:00', label: '2시간 휴가 [09-11]' },
  '22': { start: '10:00:00', end: '12:00:00', label: '2시간 휴가 [10-12]' },
  '23': { start: '11:00:00', end: '13:00:00', label: '2시간 휴가 [11-13]' },
  '24': { start: '13:00:00', end: '15:00:00', label: '2시간 휴가 [13-15]' },
  '25': { start: '14:00:00', end: '16:00:00', label: '2시간 휴가 [14-16]' },
  '26': { start: '15:00:00', end: '17:00:00', label: '2시간 휴가 [15-17]' },
  '27': { start: '16:00:00', end: '18:00:00', label: '2시간 휴가 [16-18]' },
  '28': { start: '17:00:00', end: '19:00:00', label: '2시간 휴가 [17-19]' },
};

const LEAVE_CODE_LABELS = {
  '12': '연차',
  '13': '공가',
  '16': '오전 반차',
  '17': '오후 반차',
  '18': '경조휴가',
  '19': '2시간 휴가 [07-09]',
  '20': '2시간 휴가 [08-10]',
  '21': '2시간 휴가 [09-11]',
  '22': '2시간 휴가 [10-12]',
  '23': '2시간 휴가 [11-13]',
  '24': '2시간 휴가 [13-15]',
  '25': '2시간 휴가 [14-16]',
  '26': '2시간 휴가 [15-17]',
  '27': '2시간 휴가 [16-18]',
  '28': '2시간 휴가 [17-19]',
  '51': '연차',
  '60': '연차',
  '61': '오전 반차',
  '62': '오후 반차',
};

function formatDateDashed(rawDateStr) {
  const digits = String(rawDateStr || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function isBusinessManagementTeam(dept) {
  if (!dept) return false;
  const d = String(dept).replace(/\s+/g, '');
  return d.includes('사업관리1팀') || d.includes('사업관리2팀') || d.includes('사업관리3팀');
}

/**
 * 휴가 데이터를 분석하여 네이버웍스 API용 시작/종료 일시(ISO 8601)와 상태 메시지 생성
 */
function calculateLeaveTimeWindow(leave) {
  const startDateStr = formatDateDashed(leave.start_date || leave.startDate);
  const endDateStr = formatDateDashed(leave.end_date || leave.endDate);
  if (!startDateStr || !endDateStr) return null;

  const code = String(leave.leave_code || leave.leaveCode || '').trim();
  const rawName = String(leave.leave_name || leave.leaveName || '').trim();
  const dept = leave.dept || leave.dept_name || leave.department || '';

  const isSpecialTeam = isBusinessManagementTeam(dept);

  let startTime = isSpecialTeam
    ? `${startDateStr}T10:00:00+09:00`
    : `${startDateStr}T08:00:00+09:00`;
  let endTime = isSpecialTeam
    ? `${endDateStr}T19:00:00+09:00`
    : `${endDateStr}T17:00:00+09:00`;
  let statusMessage = LEAVE_CODE_LABELS[code] || (rawName && !/^\d+$/.test(rawName) ? rawName : '연차');

  if (code === '16' || code === '61' || rawName.includes('오전') || rawName.includes('4시간휴가 [오전]')) {
    startTime = isSpecialTeam
      ? `${startDateStr}T10:00:00+09:00`
      : `${startDateStr}T08:00:00+09:00`;
    endTime = isSpecialTeam
      ? `${startDateStr}T15:00:00+09:00`
      : `${startDateStr}T12:00:00+09:00`;
    statusMessage = '오전 반차';
  } else if (code === '17' || code === '62' || rawName.includes('오후') || rawName.includes('4시간휴가 [오후]')) {
    startTime = isSpecialTeam
      ? `${startDateStr}T15:00:00+09:00`
      : `${startDateStr}T13:00:00+09:00`;
    endTime = isSpecialTeam
      ? `${startDateStr}T19:00:00+09:00`
      : `${startDateStr}T17:00:00+09:00`;
    statusMessage = '오후 반차';
  } else if (TWO_HOUR_LEAVE_TIMES[code]) {
    const info = TWO_HOUR_LEAVE_TIMES[code];
    startTime = `${startDateStr}T${info.start}+09:00`;
    endTime = `${startDateStr}T${info.end}+09:00`;
    statusMessage = info.label;
  }

  const profileStatusId = process.env.NAVER_WORKS_PROFILE_STATUS_ID || 'CUSTOM01';

  return {
    profileStatusId,
    statusMessage,
    startTime,
    endTime,
  };
}

/**
 * 특정 사용자의 네이버웍스 프로필 상태 변경 API 호출
 */
async function setUserProfileStatus(email, leave) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { success: false, skipped: true, reason: '네이버웍스 인증 미설정' };
  }

  if (!email || !email.includes('@')) {
    return { success: false, skipped: true, reason: '이메일 정보 없음' };
  }

  const window = calculateLeaveTimeWindow(leave);
  if (!window) {
    return { success: false, skipped: true, reason: '날짜 계산 실패' };
  }

  // Naver Works API는 endTime이 현재 시각 이후인 미래/현재 상태만 등록 허용합니다.
  const endTimeMs = new Date(window.endTime).getTime();
  if (Number.isFinite(endTimeMs) && endTimeMs <= Date.now()) {
    return { success: false, skipped: true, reason: '과거 연차 (endTime이 현재 시각 이전)' };
  }

  const url = `https://www.worksapis.com/v1.0/users/${encodeURIComponent(email)}/user-profile-statuses`;

  // 이미 동일한 상태가 네이버웍스에 등록/예약되어 있는지 확인하여 중복 API 호출 방지
  try {
    const checkRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (checkRes.ok) {
      const checkData = await checkRes.json().catch(() => ({}));
      const existingList = checkData.userProfileStatuses || [];
      const alreadySet = existingList.some((item) =>
        item.profileStatusId === window.profileStatusId &&
        item.statusMessage === window.statusMessage &&
        item.startTime === window.startTime &&
        item.endTime === window.endTime
      );
      if (alreadySet) {
        return { success: true, skipped: true, reason: '이미 동일한 상태가 등록되어 있음' };
      }

      // 같은 날짜에 등록된 이전 상태(시간대가 다른 상태)가 있다면 삭제하여 새로운 시간대로 업데이트
      const startDateStr = window.startTime.slice(0, 10);
      const oldItems = existingList.filter((item) =>
        item.profileStatusId === window.profileStatusId &&
        item.startTime && item.startTime.startsWith(startDateStr)
      );

      for (const oldItem of oldItems) {
        if (oldItem.userProfileStatusId) {
          const deleteUrl = `${url}/${encodeURIComponent(oldItem.userProfileStatusId)}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
          }).catch(() => {});
        }
      }
    }
  } catch (checkErr) {
    // 조회/삭제 실패 시 등록 계속 진행
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(window),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (errText.includes('endTime must be after the current time')) {
      return { success: false, skipped: true, reason: '종료된 연차 (endTime이 현재 시각 이전)' };
    }
    throw new Error(`[NaverWorks Status Error ${res.status}] ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  return { success: true, email, window, data };
}

/**
 * 연차 목록을 받아 네이버웍스 상태로 배치 동기화
 */
async function syncLeavesToNaverWorks(leavesWithEmails = []) {
  if (!isNaverWorksConfigured()) {
    console.log('[NaverWorks Sync] NAVER_WORKS credentials 미설정으로 상태 동기화를 건너뜁니다.');
    return { success: true, processed: 0, skipped: leavesWithEmails.length };
  }

  // 가장 가까운 미래 연차가 가장 마지막에 등록(덮어쓰기)되도록 내림차순 정렬
  const sortedLeaves = [...leavesWithEmails].sort((a, b) => {
    const aDate = String(a.start_date || a.startDate || '');
    const bDate = String(b.start_date || b.startDate || '');
    return bDate.localeCompare(aDate);
  });

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of sortedLeaves) {
    try {
      const email = item.email || item.emp_email;
      const res = await setUserProfileStatus(email, item);
      if (res.skipped) {
        skipped++;
      } else {
        processed++;
      }
    } catch (err) {
      errors++;
      console.error(`[NaverWorks Sync Error] ${item.emp_name || item.emp_no} 상태 설정 실패:`, err.message);
    }
  }

  if (processed > 0) {
    console.log(`[NaverWorks Sync] 총 ${processed}건 상태 동기화 완료`);
  }

  return { success: errors === 0, processed, skipped, errors };
}


/**
 * 부서별 네이버웍스 공유 캘린더 자동 동기화 (멤버 및 휴가 일정)
 */
async function syncDepartmentCalendars(supabase) {
  if (!isNaverWorksConfigured() || !supabase) {
    return { success: true, processed: 0 };
  }

  const token = await getAccessToken();
  if (!token) return { success: false, error: '토큰 발급 실패' };

  const cfg = getEnvConfig();
  const serviceAccount = cfg.serviceAccount;

  // 1. 등록된 부서 캘린더 목록 조회
  const { data: calendars, error: calErr } = await supabase
    .from('sa_ical_subscriptions')
    .select('*')
    .eq('scope', 'naver-works-calendar')
    .eq('is_active', true);

  if (calErr || !calendars || calendars.length === 0) {
    return { success: true, processed: 0 };
  }

  let totalEventsCreated = 0;

  for (const cal of calendars) {
    const calendarId = cal.token;
    const dept = cal.depts?.[0];
    if (!calendarId || !dept) continue;

    let excludedEmpNos = [];
    try {
      if (cal.owner_emp_no && cal.owner_emp_no.startsWith('[')) {
        excludedEmpNos = JSON.parse(cal.owner_emp_no);
      }
    } catch {
      excludedEmpNos = [];
    }
    const excludedSet = new Set(excludedEmpNos.map(String));

    // 부서 정직원 목록 조회 (퇴사/비활성 제외)
    const { data: emps } = await supabase
      .from('sa_employees')
      .select('emp_no, name, dept, email, status, is_active')
      .eq('dept', dept);

    const activeEmps = (emps || []).filter((e) => {
      if (!e || e.is_active === false || e.status === 'resigned') return false;
      const empNo = String(e.emp_no || '').trim();
      return empNo && !excludedSet.has(empNo);
    });

    const validEmpNos = activeEmps.map((e) => String(e.emp_no));
    const empMap = new Map(activeEmps.map((e) => [String(e.emp_no), e]));

    // 멤버 갱신 (부서 이동 등으로 변경되었을 수 있음)
    const members = [];
    const seenEmails = new Set();
    for (const e of activeEmps) {
      const email = String(e.email || '').trim().toLowerCase();
      if (email && email.includes('@') && !seenEmails.has(email)) {
        seenEmails.add(email);
        members.push({ id: email, type: 'USER', role: 'EVENT_READ' });
      }
    }

    try {
      await fetch(`https://www.worksapis.com/v1.0/calendars/${encodeURIComponent(calendarId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ members }),
      });
    } catch (patchErr) {
      console.warn(`[NaverWorks Calendar Member Update Warning] ${dept}:`, patchErr.message);
    }

    if (validEmpNos.length === 0) continue;

    // 최근 30일 ~ 향후 90일 승인 휴가 조회
    const now = new Date();
    const pastStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const futureStr = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');

    const { data: leaves } = await supabase
      .from('sa_leaves')
      .select('*')
      .in('emp_no', validEmpNos)
      .eq('status', '40')
      .gte('end_date', pastStr)
      .lte('start_date', futureStr);

    if (!leaves || leaves.length === 0) continue;

    // 네이버웍스 기존 등록 일정 확인
    let existingKeys = new Set();
    try {
      const chunkMs = 28 * 24 * 60 * 60 * 1000;
      for (let t = past.getTime(); t < future.getTime(); t += chunkMs) {
        const chunkFrom = new Date(t).toISOString();
        const chunkUntil = new Date(Math.min(t + chunkMs, future.getTime())).toISOString();
        const listRes = await fetch(
          `https://www.worksapis.com/v1.0/users/${serviceAccount}/calendars/${encodeURIComponent(calendarId)}/events?fromDateTime=${encodeURIComponent(chunkFrom)}&untilDateTime=${encodeURIComponent(chunkUntil)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          for (const ev of listData.events || []) {
            for (const comp of ev.eventComponents || []) {
              const m = comp.description?.match(/\[KEY:\s*([^\]]+)\]/);
              if (m) existingKeys.add(m[1].trim());
              if (comp.summary && comp.start?.date) {
                existingKeys.add(`${comp.summary}_${comp.start.date}`);
                const namePart = comp.summary.split('·')[0].trim();
                if (namePart) existingKeys.add(`${namePart}_${comp.start.date}`);
              }
            }
          }
        }
      }
    } catch {}

    for (const l of leaves) {
      const emp = empMap.get(String(l.emp_no));
      if (!emp) continue;

      const startDate = l.start_date?.length === 8
        ? `${l.start_date.slice(0, 4)}-${l.start_date.slice(4, 6)}-${l.start_date.slice(6, 8)}`
        : String(l.start_date || '').slice(0, 10);
      const endDate = l.end_date?.length === 8
        ? `${l.end_date.slice(0, 4)}-${l.end_date.slice(4, 6)}-${l.end_date.slice(6, 8)}`
        : String(l.end_date || l.start_date || '').slice(0, 10);

      const leaveCode = String(l.leave_code || '').trim();
      const leaveKey = `${l.emp_no}_${startDate}_${leaveCode}`;
      const empName = l.emp_name || emp.name;
      const rawName = String(l.leave_name || '').trim();
      const leaveLabel = LEAVE_CODE_LABELS[leaveCode] || (rawName && !/^\d+$/.test(rawName) ? rawName : '연차');
      const summary = `${empName} · ${leaveLabel}`;

      if (
        existingKeys.has(leaveKey) ||
        existingKeys.has(`${summary}_${startDate}`) ||
        existingKeys.has(`${empName}_${startDate}`)
      ) {
        continue;
      }

      const description = [
        `이름: ${empName}`,
        `부서: ${dept}`,
        `휴가종류: ${leaveLabel}`,
        `기간: ${startDate} ~ ${endDate}`,
        `일수: ${l.leave_days || 1}일`,
        `[KEY: ${leaveKey}]`,
      ].join('\n');

      try {
        const postRes = await fetch(
          `https://www.worksapis.com/v1.0/users/${serviceAccount}/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              eventComponents: [
                {
                  summary,
                  description,
                  start: { date: startDate },
                  end: { date: getNextCalendarDay(endDate) },
                  transparency: 'TRANSPARENT',
                  visibility: 'PUBLIC',
                },
              ],
              sendNotification: false,
            }),
          }
        );
        if (postRes.ok) {
          totalEventsCreated++;
          existingKeys.add(leaveKey);
        }
      } catch (err) {
        console.warn(`[Calendar Event Create Error] ${summary}:`, err.message);
      }

      await new Promise((r) => setTimeout(r, 60));
    }
  }

  if (totalEventsCreated > 0) {
    console.log(`[NaverWorks Calendar Sync] 부서 캘린더에 총 ${totalEventsCreated}건의 신규 연차 일정을 동기화했습니다.`);
  }

  return { success: true, created: totalEventsCreated };
}

module.exports = {
  syncDepartmentCalendars,
  isNaverWorksConfigured,
  getAccessToken,
  calculateLeaveTimeWindow,
  setUserProfileStatus,
  syncLeavesToNaverWorks,
};
