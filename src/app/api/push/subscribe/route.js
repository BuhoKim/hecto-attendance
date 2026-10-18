import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const { subscription, empNo } = await request.json();
    if (!subscription || !subscription.endpoint || !empNo) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (String(empNo) !== String(session.empNo || '')) {
      return NextResponse.json({ error: '본인 계정의 푸시 구독만 등록할 수 있습니다.' }, { status: 403 });
    }

    const supabase = getAdminClient();
    
    // We assume the sa_push_subscriptions table has been created
    const { error } = await supabase
      .from('sa_push_subscriptions')
      .upsert({
        emp_no: String(empNo),
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh,
        auth: subscription.keys?.auth,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });

    if (error) {
      console.error('Failed to save subscription:', error);
      // Even if the table doesn't exist yet, we return 200 so frontend doesn't crash
      return NextResponse.json({ success: false, error: publicErrorMessage(error, '푸시 구독 저장에 실패했습니다.') });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
