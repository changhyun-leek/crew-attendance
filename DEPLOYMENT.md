# 운영 배포

## 1. 기존 데이터 백업

```powershell
node scripts/backup-legacy.mjs
```

출력된 인원·출석 건수를 기록하고 `legacy-backups` 파일을 별도 보관합니다.

## 2. Supabase 연결

```powershell
npx supabase login
npx supabase link --project-ref zzavmguguvuqgdblmkcj
npx supabase db push
```

마이그레이션은 기존 `crew_members`, `attendance`를 삭제하지 않고 신규 테이블로 복사합니다.

## 3. 서버 비밀값과 함수

서로 다른 충분히 긴 임의 문자열 세 개와 Web Push용 VAPID 키 쌍을 준비합니다.

```powershell
npx web-push generate-vapid-keys
npx supabase secrets set PIN_PEPPER="<32자 이상 임의 문자열>" ACTIVATION_PEPPER="<PIN_PEPPER와 다른 32자 이상 문자열>" BOOTSTRAP_ADMIN_CODE="<일회용 초기 설정 코드>"
npx supabase secrets set VAPID_PUBLIC_KEY="<생성된 Public Key>" VAPID_PRIVATE_KEY="<생성된 Private Key>" VAPID_SUBJECT="https://changhyun-leek.github.io/crew-attendance/"
npx supabase secrets set MASTER_PIN="<관리자만 아는 4~6자리 숫자>"
npx supabase functions deploy crew-api --no-verify-jwt
```

`PIN_PEPPER`는 변경하면 기존 교사의 PIN 로그인이 불가능해집니다. `ACTIVATION_PEPPER`는 최초 PIN 본인 확인값을 만드는 별도 키입니다. `VAPID_PRIVATE_KEY`를 바꾸면 기존 알림 구독을 다시 받아야 할 수 있으므로 모두 안전하게 보관합니다. `MASTER_PIN`은 관리자가 어떤 교사·임원 카드에서든 그 사람의 PIN 대신 입력하면 로그인되는 마스터 키입니다. 설정하지 않으면(빈 값) 비활성화되며, 사용될 때마다 `account_security_events`에 `master_key_login`으로 기록됩니다. 코드 저장소는 공개 저장소이므로 이 값은 절대 소스에 하드코딩하지 말고 secrets로만 관리합니다.

## 4. 최초 임원 계정

임원이 아직 한 명도 없을 때만 `bootstrap-executive` 요청이 허용됩니다. 최초 계정 생성 후에는 같은 요청이 자동 차단됩니다.

```json
{
  "action": "bootstrap-executive",
  "bootstrapCode": "서버에 설정한 일회용 코드",
  "name": "임원 이름",
  "pin": "6자리 숫자",
  "role": "executive"
}
```

이후 교사·임원·크루는 임원 화면에서 등록합니다.

## 5. 2026 교적부 명단 이관

최초 임원으로 로그인한 뒤, 로컬 교적부 PDF를 `scripts/import_2026_roster.py`로 한 번만 이관합니다. 스크립트는 이름·크루·휴대폰 끝 4자리만 메모리에서 처리하며 생년월일, 주소, 학교, 부모 정보, 비고는 읽거나 전송하지 않습니다. 휴대폰 끝 4자리는 서버에서 즉시 HMAC으로 바뀌며 원문으로 저장되지 않습니다.

- 일반 크루 22개, 학생 136명, 새가족 1명, 교사 34명 수가 맞지 않으면 자동 중단됩니다.
- `구예영크루` 담당자는 이관 시 `김유진` 선생님으로 배정됩니다.
- 기존 계정과 출석 기록은 보존하고 새 명단만 보충합니다.
- 실행에 필요한 임원 액세스 토큰은 명령줄이나 문서에 쓰지 말고 현재 PowerShell 세션의 `CREW_ADMIN_ACCESS_TOKEN` 환경변수로만 전달합니다.

## 6. 검증 후 GitHub Pages 전환

1. `npm run check`
2. 데모 화면과 실제 Supabase 연결 화면 확인
3. 교사 기기에서 `알림 켜기` 후 임원 화면에서 독려 알림 수신 확인
4. 새 교사의 `처음 사용` 본인 확인과 PIN 설정, 기존 교사의 PIN 변경·재로그인 확인
5. `교적부 XLSX`를 실제 Excel에서 열어 12개 열, 크루 병합, 빈 개인정보 열 확인
6. 기존/신규 명단 수와 날짜별 출석 건수 비교
7. GitHub Actions secret `VITE_SUPABASE_PUBLISHABLE_KEY` 등록
8. Pages Source를 `GitHub Actions`로 변경
9. main 브랜치 배포

기존 테이블은 30일 동안 삭제하지 말고 읽기 전용 백업으로 유지합니다.
