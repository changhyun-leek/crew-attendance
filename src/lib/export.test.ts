import { describe, expect, it } from 'vitest'
import { buildReportText, rowsToCsv, rowsToTsv } from './export'
import type { AttendanceExportRow, AttendanceMember } from '../types'

const members: AttendanceMember[] = [
  { membershipId: '1', studentId: '1', name: '김하늘', membershipStatus: 'active', attendanceStatus: 'present', sortOrder: 0 },
  { membershipId: '2', studentId: '2', name: '박사랑', membershipStatus: 'active', attendanceStatus: 'absent', sortOrder: 1 },
  { membershipId: '3', studentId: '3', name: '이소망', membershipStatus: 'long_absence', attendanceStatus: 'unchecked', sortOrder: 2 },
]

const rows: AttendanceExportRow[] = [{
  attendanceDate: '2026-07-26', crewName: '이창현, 크루', studentName: '김"하늘', membershipStatus: 'active',
  attendanceStatus: 'present', actorType: 'teacher', actorName: '이창현', markedAt: '2026-07-26T09:00:00Z', updatedAt: '2026-07-26T09:00:00Z',
}]

describe('attendance exports', () => {
  it('builds the church report without counting long absence', () => {
    const report = buildReportText('2026-07-26', '이창현 크루', members)
    expect(report).toContain('출석 1명: 김하늘')
    expect(report).toContain('결석 1명: 박사랑')
    expect(report).toContain('장기결석 1명: 이소망')
  })

  it('creates Excel-friendly BOM CSV and escapes cells', () => {
    const csv = rowsToCsv(rows)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"이창현, 크루"')
    expect(csv).toContain('"김""하늘"')
  })

  it('creates tab-separated clipboard text', () => {
    expect(rowsToTsv(rows)).toContain('2026-07-26\t이창현, 크루')
  })
})
