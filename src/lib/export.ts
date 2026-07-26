import type { AttendanceExportRow, AttendanceMember } from '../types'

const statusLabel = {
  unchecked: '미체크',
  present: '출석',
  absent: '결석',
  active: '활동',
  long_absence: '장기결석',
  left: '퇴실',
} as const

export function buildReportText(date: string, crewName: string, members: AttendanceMember[]): string {
  const active = members.filter((member) => member.membershipStatus === 'active')
  const present = active.filter((member) => member.attendanceStatus === 'present')
  const absent = active.filter((member) => member.attendanceStatus === 'absent')
  const unchecked = active.filter((member) => member.attendanceStatus === 'unchecked')
  const longAbsent = members.filter((member) => member.membershipStatus === 'long_absence')

  const lines = [date.replaceAll('-', '.'), `새벽이슬 청소년부 · ${crewName}`]
  lines.push(`출석 ${present.length}명${present.length ? `: ${present.map((member) => member.name).join(', ')}` : ''}`)
  lines.push(`결석 ${absent.length}명${absent.length ? `: ${absent.map((member) => member.name).join(', ')}` : ''}`)
  if (unchecked.length) lines.push(`미체크 ${unchecked.length}명: ${unchecked.map((member) => member.name).join(', ')}`)
  if (longAbsent.length) lines.push(`장기결석 ${longAbsent.length}명: ${longAbsent.map((member) => member.name).join(', ')}`)
  return lines.join('\n')
}

function csvCell(value: string | number): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export const exportHeaders = [
  '출석일',
  '크루',
  '학생명',
  '학생상태',
  '출석상태',
  '체크자구분',
  '체크자명',
  '체크시각',
  '최종수정시각',
]

export function rowsToCsv(rows: AttendanceExportRow[]): string {
  const body = rows.map((row) => [
    row.attendanceDate,
    row.crewName,
    row.studentName,
    statusLabel[row.membershipStatus],
    statusLabel[row.attendanceStatus],
    row.actorType,
    row.actorName,
    row.markedAt,
    row.updatedAt,
  ].map(csvCell).join(','))
  return `\uFEFF${[exportHeaders.join(','), ...body].join('\r\n')}`
}

export function rowsToTsv(rows: AttendanceExportRow[]): string {
  const body = rows.map((row) => [
    row.attendanceDate,
    row.crewName,
    row.studentName,
    statusLabel[row.membershipStatus],
    statusLabel[row.attendanceStatus],
    row.actorType,
    row.actorName,
    row.markedAt,
    row.updatedAt,
  ].join('\t'))
  return [exportHeaders.join('\t'), ...body].join('\n')
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
