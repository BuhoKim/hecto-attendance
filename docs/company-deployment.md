# 회사 계정으로 Git 및 Vercel 배포

이 저장소는 회사 GitHub `BuhoKim`, Vercel `buhokim` 및 `hecto-qnm` 팀을 사용합니다.
회사 이메일은 `bhkim@hecto.co.kr`입니다. 개인 계정은 회사 계정에 연결하지 않습니다.

저장소 루트에서 다음 설정을 적용합니다. 전역 Git 설정은 변경하지 않습니다.

```powershell
git config --local user.name BuhoKim
git config --local user.email bhkim@hecto.co.kr
git config --local credential.https://github.com.useHttpPath false
git config --local credential.https://github.com.username BuhoKim
git remote set-url origin https://BuhoKim@github.com/BuhoKim/hecto-attendance.git
```

Git 인증은 Git Credential Manager에서 회사 계정으로 별도 승인합니다.
GitHub 기기 인증으로 저장한 계정은 호스트 기준으로 찾으며, remote의 `BuhoKim@`
및 `credential.username`으로 회사 계정을 지정합니다. 개인 계정은 별도 계정으로 유지됩니다.
커밋 작성자 설정과 원격 저장소 인증은 별개이므로 두 항목을 모두 확인합니다.
기존 커밋의 작성자는 바꾸지 않습니다.

Vercel의 회사 프로젝트 ID는 `prj_YojmL3PgRZsBqYrrO04eL0Rhb0x3`,
팀 ID는 `team_yLe5G18lseR58Ba6LHf1jE2t`입니다.
로컬 `.vercel/project.json`도 이 회사 프로젝트를 가리켜야 합니다.
회사 CLI 인증은 비공개 디렉터리 `.migration-private/vercel-company`에 보관합니다.

```powershell
vercel.cmd whoami --global-config .migration-private/vercel-company --scope hecto-qnm
```

회사 계정의 GitHub 연결이 `BuhoKim`인지 Vercel 계정 Authentication에서 확인합니다.
Hobby 플랜에서는 프로젝트 팀 소유자의 Git 계정으로 커밋해야 배포 권한이 인정됩니다.
권한 차단 시 계정 연결과 실제 커밋 작성자부터 확인하고, 작성자 위장이나 계정 혼용으로 우회하지 않습니다.

운영 도메인은 `https://atdc.hectoqnm.co.kr`이며 운영 Supabase는 회사 서울 프로젝트
`qcpqcuzvirmbjzqjzapt`입니다. 배포 전 환경을 확인하고, 새 배포가 READY인 것을
확인한 뒤 운영 도메인을 전환합니다.

## 자동배포 환경 구성 (2026-10-19)

`agitated-raman`이 이 저장소의 운영·Preview 자동배포 프로젝트입니다.
기존 환경변수 19개는 동일한 변수 ID와 값을 유지하고 Production 및 Preview에 적용합니다.
Preview도 운영과 같은 DB·외부 연동 설정을 사용하므로 실제 데이터에 접근하는 환경입니다.
변수 값은 이 문서나 Git에 저장하지 않습니다.

같은 저장소가 연결되어 있던 별도 Vercel `hecto-attendance` 프로젝트
(`prj_cFI0XtUYY2kvI9K4AVIogzKUzOjo`)는 Git 연결을 해제했습니다.
이 프로젝트는 환경변수가 없어 모든 자동 빌드가 실패하던 중복 배포 경로였으며,
회사 운영 도메인 `atdc.hectoqnm.co.kr`은 `agitated-raman`에 연결되어 있습니다.
중복 프로젝트와 기존 배포 기록·도메인은 삭제하지 않았습니다.
