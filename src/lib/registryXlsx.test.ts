import { describe, expect, it } from 'vitest'
import type { AttendanceExportRow } from '../types'
import { buildRegistryWorkbook, registryHeaders } from './registryXlsx'

const rows: AttendanceExportRow[] = [
  {
    attendanceDate: '2026-08-02', crewName: '사랑 크루', studentName: '학생가', membershipStatus: 'active',
    attendanceStatus: 'present', actorType: 'teacher', actorName: '교사', markedAt: '', updatedAt: '', contactStatus: 'not_contacted',
  },
  {
    attendanceDate: '2026-08-02', crewName: '사랑 크루', studentName: '학생나', membershipStatus: 'active',
    attendanceStatus: 'absent', actorType: 'teacher', actorName: '교사', markedAt: '', updatedAt: '', absenceReason: '가정 일정', contactStatus: 'contacted',
  },
]

describe('교적부 형식 Excel 내보내기', () => {
  it('기존 12개 열과 크루 병합 블록을 가진 OOXML 파일을 만든다', () => {
    const workbook = buildRegistryWorkbook(rows)
    const contents = new TextDecoder().decode(workbook)
    expect(Array.from(workbook.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(contents).toContain('xl/workbook.xml')
    expect(contents).toContain('xl/styles.xml')
    registryHeaders.forEach((header) => expect(contents).toContain(header))
    expect(contents).toContain('mergeCell ref="A5:A6"')
    expect(contents).toContain('결석 · 가정 일정 / 연락 완료')
  })

  it('프로그램에 없는 개인정보 칸에는 값을 임의 생성하지 않는다', () => {
    const contents = new TextDecoder().decode(buildRegistryWorkbook(rows))
    expect(contents).not.toContain('010-')
    expect(contents).not.toContain('생년월일:')
    expect(contents).not.toContain('주소:')
  })
})
