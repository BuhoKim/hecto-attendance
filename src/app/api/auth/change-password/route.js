import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseClient';
import { verifySession } from '@/lib/auth';

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { newPassword } = await request.json();
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();

    // 비밀번호 변경
    const { error: updateErr } = await supabase.auth.admin.updateUserById(
      session.userId,
      { password: newPassword }
    );
    if (updateErr) {
      return NextResponse.json({ error: `비밀번호 변경 실패: ${updateErr.message}` }, { status: 500 });
    }

    // must_change_password 플래그 해제
    await supabase
      .from('sa_profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', session.userId);

    const response = NextResponse.json({ success: true });
    response.cookies.set('must-change-password', 'false', {
      httpOnly: false,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (err) {
    console.error('[Change Password API]', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
