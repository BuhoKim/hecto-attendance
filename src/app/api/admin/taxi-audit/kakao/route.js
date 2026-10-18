import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { buildTaxiAuditRowsFromKakao } from '@/lib/kakaoTaxiAuditApi';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

function parseKstDateKey(value) {
  if (!DATE_RE.test(String(value || '').trim())) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDaysInclusive(startDate, endDate) {
  const start = parseKstDateKey(startDate);
  const end = parseKstDateKey(endDate);
  if (!start || !end) return null;
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return diff;
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const startDate = String(body?.startDate || '').trim();
    const endDate = String(body?.endDate || '').trim();
    const memberIdentifier = String(body?.memberIdentifier || '').trim();

    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return NextResponse.json({ error: '조회 시작일과 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.' }, { status: 400 });
    }

    const diffDays = diffDaysInclusive(startDate, endDate);
    if (!diffDays || diffDays <= 0) {
      return NextResponse.json({ error: '조회 기간이 올바르지 않습니다.' }, { status: 400 });
    }
    if (diffDays > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `조회 기간은 최대 ${MAX_RANGE_DAYS}일까지만 가능합니다.` }, { status: 400 });
    }

    const result = await buildTaxiAuditRowsFromKakao({
      startDate,
      endDate,
      memberIdentifier,
    });

    const rows = result.rows || [];
    const orderIds = rows.map((r) => r.orderId || r.id || r.ticketNo).filter(Boolean);
    const { fetchTaxiExplanationsMap } = await import('@/lib/taxiExplanationDb');
    const expMap = await fetchTaxiExplanationsMap(orderIds);

    const enrichedRows = rows.map((row) => {
      const orderId = row.orderId || row.id || row.ticketNo;
      const exp = expMap.get(orderId);
      return {
        ...row,
        explanationRecord: exp || null,
        explanationStatus: exp?.status || 'NONE',
        explanationText: exp?.explanation_text || '',
        explanationSubmittedAt: exp?.submitted_at || null,
        explanationRequestedAt: exp?.requested_at || null,
      };
    });

    return NextResponse.json({
      success: true,
      rows: enrichedRows,
      count: result.count || 0,
      meta: result.meta || null,
    });
  } catch (error) {
    console.error('[Taxi Audit Kakao Query Error]', error);
    return NextResponse.json(
      { error: publicErrorMessage(error, '카카오T 내역을 불러오지 못했습니다.') },
      { status: 500 }
    );
  }
}
