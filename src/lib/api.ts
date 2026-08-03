import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import type {
  AttendanceExportRow,
  AttendanceSnapshot,
  AttendanceStatus,
  AuthenticatedProfile,
  CrewLoginCard,
  DashboardSummary,
  MembershipStatus,
  ContactStatus,
  Announcement,
  CustomField,
  FeedbackItem,
  AdminWorkspaceData,
  AttendanceReminderCrew,
  PushConfig,
  ReminderSendResult,
} from '../types'
import { demoCards, demoExecutive, demoRows, demoSnapshot, demoSummary } from './mock'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://zzavmguguvuqgdblmkcj.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_VY0sNxSFQgHMSItmR5q5pw_4tpdrxWb'
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1'

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('crew-api', { body: { action, ...body } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const responseBody = await error.context.json().catch(() => null)
      throw new Error(responseBody?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export const api = {
  async loginCards(): Promise<CrewLoginCard[]> {
    return isDemoMode ? demoCards : invoke<CrewLoginCard[]>('list-login-teachers')
  },

  async teacherLogin(teacherId: string, pin: string): Promise<AuthenticatedProfile> {
    if (isDemoMode) {
      if (pin !== '1234') return Promise.reject(new Error('데모 PIN은 1234입니다.'))
      return teacherId === 'executive-1' ? demoExecutive : { id: teacherId, name: '이창현', role: 'teacher', crewId: 'crew-1', crewName: '이창현 크루' }
    }
    const result = await invoke<{ accessToken: string; refreshToken: string; profile: AuthenticatedProfile }>('teacher-login', { teacherId, pin })
    const { error } = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken })
    if (error) throw error
    localStorage.setItem('crew-login-at', String(Date.now()))
    return result.profile
  },

  async teacherFirstSetup(teacherId: string, phoneLast4: string, pin: string): Promise<AuthenticatedProfile> {
    if (isDemoMode) {
      if (phoneLast4 !== '0000') return Promise.reject(new Error('미리보기 본인 확인 번호는 0000입니다.'))
      return teacherId === 'executive-1' ? demoExecutive : { id: teacherId, name: '김은혜', role: 'teacher', crewId: 'crew-2', crewName: '은혜 크루' }
    }
    const result = await invoke<{ accessToken: string; refreshToken: string; profile: AuthenticatedProfile }>('teacher-first-setup', { teacherId, phoneLast4, pin })
    const { error } = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken })
    if (error) throw error
    localStorage.setItem('crew-login-at', String(Date.now()))
    return result.profile
  },

  async executiveDemoLogin(): Promise<AuthenticatedProfile> {
    if (!isDemoMode) throw new Error('임원 계정을 선택한 뒤 PIN을 입력해주세요.')
    return demoExecutive
  },

  async profile(): Promise<AuthenticatedProfile | null> {
    if (isDemoMode) return null
    const { data: sessionData } = await supabase.auth.getSession()
    const loginAt = Number(localStorage.getItem('crew-login-at') ?? 0)
    if (sessionData.session && loginAt && Date.now() - loginAt > 30 * 24 * 60 * 60 * 1000) {
      await supabase.auth.signOut()
      return null
    }
    return sessionData.session ? invoke<AuthenticatedProfile>('get-profile') : null
  },

  async logout(): Promise<void> {
    localStorage.removeItem('crew-login-at')
    await supabase.auth.signOut()
  },

  async changePin(currentPin: string, newPin: string): Promise<void> {
    if (isDemoMode) return
    await invoke('teacher-change-pin', { currentPin, newPin })
  },

  async pushConfig(): Promise<PushConfig> {
    if (isDemoMode) return { publicKey: 'demo', subscribed: false }
    return invoke<PushConfig>('push-config')
  },

  async savePushSubscription(subscription: PushSubscription): Promise<void> {
    if (isDemoMode) return
    const json = subscription.toJSON()
    await invoke('push-subscribe', {
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      userAgent: navigator.userAgent,
    })
  },

  async removePushSubscription(endpoint: string): Promise<void> {
    if (isDemoMode) return
    await invoke('push-unsubscribe', { endpoint })
  },

  async assistantStart(crewId: string, name: string): Promise<AttendanceSnapshot> {
    if (isDemoMode) return demoSnapshot(name, 'assistant')
    const snapshot = await invoke<AttendanceSnapshot & { token: string }>('assistant-start', { crewId, name })
    sessionStorage.setItem('assistant-token', snapshot.token)
    return snapshot
  },

  async correctAssistantName(name: string): Promise<AttendanceSnapshot> {
    if (isDemoMode) return demoSnapshot(name, 'assistant')
    return invoke<AttendanceSnapshot>('assistant-correct-name', { token: sessionStorage.getItem('assistant-token'), name })
  },

  async attendance(crewId: string, date: string): Promise<AttendanceSnapshot> {
    if (isDemoMode) return { ...demoSnapshot(), crewId, attendanceDate: date }
    return invoke<AttendanceSnapshot>('get-attendance', { crewId, date })
  },

  async mark(sessionId: string, membershipId: string, status: AttendanceStatus, assistant = false): Promise<void> {
    if (isDemoMode) return
    await invoke(assistant ? 'assistant-mark-attendance' : 'mark-attendance', {
      sessionId,
      membershipId,
      status,
      token: assistant ? sessionStorage.getItem('assistant-token') : undefined,
    })
  },

  async updateAttendanceDetails(sessionId: string, membershipId: string, details: { absenceReason: string; contactStatus: ContactStatus; specialNote?: string; customResponses: Record<string, string> }, assistant = false): Promise<AttendanceSnapshot> {
    if (isDemoMode) {
      const snapshot = demoSnapshot()
      return { ...snapshot, members: snapshot.members.map((member) => member.membershipId === membershipId ? { ...member, ...details } : member) }
    }
    return invoke<AttendanceSnapshot>(assistant ? 'assistant-update-attendance-details' : 'update-attendance-details', {
      sessionId, membershipId, ...details, token: assistant ? sessionStorage.getItem('assistant-token') : undefined,
    })
  },

  async addStudent(crewId: string, name: string): Promise<void> {
    if (!isDemoMode) await invoke('add-student', { crewId, name })
  },

  async setMembershipStatus(membershipId: string, status: MembershipStatus): Promise<void> {
    if (!isDemoMode) await invoke('set-membership-status', { membershipId, status })
  },

  async dashboard(filters: Record<string, string>): Promise<{ summary: DashboardSummary; rows: AttendanceExportRow[] }> {
    return isDemoMode ? { summary: demoSummary, rows: demoRows } : invoke('dashboard', filters)
  },

  async reminderStatus(date: string): Promise<AttendanceReminderCrew[]> {
    if (isDemoMode) return [{ crewId: 'crew-1', crewName: '이창현 크루', teacherId: 'teacher-1', teacherName: '이창현', attendanceDate: date, checked: 0, total: 8, status: 'not_started', notificationDevices: 1 }]
    return invoke<AttendanceReminderCrew[]>('admin-reminder-status', { date })
  },

  async sendAttendanceReminder(crewId: string, date: string): Promise<ReminderSendResult> {
    if (isDemoMode) return { sent: 1, failed: 0, message: '이창현 선생님의 휴대폰 1대에 알림을 보냈습니다.' }
    return invoke<ReminderSendResult>('admin-send-attendance-reminder', { crewId, date })
  },

  async adminWorkspace(): Promise<AdminWorkspaceData> {
    if (isDemoMode) return {
      announcements: demoSnapshot().announcements,
      customFields: demoSnapshot().customFields,
      feedback: [{ id: 'feedback-1', actorName: '김은혜', actorRole: 'teacher', category: '개선 의견', message: '학생 검색 기능이 있으면 좋겠습니다.', page: '출석체크', status: 'new', createdAt: new Date().toISOString() }],
      crews: [{ id: 'crew-1', name: '이창현 크루', operatingYear: new Date().getFullYear(), active: true, teacherId: 'teacher-1', teacherName: '이창현' }],
      users: [{ id: 'teacher-1', name: '이창현', role: 'teacher', active: true }, { id: 'executive-1', name: '임원 관리자', role: 'executive', active: true }],
      memberships: demoSnapshot().members.map((member) => ({ id: member.membershipId, studentId: member.studentId, studentName: member.name, crewId: 'crew-1', crewName: '이창현 크루', status: member.membershipStatus })),
    }
    return invoke('admin-workspace')
  },

  async submitFeedback(payload: { actorName: string; actorRole: string; category: string; message: string; page: string }): Promise<void> {
    if (!isDemoMode) await invoke('submit-feedback', { ...payload, token: sessionStorage.getItem('assistant-token') })
  },

  async adminAction(action: string, payload: Record<string, unknown>): Promise<void> {
    if (!isDemoMode) await invoke(action, payload)
  },
}
