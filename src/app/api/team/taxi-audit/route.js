import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { isLeaderPosition } from '@/lib/roleUtils';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const isLeader = !!(session.isLeader || isLeaderPosition(session.position) || session.isAdmin);
    if (!isLeader) {
      return NextResponse.json({ error: '팀장 또는 관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const filterDept = String(searchParams.get('dept') || '').trim();
    const targetDept = session.isAdmin ? (filterDept || '') : (session.dept || '');

    const supabase = getAdminClient();
    let query = supabase
      .from('sa_taxi_explanations')
      .select('*')
      .order('requested_at', { ascending: false });

    if (targetDept) {
      query = query.eq('dept', targetDept);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Team Taxi Audit API Error]', error);
      // 테이블 미존재 시 빈 배열 반환
      return NextResponse.json({ success: true, rows: [], dept: targetDept });
    }

    return NextResponse.json({
      success: true,
      dept: targetDept,
      rows: data || [],
    });
  } catch (error) {
    console.error('[Team Taxi Audit Catch]', error);
    return NextResponse.json(
      { error: publicErrorMessage(error, '팀원 소명 내역을 불러오지 못했습니다.') },
      { status: 500 }
    );
  }
}
