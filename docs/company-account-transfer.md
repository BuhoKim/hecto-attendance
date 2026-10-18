# 회사 계정 이전 준비

작성일: 2026-10-15. 아래 최신 진행상태를 기준으로 한다. 초기 준비 기록은 이력을 위해 남겨두었다.

## 최신 진행상태: 회사 서울 DB 검증 복원 완료, 운영 전환 전

### 근태 운영 사이트 회사 DB 전환 완료 (2026-10-15)

- 사용자 지시에 따라 캘린더 수정과 필요한 테스트/로더 3개만 `df50eec`로 커밋하고 회사 GitHub `codex/stable-pullable`에 푸시했다. 나머지 기존 미커밋 파일은 보존했다. 운영 배포는 검증한 소스를 그대로 승격했으며 Git HEAD 전체로 재빌드하지 않았다.
- 승격 직전 원본과 회사 DB의 `sa_*` 업무 테이블 19개를 읽기 전용 트랜잭션으로 건수·행 내용 해시 대조했다. 모두 일치했다. 대상의 새 Auth 세션은 덮어쓰지 않았다.
- `dpl_DMxmWDQNfV5wAtrFdfYRfPehXaCT` 운영 승격 완료. `atdc.hectoqnm.co.kr`, `agitated-raman-alpha.vercel.app` 모두 해당 배포로 연결된 것을 Vercel API로 확인했다. 각 도메인 로그인 화면 HTTP 200 및 기존 캘린더 23개씩 총 46개 HTTP 200/정상 ICS, 전체 부서 1,174건을 확인했다. 구독 토큰·도메인·URL은 바꾸지 않았다.
- 사용자가 PM2를 모두 kill했고 기존 스크립트가 `index.js`라고 확인했다. `sync/index.js`는 직원/세콤/캡스/휴가 통합 워커이며 시작 즉시 실행 후 10분 간격이다. 회사 DB 환경파일과 읽기 전용 `npm run check:supabase` 성공을 전제로 `pm2 start index.js --name hecto-sync`를 안내한다. 출입기록은 복사된 체크포인트 5분 전부터 현재까지 재조회한다. 이 에이전트는 서버 PC에 접속하거나 PM2를 직접 시작하지 않았다. 실제 첫 동기화 성공 확인은 남아 있다.
- 아래 '운영 전환 전/승격 보류' 기록은 이 단계 이전 이력이다. Storage 공개정책, 다른 공존 앱/Edge secrets/cron은 여전히 별도 과제다. 회사 Supabase 프로젝트 전체 이전 완료를 의미하지 않는다.

### 캘린더 1,000건 제한 수정 (2026-10-15, 운영 승격과 별도)

- 사용자는 첫 검증 배포에서 기존 계정 로그인·대시보드 조회가 정상임을 확인했다. 처음에는 현 상태 설명만 요청했으나, 이후 제한 제거를 명시 승인했다.
- `src/lib/icalFeed.js`의 승인 휴가 조회를 고유 ID 오름차순의 500건 단위 페이지 조회로 변경했다. 날짜/부서/재직 조건, 개인용 소속 부서 추적, 기존 URL·UID·환경변수는 유지한다. 중간 페이지 실패 시 일부 일정만 발행하지 않고 기존 오류 경로로 중단한다.
- HTTP 경계만 대체하고 실제 Supabase query builder와 ICS 생성을 실행하는 `test/icalFeedPagination.test.mjs` 8개를 추가했다. 수정 전 1,174건이 1,000건으로 잘리는 실패를 재현했고, 수정 후 전체 테스트 63개·Next.js 빌드·변경 파일 ESLint가 통과했다. 기존 Node 모듈 형식 경고는 별도이며 변경하지 않았다.
- 회사 DB를 읽기 전용으로 조회해 23개 구독을 대조했다. 전체 부서용 1,174개 이벤트가 전부 포함됐고 모든 구독의 누락·초과·중복이 0이었다. 기존에 매칭 직원이 없는 부서 링크 1개는 계속 0건이다.
- 기존 검증 배포의 입력 파일을 상속하고 캘린더 소스 1개와 테스트 1개만 교체한 새 배포: `dpl_DMxmWDQNfV5wAtrFdfYRfPehXaCT`, `https://agitated-raman-1485pi1ln-hecto-qnm.vercel.app`. READY/STAGED, `autoAssignCustomDomains=false`를 확인했다. 688개 입력 중 변경 파일이 위 2개뿐이고 원본 파일 누락이 없음을 SHA-1로 대조했다. 로컬의 다른 미커밋 변경이나 서버 워커 변경을 섞어 배포하지 않았다.
- 실제 새 배포의 기존 구독 토큰 23개를 요청해 모두 HTTP 200/ICS 검증을 통과했다. 전체 부서용은 기존 운영 1,000개 UID를 그대로 포함하면서 누락 174개가 추가돼 1,174건이며 삭제 0건이다. 나머지 22개는 생성 시각과 CLI 개행을 제외한 내용이 기존 운영과 동일했다. 첫 병렬 검사에서 연결 도구 오류가 있어 중단했으며, 토큰 없는 400 응답으로 도구 접근을 확인한 뒤 제한시간을 늘리고 동시 요청을 2개로 줄인 재검사에서 23개 모두 통과했다.
- 운영 도메인 승격과 서버 PM2 재시작은 이 수정 요청에 포함하지 않았다. 서버 동기화는 사용자가 중지한 상태이며 운영 전환 때 재개를 조율해야 한다. 비공개 증빙은 `.migration-private/backups/calendar-pagination-2026-10-15/`에 보관한다.

### 최종 반영 및 검증용 배포 준비 (2026-10-15, 운영 주소 전환 보류)

- GitHub 서버 워커 변경은 `codex/stable-pullable`의 `7ede7b4`로 푸시 완료. 사용자는 서버 PC에서 회사 저장소 인증·pull과 회사 DB 읽기 전용 검사를 완료했고, 최종 전환 준비 중 PM2를 모두 중지했다고 확인했다. 아직 재시작하지 않도록 안내했다.
- Vercel 소유권 이전 후 회사 팀은 `hecto-qnm`, 팀 ID `team_yLe5G18lseR58Ba6LHf1jE2t`이다. 회사 CLI 인증을 `.migration-private/vercel-company`에 별도로 받았고 `.migration-private/vercel-workspace`를 회사 프로젝트에 연결했다. 기존 루트의 `.vercel/project.json`은 아직 개인 팀 정보이므로 기본 옵션으로 배포하지 않는다.
- 중요 정정: `vercel env pull`로 생성한 운영 환경파일은 17개 앱 변수가 모두 sensitive라 값이 빈 문자열이었다. 이 파일은 키 목록/적용범위 보존일 뿐 실제 비밀값 복구용 백업이 아니다. 아래 최초 기록의 '환경변수 백업'은 이 한계를 전제로 읽는다. 비밀값 보호를 해제하거나 빈 값으로 덮어쓰지 않았다.
- 기존 배포의 코드와 기존 환경을 상속하는 API 재배포로 검증용 production:STAGED 배포를 생성했다. ID `dpl_B3xPVeRkGwj5jReWoMcZFca72xXa`, URL `https://agitated-raman-qf9cbx15u-hecto-qnm.vercel.app`. `autoAssignCustomDomains=false`, READY/STAGED 확인. 운영 주소는 여전히 `dpl_CgcbZCSvYvbk11fEL7QVG48sZJJe`를 가리킨다.
- 검증 배포는 DB 연결 3개를 회사 값으로 교체하고, 기존 로컬 원본 서비스 키 fallback을 AUTH_MODE_SECRET / TAXI_AUDIT_TOKEN_SECRET에 명시했다. ICAL_SUBSCRIPTION_SECRET 및 카카오·네이버웍스·SMTP 등 나머지 sensitive 변수는 상속하여 유지했다.
- 향후 운영 배포용 프로젝트 설정에도 위 5개 변수만 sensitive로 반영했다. 기존 17개 중 ICAL/외부 연동 값은 수정하지 않았다. 아직 새 배포를 운영 도메인으로 승격하지 않았다. 따라서 추가 자동 운영 배포도 승인 없이 실행하지 않는다.
- 새 백업: 원본 `.migration-private/backups/2026-10-15T07-11-30-455Z/source.dump`; 회사 DB 갱신 전 `.migration-private/backups/2026-10-15T07-11-40-076Z/target.dump`; PM2 중지 확인 후 최종 원본 `.migration-private/backups/2026-10-15T07-22-59-278Z/source.dump` (SHA-256 `88f47edfdea2fa80ae8224469cc73d6e08e5aa3e9b0b2b8d499c802572fd3f65`).
- 회사 DB가 초기 복원본과 같고 독립 변경이 없음을 먼저 검증했다. 동시 변경 시 중단하는 checksum 검사 및 한 트랜잭션의 DELETE/COPY로 검토한 변경 테이블 10개만 최종 snapshot에 맞춰 갱신했다. 94개 public/Auth 테이블의 행 SHA-256 비교가 모두 일치했다. 원본에는 쓰지 않았다. 증빙은 최종 백업 폴더 `refresh-plan.json`, `refresh-staged-data.sql`, `refresh-verification.json`에 비공개 보관했다. 초기 테이블명 검사 1회 중단은 기존 camelCase 인용 테이블명 허용 후 해결됐고 그 시도에서는 쓰기가 없었다.
- 새 출입 건수 116335, 휴가 1727, 구독 23. 검증 배포에 캘린더 HTTP 요청 전후 회사 DB의 pg_stat_statements 해당 쿼리 호출이 111→112로 늘어 실제 회사 DB 접근을 확인했다.
- public 스키마 anon/authenticated USAGE는 계속 닫혀 있고 cron은 비활성이다. 현재 근태 앱의 실제 DB 접근은 서버 admin client이며 getServerClient의 실제 호출은 발견되지 않았다. 다른 서비스의 일반 클라이언트/API 접근은 별도 전환 때 검토한다. 기존 advisor 알림은 남아 있다.
- 공유캘린더 23개 모두 검증 배포에서 HTTP 200/ICS를 제공한다. CLI 개행과 생성 DTSTAMP를 정규화하면 부서/개인용 22개 내용이 기존 운영과 일치했다. 전체 부서용 1개는 승인 휴가 1174건 중 기존 코드가 API 기본 제한 1000건만 조회함을 확인했다. 기존/회사 배포가 각각 1000개 이벤트를 내보내지만 999개 UID만 공통이고 각 1개가 달랐다. 데이터 유실이 아니라 정렬 없는 제한 조회의 문제이므로 운영 승격은 보류했다.
- 사용자에게 500건씩 안정적으로 페이지 조회하는 제한 보완 및 테스트/재배포를 추가 승인 요청했다. 아직 캘린더 조회 코드는 수정하지 않았다. 검증용 페이지에서 기존 근태 계정 로그인·화면 조회 확인도 요청한 상태다.
- 이번 단계에서도 Storage의 staging 비공개 설정, 외부 Edge secrets/cron, 다른 공존 앱의 운영 연결은 자동 활성화하지 않았다. 전체 회사 프로젝트 이전 완료로 간주하지 않는다.

### 회사 Vercel 팀 지정 및 동기화 전환 보류 (2026-10-15)

- 사용자가 회사 Vercel 팀 주소 `https://vercel.com/hecto-qnm`를 지정했다. 현재 CLI 인증으로는 개인 팀 `nodabons-projects`만 조회되며 회사 scope 접근은 실패한다. 회사 팀이 없다는 의미로 판단하지 않는다.
- 내장 브라우저에서 최초에는 로그인 화면으로 이동했으나 이후 회사 계정 `buhokim` 로그인 및 `HectoQNM` 팀 접근을 확인했다. 팀 선택기에 Hobby로 표시된다. 기존에 별도로 생성된 `hecto-attendance` 프로젝트가 있으며 이번 이전 대상인 `agitated-raman`과 구분한다. 새 프로젝트를 삭제하거나 도메인을 붙이지 않았다.
- Vercel 공식 이전 절차는 실행 계정이 원본 팀 Owner이면서 대상 팀 Member여야 한다. 접근권한을 확보한 뒤 이전 화면에서 도메인·alias·환경변수·Git 연결 보존 항목을 검토한다. 자동 업그레이드나 결제는 실행하지 않는다.
- 운영 Production 환경변수는 보호된 `.migration-private/` 백업에 보존했다. 실제 값은 이 문서에 기록하지 않았다. `ICAL_SUBSCRIPTION_SECRET`이 명시적으로 설정되어 있음을 확인했다.
- 사용자가 MySQL 동기화는 별도 서버 PC에서 실행 중이며 스크립트 수정은 추후 진행하도록 요청했다. 지금은 서버 동기화 코드·설정과 운영 웹앱 DB 연결을 변경하지 않는다. 회사 DB는 검증용 복원 상태이며 최종 동기화 전의 운영 DB로 사용하지 않는다.
- Vercel 소유권 이전은 기존 DB 환경변수를 유지한 채 진행할 수 있다. 새 DB 실제 전환은 서버 동기화 및 다른 모든 writer의 전환 시점과 함께 조율해야 한다.
- 서로 다른 소유자 간의 공식 Claim Deployments 경로를 확인해 기존 `agitated-raman`의 이전 요청을 생성했다. 회사 계정 브라우저에서 `HectoQNM` 대상 선택 및 Transfer 버튼이 표시되는 것을 확인했다. 최종 소유권 이전 버튼은 사용자 직접 실행을 요청한 상태다. 코드/수락 URL은 소유권 수락 권한을 담으므로 문서나 Git에 기록하지 않는다. 요청은 24시간 유효하다.
- 이전 직전 기존 프로젝트 ID는 `prj_YojmL3PgRZsBqYrrO04eL0Rhb0x3`, 소유 팀은 `team_1kb5oHSjNA4aZBypqRqtlmJL`이었다. 도메인 `atdc.hectoqnm.co.kr`, `agitated-raman-alpha.vercel.app` 모두 verified 상태이며 Git 연결은 `BuhoKim/hecto-attendance`를 가리킨다. 수락 후 이 값들과 환경변수·배포를 재검증한다.
- 공식 다른 계정 수락 흐름: https://vercel.com/docs/deployments/claim-deployments

### GitHub 수락·서버 키 입력 후 추가 완료 (2026-10-15)

- GitHub API가 기존 주소와 새 주소 모두 저장소 소유자를 `BuhoKim/hecto-attendance`로 반환했다. 수락 완료를 확인했다.
- 로컬 origin을 `https://github.com/BuhoKim/hecto-attendance.git`로 변경하고 새 주소에서 main 및 codex/stable-pullable ref가 조회되는 것을 확인했다. 임의 커밋·푸시는 하지 않았다.
- 회사 서울 서버 키로 실제 파일 90개를 버킷 3개에 업로드하고 모두 다시 다운로드했다. 90개 전체가 백업의 SHA-256과 크기에 일치했다. 원본 소유자·사용자 메타데이터·백업 시점 timestamp도 복원·비교했다. 내부 backing-object ID는 새 Storage가 부여한 값을 유지하며 이전/새 ID 대응은 비공개 검증 manifest에 있다.
- 파일 검증 결과: `.migration-private/backups/2026-10-15T06-07-42-130Z/storage/final-verification.json`. 파일90, 버킷3, 공개 버킷0, anon/authenticated public-schema USAGE 없음, 활성 cron0개.
- 새 서비스 키로 sa_employees(113), sa_attendance(116311), sa_leaves(1727), sa_profiles(16), sa_ical_subscriptions(23) Data API 조회가 모두 성공하고 baseline 건수에 일치했다.
- 원본/대상 Auth admin API에 표시되는 사용자 20명의 UUID 집합이 동일함을 확인했다. DB에는 원본/대상 모두 auth.users 21행이다. 원본부터 instance_id=NULL인 레거시 행 1개가 있어 raw DB 건수와 API 표시 건수가 다르며, 이전 누락이 아니다. 레거시 행을 임의 수정하지 않았다.
- 캘린더의 직원 참조와 프로필의 Auth 참조 누락 0건을 확인했다. 비밀번호 로그인·실제 메일/콜백 호출은 하지 않았다.
- 운영 사이트·서버 동기화·Vercel 환경변수는 아직 원본 DB 연결 그대로다. 아래 서버 키 입력/이전 수락 필요라는 최초 기록은 이 단계에서 해결됐다.

- 실제 비밀번호·공식 CA를 사용해 원본과 회사 서울 DB에 `verify-full` 수준으로 접속했다. `.env.migration.local`의 특수문자 비밀번호는 메모리에서 URL 인코딩했다.
- `.migration-private/`는 Git ignore에 추가하고 Windows ACL을 현재 사용자로 제한했다. 이 폴더의 파일은 커밋·푸시하지 않는다. 기존 공개 Git 저장소에 데이터나 백업을 추가하지 않았다.
- PostgreSQL 공식 Windows 배포본 17.11을 공급사 EDB에서 내려받아 client 도구만 사용했다. 시스템 DB 서버를 설치하거나 서비스를 추가하지 않았다.
- 원본 전체 DB를 일관된 snapshot으로 백업: `.migration-private/backups/2026-10-15T06-07-42-130Z/source.dump`, 3,719,948 bytes, SHA-256 `c5889e8f602f05458bcfb7b13eb1ca45972202454ff4b41e39f28f41dbdd4334`. 107개 테이블이 baseline manifest에 기록됐다.
- 회사 대상의 복원 전 상태도 별도 백업: `.migration-private/backups/2026-10-15T06-09-23-774Z/target.dump`.
- 서울 대상 `qcpqcuzvirmbjzqjzapt`에 public 68개 테이블, 로그인 계정 21개와 연관 Auth 데이터, 업무 함수·인덱스·정책·migration history를 한 트랜잭션으로 복원했다. 플랫폼 관리 Auth/Storage 스키마 정의와 auth.schema_migrations는 덮어쓰지 않았다.
- `verify-staged.mjs`가 백업 snapshot의 94개 public/Auth 테이블을 COPY 행 내용의 정렬된 SHA-256과 건수로 비교했다. 모두 일치했다. public 68개 테이블 정확한 건수도 모두 일치했다. 원본 운영 DB는 계속 바뀔 수 있으며 최신 원본과 일치한다는 뜻은 아니다.
- 새 DB의 public 스키마는 `anon`, `authenticated`, `PUBLIC` USAGE를 회수해 staging 동안 일반 Data API 접근을 막았다. 예약작업 활성 건수 0개 확인. 서비스 연결 전 이 접근 제한을 의도한 정책에 맞춰 재검토해야 한다.
- 복원 후 Supabase security advisor를 실행했다. RLS 비활성, 함수 search_path/SECURITY DEFINER 실행권한, public 확장 등 7개 유형의 알림이 반환됐다. 원본 정책을 임의 변경하지 않았으며 staging 스키마 접근은 닫혀 있다. 운영 API 접근을 열기 전에 검토한다. RLS 검사 설명: https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- 원본에만 있던 `hr_hub_readonly` 역할은 grant 복원을 위해 새 DB에 NOLOGIN/NOBYPASSRLS 상태로 준비했다. 외부 HR 연동 계정 활성화는 아직 안 했다. 원본 관리자인 supabase_admin의 기본권한 3개는 새 플랫폼 관리 영역이므로 덮어쓰지 않았다.
- 원본 Vault 설정 1개는 지원되는 vault.create_secret으로 이름과 비밀값을 보존해 새 DB 키로 다시 암호화하고 복호화 결과 일치를 확인했다. Vault UUID는 새로 할당됐다. 원본 public 함수/cron에서 옛 Vault UUID를 직접 참조하지 않음을 확인했으나 다른 외부 소비자의 UUID 사용 여부는 별도 확인 필요.
- 실제 Storage 파일 90개/버킷 3개를 전부 다운로드하고 SHA-256을 기록했다. 파일 총량 160,725,371 bytes. 백업 파일은 위 snapshot 폴더의 storage 하위에 있으며 Storage 백업은 DB snapshot과 별도 시점이다. 이후 회사 Storage 업로드·검증까지 완료했다.
- Edge Functions 4개를 회사 프로젝트에 배포했고, 각 파일 내용과 verify_jwt 설정이 원본과 모두 일치함을 재조회로 확인했다. 관련 사용자 지정 secrets는 아직 이전하지 않았고 함수 호출·메일 발송은 실행하지 않았다. 초기의 JWT 설정 변경 배포 거절은 원본 인증 설정을 확인해 그대로 배포함으로써 해결됐다.
- daily-late-mail 원본 인증 조건에 임의 Bearer 문자열도 허용하는 분기가 확인됐다. 원본을 임의 수정하지 않았다. 회사 운영 secrets·예약 작업 활성화 전에 인증 조건 보완 여부를 검토해야 한다.
- Git 전체 이력 bundle을 만들고 git bundle verify를 통과했다. 미커밋·신규 작업 파일 682개를 별도 worktree 백업에 보존했다. 기존 삭제 경로 23개도 manifest에 기록했다. 일괄 커밋·푸시는 하지 않았다.
- 원본 GitHub는 공개 저장소이며 로그인 nodAbon의 관리자 권한을 확인했다. 사용자 지정 BuhoKim은 User 계정이다. 이전 요청 접수 후 BuhoKim의 수락과 새 소유자를 확인했다. 공개 여부는 유지했고 로컬 remote는 새 주소로 변경했다.

### 사용자 조치 완료

GitHub 이전 수락과 TARGET_SUPABASE_SERVICE_ROLE_KEY 입력을 완료했고 실제 접근으로 검증했다. 해당 키 값은 채팅/문서/Git에 기록하지 않았다.

### 아직 완료하지 않은 작업

- Storage의 운영 접근설정 적용: 현재 staging 버킷은 비공개이며 원본 공개설정은 manifest로 보존했다. 파일 자체 업로드와 해시검증은 완료됐다.
- Auth 설정/SMTP/provider/redirect URL, Edge Function secrets, Cron 원본 1개, 외부 callback 허용목록, 다른 서비스의 앱별 비밀설정 이전.
- source DB에 새로 발생한 변경분의 최종 동기화와 모든 writer의 전환 시점 조율.
- Vercel 전체 연관 앱, 사내 PM2/스케줄러, 네이버웍스 callback URL과 API 키 전환, iCal 서명 secret·도메인 유지, 실제 로그인·기능 검증.
- Vercel 회사 소유권 지정/이전 및 새 GitHub 자동배포 연결 점검. 기존 운영 도메인이나 환경변수는 아직 바꾸지 않았다.

실행 도구는 `scripts/migration/`에 있다. 백업/스테이징 스크립트는 이번 프로젝트 ref와 snapshot에 묶여 있으며 범용 자동 이전 도구가 아니다. `stage-database.mjs`는 비어 있는 대상만 허용하므로 현재 상태에서 재실행하면 중단된다.

## 확정된 사용자 요청 및 현재 실행 상태

### 연결 재확인 결과 (2026-10-15)

#### 서울 대상 생성 후 점검

- 사용자 접속정보 저장 후 점검: 양쪽 URI의 프로젝트 식별자는 올바르게 입력됐다. 비밀번호에 URL 예약문자가 있어 URI 파싱 오류가 발생했으며, 원본 비밀번호를 출력/변경하지 않고 메모리에서 인코딩하는 보완을 추가했다.
- 네트워크 승인 후 원본 연결은 `SELF_SIGNED_CERT_IN_CHAIN`으로 인증 전 중단됐다. `.env.migration.local`의 `MIGRATION_CA_FILE`에 공식 대시보드 Database Settings → SSL Configuration에서 다운로드한 Supabase CA 파일 경로가 필요하다. TLS 인증서 검증은 유지했다.
- 내장 브라우저 대시보드 세션은 로그아웃 상태로 바뀌어 인증서를 자동 다운로드하지 못했다. 공식 인증서 확보 전 DB 비밀번호 유효성, 테이블 직접 조회, export/restore는 미검증이다.

- 최종 대상: `Hecto Q&M Seoul`, ref `qcpqcuzvirmbjzqjzapt`, URL `https://qcpqcuzvirmbjzqjzapt.supabase.co`. 회사 조직 소유, 서울 `ap-northeast-2`, ACTIVE_HEALTHY 확인.
- 원본 PostgreSQL 17.6.1.121, 대상 17.11.0.003으로 둘 다 major 17이다. 확장과 관리 스키마 차이는 별도로 검증한다.
- 원본 public 일반/파티션 테이블 68개, Auth 사용자 21개, Storage 버킷 3개/객체 메타데이터 90개를 SQL 집계로 확인했다.
- 대상 public 테이블/Auth 사용자/Storage 버킷/객체는 모두 0개다.
- 원본 추가 확장: `pg_trgm`, `pg_cron`, `pg_net`. 대상에는 아직 없다. 원본에 `supabase_migrations`, `cron`, `net` 스키마가 존재한다.
- 대상 Session pooler URI의 호스트 `aws-0-ap-northeast-2.pooler.supabase.com`, 포트 5432, 사용자 `postgres.qcpqcuzvirmbjzqjzapt`를 공식 대시보드 Connect에서 확인했다.
- `.env.migration.local`은 Git ignore 대상인 별도 접속정보 양식이다. 기존 앱 `.env.local` 및 sync 환경은 바꾸지 않았다. 원본/대상 접속 문자열을 사용자 로컬에서 입력해야 한다. Source URI는 원본 프로젝트 Connect → Direct → Session pooler에서 가져온다. URI 비밀번호 내 특수문자는 percent encoding한다.
- 읽기 전용 점검 도구: `node scripts/migration/preflight.mjs` 또는 `node scripts/migration/preflight.mjs --counts`. 대상 ref를 검사하고 인증서 검증을 유지하며 행 본문과 인증정보를 출력하지 않는다. 원본/대상은 서로 다른 snapshot이며 건수 일치만으로 복원 완료를 보증하지 않는다.
- 점검 스크립트의 실제 접속 실행은 비밀번호 입력 전이라 미완료다. DB 덤프·파일 복사·함수 배포·운영 전환도 미실행이다.

- 사용자 확정: 회사 조직에 서울 `ap-northeast-2` 리전 프로젝트를 새로 만들어 전체 이전한다. 기존 싱가포르 대상은 삭제하지 않는다.
- 회사 조직 `Hecto Q&M`은 Free 요금제이며, 현재 회사 연결에서 조회되는 프로젝트는 싱가포르 대상 1개다.
- 생성 전 비용 조회 도구가 `get_cost was not returned by tools/list` 오류를 반환했다. 비용을 추정하거나 확인 ID를 임의 생성해 프로젝트 생성하지 않았다.
- 대안으로 공식 대시보드를 열었으나 내장 브라우저는 로그인되어 있지 않다. 회사 계정 로그인 화면을 사용자 이어하기로 남겼다. connector 인증과 브라우저 로그인은 별도다. 서울 프로젝트 생성 및 데이터 복원은 아직 수행하지 않았다.

- 회사 연결 `QNM`으로 대상 `ktdameqhgnlpfznfjgxi` 접근 성공. 개인 연결 `Primary`로 원본 `gbfoempwoeurhhlxqxgy` 접근 성공. 아래의 기존 권한 없음 기록은 해소됐다.
- 대상 프로젝트명: `HectoQ&M's Project`, 상태 ACTIVE_HEALTHY, PostgreSQL 17.11.0.003.
- 대상 public 테이블 0개, Auth 사용자 0개, Storage 버킷/객체 0개, Edge Functions 0개를 조회로 확인했다. 다른 사용자 스키마 존재 여부는 별도 확인해야 한다.
- 원본 리전은 서울 `ap-northeast-2`, 대상 리전은 싱가포르 `ap-southeast-1`이다. 개인정보 저장 지역이 달라지므로 실제 복사 전에 사용자에게 기존 대상 사용 또는 서울 리전 새 대상 사용을 확인한다. 새 유료 프로젝트 생성은 비용 확인 절차를 거친다.
- 이 점검에서는 복사/복원/운영 연결 변경을 하지 않았다.

- GitHub 대상: `BuhoKim`.
- Supabase 대상: `https://ktdameqhgnlpfznfjgxi.supabase.co` (ref `ktdameqhgnlpfznfjgxi`).
- 이전 범위: 기존 공유 프로젝트의 전체 서비스. 근태 `sa_*`로 제한하지 않는다.
- 새 프로젝트로 전체 복원하는 경로를 우선 준비한다. 아래 A/B는 대안 비교를 위한 최초 조사 기록이다. 새 프로젝트 접근·기존 데이터·호환성 확인 후 복원 방식을 확정한다.
- 대상 프로젝트 조회 결과: 현재 Supabase 연결 계정에 권한 없음. 원본에는 접근할 수 있지만 대상의 소유 조직·플랜·리전·데이터 유무는 확인하지 못했다.
- 원본에서 개인정보를 출력하지 않는 COUNT로 확인: Auth 사용자 21개, Storage 버킷 3개, storage.objects 메타데이터 90개. 객체 파일 실재 여부·전체 크기는 별도 확인 필요.
- 원본 Edge Functions 4개: `naverworks-bot-callback`, `send-late-alert`, `naverworks-oauth-callback`, `daily-late-mail`. 함수 코드·secrets·JWT 검증 설정과 외부 callback URL을 이전하고, 알림/메일 작업은 전환 전에 중복 실행되지 않도록 제어한다.
- 로컬 PATH에서는 Supabase CLI, pg_dump, psql, Docker가 발견되지 않았다. 실제 export/restore 전 실행 도구와 호환 버전을 마련한다.
- 다음 선행조치: 회사 조직에 현재 연결된 Supabase 계정을 초대하거나, 이 작업의 Supabase 연결을 회사 계정으로 인증하고 원본/대상 양쪽 접근을 확보한다. 비밀번호나 secret key를 채팅으로 전달하지 않는다.
- URL만으로 DB 복원 권한을 얻을 수 없다. 대상 접근 확보 전 개인정보 덤프·복사·대상 DDL·운영 환경변수 변경·원본 삭제는 수행하지 않았다.
- 실제 복원 절차는 Supabase 공식 CLI backup/restore 가이드에 맞춰 관리 스키마 사용자 변경, Auth, Storage 파일, migration history, Vault/암호화 의존성, extensions, Realtime, Cron과 외부 연동을 포함한다. DB 덤프에 Storage 파일 내용이나 서비스 설정까지 포함된다고 가정하지 않는다.

공식 전체 복원 가이드: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## 확인된 현황

- Git 원격: `https://github.com/nodAbon/hecto-attendance.git`.
- 사용자가 지정한 GitHub 이전 대상: `BuhoKim` (`https://github.com/BuhoKim`). 예정 저장소 주소는 `https://github.com/BuhoKim/hecto-attendance`이며 아직 이전하지 않았다. 대상의 비공개 동일명 저장소 유무와 이전 수락 가능 여부는 대상 계정에서 확인해야 한다.
- 로컬 Vercel 연결: `agitated-raman`, 운영 도메인 `atdc.hectoqnm.co.kr`.
- Supabase 프로젝트: `Asset Management`, ref `gbfoempwoeurhhlxqxgy`, 서울 리전. 연결 계정에서 확인된 조직은 개인 조직 한 개뿐이다.
- public 스키마에는 `sa_*` 근태 외에 `antigravity_*`, `codex_*`, `budgets_*`, `cont_*`, `db_*` 등 여러 앱 데이터가 공존한다. 프로젝트 이전 범위는 근태 앱보다 크다.
- 직원 로그인은 Supabase Auth를 사용한다. public 테이블만 복사해서는 로그인 이전이 완료되지 않는다.
- 근태 테이블 19개가 메타데이터 조회에서 확인되었다. 행 수는 목록 도구의 추정값이며 검증 기준으로 사용하지 않는다.
- 작업 디렉터리에 미커밋 변경·신규 파일이 다수 있다. GitHub 저장소 이전만으로 이 변경들이 이전되지는 않는다.

개인정보 원본·키 값·실제 구독 토큰은 이 문서에 기록하지 않는다.

## 이전 방식 결정

### A. 기존 프로젝트 전체를 회사 Supabase 조직으로 이전

모든 공존 서비스가 회사 이전 대상이라면 우선 검토한다. Supabase Project Transfer로 프로젝트 자체의 소유 조직을 변경한다. 새 DB 복제 작업을 줄일 수 있다. 회사 계정 초대만으로는 회사 조직 소유가 되는 것이 아니므로, 소유 조직과 결제 주체를 확인해야 한다.

공식 선행조건: 원본 조직 Owner, 대상 조직 Member 이상, 활성 GitHub 통합 없음, 프로젝트 범위 역할 및 Log Drain 등 이전 제한 확인. 대상 요금제에서 기능·프로젝트 수·결제를 확인한다. 유료에서 Free 이전 시 짧은 중단이나 기능 차이가 발생할 수 있다.

이전 전후 프로젝트 ref, API 주소, 접속 설정 및 실제 앱 동작이 같은지 확인한다. 프로젝트 이전과 동시에 키를 무조건 재발급하지 말고 키 교체를 별도 단계로 수행한다.

### B. 현재 근태 시스템만 회사 프로젝트로 분리

다른 앱을 개인 프로젝트에 남겨야 한다면 이 경로를 선택한다. 대상 회사 프로젝트를 지정한 뒤 스키마·의존성·Auth·설정을 함께 이전한다.

대상 후보: `sa_employees`, `sa_attendance`, `sa_leaves`, `sa_profiles`, `sa_overtime_settings`, `sa_overtime_periods`, `sa_attendance_corrections`, `sa_schedule_overrides`, `sa_holiday_work`, `sa_manual_checkins`, `sa_leave_backfill_queue`, `sa_employee_schedules`, `sa_team_schedule_patterns`, `sa_attendance_log_adjustments`, `sa_employee_overtime_rounds`, `sa_ical_subscriptions`, `sa_push_subscriptions`, `sa_taxi_explanations`, `sa_sync_checkpoints`.

실제 조회에서 확인한 `sa_*`는 위 19개다. 신규 테이블 유무를 전환 직전에 다시 조회한다. 이름 접두사만으로 범위를 확정하지 않고 FK, 함수, 트리거, 뷰, enum, sequence, 확장, RLS, GRANT, publication 의존성을 확인한다.

Auth 사용자를 이메일로 새로 생성하면 UUID가 바뀌므로 금지한다. `sa_profiles.id`, 캘린더 생성자 등 UUID 참조를 보존할 수 있는 Auth 이전 절차를 검증한다. 공용 Auth에서 다른 서비스 사용자까지 옮기지 않도록 사용자·연관 identity·FK 범위를 별도로 설계한다. 새 프로젝트에서는 기존 세션 유지 여부를 검증하고 필요하면 재로그인을 안내한다.

`supabase/schema.sql`만 실행해서 전체 운영 스키마가 복구된다고 가정하지 않는다. 운영 DB와 로컬 migration 사이 차이를 먼저 확인한다. Storage/Edge Functions/DB Cron/Webhook/SMTP/Auth provider와 redirect URL 설정은 사용 여부를 조사한 뒤 따로 이전한다.

## 실행 순서와 완료 조건

1. 회사 GitHub 대상 계정 또는 Organization, Supabase 대상 Organization, 회사 담당자와 결제 플랜을 확정한다. A/B 경로를 결정한다.
2. 회사 관리자 접근을 확보하고 서비스별 현황·권한·비밀값 이름만 목록화한다. DB 관리 권한과 웹앱 로그인 계정은 구분한다.
3. Git 작업 디렉터리와 원격 차이를 분류한다. 필요한 변경만 검토 후 보존하며 일괄 커밋/푸시하지 않는다. 회사가 승인한 저장 위치에서 Git 백업과 DB 백업을 준비하고 복원 가능성을 확인한다.
4. GitHub Settings → General → Transfer ownership으로 기존 저장소를 회사 소유로 이전한다. 새 저장소에 코드를 단순 복사하는 경로보다 커밋·PR·Issue 이력을 보존하기 쉽다. Private 여부, 회사 기본 접근권한, 브랜치 규칙, GitHub App·웹훅·Actions secret·deploy key를 확인한다. 로컬과 서버 remote URL을 새 주소로 갱신한다.
5. A 경로는 공존 앱 담당자와 함께 Project Transfer를 실행한다. B 경로는 비운영 리허설, 복원 검증, 쓰기 중지, 최종 동기화, 연결 전환 순서로 실행한다. 쓰기 중지에는 웹 수동 입력·API·사내 PM2/작업 스케줄러·재처리 큐 등 모든 writer를 포함한다.
6. Vercel의 소유 팀과 GitHub App 접근을 확인한다. GitHub 저장소 이전이 Vercel 소유권을 자동 이전하지는 않는다. 회사 팀 이전은 별도 지정 후 수행한다. 운영 도메인 및 기존 iCal URL을 보존한다.
7. 로그인/비밀번호 변경/관리자 권한, 직원·출입·휴가·보정·시간외·택시 기능, 개인/부서 캘린더를 확인한다. 읽기 검증은 먼저 수행하고 쓰기 검증은 회사가 지정한 테스트 계정으로 실행한다.
8. 사내 동기화가 올바른 프로젝트로 들어오는지 확인하고 구독 URL에서 예상 부서·휴가가 제공되는지 확인한다. 비동기 구독 서비스의 실제 갱신 시점은 별도로 관찰한다.
9. 검증 후 개인 계정 권한, PAT/CLI 토큰·deploy key, 백업 보관 범위와 삭제 시점을 정리한다. 회사 관리자 접근을 확인하기 전에 기존 접근을 제거하지 않는다.

## 연결 전환 목록

| 위치 | 확인할 항목 |
| --- | --- |
| Vercel Development/Preview/Production | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 중 실제 사용값 |
| 사내 동기화 서버 | `sync/loadEnv.js`가 읽는 환경파일, PM2/작업 스케줄러, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Git remote |
| 캘린더 | `sa_ical_subscriptions` 전체 레코드와 token·owner 참조, 운영 도메인, `ICAL_SUBSCRIPTION_SECRET` |
| 로그인/택시 링크/푸시 | `AUTH_MODE_SECRET`, `TAXI_AUDIT_TOKEN_SECRET`, VAPID 키와 기존 구독 유지 여부 |
| 외부 연동 | MySQL, 네이버웍스, SMTP, 카카오T 설정·권한·허용목록 |

캘린더 토큰 서명 코드는 `ICAL_SUBSCRIPTION_SECRET` 미설정 시 Supabase service-role key 등으로 fallback한다. 현재 운영 환경에서 무엇이 적용되는지 값 노출 없이 확인해야 한다. DB 키 교체 전에 기존 캘린더 서명 검증에 미치는 영향을 점검한다. 서명 secret과 호스트를 바꾸면 기존 공유 URL이 깨질 수 있다.

## 백업·검증·복구

- 데이터 덤프나 `.env`를 Git에 넣지 않는다. 이 준비 과정에서는 덤프를 생성하지 않았다. 회사 지정 암호화 저장소·담당자·보관기간을 정한 뒤 백업한다.
- 이전 전 기준: 테이블별 정확한 COUNT, PK 범위, 날짜 범위, NULL/중복/FK 참조, RLS·권한·함수 정의, Auth UUID 대응을 기록한다. 필요하면 일관된 snapshot 기준으로 개인정보를 출력하지 않는 집계/해시 비교를 설계한다.
- 이전 후 기준: snapshot 또는 최종 쓰기 중지 시점을 맞춰 같은 지표를 비교한다. 운영 중 발생한 새 행을 손실로 오인하지 않는다.
- B 경로에서 전환 후 새 쓰기가 있으면 단순히 옛 DB로 되돌릴 수 없다. 모든 writer를 멈추고 대상에서 발생한 변경을 보존·대사한 다음 복구한다. 검증 완료 전 원본 프로젝트를 삭제하지 않는다.

## 추가 발견 및 미확인 항목

- 메타데이터 조회에서 공존 서비스의 `cont_documents`, `cont_document_versions`, `cont_document_extractions`, `cont_audit_logs`, `db_attendance_notes`에 RLS가 꺼져 있었다. 실제 노출은 role GRANT와 API 설정도 확인해야 한다. 자동 수정은 하지 않았다. 공존 서비스 담당자가 접근정책을 검토해야 한다.
- GitHub 저장소 공개 여부·원격 최신 HEAD와 로컬 일치 여부, 전체 Git 이력 내 비밀값/개인정보, 회사 계정 접근, Vercel 환경변수 실제 값, 백업 복원, Storage/Auth 규모는 아직 검증하지 않았다.
- 새 회사 DB로 분리하는 export/import 스크립트는 대상과 범위가 확정된 뒤 작성한다. 공용 프로젝트 전체를 무심코 복사하는 스크립트는 준비하지 않는다.

## 공식 문서

- Supabase Project Transfer: https://supabase.com/docs/guides/platform/project-transfer
- GitHub Repository Transfer: https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository
