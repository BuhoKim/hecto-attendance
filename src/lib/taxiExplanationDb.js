import crypto from 'node:crypto';
import { getAdminClient } from './supabaseClient.js';

const TABLE_NAME = 'sa_taxi_explanations';
const getSecretKey = () => process.env.TAXI_AUDIT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * 정보가 포함된 자체 검증 가능한 보안 토큰 생성
 */
export function encodeTaxiToken(payload) {
  const secretKey = getSecretKey();
  if (!secretKey) throw new Error('택시 소명 토큰 비밀키가 설정되지 않았습니다.');
  const jsonStr = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(jsonStr);
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(encodedPayload)
    .digest('hex')
    .slice(0, 16);
  return `${encodedPayload}.${signature}`;
}

/**
 * 토큰 복호화 및 검증
 */
export function decodeTaxiToken(token) {
  if (!token || typeof token !== 'string') return null;
  const secretKey = getSecretKey();
  if (!secretKey) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(encodedPayload)
    .digest('hex')
    .slice(0, 16);

  if (signature !== expectedSignature) return null;
  if (false) {
    // 서명이 맞지 않으면 하위 호환성 체크 후 실패
    try {
      const parsed = JSON.parse(base64UrlDecode(encodedPayload));
      return parsed;
    } catch {
      return null;
    }
  }

  try {
    const jsonStr = base64UrlDecode(encodedPayload);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 소명 요청 생성 또는 기존 소명 토큰 가져오기
 */
export async function createOrGetTaxiExplanation(row) {
  const supabase = getAdminClient();
  const orderId = String(row?.orderId || row?.id || row?.ticketNo || '').trim();
  const empNo = String(row?.empNo || row?.memberIdentifier || '').trim();

  // 기존 DB 레코드 조회
  if (orderId) {
    try {
      const { data: existing } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

      if (existing) {
        return existing;
      }
    } catch (err) {
      // DB 테이블이 없는 경우 무시하고 자체 구성 토큰으로 진행
    }
  }

  const payload = {
    order_id: orderId || null,
    ticket_no: String(row?.ticketNo || orderId || '').trim(),
    emp_no: empNo || null,
    employee_name: String(row?.employeeName || '').trim(),
    dept: String(row?.dept || '').trim(),
    ride_time: String(row?.rideTime || row?.rideTimeRaw || '').trim(),
    actual_out_time: String(row?.actualOutTime || '').trim(),
    amount: Number(String(row?.amount || '0').replace(/,/g, '')) || 0,
    pickup: String(row?.pickup || '').trim(),
    dropoff: String(row?.dropoff || '').trim(),
    use_reason: String(row?.reason || '').trim(),
    requested_at: new Date().toISOString(),
  };

  const token = encodeTaxiToken(payload);
  const newRecord = {
    ...payload,
    token,
    status: 'PENDING',
  };

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert([newRecord])
      .select()
      .single();

    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn('sa_taxi_explanations insert fallback activated:', err.message);
  }

  // DB 저장 미지원 시에도 복호화 가능한 토큰 포함 객체 반환
  return newRecord;
}

/**
 * 토큰으로 소명 정보 조회 (직원용 페이지)
 */
export async function getTaxiExplanationByToken(token) {
  if (!token) return null;
  const supabase = getAdminClient();

  // 1. DB에서 우선 조회
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  } catch (err) {
    // DB 에러 시 토큰 디코딩 폴백으로 넘어감
  }

  // 2. DB 미조회 시 토큰 기반 자체 복호화 폴백
  const decoded = decodeTaxiToken(token);
  if (!decoded) return null;

  return {
    id: token,
    token,
    order_id: decoded.order_id || null,
    ticket_no: decoded.ticket_no || '',
    emp_no: decoded.emp_no || '',
    employee_name: decoded.employee_name || '',
    dept: decoded.dept || '',
    ride_time: decoded.ride_time || '',
    actual_out_time: decoded.actual_out_time || '',
    amount: decoded.amount || 0,
    pickup: decoded.pickup || '',
    dropoff: decoded.dropoff || '',
    use_reason: decoded.use_reason || '',
    explanation_text: decoded.explanation_text || '',
    status: decoded.status || 'PENDING',
    requested_at: decoded.requested_at || new Date().toISOString(),
  };
}

/**
 * 소명 사유 제출 (직원용)
 */
export async function submitTaxiExplanation({ token, explanationText }) {
  if (!token) throw new Error('소명 토큰이 누락되었습니다.');
  if (!explanationText || !explanationText.trim()) throw new Error('소명 사유를 입력해 주세요.');

  const supabase = getAdminClient();
  const trimmedText = explanationText.trim();
  const nowIso = new Date().toISOString();

  // 1. DB 업데이트 시도
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({
        explanation_text: trimmedText,
        status: 'SUBMITTED',
        submitted_at: nowIso,
        updated_at: nowIso,
      })
      .eq('token', token)
      .select()
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn('submitTaxiExplanation DB fallback:', err.message);
  }

  // 2. DB 없거나 누락 시 토큰 디코딩 후 반환
  const existing = await getTaxiExplanationByToken(token);
  if (!existing) {
    throw new Error('존재하지 않거나 유효하지 않은 소명 요청입니다.');
  }

  return {
    ...existing,
    explanation_text: trimmedText,
    status: 'SUBMITTED',
    submitted_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * 관리자용: 여러 order_id 에 대한 소명 내역 Map 반환 (order_id -> explanation record)
 */
export async function fetchTaxiExplanationsMap(orderIds = []) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return new Map();
  }

  const supabase = getAdminClient();
  const validOrderIds = orderIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (validOrderIds.length === 0) return new Map();

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .in('order_id', validOrderIds);

    if (error) {
      return new Map();
    }

    const map = new Map();
    (data || []).forEach((item) => {
      if (item.order_id) map.set(item.order_id, item);
    });

    return map;
  } catch (err) {
    return new Map();
  }
}
