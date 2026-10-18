import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { buildLeaveIcsForDepartments } from '@/lib/icalFeed';
import { getIcalSubscriptionRecordByToken } from '@/lib/icalSubscriptions';
import { buildIcalHeaders } from '@/lib/icalHttp';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

    const ics = await buildLeaveIcsForDepartments({
      departments: Array.isArray(record.depts) && record.depts.length > 0 ? record.depts : [],
      subscriptionOwnerId: record.scope === 'leader-current-dept' ? record.created_by : null,
      subscriptionOwnerEmpNo: record.scope === 'employee-current-dept' ? record.owner_emp_no : null,
      calendarName: record.label || '비공개 iCal 구독',
      calendarDescription: `${record.label || '비공개 iCal 구독'} - 비공개 부서 연차 구독`,
    });

    return new NextResponse(ics, {
      headers: buildIcalHeaders({
        'Content-Disposition': 'inline; filename="private-leaves.ics"',
      }),
    });
  } catch (error) {
    console.error('[ICS Subscriptions GET ICS]', error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}
