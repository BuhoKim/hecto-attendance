# 인사 허브 전송

`hrHubSync.js`는 기존 `hecto-sync`와 별도의 PM2 프로세스다. 원본 MySQL에서 세콤·캡스 출입을 3분마다 조회한다. 최초 한 번은 최근 3일을 조회하고, 이후 마지막 성공 시각보다 5분 앞부터 조회해 중복 무시 방식으로 보낸다. 모든 전송이 성공한 뒤에만 `%LOCALAPPDATA%\hecto-sync\hr-hub-attendance-checkpoint.json`의 시각을 갱신한다. 오류나 재시작 뒤에는 저장된 시각부터 다시 보낸다. 별도 원본 DB 연결과 대상 전송이 성공하면, 총무 Supabase 연결이 끊겨도 이 경로는 동작한다. 서버 중단이나 대상 장애로 3일을 넘겨 늦어진 출입기록은 인사 허브에서 자동 재계산되지 않는다.

총무 Supabase에만 있는 직원, 휴가 및 근무표 4개 테이블은 30분마다 각각 전체를 읽고, 두 번 읽은 내용이 같을 때 한 번의 요청으로 교체한다. 읽기 실패, 빈 테이블이나 결과 변경은 해당 교체를 건너뛰고 재시도한다. 한 테이블의 실패는 다른 테이블을 중단하지 않는다. 출입기록은 원본의 최근 3일 자료도 확인하여, 총무 DB에 아직 없는 기록은 인사 허브로 추가 전송하고 전체 보정은 보류한다. 총무 DB에 원본 기록이 모두 들어 있으면 하루 한 번 전체 보정한다. 보정과 네 테이블 전송은 총무 DB가 연결돼야 한다.

## 서버 PC 설치

기존 `hecto-sync`를 실행하는 **동일 Windows 계정**에서 프로젝트 폴더로 이동해 최신 코드를 받는다. 해당 계정의 Windows 암호화 저장소에 전용 키를 입력한다. 키를 터미널에 붙여넣을 때 입력 문자는 보이지 않는다. 다른 사용자 계정은 이 파일을 복호화할 수 없다.

```powershell
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git 업데이트 실패' }
$keyDirectory = Join-Path $env:LOCALAPPDATA 'hecto-sync'
New-Item -ItemType Directory -Force -Path $keyDirectory | Out-Null
Read-Host '인사 근태연동 전용 키' -AsSecureString | ConvertFrom-SecureString | Set-Content -NoNewline -LiteralPath (Join-Path $keyDirectory 'hr-hub.key')
pm2 start sync/hrHubSync.js --name hecto-hrhub-sync
pm2 save
pm2 logs hecto-hrhub-sync --lines 30
```

기존 동기화 프로세스를 재시작할 필요는 없다. `원본 출입 전송`, `출입 보정`과 각 테이블 전송 결과를 확인한다. 키가 바뀌면 같은 계정에서 키 저장 단계만 다시 실행한 후 `pm2 restart hecto-hrhub-sync`를 실행한다. PM2 계정 또는 Windows 로그인 계정이 바뀌면 해당 계정에서 키를 다시 저장해야 한다.

환경변수 `HR_HUB_INGEST_KEY`도 지원하지만, PM2가 환경변수를 디스크에 저장할 수 있으므로 위 암호화 파일을 권장한다. 키를 코드나 Git에 넣지 않는다. 인사 허브의 실제 수신과 기존 가져오기 중단은 인사 담당자가 확인해야 한다.
