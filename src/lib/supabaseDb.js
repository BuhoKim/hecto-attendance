/**
 * ================================================================
 * Supabase 湲곕컲 洹쇳깭 ?곗씠??議고쉶/蹂寃??덉씠?? * ================================================================
 */

import { getAdminClient } from './supabaseClient';
import { getKstMonthKey, getKstDateTimeKey, getKstDateKey, shiftKstDateKey } from './kstDate';
import { normalizeEmpNoKey } from './dashboardUtils';
import { getLeaveDisplayLabel } from './leaveRules';


const isMissingColumnError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42703'
    || message.includes('does not exist')
    || message.includes('could not find the column')
  );
};

const isConflictTargetError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42p10'
    || message.includes('no unique or exclusion constraint')
    || message.includes('on conflict')
    || message.includes('conflict')
  );
};

// sa_schedule_overrides optional 컬럼이 없을 경우 순서대로 제거하면서 재시도
const OPTIONAL_OVERRIDE_COLS = ['note', 'allow_overtime', 'schedule_end', 'created_by'];

async function upsertWithFallback(supabase, tableName, row) {
  let currentRow = { ...row };

  // 1李? upsert ?쒕룄
  const upsertResult = await supabase
    .from(tableName)
    .upsert(currentRow, { onConflict: 'emp_no,work_date' })
    .select();

  if (!upsertResult.error) return upsertResult.data;

  // conflict target ?ㅻ쪟 ??delete + insert ?대갚
  if (isConflictTargetError(upsertResult.error) || isMissingColumnError(upsertResult.error)) {
    // optional 컬럼이 하나씩 빠지면 해당 컬럼을 제외하고 다시 시도
    const toStrip = isMissingColumnError(upsertResult.error) ? [...OPTIONAL_OVERRIDE_COLS] : [];
    let insertRow = { ...currentRow };

    const tryInsert = async () => {
      await supabase.from(tableName).delete().eq('emp_no', insertRow.emp_no).eq('work_date', insertRow.work_date);
      return supabase.from(tableName).insert(insertRow).select();
    };

    let insertResult = await tryInsert();
    while (insertResult.error && isMissingColumnError(insertResult.error) && toStrip.length > 0) {
      const col = toStrip.shift();
      delete insertRow[col];
      insertResult = await tryInsert();
    }
    if (insertResult.error) throw insertResult.error;
    return insertResult.data;
  }

  throw upsertResult.error;
}

const parseKstDateTimeToDisplay = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  if (!hasTimezone) {
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    return normalized.substring(0, 19).replace('T', ' ');
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw.length >= 19 ? raw.substring(0, 19) : raw;
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

/**
 * fetchAttendanceLogs: 洹쇳깭愿€??紐⑤뱺 ?곗씠?곕? ?듯빀 濡쒕뱶
 * 諛섑솚媛? { employees, logs, leaves, corrections, overrides, manualCheckins, isDemo, error }
 */
export async function fetchAttendanceLogs(yearMonth, options = {}) {
  const supabase = getAdminClient();
  const targetMonth = yearMonth || getKstMonthKey(); // YYYY-MM
  const [year, month] = targetMonth.split('-');
  const monthCompact = `${year}${month}`; // YYYYMM
  const pad2 = (num) => String(num).padStart(2, '0');

  const empNoArr = (() => {
    if (options.empNo == null) return null;
    if (Array.isArray(options.empNo)) return options.empNo;
    return String(options.empNo).split(',').map(s => s.trim()).filter(Boolean);
  })();

  // To cover the visible cells of the calendar (exactly 42 days = 6 weeks):
  // Calendar always starts on the Sunday of the first week of the month.
  const monthStartDate = new Date(Number(year), Number(month) - 1, 1);
  const firstDayIndex = monthStartDate.getDay(); // 0 for Sunday
  const calendarStartDate = new Date(Number(year), Number(month) - 1, 1 - firstDayIndex);
  
  // The frontend calendar grid ALWAYS renders exactly 42 cells.
  const calendarEndDate = new Date(Number(year), Number(month) - 1, 1 - firstDayIndex + 41);

  const firstDay = `${calendarStartDate.getFullYear()}-${pad2(calendarStartDate.getMonth() + 1)}-${pad2(calendarStartDate.getDate())}`;
  const lastDay = `${calendarEndDate.getFullYear()}-${pad2(calendarEndDate.getMonth() + 1)}-${pad2(calendarEndDate.getDate())}`;

  // log_time 기반 ISO 범위 (KST +09:00 기준)
  let logTimeFrom;
  let logTimeTo;

  if (options.dashboardOnly) {
    const todayStr = getKstDateKey();
    const yesterdayStr = shiftKstDateKey(todayStr, -1);
    logTimeFrom = `${yesterdayStr}T00:00:00+09:00`;
    logTimeTo = `${todayStr}T23:59:59+09:00`;
  } else {
    logTimeFrom = `${firstDay}T00:00:00+09:00`;
    // Add 1 day to logTimeTo to account for overnight shifts of the last day.
    const logTimeToDate = new Date(calendarEndDate);
    logTimeToDate.setDate(logTimeToDate.getDate() + 1);
    logTimeTo = `${logTimeToDate.getFullYear()}-${pad2(logTimeToDate.getMonth() + 1)}-${pad2(logTimeToDate.getDate())}T23:59:59+09:00`;
  }

  // Helper functions for tables with potential schema fallbacks
  const fetchAdjustments = async () => {
    const adjustFrom = options.dashboardOnly ? shiftKstDateKey(getKstDateKey(), -1) : firstDay;
    const adjustTo = options.dashboardOnly ? getKstDateKey() : lastDay;
    let query = supabase
      .from('sa_attendance_log_adjustments')
      .select('id, attendance_id, emp_no, work_date, adjusted_role, note, adjusted_by, created_at, updated_at')
      .gte('work_date', adjustFrom)
      .lte('work_date', adjustTo);
    if (empNoArr) query = query.in('emp_no', empNoArr);

    const { data: rawAdjustments, error: adjustErr } = await query;

    if (adjustErr) {
      const adjustMessage = String(adjustErr.message || '').toLowerCase();
      if (adjustMessage.includes('sa_attendance_log_adjustments') || adjustErr.code === '42p01') {
        return [];
      }
      throw new Error(`Attendance log adjustment fetch failed: ${adjustErr.message}`);
    }
    return rawAdjustments || [];
  };

  const fetchOverrides = async () => {
    const rangeFrom = options.dashboardOnly ? shiftKstDateKey(getKstDateKey(), -1) : firstDay;
    const rangeTo = options.dashboardOnly ? getKstDateKey() : lastDay;

    if (empNoArr) {
      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < empNoArr.length; i += chunkSize) {
        chunks.push(empNoArr.slice(i, i + chunkSize));
      }

      try {
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            let query = supabase
              .from('sa_schedule_overrides')
              .select('emp_no, work_date, schedule_start, schedule_end, allow_overtime, note')
              .gte('work_date', rangeFrom)
              .lte('work_date', rangeTo)
              .in('emp_no', chunk);

            const { data, error } = await query;
            if (error) {
              const message = String(error.message || '').toLowerCase();
              if (message.includes('allow_overtime') || error.code === '42703') {
                let fallbackQuery = supabase
                  .from('sa_schedule_overrides')
                  .select('emp_no, work_date, schedule_start, schedule_end, note')
                  .gte('work_date', rangeFrom)
                  .lte('work_date', rangeTo)
                  .in('emp_no', chunk);
                const { data: fallbackData, error: fallbackErr } = await fallbackQuery;
                if (fallbackErr) throw fallbackErr;
                return (fallbackData || []).map((row) => ({ ...row, allow_overtime: false }));
              }
              throw error;
            }
            return (data || []).map((row) => ({ ...row, allow_overtime: row.allow_overtime !== false }));
          })
        );
        return results.flat();
      } catch (err) {
        throw new Error(`스케줄 예외 조회 실패: ${err.message}`);
      }
    }

    let query = supabase
      .from('sa_schedule_overrides')
      .select('emp_no, work_date, schedule_start, schedule_end, allow_overtime, note')
      .gte('work_date', rangeFrom)
      .lte('work_date', rangeTo);

    const { data: overridesRaw, error: overErr } = await query;

    if (overErr) {
      const message = String(overErr.message || '').toLowerCase();
      if (message.includes('allow_overtime') || overErr.code === '42703') {
        let fallbackQuery = supabase
          .from('sa_schedule_overrides')
          .select('emp_no, work_date, schedule_start, schedule_end, note')
          .gte('work_date', rangeFrom)
          .lte('work_date', rangeTo);

        const { data: fallbackOverrides, error: fallbackErr } = await fallbackQuery;
        if (fallbackErr) throw new Error(`스케줄 예외 대체 조회 실패: ${fallbackErr.message}`);
        return (fallbackOverrides || []).map((row) => ({ ...row, allow_overtime: false }));
      }
      throw new Error(`스케줄 예외 조회 실패: ${overErr.message}`);
    }
    return (overridesRaw || []).map((row) => ({ ...row, allow_overtime: row.allow_overtime !== false }));
  };

  const fetchTeamPatterns = async () => {
    const rangeFrom = options.dashboardOnly ? shiftKstDateKey(getKstDateKey(), -1) : firstDay;
    const rangeTo = options.dashboardOnly ? getKstDateKey() : lastDay;
    const { data: teamPatterns, error: teamPatternErr } = await supabase
      .from('sa_team_schedule_patterns')
      .select('dept_name, work_date, pattern_code, pattern_name, schedule_start, schedule_end, note, created_by, created_at, updated_at')
      .gte('work_date', rangeFrom)
      .lte('work_date', rangeTo);

    if (teamPatternErr) {
      const message = String(teamPatternErr.message || '').toLowerCase();
      if (!message.includes('sa_team_schedule_patterns') && !message.includes('does not exist')) {
        throw new Error(`부서 일정 패턴 조회 실패: ${teamPatternErr.message}`);
      }
      return [];
    }
    return teamPatterns || [];
  };

  try {
    const keys = ['employees', 'employeeNames', 'leaves'];
    
    let employeesQuery = supabase.from('sa_employees').select('emp_no, name, dept, status').eq('is_active', true).order('dept').order('name');
    if (empNoArr) employeesQuery = employeesQuery.in('emp_no', empNoArr);

    const compactFirstDay = firstDay.replace(/-/g, '');
    const compactLastDay = lastDay.replace(/-/g, '');
    let leavesQuery = supabase.from('sa_leaves').select('emp_no, emp_name, start_date, end_date, leave_code, leave_name, leave_days, status')
      .lte('start_date', compactLastDay)
      .gte('end_date', compactFirstDay)
      .eq('status', '40');
    if (empNoArr) leavesQuery = leavesQuery.in('emp_no', empNoArr);

    const fetchLogs = async () => {
      const pageSize = 1000;
      const fetchLogPages = async (empNos = null) => {
        const rows = [];
        let from = 0;

        while (true) {
          let query = supabase
            .from('sa_attendance')
            .select('id, sabun, emp_no, card_no, a_time, log_time, eq_code, gate_name, flag1, event_type, source')
            .gte('log_time', logTimeFrom)
            .lte('log_time', logTimeTo)
            .order('log_time', { ascending: true })
            .range(from, from + pageSize - 1);
          if (empNos) query = query.in('emp_no', empNos);

          const { data, error } = await query;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < pageSize) break;
          from += pageSize;
        }

        return rows;
      };

      if (empNoArr) {
        const chunkSize = 5;
        const chunks = [];
        for (let i = 0; i < empNoArr.length; i += chunkSize) {
          chunks.push(empNoArr.slice(i, i + chunkSize));
        }

        try {
          const results = await Promise.all(
          chunks.map(async (chunk) => {
              return fetchLogPages(chunk);
          })
          );
          return { data: results.flat(), error: null };
        } catch (err) {
          return { data: [], error: err };
        }
      }

      // This server-side client uses service_role. Calling the SECURITY DEFINER RPC
      // here would have auth.uid() = NULL and return an empty result by design.
      // Query directly instead; service_role access is kept server-only.
      return { data: await fetchLogPages(), error: null };
    };

    const fetchPromises = [
      employeesQuery,
      supabase.from('sa_employees').select('emp_no, name'),
      leavesQuery
    ];

    if (!options.excludeLogs) {
      keys.push('logs', 'adjustments', 'corrections', 'overrides', 'teamPatterns', 'manualCheckins');
      const rangeFrom = options.dashboardOnly ? shiftKstDateKey(getKstDateKey(), -1) : firstDay;
      const rangeTo = options.dashboardOnly ? getKstDateKey() : lastDay;

      let correctionsQuery = supabase.from('sa_attendance_corrections').select('emp_no, work_date, corrected_out_time, reason').gte('work_date', rangeFrom).lte('work_date', rangeTo);
      if (empNoArr) correctionsQuery = correctionsQuery.in('emp_no', empNoArr);

      let manualCheckinsQuery = supabase.from('sa_manual_checkins').select('id, emp_no, check_type, check_time, work_date, note, admin_decision, created_at, decided_at').gte('work_date', rangeFrom).lte('work_date', rangeTo);
      if (empNoArr) manualCheckinsQuery = manualCheckinsQuery.in('emp_no', empNoArr);

      fetchPromises.push(
        fetchLogs(),
        fetchAdjustments(),
        correctionsQuery,
        fetchOverrides(),
        fetchTeamPatterns(),
        manualCheckinsQuery
      );
    }

    const results = await Promise.all(fetchPromises);
    const dataMap = {};
    keys.forEach((key, index) => {
      const res = results[index];
      if (res && res.error) {
        throw new Error(`${key} 조회 실패: ${res.error.message}`);
      }
      dataMap[key] = res?.data !== undefined ? res.data : res;
    });

    const employees = dataMap.employees;
    const employeeNames = dataMap.employeeNames;
    const rawLeaves = dataMap.leaves;
    let rawLogs = dataMap.logs || [];
    const safeAdjustments = dataMap.adjustments || [];
    const corrections = dataMap.corrections || [];
    const overrides = dataMap.overrides || [];
    const teamSchedulePatterns = dataMap.teamPatterns || [];
    const rawManual = dataMap.manualCheckins || [];



    // ?? 7. ?곗씠???щ㎎??諛?蹂묓빀 ??????????????????????????????????
    const corrMap = new Map();
    (corrections || []).forEach(c => {
      corrMap.set(`${c.emp_no}_${c.work_date}`, c);
    });

    const adjustmentMap = new Map();
    (safeAdjustments || []).forEach((adjustment) => {
      adjustmentMap.set(String(adjustment.attendance_id), adjustment);
    });


    const employees_fmt = (employees || []).map(e => ({
      empNo: e.emp_no,
      name:  e.name,
      dept:  e.dept,
      status: e.status || '',
    }));
    const employeeNameMap = new Map((employeeNames || []).map(e => [normalizeEmpNoKey(e.emp_no), e.name || '']));

    // 출입 로그 정규화
    const logs_fmt = (rawLogs || []).map(r => {
      let logTime = '';
      if (r.a_time && r.a_time.length >= 14) {
        // a_time (YYYYMMDDHHMMSS KST ?꾩? ?쒓컖) 吏곸젒 ?뚯떛 ???댁쨷蹂???놁씠 KST ?쒓컖 洹몃?濡??ъ슜
        logTime = formatATime(r.a_time);
      } else if (r.log_time) {
        // log_time??+09:00 ?ㅽ봽?뗭쑝濡???λ맂 寃쎌슦 ???대? KST?대?濡??ㅽ봽???놁씠 洹몃?濡?異쒕젰
        const d = new Date(r.log_time);
        // getTime()? UTC 湲곗? ms, toISOString()? UTC 臾몄옄?댁씠誘濡?        // +09:00 ??꾩뒪?ы봽 ??UTC offset -9h ??toISOString??UTC ?쒓컖 異쒕젰 ??+9h 蹂댁젙 ?꾩슂
        const kst = new Date(d.getTime() + (9 * 60 * 60 * 1000));
        logTime = kst.toISOString().replace('T', ' ').substring(0, 19);
      } else {
        logTime = getKstDateTimeKey();
      }

      const dateStr = logTime.split(' ')[0]; // YYYY-MM-DD
      const corr = corrMap.get(`${r.emp_no}_${dateStr}`);
      const adjustment = adjustmentMap.get(String(r.id || ''));
      const adjustedWorkDate = adjustment?.work_date || dateStr;
      const adjustedRole = adjustment?.adjusted_role || null;
      const baseMinutes = (() => {
        const timePart = String(logTime || '').split(' ')[1] || '00:00:00';
        const [hours = 0, minutes = 0] = timePart.substring(0, 5).split(':').map((value) => Number(value) || 0);
        return (hours * 60) + minutes;
      })();
      const adjustedRoleText = String(adjustedRole || '').trim().toLowerCase();
      const isIgnored = adjustedRoleText.includes('무시') || adjustedRoleText.includes('ignore');
      const isAdjustedCheckout = adjustedRoleText.includes('퇴') || adjustedRoleText.includes('checkout');
      const isAdjustedCheckin = adjustedRoleText.includes('출') || adjustedRoleText.includes('checkin');
      const eventType = String(r.event_type || '').trim();
      const adjustedWorkOrder = (() => {
        if (isAdjustedCheckout) return baseMinutes + (24 * 60);
        if (isAdjustedCheckin) return baseMinutes - (24 * 60);
        return baseMinutes;
      })();

      return {
        id:        r.id,
        empNo:     r.emp_no,
        cardNo:    r.card_no,
        logTime,
        rawWorkDate: dateStr,
        workDate:  adjustedWorkDate,
        gateName:  r.gate_name || '게이트',
        flag1:     r.flag1,
        source:    r.source || 'secom',
        eventType: adjustedRole || r.event_type || flag1ToEventType(r.flag1),
        adjustedRole,
        isIgnored,
        isAdjustedCheckout,
        isAdjustedCheckin,
        workOrder: adjustedWorkOrder,
        adjustmentId: adjustment?.id || null,
        adjustmentNote: adjustment?.note || '',
        adjustedRoleApplied: adjustedRole || null,
        isAdjusted: !!adjustment,
        correctedOutTime: (eventType === '퇴근' && corr)
          ? corr.corrected_out_time?.replace('T', ' ').substring(0, 19)
          : null,
        correctionReason: (eventType === '퇴근' && corr) ? corr.reason : null,
      };
    }).filter((row) => !row.isIgnored);

    // ?섎룞 湲곕줉??濡쒓렇 ?뺤떇?쇰줈 蹂묓빀
    const normalizeManualCheckinType = (value) => {
      const rawType = String(value || '').trim();
      if (!rawType) return '';
      if (rawType.startsWith('수정요청-')) {
        return rawType.slice('수정요청-'.length).trim();
      }
      if (rawType === '일정조정') return '근무일정조정';
      return rawType;
    };

    const latestApprovedManualByKey = new Map();
    (rawManual || []).forEach((m) => {
      if (m.admin_decision !== 'approved') return;
      const normalizedType = normalizeManualCheckinType(m.check_type);
      const key = `${String(m.emp_no || '').trim()}_${String(m.work_date || '').trim()}_${normalizedType}`;
      const decidedAt = new Date(m.decided_at || m.created_at || 0).getTime();
      const current = latestApprovedManualByKey.get(key);
      const currentDecidedAt = current ? new Date(current.decided_at || current.created_at || 0).getTime() : -1;
      if (!current || decidedAt >= currentDecidedAt) {
        latestApprovedManualByKey.set(key, m);
      }
    });

    const manual_logs = Array.from(latestApprovedManualByKey.values())
      .flatMap(m => {
        const normalizedType = normalizeManualCheckinType(m.check_type);
        if (normalizedType === '근무일정조정') {
          return [];
        }
        let logTime = '';
        if (m.check_time) {
          logTime = parseKstDateTimeToDisplay(m.check_time);
        } else {
          logTime = `${m.work_date} 09:00:00`;
        }
        const dateStr = m.work_date;
        const corr = corrMap.get(`${m.emp_no}_${dateStr}`);
        const timePart = String(logTime || '').split(' ')[1] || '00:00:00';
        const [hours = 0, minutes = 0] = timePart.substring(0, 5).split(':').map((value) => Number(value) || 0);
        const workOrder = (hours * 60) + minutes;

        return [{
          empNo:     m.emp_no,
          cardNo:    '수동',
          logTime,
          workOrder,
          workDate:  dateStr,
          gateName:  m.note ? `수동 (${m.note})` : '수동',
          flag1:     normalizedType === '출근' ? '1' : '4',
          eventType: normalizedType,
          manualPriority: normalizedType === '출근' ? 0 : 2,
          note: m.note || '',
          correctedOutTime: (normalizedType === '퇴근' && corr)
            ? corr.corrected_out_time?.replace('T', ' ').substring(0, 19)
            : null,
          correctionReason: (normalizedType === '퇴근' && corr) ? corr.reason : null,
          isManual:  true,
          manualId:  m.id,
          adminDecision: m.admin_decision
        }];
      });

    // 전체 로그 (최신순 정렬)
    const combined_logs = [...logs_fmt, ...manual_logs].sort((a, b) => b.logTime.localeCompare(a.logTime));

    const leaves_fmt = (rawLeaves || []).map(l => ({
      empNo:     l.emp_no,
      empName:   l.emp_name || employeeNameMap.get(normalizeEmpNoKey(l.emp_no)) || '',
      startDate: l.start_date,
      endDate:   l.end_date,
      leaveCode: l.leave_code,
      leaveName: getLeaveDisplayLabel(l),
      leaveDays: l.leave_days?.toString() || '0',
      status:    l.status,
    }));

    return {
      employees: employees_fmt,
      logs:      combined_logs,
      leaves:    leaves_fmt,
      corrections: corrections || [],
      overrides: overrides || [],
      teamSchedulePatterns,
      manualCheckins: rawManual || [],
      isDemo:    false,
      error:     null,
    };

  } catch (err) {
    console.error('[Supabase] ?곗씠??議고쉶 ?ㅽ뙣:', err.message);
    return {
      employees: [],
      logs:      [],
      leaves:    [],
      corrections: [],
      overrides: [],
      teamSchedulePatterns: [],
      manualCheckins: [],
      isDemo:    true,
      error:     `?곗씠??議고쉶 ?ㅽ뙣: ${err.message}`,
    };
  }
}

/**
 * 珥덇낵?쒓컙 ?ㅼ젙 議고쉶
 */
export async function fetchOvertimeSettings() {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_overtime_settings')
    .select('dept_name, threshold_time, is_active')
    .eq('is_active', true);

  if (error) return {};

  const map = {};
  (data || []).forEach(s => {
    map[s.dept_name] = s.threshold_time; // "HH:MM:SS"
  });
  return map;
}

/**
 * ?좎쭨蹂?洹쇰Т?쇱젙 議곗젙 議고쉶
 */
export async function fetchScheduleOverrides(yearMonth) {
  const supabase = getAdminClient();
  const [year, month] = yearMonth.split('-');
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const selectFields = 'emp_no, work_date, schedule_start, schedule_end, allow_overtime, note';
  const fallbackFields = 'emp_no, work_date, schedule_start, schedule_end, note';

  const queryRange = (query) => query
    .gte('work_date', `${year}-${month}-01`)
    .lte('work_date', `${year}-${month}-${String(lastDay).padStart(2, '0')}`);

  const primary = await queryRange(
    supabase
      .from('sa_schedule_overrides')
      .select(selectFields)
  );

  if (!primary.error) {
    return (primary.data || []).map((row) => ({ ...row, allow_overtime: Boolean(row.allow_overtime) }));
  }

  const message = String(primary.error.message || '').toLowerCase();
  if (message.includes('allow_overtime') || primary.error.code === '42703') {
    const fallback = await queryRange(
      supabase
        .from('sa_schedule_overrides')
        .select(fallbackFields)
    );
    if (fallback.error) return [];
    return (fallback.data || []).map((row) => ({ ...row, allow_overtime: false }));
  }

  return [];
}

/**
 * 吏곸썝蹂?湲곕낯 異쒓렐?쒓컙 議고쉶
 */
export async function fetchEmployeeSchedules(empNos = null) {
  if (empNos?.length === 0) return [];
  const supabase = getAdminClient();
  const scoped = query => empNos ? query.in('emp_no', empNos) : query;
  const primary = await scoped(supabase
    .from('sa_employee_schedules')
    .select('emp_no, schedule_time, schedule_end_time, updated_at, updated_by'));

  if (!primary.error) return primary.data || [];

  const message = String(primary.error.message || '').toLowerCase();
  if (message.includes('schedule_end_time') || primary.error.code === '42703') {
    const fallback = await scoped(supabase
      .from('sa_employee_schedules')
      .select('emp_no, schedule_time, updated_at, updated_by'));
    if (fallback.error) return [];
    return (fallback.data || []).map((row) => ({ ...row, schedule_end_time: null }));
  }

  return [];
}

/**
 * 吏곸썝蹂?湲곕낯 異쒓렐?쒓컙 ?????젣
 */
export async function saveEmployeeSchedules(entries, userId) {
  const supabase = getAdminClient();
  const payload = Array.isArray(entries)
    ? entries
    : Object.entries(entries || {}).map(([empNo, scheduleValue]) => {
      if (scheduleValue && typeof scheduleValue === 'object') {
        return {
          empNo,
          scheduleTime: scheduleValue.scheduleTime ?? scheduleValue.scheduleStart ?? '',
          scheduleEndTime: scheduleValue.scheduleEndTime ?? scheduleValue.scheduleEnd ?? null,
        };
      }
      return { empNo, scheduleTime: scheduleValue };
    });

  const rows = payload
    .map((item) => ({
      emp_no: item.empNo,
      schedule_time: String(item.scheduleTime || '').trim() || null,
      schedule_end_time: String(item.scheduleEndTime || '').trim() || null,
      updated_by: userId || null,
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.emp_no);

  const toUpsert = rows.filter((row) => row.schedule_time);
  const toDelete = rows.filter((row) => !row.schedule_time).map((row) => row.emp_no);

  if (toUpsert.length > 0) {
    const withEnd = await supabase
      .from('sa_employee_schedules')
      .upsert(toUpsert, { onConflict: 'emp_no' });
    if (withEnd.error) {
      const message = String(withEnd.error.message || '').toLowerCase();
      if (message.includes('schedule_end_time') || withEnd.error.code === '42703') {
        const fallbackRows = toUpsert.map(({ schedule_end_time, ...row }) => row);
        const fallback = await supabase
          .from('sa_employee_schedules')
          .upsert(fallbackRows, { onConflict: 'emp_no' });
        if (fallback.error) throw fallback.error;
      } else {
        throw withEnd.error;
      }
    }
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('sa_employee_schedules')
      .delete()
      .in('emp_no', toDelete);
    if (error) throw error;
  }

  return true;
}

/**
 * ?닿렐 ?쒓컙 ?섏젙 ??? */
export async function saveAttendanceCorrection({ empNo, workDate, correctedOutTime, reason, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_attendance_corrections')
    .upsert({
      emp_no: empNo,
      work_date: workDate,
      corrected_out_time: correctedOutTime,
      reason,
      corrected_by: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'emp_no,work_date' })
    .select();
  if (error) throw error;
  return data;
}

export async function deleteAttendanceCorrection({ empNo, workDate }) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from('sa_attendance_corrections')
    .delete()
    .eq('emp_no', empNo)
    .eq('work_date', workDate);
  if (error) throw error;
  return true;
}

export async function saveTeamSchedulePattern({ deptName, workDate, patternCode, patternName, scheduleStart, scheduleEnd, note, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_team_schedule_patterns')
    .upsert({
      dept_name: deptName,
      work_date: workDate,
      pattern_code: patternCode,
      pattern_name: patternName,
      schedule_start: scheduleStart || null,
      schedule_end: scheduleEnd || null,
      note: note || '',
      created_by: userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'dept_name,work_date' })
    .select();
  if (error) {
    if (String(error?.message || '').includes('sa_team_schedule_patterns') || error?.code === '42P01') {
      const tableError = new Error('? ?ㅼ?以??뚯씠釉붿씠 ?꾩쭅 以鍮꾨릺吏 ?딆븯?듬땲?? Supabase 留덉씠洹몃젅?댁뀡???곸슜?????ㅼ떆 ?쒕룄??二쇱꽭??');
      tableError.code = 'MISSING_TEAM_SCHEDULE_TABLE';
      throw tableError;
    }
    throw error;
  }
  return data;
}

export async function fetchTeamSchedulePatterns({ deptName, from, to } = {}) {
  const supabase = getAdminClient();
  let query = supabase
    .from('sa_team_schedule_patterns')
    .select('dept_name, work_date, pattern_code, pattern_name, schedule_start, schedule_end, note, created_by, created_at, updated_at')
    .order('work_date', { ascending: true });

  if (deptName) {
    query = query.eq('dept_name', deptName);
  }
  if (from) {
    query = query.gte('work_date', from);
  }
  if (to) {
    query = query.lte('work_date', to);
  }

  const { data, error } = await query;
  if (error) {
    if (String(error?.message || '').includes('sa_team_schedule_patterns') || error?.code === '42P01') {
      return [];
    }
    throw error;
  }
  return data || [];
}

/**
 * ?좎쭨蹂?洹쇰Т?쇱젙 議곗젙 ??? */
export async function saveScheduleOverride({ empNo, workDate, scheduleStart, scheduleEnd, allowOvertime = true, note, userId, removed = false }) {
  const supabase = getAdminClient();
  const payload = {
    emp_no: empNo,
    work_date: workDate,
    schedule_start: removed ? '00:00' : scheduleStart,
    schedule_end: removed ? '00:00' : scheduleEnd,
    allow_overtime: removed ? false : Boolean(allowOvertime),
    note: removed ? '__SCHEDULE_REMOVED__' : note,
    created_by: userId,
  };

  return upsertWithFallback(supabase, 'sa_schedule_overrides', payload);
}

export async function saveScheduleOverridesBatch({ empNo, workDates = [], scheduleStart, scheduleEnd, allowOvertime = true, note, userId, removed = false }) {
  const supabase = getAdminClient();
  const payload = (workDates || [])
    .map((workDate) => ({
      emp_no: empNo,
      work_date: workDate,
      schedule_start: removed ? '00:00' : scheduleStart,
      schedule_end: removed ? '00:00' : scheduleEnd,
      allow_overtime: removed ? false : Boolean(allowOvertime),
      note: removed ? '__SCHEDULE_REMOVED__' : (note || ''),
      created_by: userId || null,
    }))
    .filter((row) => row.emp_no && row.work_date && row.schedule_start);

  if (payload.length === 0) {
    return [];
  }

  const inserted = [];
  for (const row of payload) {
    const data = await upsertWithFallback(supabase, 'sa_schedule_overrides', row);
    inserted.push(...(data || []));
  }
  return inserted;
}

/**
 * ?섎룞 異쒗눜洹??깅줉
 */
/**
 * ?좎쭨蹂?洹쇰Т?쇱젙 ?덉쇅 ??젣
 */
export async function deleteScheduleOverride({ empNo, workDate }) {
  const supabase = getAdminClient();

  const attempts = [
    async () => supabase
      .from('sa_schedule_overrides')
      .delete()
      .eq('emp_no', empNo)
      .eq('work_date', workDate),
    async () => supabase
      .from('sa_schedule_overrides')
      .upsert({
        emp_no: empNo,
        work_date: workDate,
        schedule_start: null,
        schedule_end: null,
        allow_overtime: null,
        note: null,
      }, { onConflict: 'emp_no,work_date' }),
    async () => supabase
      .from('sa_schedule_overrides')
      .update({
        schedule_start: null,
        schedule_end: null,
        allow_overtime: null,
        note: null,
      })
      .eq('emp_no', empNo)
      .eq('work_date', workDate),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    const result = await attempt();
    if (!result?.error) return result.data || [];
    lastError = result.error;
    if (!isMissingColumnError(result.error) && !isConflictTargetError(result.error)) {
      throw result.error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

/**
 * 異쒖엯 濡쒓렇 洹????? */
export async function saveAttendanceLogAdjustment({ attendanceId, empNo, workDate, adjustedRole, note, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_attendance_log_adjustments')
    .upsert({
      attendance_id: attendanceId,
      emp_no: empNo,
      work_date: workDate,
      adjusted_role: adjustedRole,
      note: note || '',
      adjusted_by: userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'attendance_id' })
    .select();
  if (error) {
    const message = String(error?.message || '').toLowerCase();
    const isMissingTable =
      error?.code === '42P01' ||
      message.includes('could not find the table') ||
      message.includes('relation "sa_attendance_log_adjustments" does not exist') ||
      message.includes('table "sa_attendance_log_adjustments" does not exist');

    if (isMissingTable) {
      const tableError = new Error('異쒖엯湲곕줉 洹???뚯씠釉붿씠 ?꾩쭅 Supabase??諛섏쁺?섏? ?딆븯?듬땲?? 留덉씠洹몃젅?댁뀡???곸슜????schema cache瑜??덈줈怨좎묠??二쇱꽭??');
      tableError.code = 'MISSING_ATTENDANCE_LOG_ADJUSTMENTS_TABLE';
      throw tableError;
    }
    throw error;
  }
  return data;
}

/**
 * 異쒖엯 濡쒓렇 洹????젣
 */
export async function deleteAttendanceLogAdjustment({ attendanceId }) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from('sa_attendance_log_adjustments')
    .delete()
    .eq('attendance_id', attendanceId);
  if (error) {
    const message = String(error?.message || '').toLowerCase();
    const isMissingTable =
      error?.code === '42P01' ||
      message.includes('could not find the table') ||
      message.includes('relation "sa_attendance_log_adjustments" does not exist') ||
      message.includes('table "sa_attendance_log_adjustments" does not exist');

    if (isMissingTable) {
      const tableError = new Error('異쒖엯湲곕줉 洹???뚯씠釉붿씠 ?꾩쭅 Supabase??諛섏쁺?섏? ?딆븯?듬땲?? 留덉씠洹몃젅?댁뀡???곸슜????schema cache瑜??덈줈怨좎묠??二쇱꽭??');
      tableError.code = 'MISSING_ATTENDANCE_LOG_ADJUSTMENTS_TABLE';
      throw tableError;
    }
    throw error;
  }
  return true;
}

export async function deleteAttendanceLogAdjustmentsByNotePrefix({ notePrefix }) {
  const supabase = getAdminClient();
  let query = supabase
    .from('sa_attendance_log_adjustments')
    .delete();
  if (notePrefix) {
    query = query.ilike('note', `${notePrefix}%`);
  }
  const { error } = await query;
  if (error) {
    const message = String(error?.message || '').toLowerCase();
    const isMissingTable =
      error?.code === '42P01' ||
      message.includes('could not find the table') ||
      message.includes('relation "sa_attendance_log_adjustments" does not exist') ||
      message.includes('table "sa_attendance_log_adjustments" does not exist');

    if (isMissingTable) {
      const tableError = new Error('출입기록 조정 테이블이 아직 Supabase에 반영되지 않았습니다. 마이그레이션을 적용한 뒤 다시 시도해주세요.');
      tableError.code = 'MISSING_ATTENDANCE_LOG_ADJUSTMENTS_TABLE';
      throw tableError;
    }
    throw error;
  }
  return true;
}

export async function deleteManualCheckinById({ id }) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from('sa_manual_checkins')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

export async function deleteTeamSchedulePattern({ deptName, workDate }) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from('sa_team_schedule_patterns')
    .delete()
    .eq('dept_name', deptName)
    .eq('work_date', workDate);
  if (error) {
    if (String(error?.message || '').includes('sa_team_schedule_patterns') || error?.code === '42P01') {
      const tableError = new Error('? ?ㅼ?以??뚯씠釉붿씠 ?꾩쭅 以鍮꾨릺吏 ?딆븯?듬땲?? Supabase 留덉씠洹몃젅?댁뀡???곸슜?????ㅼ떆 ?쒕룄??二쇱꽭??');
      tableError.code = 'MISSING_TEAM_SCHEDULE_TABLE';
      throw tableError;
    }
    throw error;
  }
  return true;
}

export async function saveManualCheckin({ empNo, checkType, checkTime, workDate, note, adminDecision = null, decidedBy = null, decidedAt = null }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_manual_checkins')
    .insert({
      emp_no: empNo,
      check_type: checkType,
      check_time: checkTime,
      work_date: workDate,
      note,
      admin_decision: adminDecision,
      decided_by: decidedBy,
      decided_at: decidedAt || (adminDecision ? new Date().toISOString() : null),
    })
    .select();
  if (error) throw error;
  return data;
}

export async function deleteManualCheckin({ empNo, workDate, checkType }) {
  const supabase = getAdminClient();
  let query = supabase
    .from('sa_manual_checkins')
    .delete()
    .eq('emp_no', empNo)
    .eq('work_date', workDate);
  if (checkType) query = query.eq('check_type', checkType);
  const { error } = await query;
  if (error) throw error;
  return true;
}

/**
 * ?섎룞 異쒗눜洹??뱀씤/諛섎젮 寃곗젙
 */
export async function decideManualCheckin({ id, decision, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_manual_checkins')
    .update({
      admin_decision: decision,
      decided_by: userId,
      decided_at: new Date().toISOString()
    })
    .eq('id', id)
    .select();
  if (error) throw error;
  return data;
}

/**
 * ?댁씪洹쇰Т ?泥댄쑕媛 ?쒓컙 議고쉶
 */
export async function fetchHolidayWork(yearMonth) {
  const supabase = getAdminClient();
  const [year, month] = yearMonth.split('-');
  const { data, error } = await supabase
    .from('sa_holiday_work')
    .select('emp_no, work_date, clock_in, clock_out, work_hours, comp_leave_hours, is_confirmed')
    .gte('work_date', `${year}-${month}-01`)
    .lte('work_date', `${year}-${month}-31`);

  if (error) return [];
  return data || [];
}

/**
 * ?댁씪洹쇰Т ?泥댄쑕媛 ?쒓컙 ?깅줉/?섏젙
 */
export async function saveHolidayWork({ empNo, workDate, clockIn, clockOut, workHours, compLeaveHours, isConfirmed, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_holiday_work')
    .upsert({
      emp_no: empNo,
      work_date: workDate,
      clock_in: clockIn,
      clock_out: clockOut,
      work_hours: workHours,
      comp_leave_hours: compLeaveHours,
      is_confirmed: isConfirmed,
      confirmed_by: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'emp_no,work_date' })
    .select();
  if (error) throw error;
  return data;
}

/**
 * 珥덇낵?쒓컙 ?꾩쟻 湲곌컙 議고쉶
 */
export async function fetchOvertimePeriods() {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_overtime_periods')
    .select('id, name, start_date, end_date, note')
    .order('start_date', { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * 珥덇낵?쒓컙 ?꾩쟻 湲곌컙 ?깅줉
 */
export async function saveOvertimePeriod({ name, startDate, endDate, note, userId }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_overtime_periods')
    .insert({
      name,
      start_date: startDate,
      end_date: endDate,
      note,
      created_by: userId
    })
    .select();
  if (error) throw error;
  return data;
}

/**
 * 珥덇낵?쒓컙 ?꾩쟻 湲곌컙 ??젣
 */
export async function deleteOvertimePeriod(id) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from('sa_overtime_periods')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

/**
 * 珥덇낵?쒓컙 ? ?ㅼ젙 ?꾩껜 ?낅뜲?댄듃
 */
export async function saveOvertimeSettings(deptName, thresholdTime, isActive) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_overtime_settings')
    .upsert({
      dept_name: deptName,
      threshold_time: thresholdTime,
      is_active: isActive,
      updated_at: new Date().toISOString()
    }, { onConflict: 'dept_name' })
    .select();
  if (error) throw error;
  return data;
}


/**
 * 吏곸썝蹂?珥덇낵洹쇰Т 李⑥닔/湲곌컙 議고쉶
 */
export async function fetchEmployeeOvertimeRounds(empNos = null) {
  if (empNos?.length === 0) return [];
  const supabase = getAdminClient();
  let query = supabase
    .from('sa_employee_overtime_rounds')
    .select('emp_no, round_name, start_date, end_date');
  if (empNos) query = query.in('emp_no', empNos);
  const { data, error } = await query;
  if (error) {
    console.error('fetchEmployeeOvertimeRounds error:', error);
    return [];
  }
  return data || [];
}

/**
 * 吏곸썝蹂?珥덇낵洹쇰Т 李⑥닔/湲곌컙 ??? */
export async function saveEmployeeOvertimeRound({ empNo, roundName, startDate, endDate }) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('sa_employee_overtime_rounds')
    .upsert({
      emp_no: empNo,
      round_name: roundName,
      start_date: startDate,
      end_date: endDate,
      updated_at: new Date().toISOString()
    }, { onConflict: 'emp_no' })
    .select();
  if (error) throw error;
  return data;
}

// ?? ?대? ?좏떥由ы떚 ????????????????????????????????????????????????

function formatATime(aTime) {
  if (!aTime || aTime.length < 14) return getKstDateTimeKey();
  return `${aTime.substring(0,4)}-${aTime.substring(4,6)}-${aTime.substring(6,8)} ` +
         `${aTime.substring(8,10)}:${aTime.substring(10,12)}:${aTime.substring(12,14)}`;
}

function flag1ToEventType(flag1) {
  if (flag1 === '1') return '異쒓렐';
  if (flag1 === '4') return '?닿렐';
  return '異쒖엯';
}

export function getSettings() {
  try {
    const settingsPath = require('path').join(process.cwd(), 'secom-settings.json');
    if (require('fs').existsSync(settingsPath)) {
      const data = require('fs').readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(data);
      return {
        appMode: 'supabase',
        employeeSchedules: parsed.employeeSchedules || {},
      };
    }
  } catch (err) {
    console.error('supabaseDb getSettings error:', err);
  }
  return {
    appMode: 'supabase',
    employeeSchedules: {},
  };
}

