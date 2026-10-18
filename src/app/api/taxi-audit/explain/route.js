import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { getTaxiExplanationByToken, submitTaxiExplanation } from '@/lib/taxiExplanationDb';
import { checkRateLimit, getRequestIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = String(searchParams.get('token') || '').trim();
    const rate = checkRateLimit(`taxi-read:${getRequestIp(request)}:${token}`, { limit: 30, windowMs: 10 * 60 * 1000 });
    if (!rate.allowed) {
      return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });
    }

    if (!token || token.length > 4096) {
      return NextResponse.json({ error: '소명 토큰이 필요합니다.' }, { status: 400 });
    }

    const data = await getTaxiExplanationByToken(token);

    if (!data) {
      return NextResponse.json({ error: '유효하지 않거나 만료된 소명 링크입니다.' }, { status: 444 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Taxi Audit Explain GET]', error);
    return NextResponse.json(
      { error: publicErrorMessage(error, '소명 정보를 불러오지 못했습니다.') },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body?.token || '').trim();
    const explanationText = String(body?.explanationText || '').trim();
    const rate = checkRateLimit(`taxi-submit:${getRequestIp(request)}:${token}`, { limit: 10, windowMs: 10 * 60 * 1000 });
    if (!rate.allowed) {
      return NextResponse.json({ error: '제출 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });
    }

    if (!token || token.length > 4096) {
      return NextResponse.json({ error: '소명 토큰이 누락되었습니다.' }, { status: 400 });
    }
    if (!explanationText || explanationText.length > 2000) {
      return NextResponse.json({ error: '소명 사유를 입력해 주세요.' }, { status: 400 });
    }

    const updated = await submitTaxiExplanation({ token, explanationText });

    // 팀장 알림 이메일 비동기 발송
    try {
      const { sendTaxiAuditLeaderNotificationMail } = await import('@/lib/taxiAuditMail');
      sendTaxiAuditLeaderNotificationMail(updated).catch((err) => {
        console.error('Async leader mail notification error:', err);
      });
    } catch (mailErr) {
      console.warn('Leader mail import warning:', mailErr);
    }

    return NextResponse.json({
      success: true,
      message: '소명 사유가 성공적으로 제출되었습니다.',
      data: updated,
    });

  } catch (error) {
    console.error('[Taxi Audit Explain POST]', error);
    return NextResponse.json(
      { error: publicErrorMessage(error, '소명 사유 제출에 실패했습니다.') },
      { status: 500 }
    );
  }
}
