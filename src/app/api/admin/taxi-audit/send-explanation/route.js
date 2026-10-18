import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { sendTaxiAuditExplanationMail } from '@/lib/taxiAuditMail';
import { createOrGetTaxiExplanation } from '@/lib/taxiExplanationDb';

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const row = body?.row || body || {};
    const targetEmail = String(body?.targetEmail || row?.targetEmail || '').trim();

    if (!String(row.empNo || row.memberIdentifier || '').trim() && !targetEmail) {
      return NextResponse.json({ error: '직원 식별 정보가 없습니다.' }, { status: 400 });
    }

    // DB 레코드 생성 또는 기존 토큰 조회
    const explanationRecord = await createOrGetTaxiExplanation(row);

    const reqUrl = new URL(request.url);
    const siteBaseUrl = `${reqUrl.protocol}//${reqUrl.host}`;

    const result = await sendTaxiAuditExplanationMail(row, explanationRecord, siteBaseUrl, targetEmail);


    return NextResponse.json({
      success: true,
      message: `${String(row.employeeName || row.empNo || row.memberIdentifier || '직원')}에게 웹 소명 작성 링크가 포함된 요청 메일을 발송했습니다.`,
      recipientEmail: result.recipientEmail,
      messageId: result.messageId,
      token: explanationRecord?.token,
    });
  } catch (error) {
    console.error('[Taxi audit send explanation]', error);
    return NextResponse.json({
      error: publicErrorMessage(error, '소명 요청 메일 발송에 실패했습니다.'),
    }, { status: 500 });
  }
}
