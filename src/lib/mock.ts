import type { AttendanceExportRow, AttendanceSnapshot, AuthenticatedProfile, CrewLoginCard, DashboardSummary } from '../types'
import { lastSunday } from './date'

export const demoCards: CrewLoginCard[] = [
  { teacherId: 'teacher-1', teacherName: '이창현', crewId: 'crew-1', crewName: '이창현 크루', role: 'teacher' },
  { teacherId: 'teacher-2', teacherName: '김은혜', crewId: 'crew-2', crewName: '은혜 크루', role: 'teacher' },
  { teacherId: 'teacher-3', teacherName: '박지훈', crewId: 'crew-3', crewName: '지훈 크루', role: 'teacher' },
  { teacherId: 'executive-1', teacherName: '임원 관리자', crewId: '', crewName: '전체 관리', role: 'executive' },
]

const demoNames = ['김하늘', '박사랑', '이소망', '최지혜', '정은찬', '한시온']

export function demoSnapshot(actorName = '이창현', actorType: 'teacher' | 'assistant' = 'teacher'): AttendanceSnapshot {
  return {
    sessionId: 'demo-session',
    crewId: 'crew-1',
    crewName: '이창현 크루',
    attendanceDate: lastSunday(),
    actor: { type: actorType, name: actorName },
    members: demoNames.map((name, index) => ({
      membershipId: `membership-${index}`,
      studentId: `student-${index}`,
      name,
      membershipStatus: index === 5 ? 'long_absence' : 'active',
      attendanceStatus: index < 2 ? 'present' : index === 2 ? 'absent' : 'unchecked',
      sortOrder: index,
      actor: index < 3 ? { type: 'teacher', name: '이창현' } : undefined,
      updatedAt: index < 3 ? new Date().toISOString() : undefined,
      absenceReason: index === 2 ? '감기 증상으로 가정에서 쉬는 중' : '',
      contactStatus: index === 2 ? 'contacted' : 'not_contacted',
      specialNote: index === 1 ? '장학금 신청 관련 서류 확인 필요' : '',
      customResponses: (index === 0 ? { 'field-retreat': '신청' } : {}) as Record<string, string>,
    })),
    announcements: [{ id: 'notice-1', title: '이번 주 확인사항', body: '수련회 참석 여부를 학생별로 입력해주세요.', activeFrom: lastSunday(), activeUntil: '2026-12-31' }],
    customFields: [{ id: 'field-retreat', title: '수련회 참석', description: '학생과 확인 후 선택해주세요.', fieldType: 'select', options: ['신청', '미신청', '고려중'], required: true, activeFrom: lastSunday(), activeUntil: '2026-12-31' }],
  }
}

export const demoExecutive: AuthenticatedProfile = { id: 'executive-1', name: '임원 관리자', role: 'executive' }

export const demoSummary: DashboardSummary = {
  totalCrews: 3,
  totalStudents: 18,
  present: 12,
  absent: 4,
  unchecked: 2,
  attendanceRate: 75,
}

export const demoRows: AttendanceExportRow[] = demoNames.slice(0, 5).map((name, index) => ({
  attendanceDate: lastSunday(),
  crewName: '이창현 크루',
  studentName: name,
  membershipStatus: 'active',
  attendanceStatus: index < 3 ? 'present' : index === 3 ? 'absent' : 'unchecked',
  actorType: 'teacher',
  actorName: '이창현',
  markedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  absenceReason: index === 3 ? '가족 일정' : '',
  contactStatus: index === 3 ? 'contacted' : 'not_contacted',
  specialNote: index === 1 ? '장학금 신청 서류 확인 필요' : '',
  hasImportantNote: index === 1 || index === 3,
}))
