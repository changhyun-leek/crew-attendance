export type Role = 'teacher' | 'executive' | 'assistant'
export type AttendanceStatus = 'unchecked' | 'present' | 'absent'
export type MembershipStatus = 'active' | 'long_absence' | 'left'
export type ContactStatus = 'not_contacted' | 'no_answer' | 'contacted' | 'other'
export type FeedbackStatus = 'new' | 'reviewing' | 'done'

export interface CrewLoginCard {
  teacherId: string
  teacherName: string
  crewId: string
  crewName: string
  role?: 'teacher' | 'executive'
}

export interface Actor {
  type: Role | 'legacy_import'
  name: string
}

export interface AttendanceMember {
  membershipId: string
  studentId: string
  name: string
  membershipStatus: MembershipStatus
  attendanceStatus: AttendanceStatus
  sortOrder: number
  actor?: Actor
  updatedAt?: string
  absenceReason?: string
  contactStatus?: ContactStatus
  specialNote?: string
  customResponses?: Record<string, string>
}

export interface Announcement {
  id: string
  title: string
  body: string
  activeFrom: string
  activeUntil: string
  crewId?: string
}

export interface CustomField {
  id: string
  title: string
  description?: string
  fieldType: 'select' | 'text' | 'boolean'
  options: string[]
  required: boolean
  activeFrom: string
  activeUntil: string
  crewId?: string
}

export interface FeedbackItem {
  id: string
  actorName: string
  actorRole: Role
  category: string
  message: string
  page: string
  status: FeedbackStatus
  createdAt: string
}

export interface AttendanceSnapshot {
  sessionId: string
  crewId: string
  crewName: string
  attendanceDate: string
  actor: Actor
  members: AttendanceMember[]
  announcements: Announcement[]
  customFields: CustomField[]
}

export interface AuthenticatedProfile {
  id: string
  name: string
  role: 'teacher' | 'executive'
  crewId?: string
  crewName?: string
}

export interface AttendanceExportRow {
  attendanceDate: string
  crewName: string
  studentName: string
  membershipStatus: MembershipStatus
  attendanceStatus: AttendanceStatus
  actorType: Actor['type']
  actorName: string
  markedAt: string
  updatedAt: string
  absenceReason?: string
  contactStatus?: ContactStatus
  specialNote?: string
  hasImportantNote?: boolean
}

export interface DashboardSummary {
  totalCrews: number
  totalStudents: number
  present: number
  absent: number
  unchecked: number
  attendanceRate: number
}
