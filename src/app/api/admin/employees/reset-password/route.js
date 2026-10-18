import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { empNo, newPassword } = await request.json();
    if (!empNo || !newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: '사원번호와 8자 이상의 초기 비밀번호가 필요합니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: profile, error: profileErr } = await supabase
      .from('sa_profiles')
      .select('id, emp_no')
      .eq('emp_no', empNo)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileErr) {
      return NextResponse.json({ error: `프로필 조회 실패: ${profileErr.message}` }, { status: 500 });
    }
    if (!profile?.id) {
      return NextResponse.json({ error: '해당 사원의 계정이 없습니다.' }, { status: 404 });
    }

    const { error: updateErr } = await supabase.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });
    if (updateErr) {
      return NextResponse.json({ error: `비밀번호 초기화 실패: ${updateErr.message}` }, { status: 500 });
    }

    const { error: profileUpdateErr } = await supabase
      .from('sa_profiles')
      .update({
        must_change_password: true,
        updated_at: new Date().toISOString(),
      })
      .eq('emp_no', empNo);

    if (profileUpdateErr) {
      return NextResponse.json({ error: `비밀번호 플래그 갱신 실패: ${profileUpdateErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '암호가 초기화되었습니다.' });
  } catch (err) {
    console.error('[Admin Employee Reset Password]', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
