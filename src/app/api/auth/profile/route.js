import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseClient';
import { verifySession } from '@/lib/auth';
import { publicErrorMessage } from '@/lib/apiError.mjs';

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    const supabase = getAdminClient();
    const { data: deptRows } = await supabase
      .from('sa_employees')
      .select('dept')
      .order('dept', { ascending: true });

    const deptOptions = Array.from(new Set((deptRows || []).map((row) => String(row.dept || '').trim()).filter(Boolean)));

    return NextResponse.json({
      success: true,
      profile: {
        id: session.userId,
        empNo: session.empNo,
        name: session.name,
        dept: session.dept,
        rank: session.rank,
        position: session.position,
        loginId: session.loginId,
        isAdmin: session.isAdmin,
        mustChangePassword: session.mustChangePassword,
      },
      deptOptions,
    });
  } catch (err) {
    console.error('[Auth Profile GET]', err);
    return NextResponse.json({ success: false, error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });
    const body = await request.json();
    const nextRank = String(body?.rank ?? '').trim();
    const nextDept = String(body?.dept ?? '').trim();
    if (!nextRank && !nextDept) {
      return NextResponse.json({ success: false, error: '변경할 내용을 입력해 주세요.' }, { status: 400 });
    }
    // Department determines a leader's authority. Only administrators may change it.
    if (nextDept && nextDept !== session.dept && !session.isAdmin) {
      return NextResponse.json({ success: false, error: '소속 변경은 관리자에게 요청해 주세요.' }, { status: 403 });
    }
    const supabase = getAdminClient();
    if (nextRank) {
      const { error } = await supabase.from('sa_profiles')
        .update({ rank: nextRank, updated_at: new Date().toISOString() })
        .eq('id', session.userId);
      if (error) throw error;
    }
    if (nextDept && nextDept !== session.dept && session.empNo) {
      const { error } = await supabase.from('sa_employees')
        .update({ dept: nextDept }).eq('emp_no', session.empNo);
      if (error) throw error;
    }
    return NextResponse.json({ success: true, message: '내 정보가 수정되었습니다.' });
  } catch (error) {
    console.error('[Auth Profile PATCH]', error);
    return NextResponse.json({ success: false, error: publicErrorMessage(error) }, { status: 500 });
  }
}
