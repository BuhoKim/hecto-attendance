import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { parseCapsAttendanceFile } from '@/lib/capsAttendance';

function stripAttendanceSource(rows = []) {
  return rows.map(({ source, ...rest }) => rest);
}

function isMissingAttendanceSourceColumn(error) {
  return String(error?.code || '') === 'PGRST204'
    || String(error?.message || '').toLowerCase().includes('source');
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.text !== 'function') {
      return NextResponse.json({ error: '업로드할 파일을 선택해주세요.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: employees, error: employeesError } = await supabase
      .from('sa_employees')
      .select('emp_no, name, dept')
      .order('name', { ascending: true });

    if (employeesError) {
      return NextResponse.json({ error: `직원 목록 조회 실패: ${employeesError.message}` }, { status: 500 });
    }

    const parsed = await parseCapsAttendanceFile(file, employees || []);
    if (!parsed.rows.length) {
      if (parsed.sampleErrors?.length) {
        return NextResponse.json({
          error: '반영할 출입기록이 없습니다. 파일 형식과 헤더를 확인해주세요.',
          sampleErrors: parsed.sampleErrors || [],
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `${file.name || '파일'}에서 반영할 수 있는 캡스 출입기록이 없습니다.`,
        fileName: file.name || 'caps-attendance',
        totalRows: parsed.totalRows,
        importedRows: 0,
        skippedRows: parsed.skippedRows,
        sampleErrors: [],
        source: parsed.source,
        sheetName: parsed.sheetName,
      });
    }

    const batchSize = 500;
    let importedRows = 0;
    const batchErrors = [];

    for (let i = 0; i < parsed.rows.length; i += batchSize) {
      const batch = parsed.rows.slice(i, i + batchSize).map((row) => ({
        ...row,
        source: row.source || 'caps',
      }));

      let { error } = await supabase
        .from('sa_attendance')
        .upsert(batch, { onConflict: 'sabun,a_time' });

      if (error && isMissingAttendanceSourceColumn(error)) {
        ({ error } = await supabase
          .from('sa_attendance')
          .upsert(stripAttendanceSource(batch), { onConflict: 'sabun,a_time' }));
      }

      if (error) {
        batchErrors.push(publicErrorMessage(error, '출퇴근 기록 저장에 실패했습니다.'));
        continue;
      }

      importedRows += batch.length;
    }

    if (!importedRows) {
      return NextResponse.json({
        error: batchErrors.length
          ? `출입기록 반영 실패: ${batchErrors[0]}`
          : '출입기록 반영 실패: 반영 가능한 행이 없습니다.',
        sampleErrors: parsed.sampleErrors,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: batchErrors.length
        ? `${file.name || '파일'}에서 ${importedRows}건의 출입기록을 반영했습니다. 일부 행은 건너뛰었습니다.`
        : `${file.name || '파일'}에서 ${importedRows}건의 출입기록을 반영했습니다.`,
      fileName: file.name || 'caps-attendance',
      totalRows: parsed.totalRows,
      importedRows,
      skippedRows: parsed.skippedRows,
      sampleErrors: parsed.sampleErrors,
      source: parsed.source,
      sheetName: parsed.sheetName,
      warnings: batchErrors,
    });
  } catch (error) {
    console.error('[Admin Caps Attendance Upload]', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
