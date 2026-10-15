// Read-only preflight. Does not connect to MySQL, write rows, or send notifications.
const { createSyncSupabaseClient } = require('./supabaseClient');

async function main() {
  const supabase = createSyncSupabaseClient();
  console.log('회사 Supabase 연결 확인 (읽기 전용): qcpqcuzvirmbjzqjzapt');
  for (const table of ['sa_employees', 'sa_attendance', 'sa_leaves', 'sa_sync_checkpoints']) {
    const { error, count, status } = await supabase.from(table)
      .select('*', { head: true, count: 'exact' })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) {
      throw new Error(`${table} 조회 실패 (HTTP ${Number(status) || 'unknown'}). 회사 서비스 키·테이블·네트워크를 확인하세요.`);
    }
    console.log(`${table}: ${count}건 조회 가능`);
  }
  console.log('연결 확인 완료. 실제 동기화나 웹사이트 DB 전환은 실행하지 않았습니다.');
}

main().catch((error) => {
  // Configuration/API errors above deliberately contain no credentials or row data.
  console.error(error.message);
  process.exitCode = 1;
});
