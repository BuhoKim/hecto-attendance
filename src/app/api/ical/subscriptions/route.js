import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { createIcalSubscriptionToken, normalizeIcalDeptList } from '@/lib/icalToken';
import {
  buildSubscriptionAccessUrls,
  createIcalSubscriptionRecord,
  listIcalSubscriptionRecords,
} from '@/lib/icalSubscriptions';

function isMissingIcalSubscriptionTable(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    message.includes('sa_ical_subscriptions') ||
    message.includes('could not find the table') ||
    message.includes('relation "public.sa_ical_subscriptions" does not exist') ||
    message.includes('relation "sa_ical_subscriptions" does not exist')
  );
}

function getPublicBaseUrl(request) {
  const requestOrigin = new URL(request.url).origin;
  const requestHostname = new URL(request.url).hostname;
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(requestHostname);
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (!isLocalHost) {
    return requestOrigin.replace(/\/$/, '');
  }

  if (configured) {
    const normalized = configured.startsWith('http://') || configured.startsWith('https://')
      ? configured
      : `https://${configured}`;
    return normalized.replace(/\/$/, '');
  }

  return requestOrigin.replace(/\/$/, '');
}

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin && !session.isLeader) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const baseUrl = getPublicBaseUrl(request);
    const records = await listIcalSubscriptionRecords();
    const subscriptions = records.map((record) => {
      const { url, webcalUrl } = buildSubscriptionAccessUrls(baseUrl, record.token);
      return {
        id: record.id,
        token: record.token,
        label: record.label || '비공개 iCal 구독',
        depts: Array.isArray(record.depts) ? record.depts : [],
        scope: record.scope || 'leave-calendar',
        ownerEmpNo: record.owner_emp_no || null,
        isActive: record.is_active !== false && !record.revoked_at,
        revokedAt: record.revoked_at || null,
        createdAt: record.created_at || null,
        updatedAt: record.updated_at || null,
        url,
        webcalUrl,
      };
    });

    return NextResponse.json({ success: true, subscriptions });
  } catch (error) {
    if (isMissingIcalSubscriptionTable(error)) {
      return NextResponse.json({
        error: '구독 목록 테이블이 아직 Supabase에 생성되지 않았습니다. 마이그레이션을 먼저 적용해주세요.',
        missingTable: true,
      }, { status: 503 });
    }
    console.error('[ICS Subscriptions GET]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin && !session.isLeader) {
      return NextResponse.json({ error: '관리자 또는 팀장 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const personal = body.personal === true;
    const ownerEmpNo = personal ? String(body.ownerEmpNo || '').trim() : null;
    const depts = normalizeIcalDeptList(body.depts || []);
    const label = String(body.label || '').trim();

    if (personal && !ownerEmpNo) return NextResponse.json({ error: '개인용 링크 대상 직원을 선택해주세요.' }, { status: 400 });
    if (depts.length === 0 && !personal) {
      return NextResponse.json({ error: '부서를 하나 이상 선택해주세요.' }, { status: 400 });
    }

    const token = createIcalSubscriptionToken({
      depts,
      label: label || '비공개 iCal 구독',
      createdBy: session.userId || null,
      scope: personal ? 'employee-current-dept' : 'leave-calendar',
    });

    await createIcalSubscriptionRecord({
      token,
      label: label || '비공개 iCal 구독',
      depts,
      createdBy: session.userId || null,
      ownerEmpNo,
      scope: personal ? 'employee-current-dept' : 'leave-calendar',
    });

    const baseUrl = getPublicBaseUrl(request);
    const { url, webcalUrl } = buildSubscriptionAccessUrls(baseUrl, token);

    return NextResponse.json({
      success: true,
      token,
      url,
      webcalUrl,
      depts,
      label: label || '비공개 iCal 구독',
    });
  } catch (error) {
    if (isMissingIcalSubscriptionTable(error)) {
      return NextResponse.json({
        error: '구독 목록 테이블이 아직 Supabase에 생성되지 않았습니다. 마이그레이션을 먼저 적용해주세요.',
        missingTable: true,
      }, { status: 503 });
    }
    console.error('[ICS Subscriptions POST]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}
