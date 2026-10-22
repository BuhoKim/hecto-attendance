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
 * 네이버웍스(NAVER WORKS) API 연동 모듈 (ESM - Next.js App 라우트용)
 * ================================================================
 * - OAuth 2.0 (JWT Assertion) Access Token 발급 및 메모리 캐싱
 * - 구성원 프로필 상태(휴가/부재) 설정 API 호출
 * ================================================================
 */

import crypto from 'crypto';
import profileCancellation from './naverProfileCancellation.cjs';

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

export function isNaverWorksConfigured() {
  const cfg = getEnvConfig();
  return !!(cfg.clientId && cfg.clientSecret && cfg.serviceAccount && cfg.privateKey);
}

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

export async function getAccessToken() {
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

export function calculateLeaveTimeWindow(leave) {
  const startDateStr = formatDateDashed(leave.start_date || leave.startDate);
  const endDateStr = formatDateDashed(leave.end_date || leave.endDate);
  if (!startDateStr || !endDateStr) return null;

  const code = String(leave.leave_code || leave.leaveCode || '').trim();
  const rawName = String(leave.leave_name || leave.leaveName || '').trim();
  const dept = leave.dept || leave.dept_name || leave.department || '';

  const isSpecialTeam = isBusinessManagementTeam(dept);

  // 종일 휴가는 한국 시간 자정부터 마지막 휴가일 다음 날 자정까지 표시한다.
  let startTime = `${startDateStr}T00:00:00+09:00`;
  let endTime = `${getNextCalendarDay(endDateStr)}T00:00:00+09:00`;
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

export async function setUserProfileStatus(email, leave) {
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

export async function syncLeavesToNaverWorks(leavesWithEmails = []) {
  if (!isNaverWorksConfigured()) {
    console.log('[NaverWorks Sync] NAVER_WORKS credentials 미설정으로 상태 동기화를 건너뜁니다.');
    return { success: true, processed: 0, skipped: leavesWithEmails.length };
  }

  // 가장 가까운 미래 연차가 가장 마지막에 등록(덮어쓰기)되도록 내림차순 정렬
  const sortedLeaves = leavesWithEmails.filter((leave) => !leave.status || String(leave.status) === '40').sort((a, b) => {
    const aDate = String(a.start_date || a.startDate || '');
    const bDate = String(b.start_date || b.startDate || '');
    return bDate.localeCompare(aDate);
  });

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let deleted = 0;

  try {
    deleted = await profileCancellation.removeCancelledProfileStatuses({
      leaves: leavesWithEmails, getAccessToken, calculateWindow: calculateLeaveTimeWindow,
    });
  } catch (err) {
    errors++;
    console.error('[NaverWorks Sync Error] 휴가 상태 취소 실패:', err.message);
  }

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

  if (processed > 0 || deleted > 0 || errors > 0) {
    console.log(`[NaverWorks Sync] 상태 등록 ${processed}건 · 취소 삭제 ${deleted}건 · 실패 ${errors}건`);
  }

  return { success: errors === 0, processed, skipped, errors, deleted };
}


/**
 * ================================================================
 * 네이버웍스 부서별 공유 캘린더 API 연동
 * ================================================================
 */

/**
 * 캘린더 생성
 */
export async function createNaverCalendar({ calendarName, description, members = [] }) {
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증 토큰이 설정되지 않았습니다.');

  const res = await fetch('https://www.worksapis.com/v1.0/calendars', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      calendarName,
      description: description || `${calendarName} 공유 캘린더`,
      isPublic: false,
      members,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[NaverWorks Calendar Create Error ${res.status}] ${errText}`);
  }

  return await res.json();
}

/**
 * 캘린더 공유 속성(이름, 설명, 멤버) 수정
 */
export async function updateNaverCalendar(calendarId, { calendarName, description, members }) {
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증 토큰이 설정되지 않았습니다.');

  const body = {};
  if (calendarName) body.calendarName = calendarName;
  if (description !== undefined) body.description = description;
  if (members) body.members = members;

  const res = await fetch(`https://www.worksapis.com/v1.0/calendars/${encodeURIComponent(calendarId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[NaverWorks Calendar Update Error ${res.status}] ${errText}`);
  }

  return await res.json();
}

/**
 * 캘린더 상세 정보 조회
 */
export async function getNaverCalendar(calendarId) {
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증 토큰이 설정되지 않았습니다.');

  const res = await fetch(`https://www.worksapis.com/v1.0/calendars/${encodeURIComponent(calendarId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[NaverWorks Calendar Get Error ${res.status}] ${errText}`);
  }

  return await res.json();
}

/**
 * 캘린더 삭제
 */
export async function deleteNaverCalendar(calendarId) {
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증 토큰이 설정되지 않았습니다.');

  const res = await fetch(`https://www.worksapis.com/v1.0/calendars/${encodeURIComponent(calendarId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[NaverWorks Calendar Delete Error ${res.status}] ${errText}`);
  }

  return true;
}

/**
 * 부서 캘린더 일정 동기화 (기존 등록 일정 중복 방지 및 신규 등록)
 */
export async function listNaverCalendarMonth(calendarId, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900 || Number(month.slice(0, 4)) > 2200) {
    throw new Error('조회 월이 올바르지 않습니다.');
  }
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증이 필요합니다.');
  const from = new Date(`${month}-01T00:00:00+09:00`);
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1) - 9 * 3600000);
  const events = new Map();
  const base = `https://www.worksapis.com/v1.0/users/${encodeURIComponent(getEnvConfig().serviceAccount)}/calendars/${encodeURIComponent(calendarId)}/events`;
  for (let time = +from; time < +end; time += 28 * 86400000) {
    const params = new URLSearchParams({ fromDateTime: new Date(time).toISOString(), untilDateTime: new Date(Math.min(time + 28 * 86400000, +end)).toISOString() });
    const res = await fetch(`${base}?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(`네이버웍스 일정 조회 실패 (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data.events)) throw new Error('일정 응답이 올바르지 않습니다.');
    for (const event of data.events) {
      for (const component of event.eventComponents || []) {
        const id = component.eventId || event.eventId;
        if (!id) throw new Error('일정 식별 정보를 확인할 수 없습니다.');
        const start = component.start?.date || component.start?.dateTime || '';
        const finish = component.end?.date || component.end?.dateTime || '';
        const endDate = component.end?.date
          ? new Date(new Date(`${finish}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
          : finish.slice(0, 10);
        events.set(`${id}:${start}`, { id, title: component.summary || '(제목 없음)', start, end: endDate, description: component.description || '' });
      }
    }
  }
  const rows = [...events.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'ko'));
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.title}:${row.start.slice(0, 10)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.map((row) => ({ ...row, duplicate: counts.get(`${row.title}:${row.start.slice(0, 10)}`) > 1 }));
}

export async function syncDepartmentCalendarEvents({ calendarId, dept, sourceDepts, additionalEmpNos, excludedEmpNos = [], supabase }) {
  const token = await getAccessToken();
  if (!token) throw new Error('네이버웍스 인증 토큰이 설정되지 않았습니다.');
  const { syncCalendarLeaveSources } = await import('./naverCalendarSync.mjs');
  return syncCalendarLeaveSources({ calendarId, dept, sourceDepts, additionalEmpNos, excludedEmpNos, supabase,
    token, serviceAccount: getEnvConfig().serviceAccount, labels: LEAVE_CODE_LABELS });
}
