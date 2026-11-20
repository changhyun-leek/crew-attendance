import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const edgeFunction = readFileSync(join(process.cwd(), 'supabase/functions/crew-api/index.ts'), 'utf8')

describe('서버 다단계 변경 안전장치', () => {
  it('교사 인증 정보 생성 실패 시 앞서 만든 프로필과 인증 계정을 정리한다', () => {
    expect(edgeFunction).toContain('if (credentialError) {')
    expect(edgeFunction).toContain("await admin.from('profiles').delete().eq('id', profileId)")
    expect(edgeFunction).toContain('await admin.auth.admin.deleteUser(authData.user.id)')
  })

  it('학생 이동 중 기존 소속 종료가 실패하면 새 소속을 되돌린다', () => {
    expect(edgeFunction).toContain("const { data: created, error: insertError } = await admin.from('crew_memberships').insert")
    expect(edgeFunction).toContain("await admin.from('crew_memberships').delete().eq('id', created.id)")
  })

  it('담당교사 재배정 실패 시 종료했던 기존 배정을 복구한다', () => {
    expect(edgeFunction).toContain('const closedIds = (closed ?? []).map')
    expect(edgeFunction).toContain("update({ ends_on: null }).in('id', closedIds)")
  })

  it('변경 이력은 임원 권한이 필요한 별도 API로 조회한다', () => {
    expect(edgeFunction).toContain('async function attendanceEvents(req: Request, body: Json)')
    expect(edgeFunction).toContain("'attendance-events': () => attendanceEvents(req, body)")
    expect(edgeFunction).toContain("admin.from('attendance_events')")
  })
})
