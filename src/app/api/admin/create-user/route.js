import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseClient';
import { verifySession } from '@/lib/auth';

const COMPANY_CODE = '1600';

function normalizeEmpNo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  if (digits.length >= COMPANY_CODE.length + 8 && digits.startsWith(COMPANY_CODE)) {
    const empNo = digits.slice(COMPANY_CODE.length).replace(/^0+/, '') || digits.slice(COMPANY_CODE.length);
    return empNo.padStart(8, '0');
  }

  if (digits.length <= 8) {
    return digits.replace(/^0+/, '') || digits;
  }

  return digits.slice(-8);
}

// Admin API for creating employee accounts
export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const supabase = getAdminClient();

    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const { empNo, name = '', tempPassword, isAdmin = false, userId, rank = '', position = '', team = '' } = await request.json();
    const normalizedEmpNo = normalizeEmpNo(empNo);

    if (!normalizedEmpNo || !tempPassword) {
      return NextResponse.json({ error: '사원번호와 임시 비밀번호를 입력해주세요.' }, { status: 400 });
    }

    if (tempPassword.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    // sa_employees is the local employee master for both Secom and Caps staff.
    // If the employee does not exist yet, create the row so accounts can still be linked.
    const { data: existingEmployee, error: employeeLookupErr } = await supabase
      .from('sa_employees')
      .select('emp_no, name, dept, email, login_id, company_code, is_active')
      .eq('emp_no', normalizedEmpNo)
      .maybeSingle();

    if (employeeLookupErr) {
      return NextResponse.json({ error: `직원 정보 조회 실패: ${employeeLookupErr.message}` }, { status: 500 });
    }

    const finalUserId = userId?.trim() || existingEmployee?.login_id || normalizedEmpNo;
    const email = existingEmployee?.email || `${finalUserId}@hecto.internal`;

    const cleanName = name.trim();
    const cleanTeam = team.trim();

    const employeePayload = {
      emp_no: normalizedEmpNo,
      name: cleanName || existingEmployee?.name || '',
      dept: cleanTeam || existingEmployee?.dept || '',
      email,
      login_id: finalUserId,
      company_code: COMPANY_CODE,
      is_active: true,
      synced_at: new Date().toISOString(),
    };

    const { error: employeeUpsertErr } = await supabase
      .from('sa_employees')
      .upsert(employeePayload, { onConflict: 'emp_no' });

    if (employeeUpsertErr) {
      return NextResponse.json({ error: `직원 정보 저장 실패: ${employeeUpsertErr.message}` }, { status: 500 });
    }

    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u) => u.email === email);
    if (existing) {
      return NextResponse.json({ error: `아이디 사원번호(${finalUserId}) 계정이 이미 존재합니다.` }, { status: 409 });
    }

    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createErr) {
      return NextResponse.json({ error: `계정 생성 실패: ${createErr.message}` }, { status: 500 });
    }

    const { error: profileErr } = await supabase.from('sa_profiles').insert({
      id: newUser.user.id,
      emp_no: normalizedEmpNo,
      is_admin: isAdmin,
      rank,
      position,
      must_change_password: true,
    });

    if (profileErr) {
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json({ error: `프로필 생성 실패: ${profileErr.message}` }, { status: 500 });
    }

    let backfillQueued = true;
    let backfillQueueError = '';
    const { error: queueErr } = await supabase
      .from('sa_leave_backfill_queue')
      .upsert({
        emp_no: normalizedEmpNo,
        status: 'pending',
        requested_by: session.userId,
        requested_at: new Date().toISOString(),
        processed_at: null,
        last_error: null,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'emp_no' });

    if (queueErr) {
      backfillQueued = false;
      backfillQueueError = queueErr.message;
      console.warn('[Create User API] leave backfill queue failed:', queueErr.message);
    }

    const successMessage = `${employeePayload.name || normalizedEmpNo}(${normalizedEmpNo}) 계정이 생성되었습니다. 최초 로그인 시 비밀번호 변경이 필요합니다.`;

    return NextResponse.json({
      success: true,
      message: backfillQueued
        ? `${successMessage} 연차 사용내역 백필이 요청되었습니다.`
        : `${successMessage} 단, 연차 백필 요청은 실패했습니다: ${backfillQueueError}`,
      empNo: normalizedEmpNo,
      name: employeePayload.name || '',
      backfillQueued,
    });
  } catch (err) {
    console.error('[Create User API]', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
