import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import {
  deleteIcalSubscriptionRecord,
  getIcalSubscriptionRecordByToken,
  setIcalSubscriptionRecordActive,
  updateIcalSubscriptionRecord,
} from '@/lib/icalSubscriptions';

export const dynamic = 'force-dynamic';

export async function GET(_request, context) {
  try {
    const { token } = await context.params;
    const record = await getIcalSubscriptionRecordByToken(token);
    if (!record) {
      return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (record.is_active === false || record.revoked_at) {
      return NextResponse.json({ error: '비활성화된 구독 링크입니다.' }, { status: 410 });
    }

    return NextResponse.redirect(new URL(`./${encodeURIComponent(token)}.ics`, _request.url).toString(), 307);
  } catch (error) {
    console.error('[ICS Subscriptions GET]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  try {
    const session = await verifySession(request);
    if (!session || (!session.isAdmin && !session.isLeader)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }
    const { token } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (body.depts !== undefined) {
      const depts = Array.isArray(body.depts)
        ? [...new Set(body.depts.map((dept) => String(dept || '').trim()).filter(Boolean))]
        : [];
      if (depts.length === 0) {
        return NextResponse.json({ error: '최소 한 개의 부서를 선택해 주세요.' }, { status: 400 });
      }
      const record = await updateIcalSubscriptionRecord(token, { depts });
      if (!record) {
        return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, depts: record.depts || depts });
    }
    const active = body.active !== false;
    const record = await setIcalSubscriptionRecordActive(token, active);
    if (!record) {
      return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, isActive: active });
  } catch (error) {
    console.error('[ICS Subscriptions PATCH]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request, context) {
  try {
    const session = await verifySession(_request);
    if (!session || (!session.isAdmin && !session.isLeader)) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }
    const { token } = await context.params;
    const record = await deleteIcalSubscriptionRecord(token);
    if (!record) {
      return NextResponse.json({ error: '구독 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ICS Subscriptions DELETE]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}
