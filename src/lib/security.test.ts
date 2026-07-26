import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectFile = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('PIN 변경과 출석 독려 알림 보안', () => {
  const edgeFunction = projectFile('supabase/functions/crew-api/index.ts')
  const migration = projectFile('supabase/migrations/202607270002_teacher_pin_and_push_reminders.sql')

  it('교사 PIN 변경은 로그인과 현재 PIN 재확인을 모두 요구한다', () => {
    expect(edgeFunction).toContain('const profile = await currentProfile(req)')
    expect(edgeFunction).toContain('currentPin')
    expect(edgeFunction).toContain('signInWithPassword')
    expect(edgeFunction).toContain("'teacher-change-pin': () => changeOwnPin(req, body)")
  })

  it('독려 알림 발송은 임원 권한과 30분 제한을 적용한다', () => {
    expect(edgeFunction).toContain('const executive = await requireExecutive(req)')
    expect(edgeFunction).toContain('30 * 60_000')
    expect(edgeFunction).toContain('이미 출석체크를 완료한 크루입니다.')
  })

  it('푸시 구독과 발송 이력 테이블은 브라우저 직접 접근을 차단한다', () => {
    expect(migration).toContain('alter table public.push_subscriptions enable row level security')
    expect(migration).toContain('revoke all on public.push_subscriptions from anon, authenticated')
    expect(migration).toContain('revoke all on public.attendance_reminders from anon, authenticated')
  })
})
