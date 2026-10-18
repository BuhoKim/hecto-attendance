import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { isAdminRole } from '@/lib/roleUtils';
import { pickLatestProfile } from '@/lib/adminEmployeeProfile';

const normalizeEmpNo = (value) => String(value ?? '').trim();

async function findAuthUserByEmpNo(supabase, empNo) {
  const target = normalizeEmpNo(empNo);
  if (!target) return null;

  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) return null;
    const users = data?.users || [];
    return users.find((user) => {
      const localPart = String(user?.email || '').split('@')[0];
      return localPart === target || normalizeEmpNo(localPart) === target;
    }) || null;
  } catch {
    return null;
  }
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

    const supabase = getAdminClient();
    const [empRes, profileRes] = await Promise.all([
      supabase.from('sa_employees').select('emp_no, name, dept, email, login_id, status, is_active').order('name', { ascending: true }),
      supabase.from('sa_profiles').select('id, emp_no, rank, position, is_admin, must_change_password'),
    ]);

    if (empRes.error) {
      return NextResponse.json({ error: publicErrorMessage(empRes.error, '직원 조회에 실패했습니다.') }, { status: 500 });
    }
    if (profileRes.error) {
      return NextResponse.json({ error: publicErrorMessage(profileRes.error, '프로필 조회에 실패했습니다.') }, { status: 500 });
    }

    let userMap = new Map();
    try {
      const { data: userData, error: userErr } = await supabase.auth.admin.listUsers();
      if (!userErr) {
        userMap = new Map((userData?.users || []).map((user) => [user.id, user]));
      }
    } catch (userListErr) {
      console.warn('[Admin Employees GET] user list skipped:', userListErr.message);
    }

    // Keep the most recent row for each emp_no if duplicates exist.
    const profilesByEmployee = new Map();
    for (const profile of profileRes.data || []) {
      const profiles = profilesByEmployee.get(profile.emp_no) || [];
      profiles.push(profile);
      profilesByEmployee.set(profile.emp_no, profiles);
    }

    const employees = (empRes.data || []).map((emp) => {
      const profile = pickLatestProfile(profilesByEmployee.get(emp.emp_no));
      const user = profile ? userMap.get(profile.id) : null;
      return {
        empNo: emp.emp_no,
        name: emp.name || '',
        dept: emp.dept ?? '',
        email: emp.email || user?.email || '',
        loginId: emp.login_id || (user?.email ? user.email.split('@')[0] : ''),
        rank: profile?.rank ?? '',
        position: profile?.position ?? '',
        isAdmin: isAdminRole(profile || {}),
        mustChangePassword: !!profile?.must_change_password,
        hasAccount: !!profile,
        profileId: profile?.id || null,
        status: emp.status || 'active',
        isActive: emp.is_active !== false,
      };
    });

    return NextResponse.json({ success: true, employees });
  } catch (err) {
    console.error('[Admin Employees GET]', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const {
      empNo,
      profileId = '',
      name = '',
      dept = '',
      rank = '',
      position = '',
      isAdmin = false,
      status,
    } = await request.json();

    if (!empNo) {
      return NextResponse.json({ error: '사원번호가 필요합니다.' }, { status: 400 });
    }

    const supabase = getAdminClient();

    let existingProfile = null;
    let profileFindErr = null;
    if (profileId) {
      const result = await supabase
        .from('sa_profiles')
        .select('id, emp_no')
        .eq('id', profileId)
        .maybeSingle();
      existingProfile = result.data || null;
      profileFindErr = result.error || null;
    } else {
      const result = await supabase
        .from('sa_profiles')
        .select('id, emp_no')
        .eq('emp_no', empNo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingProfile = result.data || null;
      profileFindErr = result.error || null;
    }

    if (profileFindErr) {
      return NextResponse.json({ error: `프로필 확인 실패: ${profileFindErr.message}` }, { status: 500 });
    }

    const updateEmployeePayload = {};
    if (name !== '') updateEmployeePayload.name = name;
    if (dept !== '') updateEmployeePayload.dept = dept;
    if (status !== undefined) {
      updateEmployeePayload.status = status;
      updateEmployeePayload.is_active = (status === 'active');
    }

    if (Object.keys(updateEmployeePayload).length > 0) {
      const { error: empErr } = await supabase
        .from('sa_employees')
        .update(updateEmployeePayload)
        .eq('emp_no', empNo);
      if (empErr) {
        return NextResponse.json({ error: `직원 정보 수정 실패: ${empErr.message}` }, { status: 500 });
      }
    }

    const updateProfilePayload = {
      emp_no: empNo,
      rank: rank || '',
      position: position || '',
      is_admin: !!isAdmin,
      updated_at: new Date().toISOString(),
    };

    if (existingProfile?.id) {
      const { error: profileErr } = await supabase
        .from('sa_profiles')
        .update(updateProfilePayload)
        .eq('id', existingProfile.id);
      if (profileErr) {
        return NextResponse.json({ error: `프로필 수정 실패: ${profileErr.message}` }, { status: 500 });
      }
    } else if (isAdmin) {
      const authUser = await findAuthUserByEmpNo(supabase, empNo);
      if (!authUser?.id) {
        return NextResponse.json({
          error: '이 직원은 아직 로그인 계정이 없어 관리자 권한을 저장할 수 없습니다. 먼저 계정을 생성해주세요.',
        }, { status: 400 });
      }

      const { error: profileErr } = await supabase
        .from('sa_profiles')
        .upsert({
          id: authUser.id,
          ...updateProfilePayload,
          must_change_password: false,
        }, { onConflict: 'id' });
      if (profileErr) {
        return NextResponse.json({ error: `프로필 생성 실패: ${profileErr.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, message: '직원 정보가 수정되었습니다.' });
  } catch (err) {
    console.error('[Admin Employees PATCH]', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
