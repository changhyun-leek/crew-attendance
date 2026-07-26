import { writeFile } from 'node:fs/promises'
import { buildRegistryWorkbook } from '../src/lib/registryXlsx'
import type { AttendanceExportRow } from '../src/types'

const output = process.argv[2]
if (!output) throw new Error('검증용 XLSX 출력 경로가 필요합니다.')

const rows: AttendanceExportRow[] = [
  { attendanceDate: '2026-08-02', crewName: '사랑 크루', studentName: '학생가', membershipStatus: 'active', attendanceStatus: 'present', actorType: 'teacher', actorName: '교사', markedAt: '', updatedAt: '' },
  { attendanceDate: '2026-08-02', crewName: '사랑 크루', studentName: '학생나', membershipStatus: 'active', attendanceStatus: 'absent', actorType: 'teacher', actorName: '교사', markedAt: '', updatedAt: '', absenceReason: '가정 일정', contactStatus: 'contacted' },
]

await writeFile(output, buildRegistryWorkbook(rows))
