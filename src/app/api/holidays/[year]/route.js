import { NextResponse } from 'next/server';
import { buildFallbackHolidayMap } from '@/lib/holidayFallback.mjs';
import { publicErrorMessage } from '@/lib/apiError.mjs';

export const dynamic = 'force-dynamic';

const HOLIDAY_API_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

const getServiceKey = () =>
  process.env.HOLIDAY_API_SERVICE_KEY ||
  process.env.DATA_GO_KR_HOLIDAY_SERVICE_KEY ||
  process.env.DATA_GO_KR_SERVICE_KEY ||
  '';

const normalizeServiceKey = (value) => {
  const key = String(value || '').trim();
  if (!key) return '';
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try { return decodeURIComponent(key); } catch { return key; }
  }
  return key;
};

const normalizeDateKey = (locdate) => {
  const text = String(locdate || '').trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
};

const normalizeItemList = (items) => {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
};

const extractHolidayMapFromApiResponse = (payload) => {
  const items =
    payload?.response?.body?.items?.item ||
    payload?.response?.body?.items ||
    payload?.response?.items?.item ||
    payload?.response?.items ||
    [];

  const map = {};
  normalizeItemList(items).forEach((item) => {
    const isHoliday = String(item?.isHoliday ?? item?.isholiday ?? 'N').toUpperCase();
    if (isHoliday !== 'Y') return;

    const dateKey = normalizeDateKey(item?.locdate);
    const name = String(item?.dateName || item?.datename || '').trim();
    if (!dateKey || !name) return;
    map[dateKey] = name;
  });

  return map;
};

async function fetchHolidayMonth(year, month, serviceKey) {
  const monthKey = String(month).padStart(2, '0');
  const query = new URLSearchParams({
    ServiceKey: serviceKey,
    solYear: String(year),
    solMonth: monthKey,
    _type: 'json',
    numOfRows: '100',
    pageNo: '1',
  });

  const response = await fetch(`${HOLIDAY_API_URL}?${query.toString()}`, {
    cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.response?.header?.resultMsg || json?.error || '공휴일 API 요청에 실패했습니다.');
  }

  const code = String(json?.response?.header?.resultCode ?? '');
  if (code && code !== '00' && code !== '0000') throw new Error('??? API ?? ??');
  if (!json?.response?.body) throw new Error('??? API ?? ?? ??');
  return extractHolidayMapFromApiResponse(json);
}

export async function GET(_request, context) {
  try {
    const params = await context?.params;
    const year = Number(params?.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return NextResponse.json({ error: '유효한 연도를 입력하세요.' }, { status: 400 });
    }

    const serviceKey = normalizeServiceKey(getServiceKey());
    let holidays = {};
    let source = 'fallback';

    if (serviceKey) {
      const monthResults = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) => fetchHolidayMonth(year, index + 1, serviceKey))
      );

      const allMonthsSucceeded = monthResults.every((result) => result.status === 'fulfilled');
      holidays = allMonthsSucceeded ? monthResults.reduce((acc, result) => {
        if (result.status !== 'fulfilled' || !result.value) return acc;
        return { ...acc, ...result.value };
      }, {}) : {};
      source = allMonthsSucceeded ? 'data.go.kr' : 'data.go.kr+fallback';
    }

    if (Object.keys(holidays).length === 0) {
      holidays = buildFallbackHolidayMap(year);
      source = serviceKey ? 'data.go.kr+fallback' : 'fallback';
    }

    return NextResponse.json({
      success: true,
      year,
      source,
      holidays,
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[Holiday API]', error);
    return NextResponse.json({
      error: publicErrorMessage(error, '공휴일 정보를 불러오지 못했습니다.'),
    }, { status: 500 });
  }
}
