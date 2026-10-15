# Hecto 동기화 워커

서버PC 전용입니다. AWS MySQL(VPN)에서 데이터를 읽어서 Supabase로 반영합니다.

## 설치

```bash
cd sync
npm install
cp .env.example .env
```

`sync/` 스크립트는 `sync/.env`, `sync/.env.local`, 상위 폴더의 `.env` / `.env.local`도 함께 읽습니다.

## 회사 Supabase 전환 (2026-10-15)

출입·캡스·직원·휴가 워커와 `index3days` / `index15days` / `index30days`, 백필 워커는
공통 `supabaseClient.js`에서 회사 서울 프로젝트 연결을 검사합니다.
다른 주소·기존 프로젝트의 JWT·anon/publishable 키·누락된 키이면 동기화 전에 중단합니다.
새 `sb_secret_` 키는 내부 프로젝트를 해석할 수 없으므로 아래 읽기 전용 연결 검사도 실행해야 합니다.
MySQL 접속 설정, 조회 범위, 동기화 주기와 체크포인트 처리 방식은 변경하지 않았습니다.

**스크립트 업데이트만으로 운영 이전이 끝나지 않습니다.** 웹사이트가 기존 DB에 연결된 상태에서
서버 워커만 회사 DB로 바꾸면 새 출입·휴가가 운영 화면에 반영되지 않습니다.
최종 변경분 반영 및 웹사이트 DB 전환과 시점을 맞춰 아래 재시작을 진행하세요.
백필·메인 워커를 중복 실행하지 마세요. 이 문서의 명령은 작업자가 서버 PC에서 직접 실행합니다.

### 서버 PC 적용 준비

1. 기존 실행 프로세스/경로는 `pm2 ls`로 확인하고 환경파일을 안전한 비공개 위치에 백업합니다.
2. 저장소 루트에서 `git pull --ff-only origin codex/stable-pullable`을 실행합니다.
   서버 체크아웃도 해당 브랜치여야 하며, 다른 브랜치이면 먼저 확인하세요.
3. 서버의 기존 `sync/.env`에서 아래 두 값만 교체합니다. MySQL·네이버웍스 설정은 유지합니다.
   파일을 예제 전체로 덮어쓰지 마세요. `.env`의 값이 `.env.local`보다 먼저 적용됩니다.

```dotenv
SUPABASE_URL=https://qcpqcuzvirmbjzqjzapt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<회사 서울 프로젝트의 secret 또는 service_role 키>
```

서비스 키는 Supabase 회사 서울 프로젝트에서 가져와 서버 환경파일에만 저장합니다.
브라우저용 anon/publishable 키가 아닙니다. 키를 채팅, Git, 콘솔 명령 이력에 남기지 마세요.

4. `sync` 폴더에서 읽기 전용 검사를 실행합니다. 이 검사는 MySQL 연결이나 DB 쓰기,
   체크포인트 변경, 네이버웍스 알림 발송을 하지 않습니다.

```powershell
npm run check:supabase
```

### 최종 전환 시 PM2 재시작

프로세스 환경변수가 환경파일보다 우선하므로 `--update-env`만 붙였다고 파일을 다시 읽은 값으로
항상 바뀌는 것은 아닙니다. PowerShell에서 회사 URL과 키를 명시적으로 전달합니다.
키는 가려진 입력창으로 받으며 실제 값은 명령 이력에 들어가지 않습니다.

```powershell
$env:SUPABASE_URL = 'https://qcpqcuzvirmbjzqjzapt.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', (Read-Host '회사 Supabase 서비스 키' -AsSecureString)).Password
npm run check:supabase
if ($LASTEXITCODE -ne 0) { throw '회사 Supabase 연결 확인 실패. 재시작하지 마세요.' }

# pm2 ls에서 확인한 기존 워커 이름만 지정합니다. 아래는 통합 워커를 쓰는 경우의 예입니다.
pm2 restart hecto-sync --update-env
# 별도 백필 워커를 사용 중일 때만 추가로 실행:
# pm2 restart hecto-leave-backfill --update-env
pm2 save
Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
```

분리 워커 구성(`ecosystem.config.js`)이면 위 통합 워커 재시작 대신 기존 프로세스
`hecto-sync-attendance`, `hecto-sync-leaves`를 각각 `--update-env`로 재시작합니다.
설정 오류로 중단되면 기존 PM2 환경을 회사 값으로 갱신했는지 먼저 확인합니다.
PM2 환경/덤프 파일에는 서버 키가 저장될 수 있으므로 파일 접근권한과 백업을 관리하세요.

이번 변경은 서버 워커용입니다. 웹사이트의 Vercel 환경변수, DB 최종 변경분 동기화,
Auth/Storage/외부 연동 설정은 이 스크립트가 자동 변경하지 않습니다.
`scripts/diagnostics/`의 별도 진단 도구와 `inspect_db_size.js`도 자동 전환 대상이 아닙니다.

## 실행

```bash
# 메인 동기화
npm run start

# 개발용 watch
npm run dev

# 신규 등록 사번의 연차 백필 큐 처리
npm run backfill:leaves
```

## 조회 도구

```bash
npm run list:hr
npm run list:leave
```

## PM2 예시

```bash
pm2 start index.js --name hecto-sync
pm2 start backfill-leaves.js --name hecto-leave-backfill
pm2 save
pm2 startup
```

## 테이블 역할

| Supabase 테이블 | MySQL 원본 | 용도 |
|---|---|---|
| `sa_employees` | `hr_employee` | 회사 전체 직원 마스터 |
| `sa_attendance` | `t_secom_alarm` | 출입기록 |
| `sa_leaves` | `hr_yuncha_use` | 연차/휴가 내역 |
| `sa_leave_backfill_queue` | `sa_employees` 등록 시 생성 | 신규 등록 사번 연차 보강 큐 |

## 운영 메모

- `I_COMPANY = 1600`만 사용합니다.
- 메인 sync는 계속 MySQL -> Supabase 단방향으로 동작합니다.
- `sa_leave_backfill_queue`에 쌓인 사번은 `backfill-leaves.js`가 MySQL에서 재조회해 `sa_leaves`에 반영합니다.
- Supabase에 `supabase/migrations/20260527_create_leave_backfill_queue.sql`을 먼저 적용해야 백필 아이콘과 워커가 정상 동작합니다.
- `.env`는 git에 포함하지 않습니다.
