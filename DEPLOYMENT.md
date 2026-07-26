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

충분히 긴 임의 문자열 두 개를 준비합니다.

```powershell
npx supabase secrets set PIN_PEPPER="<32자 이상 임의 문자열>" BOOTSTRAP_ADMIN_CODE="<일회용 초기 설정 코드>"
npx supabase functions deploy crew-api --no-verify-jwt
```

`PIN_PEPPER`는 변경하면 기존 교사의 PIN 로그인이 불가능해지므로 안전하게 보관합니다.

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

## 5. 검증 후 GitHub Pages 전환

1. `npm run check`
2. 데모 화면과 실제 Supabase 연결 화면 확인
3. 기존/신규 명단 수와 날짜별 출석 건수 비교
4. GitHub Actions secret `VITE_SUPABASE_PUBLISHABLE_KEY` 등록
5. Pages Source를 `GitHub Actions`로 변경
6. main 브랜치 배포

기존 테이블은 30일 동안 삭제하지 말고 읽기 전용 백업으로 유지합니다.
