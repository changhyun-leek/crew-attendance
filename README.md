# 새벽이슬 청소년부 출석관리

생명샘동천교회 새벽이슬 청소년부 내부에서 담당교사, 보조교사, 임원이 함께 사용하는 출석관리 앱입니다.

## 실행

```powershell
npm install
npm run dev
```

`http://localhost:5173/crew-attendance/?demo=1`에서 백엔드 없이 전체 UI를 확인할 수 있습니다. 데모 PIN은 `1234`입니다.

## 확인

```powershell
npm run check
```

## 구성

- `src/`: 모바일 출석 화면과 데스크톱 임원 대시보드
- `supabase/migrations/`: 신규 스키마, RLS, 기존 v1 데이터 이관
- `supabase/functions/crew-api/`: PIN 로그인, 보조교사 세션, 출석·관리 API
- `scripts/backup-legacy.mjs`: 기존 `crew_members`, `attendance` JSON 백업

운영 배포 절차와 초기 임원 생성은 [DEPLOYMENT.md](./DEPLOYMENT.md)를 따릅니다.
