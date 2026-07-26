import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const PUBLISHABLE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!
const SECRET_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIN_PEPPER = Deno.env.get('PIN_PEPPER') ?? ''
const BOOTSTRAP_ADMIN_CODE = Deno.env.get('BOOTSTRAP_ADMIN_CODE') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@saebyeokiseul.invalid'
const ALLOWED_ORIGINS = new Set([
  'https://changhyun-leek.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

type Json = Record<string, unknown>
type Profile = { id: string; auth_user_id: string; display_name: string; role: 'teacher' | 'executive'; active: boolean }

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://changhyun-leek.github.io'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  }
}

function reply(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(req.headers.get('origin')) })
}

function fail(req: Request, message: string, status = 400) { return reply(req, { error: message }, status) }

function isPin(pin: unknown): pin is string { return typeof pin === 'string' && /^\d{4,6}$/.test(pin) }
function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}
function cleanName(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name.trim().replace(/\s+/g, ' ').slice(0, 30)
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function derivePassword(profileId: string, pin: string): Promise<string> {
  if (!PIN_PEPPER) throw new Error('PIN_PEPPER가 설정되지 않았습니다.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${profileId}:${pin}`))
  const hex = Array.from(new Uint8Array(signed)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `Crew!${hex}`
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function kstDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function kstThisWeekSunday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12))
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7))
  return date.toISOString().slice(0, 10)
}

async function currentProfile(req: Request): Promise<Profile> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('로그인이 필요합니다.')
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) throw new Error('로그인이 만료되었습니다.')
  const { data, error } = await admin.from('profiles').select('id,auth_user_id,display_name,role,active').eq('auth_user_id', userData.user.id).eq('active', true).single()
  if (error || !data) throw new Error('사용자 권한을 찾을 수 없습니다.')
  return data as Profile
}

async function requireExecutive(req: Request): Promise<Profile> {
  const profile = await currentProfile(req)
  if (profile.role !== 'executive') throw new Error('임원 권한이 필요합니다.')
  return profile
}

async function activeAssignment(profileId: string, crewId?: string) {
  let query = admin.from('crew_assignments').select('id,crew_id,profile_id,crews(id,name,active)').eq('profile_id', profileId).is('ends_on', null)
  if (crewId) query = query.eq('crew_id', crewId)
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw error
  return data
}

async function assertCrewAccess(profile: Profile, crewId: string) {
  if (profile.role === 'executive') return
  if (!await activeAssignment(profile.id, crewId)) throw new Error('이 크루에 접근할 수 없습니다.')
}

async function buildAttendance(sessionId: string, actor: { type: string; name: string }, token?: string) {
  const { data: session, error: sessionError } = await admin.from('attendance_sessions').select('id,crew_id,attendance_date,crews(name)').eq('id', sessionId).single()
  if (sessionError) throw sessionError
  const { data: records, error } = await admin.from('attendance_records').select(`
    id,status,membership_id,updated_at,actor_type,absence_reason,contact_status,
    crew_memberships!inner(id,status,sort_order,students!inner(id,display_name,special_note)),
    profiles(display_name),assistant_sessions(display_name)
  `).eq('session_id', sessionId)
  if (error) throw error
  const membershipIds = (records ?? []).map((record: any) => record.membership_id)
  const date = session.attendance_date
  const { data: announcements } = await admin.from('announcements').select('id,title,body,crew_id,active_from,active_until').eq('active', true).lte('active_from', date).gte('active_until', date).or(`crew_id.is.null,crew_id.eq.${session.crew_id}`).order('created_at', { ascending: false })
  const { data: fields } = await admin.from('custom_fields').select('id,title,description,field_type,options,required,crew_id,active_from,active_until').eq('active', true).lte('active_from', date).gte('active_until', date).or(`crew_id.is.null,crew_id.eq.${session.crew_id}`).order('created_at')
  const fieldIds = (fields ?? []).map((field: any) => field.id)
  let responses: any[] = []
  if (fieldIds.length && membershipIds.length) {
    const { data: responseRows, error: responseError } = await admin.from('custom_field_responses').select('field_id,membership_id,value_text').in('field_id', fieldIds).in('membership_id', membershipIds)
    if (responseError) throw responseError
    responses = responseRows ?? []
  }
  const responseMap = new Map<string, Record<string, string>>()
  for (const response of responses) responseMap.set(response.membership_id, { ...(responseMap.get(response.membership_id) ?? {}), [response.field_id]: response.value_text })
  const members = (records ?? []).map((record: any) => ({
    membershipId: record.membership_id,
    studentId: record.crew_memberships.students.id,
    name: record.crew_memberships.students.display_name,
    membershipStatus: record.crew_memberships.status,
    attendanceStatus: record.status,
    sortOrder: record.crew_memberships.sort_order,
    actor: record.actor_type ? {
      type: record.actor_type,
      name: record.profiles?.display_name ?? record.assistant_sessions?.display_name ?? (record.actor_type === 'legacy_import' ? '기존 시스템 이관' : ''),
    } : undefined,
    updatedAt: record.updated_at,
    absenceReason: record.absence_reason ?? '',
    contactStatus: record.contact_status ?? 'not_contacted',
    specialNote: record.crew_memberships.students.special_note ?? '',
    customResponses: responseMap.get(record.membership_id) ?? {},
  })).sort((a: any, b: any) => a.sortOrder - b.sortOrder)
  return {
    sessionId: session.id,
    crewId: session.crew_id,
    crewName: (session.crews as any).name,
    attendanceDate: session.attendance_date,
    actor,
    members,
    announcements: (announcements ?? []).map((item: any) => ({ id: item.id, title: item.title, body: item.body, crewId: item.crew_id ?? undefined, activeFrom: item.active_from, activeUntil: item.active_until })),
    customFields: (fields ?? []).map((item: any) => ({ id: item.id, title: item.title, description: item.description, fieldType: item.field_type, options: Array.isArray(item.options) ? item.options : [], required: item.required, crewId: item.crew_id ?? undefined, activeFrom: item.active_from, activeUntil: item.active_until })),
    ...(token ? { token } : {}),
  }
}

async function markRecord(options: {
  sessionId: string
  membershipId: string
  status: 'unchecked' | 'present' | 'absent'
  actorType: 'teacher' | 'executive' | 'assistant'
  actorName: string
  actorProfileId?: string
  assistantSessionId?: string
}) {
  const { data: record, error: recordError } = await admin.from('attendance_records').select('id,status,membership_id').eq('session_id', options.sessionId).eq('membership_id', options.membershipId).single()
  if (recordError) throw recordError
  const now = new Date().toISOString()
  const { error } = await admin.from('attendance_records').update({
    status: options.status,
    actor_type: options.actorType,
    actor_profile_id: options.actorProfileId ?? null,
    assistant_session_id: options.assistantSessionId ?? null,
    marked_at: options.status === 'unchecked' ? null : now,
    updated_at: now,
  }).eq('id', record.id)
  if (error) throw error
  await admin.from('attendance_events').insert({
    session_id: options.sessionId,
    record_id: record.id,
    membership_id: record.membership_id,
    event_type: options.status === 'unchecked' ? 'unmark' : 'mark',
    old_status: record.status,
    new_status: options.status,
    actor_type: options.actorType,
    actor_profile_id: options.actorProfileId ?? null,
    assistant_session_id: options.assistantSessionId ?? null,
    actor_name_snapshot: options.actorName,
  })
}

async function assistantFromToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 40) throw new Error('보조교사 세션이 없습니다.')
  const hash = await sha256(token)
  const { data, error } = await admin.from('assistant_sessions').select('*').eq('token_hash', hash).eq('active', true).gt('expires_at', new Date().toISOString()).single()
  if (error || !data) throw new Error('보조교사 세션이 만료되었습니다.')
  return data
}

async function loginCards() {
  const { data: profiles, error } = await admin.from('profiles').select('id,display_name,role').eq('active', true).order('display_name')
  if (error) throw error
  const { data: assignments } = await admin.from('crew_assignments').select('profile_id,crew_id,crews(name)').is('ends_on', null)
  const assignmentMap = new Map((assignments ?? []).map((row: any) => [row.profile_id, row]))
  return (profiles ?? []).flatMap((profile: any) => {
    if (profile.role === 'executive') return [{ teacherId: profile.id, teacherName: profile.display_name, crewId: '', crewName: '전체 관리', role: 'executive' }]
    const assignment: any = assignmentMap.get(profile.id)
    return assignment ? [{ teacherId: profile.id, teacherName: profile.display_name, crewId: assignment.crew_id, crewName: assignment.crews.name, role: 'teacher' }] : []
  })
}

async function teacherLogin(teacherId: unknown, pin: unknown) {
  if (typeof teacherId !== 'string' || !isPin(pin)) throw new Error('교사와 PIN을 확인해주세요.')
  const { data: profile, error: profileError } = await admin.from('profiles').select('*').eq('id', teacherId).eq('active', true).single()
  if (profileError || !profile) throw new Error('사용할 수 없는 교사 계정입니다.')
  const { data: credential, error: credentialError } = await admin.from('teacher_credentials').select('*').eq('profile_id', teacherId).single()
  if (credentialError || !credential) throw new Error('로그인 설정이 완료되지 않았습니다.')
  if (credential.locked_until && new Date(credential.locked_until) > new Date()) throw new Error('PIN을 여러 번 잘못 입력했습니다. 10분 후 다시 시도해주세요.')

  const password = await derivePassword(profile.id, pin)
  const authClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email: credential.auth_email, password })
  if (authError || !authData.session) {
    const count = Number(credential.failed_count ?? 0) + 1
    await admin.from('teacher_credentials').update({ failed_count: count >= 5 ? 0 : count, locked_until: count >= 5 ? new Date(Date.now() + 10 * 60_000).toISOString() : null, updated_at: new Date().toISOString() }).eq('profile_id', profile.id)
    throw new Error(count >= 5 ? 'PIN을 5회 잘못 입력해 10분간 잠겼습니다.' : `PIN이 올바르지 않습니다. (${count}/5)`)
  }
  await admin.from('teacher_credentials').update({ failed_count: 0, locked_until: null, updated_at: new Date().toISOString() }).eq('profile_id', profile.id)
  const assignment: any = profile.role === 'teacher' ? await activeAssignment(profile.id) : null
  return {
    accessToken: authData.session.access_token,
    refreshToken: authData.session.refresh_token,
    profile: { id: profile.id, name: profile.display_name, role: profile.role, crewId: assignment?.crew_id, crewName: assignment?.crews?.name },
  }
}

async function getProfile(req: Request) {
  const profile = await currentProfile(req)
  const assignment: any = profile.role === 'teacher' ? await activeAssignment(profile.id) : null
  return { id: profile.id, name: profile.display_name, role: profile.role, crewId: assignment?.crew_id, crewName: assignment?.crews?.name }
}

async function getAttendance(req: Request, body: Json) {
  const profile = await currentProfile(req)
  const crewId = String(body.crewId ?? '')
  const date = String(body.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('출석 날짜가 올바르지 않습니다.')
  await assertCrewAccess(profile, crewId)
  const { data: sessionId, error } = await admin.rpc('ensure_attendance_session', { target_crew: crewId, target_date: date })
  if (error) throw error
  return buildAttendance(sessionId, { type: profile.role, name: profile.display_name })
}

async function assistantStart(body: Json) {
  const crewId = String(body.crewId ?? '')
  const name = cleanName(body.name)
  if (name.length < 2) throw new Error('보조교사 이름을 입력해주세요.')
  const { data: crew, error: crewError } = await admin.from('crews').select('id').eq('id', crewId).eq('active', true).single()
  if (crewError || !crew) throw new Error('사용할 수 없는 크루입니다.')
  const date = kstThisWeekSunday()
  const { data: sessionId, error } = await admin.rpc('ensure_attendance_session', { target_crew: crewId, target_date: date })
  if (error) throw error
  const token = randomToken()
  const { data: assistant, error: assistantError } = await admin.from('assistant_sessions').insert({
    crew_id: crewId,
    attendance_session_id: sessionId,
    display_name: name,
    token_hash: await sha256(token),
    expires_at: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
  }).select('id').single()
  if (assistantError) throw assistantError
  return buildAttendance(sessionId, { type: 'assistant', name }, token)
}

async function correctAssistantName(body: Json) {
  const assistant = await assistantFromToken(body.token)
  const name = cleanName(body.name)
  if (name.length < 2) throw new Error('보조교사 이름을 입력해주세요.')
  const oldName = assistant.display_name
  const { error } = await admin.from('assistant_sessions').update({ display_name: name, corrected_at: new Date().toISOString() }).eq('id', assistant.id)
  if (error) throw error
  await admin.from('attendance_events').insert({
    session_id: assistant.attendance_session_id,
    event_type: 'assistant_name_corrected',
    actor_type: 'assistant',
    assistant_session_id: assistant.id,
    actor_name_snapshot: name,
    metadata: { previous_name: oldName, corrected_name: name },
  })
  return buildAttendance(assistant.attendance_session_id, { type: 'assistant', name })
}

async function markAttendance(req: Request, body: Json) {
  const status = String(body.status)
  if (!['unchecked', 'present', 'absent'].includes(status)) throw new Error('출석 상태가 올바르지 않습니다.')
  const profile = await currentProfile(req)
  const sessionId = String(body.sessionId ?? '')
  const { data: session, error } = await admin.from('attendance_sessions').select('crew_id').eq('id', sessionId).single()
  if (error) throw error
  await assertCrewAccess(profile, session.crew_id)
  await markRecord({ sessionId, membershipId: String(body.membershipId), status: status as any, actorType: profile.role, actorName: profile.display_name, actorProfileId: profile.id })
  return { ok: true }
}

async function assistantMark(body: Json) {
  const status = String(body.status)
  if (!['unchecked', 'present', 'absent'].includes(status)) throw new Error('출석 상태가 올바르지 않습니다.')
  const assistant = await assistantFromToken(body.token)
  if (assistant.attendance_session_id !== body.sessionId) throw new Error('다른 출석일은 변경할 수 없습니다.')
  await markRecord({ sessionId: assistant.attendance_session_id, membershipId: String(body.membershipId), status: status as any, actorType: 'assistant', actorName: assistant.display_name, assistantSessionId: assistant.id })
  return { ok: true }
}

async function updateAttendanceDetails(req: Request, body: Json, assistantMode = false) {
  const sessionId = String(body.sessionId ?? '')
  const membershipId = String(body.membershipId ?? '')
  const contactStatus = String(body.contactStatus ?? 'not_contacted')
  if (!['not_contacted', 'no_answer', 'contacted', 'other'].includes(contactStatus)) throw new Error('연락 상태가 올바르지 않습니다.')
  const absenceReason = String(body.absenceReason ?? '').trim().slice(0, 500)
  const { data: session, error: sessionError } = await admin.from('attendance_sessions').select('id,crew_id,attendance_date').eq('id', sessionId).single()
  if (sessionError || !session) throw new Error('출석 세션을 찾을 수 없습니다.')
  const { data: membership, error: membershipError } = await admin.from('crew_memberships').select('id,crew_id,student_id').eq('id', membershipId).single()
  if (membershipError || !membership || membership.crew_id !== session.crew_id) throw new Error('이 크루의 학생이 아닙니다.')

  let actorType: 'teacher' | 'executive' | 'assistant'
  let actorName: string
  let actorProfileId: string | undefined
  let assistantSessionId: string | undefined
  if (assistantMode) {
    const assistant = await assistantFromToken(body.token)
    if (assistant.attendance_session_id !== sessionId) throw new Error('다른 출석일은 변경할 수 없습니다.')
    actorType = 'assistant'; actorName = assistant.display_name; assistantSessionId = assistant.id
  } else {
    const profile = await currentProfile(req)
    await assertCrewAccess(profile, session.crew_id)
    actorType = profile.role; actorName = profile.display_name; actorProfileId = profile.id
    if (typeof body.specialNote === 'string') {
      await admin.from('students').update({ special_note: body.specialNote.trim().slice(0, 1000), note_updated_at: new Date().toISOString(), note_updated_by: profile.id, updated_at: new Date().toISOString() }).eq('id', membership.student_id)
    }
  }

  const { data: record, error: recordError } = await admin.from('attendance_records').update({ absence_reason: absenceReason, contact_status: contactStatus, actor_type: actorType, actor_profile_id: actorProfileId ?? null, assistant_session_id: assistantSessionId ?? null, updated_at: new Date().toISOString() }).eq('session_id', sessionId).eq('membership_id', membershipId).select('id').single()
  if (recordError) throw recordError

  const rawResponses = body.customResponses && typeof body.customResponses === 'object' ? body.customResponses as Record<string, unknown> : {}
  const responseIds = Object.keys(rawResponses)
  if (responseIds.length) {
    const { data: allowedFields, error: fieldError } = await admin.from('custom_fields').select('id').in('id', responseIds).eq('active', true).lte('active_from', session.attendance_date).gte('active_until', session.attendance_date).or(`crew_id.is.null,crew_id.eq.${session.crew_id}`)
    if (fieldError) throw fieldError
    const allowed = new Set((allowedFields ?? []).map((field: any) => field.id))
    const values = responseIds.filter((id) => allowed.has(id)).map((fieldId) => ({ field_id: fieldId, membership_id: membershipId, value_text: String(rawResponses[fieldId] ?? '').trim().slice(0, 500), actor_type: actorType, actor_profile_id: actorProfileId ?? null, assistant_session_id: assistantSessionId ?? null, updated_at: new Date().toISOString() }))
    if (values.length) {
      const { error } = await admin.from('custom_field_responses').upsert(values, { onConflict: 'field_id,membership_id' })
      if (error) throw error
    }
  }
  await admin.from('attendance_events').insert({ session_id: sessionId, record_id: record.id, membership_id: membershipId, event_type: 'details_updated', actor_type: actorType, actor_profile_id: actorProfileId ?? null, assistant_session_id: assistantSessionId ?? null, actor_name_snapshot: actorName, metadata: { absence_reason: absenceReason, contact_status: contactStatus, custom_field_ids: responseIds } })
  return buildAttendance(sessionId, { type: actorType, name: actorName })
}

async function addStudent(req: Request, body: Json) {
  const profile = await currentProfile(req)
  const crewId = String(body.crewId ?? '')
  const name = cleanName(body.name)
  await assertCrewAccess(profile, crewId)
  if (!name) throw new Error('학생 이름을 입력해주세요.')
  const { data: student, error } = await admin.from('students').insert({ display_name: name }).select('id').single()
  if (error) throw error
  const { data: maxSort } = await admin.from('crew_memberships').select('sort_order').eq('crew_id', crewId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { error: memberError } = await admin.from('crew_memberships').insert({ student_id: student.id, crew_id: crewId, sort_order: Number(maxSort?.sort_order ?? -1) + 1 })
  if (memberError) throw memberError
  return { ok: true }
}

async function setMembershipStatus(req: Request, body: Json) {
  const profile = await currentProfile(req)
  const status = String(body.status)
  if (!['active', 'long_absence', 'left'].includes(status)) throw new Error('학생 상태가 올바르지 않습니다.')
  const { data: membership, error } = await admin.from('crew_memberships').select('id,crew_id,status').eq('id', String(body.membershipId)).single()
  if (error) throw error
  await assertCrewAccess(profile, membership.crew_id)
  const { error: updateError } = await admin.from('crew_memberships').update({ status, status_changed_on: kstDate(), ended_on: status === 'left' ? kstDate() : null, updated_at: new Date().toISOString() }).eq('id', membership.id)
  if (updateError) throw updateError
  return { ok: true }
}

async function dashboard(req: Request, body: Json) {
  await requireExecutive(req)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from)) ? String(body.from) : kstDate()
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to)) ? String(body.to) : from
  const { data: sessions, error: sessionsError } = await admin.from('attendance_sessions').select('id,attendance_date,crew_id,crews(name)').gte('attendance_date', from).lte('attendance_date', to).order('attendance_date', { ascending: false })
  if (sessionsError) throw sessionsError
  const sessionMap = new Map((sessions ?? []).map((session: any) => [session.id, session]))
  const sessionIds = [...sessionMap.keys()]
  if (!sessionIds.length) return { summary: { totalCrews: 0, totalStudents: 0, present: 0, absent: 0, unchecked: 0, attendanceRate: 0 }, rows: [] }
  const { data: records, error } = await admin.from('attendance_records').select(`
    session_id,status,actor_type,marked_at,updated_at,absence_reason,contact_status,
    crew_memberships!inner(status,students!inner(display_name,special_note)),
    profiles(display_name),assistant_sessions(display_name)
  `).in('session_id', sessionIds)
  if (error) throw error
  let rows = (records ?? []).map((record: any) => {
    const session: any = sessionMap.get(record.session_id)
    return {
      attendanceDate: session.attendance_date,
      crewName: session.crews.name,
      studentName: record.crew_memberships.students.display_name,
      membershipStatus: record.crew_memberships.status,
      attendanceStatus: record.status,
      actorType: record.actor_type ?? 'legacy_import',
      actorName: record.profiles?.display_name ?? record.assistant_sessions?.display_name ?? (record.actor_type === 'legacy_import' ? '기존 시스템 이관' : ''),
      markedAt: record.marked_at ?? '',
      updatedAt: record.updated_at,
      absenceReason: record.absence_reason ?? '',
      contactStatus: record.contact_status ?? 'not_contacted',
      specialNote: record.crew_memberships.students.special_note ?? '',
      hasImportantNote: Boolean(record.absence_reason || record.crew_memberships.students.special_note || record.contact_status === 'no_answer'),
    }
  })
  if (body.crew) rows = rows.filter((row: any) => row.crewName.includes(String(body.crew)))
  if (body.student) rows = rows.filter((row: any) => row.studentName.includes(String(body.student)))
  if (body.status) rows = rows.filter((row: any) => row.attendanceStatus === body.status)
  if (body.actor) rows = rows.filter((row: any) => row.actorName.includes(String(body.actor)))
  if (body.notes === 'yes') rows = rows.filter((row: any) => row.hasImportantNote)
  const present = rows.filter((row: any) => row.attendanceStatus === 'present').length
  const absent = rows.filter((row: any) => row.attendanceStatus === 'absent').length
  const unchecked = rows.filter((row: any) => row.attendanceStatus === 'unchecked').length
  const counted = present + absent
  return { summary: { totalCrews: new Set(rows.map((row: any) => row.crewName)).size, totalStudents: new Set(rows.map((row: any) => `${row.crewName}:${row.studentName}`)).size, present, absent, unchecked, attendanceRate: counted ? Math.round((present / counted) * 1000) / 10 : 0 }, rows }
}

async function createUser(req: Request, body: Json, bootstrap = false) {
  if (bootstrap) {
    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'executive')
    if (count && count > 0) throw new Error('초기 임원 설정은 이미 완료되었습니다.')
    if (!BOOTSTRAP_ADMIN_CODE || body.bootstrapCode !== BOOTSTRAP_ADMIN_CODE) throw new Error('초기 관리자 코드가 올바르지 않습니다.')
  } else await requireExecutive(req)
  const name = cleanName(body.name)
  const role = body.role === 'executive' ? 'executive' : 'teacher'
  const pin = body.pin
  if (name.length < 2 || !isPin(pin)) throw new Error('이름과 4~6자리 PIN을 확인해주세요.')
  const profileId = crypto.randomUUID()
  const authEmail = `crew-${profileId}@users.saebyeokiseul.invalid`
  const { data: authData, error: authError } = await admin.auth.admin.createUser({ email: authEmail, password: await derivePassword(profileId, pin), email_confirm: true, user_metadata: { display_name: name } })
  if (authError || !authData.user) throw authError ?? new Error('인증 계정을 만들지 못했습니다.')
  const { error: profileError } = await admin.from('profiles').insert({ id: profileId, auth_user_id: authData.user.id, display_name: name, role })
  if (profileError) { await admin.auth.admin.deleteUser(authData.user.id); throw profileError }
  await admin.from('teacher_credentials').insert({ profile_id: profileId, auth_email: authEmail })
  return { id: profileId, name, role }
}

async function resetPin(req: Request, body: Json) {
  await requireExecutive(req)
  if (!isPin(body.pin)) throw new Error('4~6자리 숫자 PIN을 입력해주세요.')
  const { data: profile, error } = await admin.from('profiles').select('id,auth_user_id').eq('id', String(body.profileId)).single()
  if (error) throw error
  const { error: authError } = await admin.auth.admin.updateUserById(profile.auth_user_id, { password: await derivePassword(profile.id, body.pin) })
  if (authError) throw authError
  await admin.from('teacher_credentials').update({ failed_count: 0, locked_until: null, updated_at: new Date().toISOString() }).eq('profile_id', profile.id)
  return { ok: true }
}

async function changeOwnPin(req: Request, body: Json) {
  const profile = await currentProfile(req)
  if (!isPin(body.currentPin) || !isPin(body.newPin)) throw new Error('현재 PIN과 새 4~6자리 PIN을 확인해주세요.')
  if (body.currentPin === body.newPin) throw new Error('새 PIN은 현재 PIN과 다르게 정해주세요.')
  const { data: credential, error: credentialError } = await admin.from('teacher_credentials').select('auth_email').eq('profile_id', profile.id).single()
  if (credentialError || !credential) throw new Error('로그인 설정을 찾을 수 없습니다.')
  const authClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: verifyError } = await authClient.auth.signInWithPassword({ email: credential.auth_email, password: await derivePassword(profile.id, body.currentPin) })
  if (verifyError) throw new Error('현재 PIN이 올바르지 않습니다.')
  const { error: updateError } = await admin.auth.admin.updateUserById(profile.auth_user_id, { password: await derivePassword(profile.id, body.newPin) })
  if (updateError) throw updateError
  await admin.from('teacher_credentials').update({ failed_count: 0, locked_until: null, pin_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('profile_id', profile.id)
  return { ok: true }
}

function requirePushConfiguration() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('휴대폰 알림 서버 설정이 아직 완료되지 않았습니다.')
}

async function pushConfig(req: Request) {
  const profile = await currentProfile(req)
  const { count } = await admin.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('profile_id', profile.id).eq('active', true)
  return { publicKey: VAPID_PUBLIC_KEY, subscribed: Boolean(count) }
}

async function subscribePush(req: Request, body: Json) {
  requirePushConfiguration()
  const profile = await currentProfile(req)
  const endpoint = String(body.endpoint ?? '')
  const p256dh = String(body.p256dh ?? '')
  const auth = String(body.auth ?? '')
  if (!endpoint.startsWith('https://') || !p256dh || !auth) throw new Error('휴대폰 알림 정보를 확인하지 못했습니다.')
  const { error } = await admin.from('push_subscriptions').upsert({
    profile_id: profile.id,
    endpoint: endpoint.slice(0, 2000),
    p256dh: p256dh.slice(0, 500),
    auth: auth.slice(0, 500),
    user_agent: String(body.userAgent ?? '').slice(0, 500),
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
  if (error) throw error
  return { ok: true }
}

async function unsubscribePush(req: Request, body: Json) {
  const profile = await currentProfile(req)
  const endpoint = String(body.endpoint ?? '')
  if (endpoint) await admin.from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('profile_id', profile.id).eq('endpoint', endpoint)
  return { ok: true }
}

async function reminderStatus(req: Request, body: Json) {
  await requireExecutive(req)
  const attendanceDate = validDate(body.date) ? body.date : kstThisWeekSunday()
  const [crewsResult, assignmentsResult, sessionsResult, membershipsResult, remindersResult] = await Promise.all([
    admin.from('crews').select('id,name').eq('active', true).order('name'),
    admin.from('crew_assignments').select('crew_id,profile_id,profiles(display_name)').is('ends_on', null),
    admin.from('attendance_sessions').select('id,crew_id').eq('attendance_date', attendanceDate),
    admin.from('crew_memberships').select('crew_id').eq('status', 'active'),
    admin.from('attendance_reminders').select('crew_id,created_at').eq('attendance_date', attendanceDate).order('created_at', { ascending: false }),
  ])
  const firstError = crewsResult.error ?? assignmentsResult.error ?? sessionsResult.error ?? membershipsResult.error ?? remindersResult.error
  if (firstError) throw firstError
  const sessions = sessionsResult.data ?? []
  const sessionIds = sessions.map((session: any) => session.id)
  const { data: records, error: recordsError } = sessionIds.length
    ? await admin.from('attendance_records').select('session_id,status').in('session_id', sessionIds)
    : { data: [], error: null }
  if (recordsError) throw recordsError
  const assignments = new Map((assignmentsResult.data ?? []).map((item: any) => [item.crew_id, item]))
  const sessionByCrew = new Map(sessions.map((item: any) => [item.crew_id, item.id]))
  const activeCounts = new Map<string, number>()
  for (const membership of membershipsResult.data ?? []) activeCounts.set(membership.crew_id, (activeCounts.get(membership.crew_id) ?? 0) + 1)
  const profileIds = (assignmentsResult.data ?? []).map((item: any) => item.profile_id)
  const { data: subscriptions, error: subscriptionError } = profileIds.length
    ? await admin.from('push_subscriptions').select('profile_id').in('profile_id', profileIds).eq('active', true)
    : { data: [], error: null }
  if (subscriptionError) throw subscriptionError
  const deviceCounts = new Map<string, number>()
  for (const subscription of subscriptions ?? []) deviceCounts.set(subscription.profile_id, (deviceCounts.get(subscription.profile_id) ?? 0) + 1)
  const lastReminders = new Map<string, string>()
  for (const reminder of remindersResult.data ?? []) if (!lastReminders.has(reminder.crew_id)) lastReminders.set(reminder.crew_id, reminder.created_at)
  return (crewsResult.data ?? []).map((crew: any) => {
    const assignment: any = assignments.get(crew.id)
    const teacher = firstRelation<{ display_name: string }>(assignment?.profiles)
    const sessionId = sessionByCrew.get(crew.id)
    const crewRecords = sessionId ? (records ?? []).filter((record: any) => record.session_id === sessionId) : []
    const total = crewRecords.length || activeCounts.get(crew.id) || 0
    const checked = crewRecords.filter((record: any) => record.status !== 'unchecked').length
    return {
      crewId: crew.id,
      crewName: crew.name,
      teacherId: assignment?.profile_id,
      teacherName: teacher?.display_name,
      attendanceDate,
      checked,
      total,
      status: total > 0 && checked >= total ? 'completed' : checked > 0 ? 'in_progress' : 'not_started',
      notificationDevices: assignment ? deviceCounts.get(assignment.profile_id) ?? 0 : 0,
      lastReminderAt: lastReminders.get(crew.id),
    }
  })
}

async function sendAttendanceReminder(req: Request, body: Json) {
  const executive = await requireExecutive(req)
  requirePushConfiguration()
  const crewId = String(body.crewId ?? '')
  const attendanceDate = validDate(body.date) ? body.date : kstThisWeekSunday()
  const { data: assignment, error: assignmentError } = await admin.from('crew_assignments').select('profile_id,profiles(display_name),crews(name)').eq('crew_id', crewId).is('ends_on', null).single()
  if (assignmentError || !assignment) throw new Error('담당교사가 배정된 크루인지 확인해주세요.')
  const statuses = await reminderStatus(req, { date: attendanceDate }) as any[]
  const target = statuses.find((item) => item.crewId === crewId)
  if (target?.status === 'completed') throw new Error('이미 출석체크를 완료한 크루입니다.')
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const { count: recentCount } = await admin.from('attendance_reminders').select('*', { count: 'exact', head: true }).eq('crew_id', crewId).eq('attendance_date', attendanceDate).gte('created_at', cutoff)
  if (recentCount) throw new Error('같은 크루에는 30분에 한 번만 독려 알림을 보낼 수 있습니다.')
  const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('profile_id', assignment.profile_id).eq('active', true)
  if (subscriptionError) throw subscriptionError
  if (!subscriptions?.length) return { sent: 0, failed: 0, message: '담당교사가 아직 휴대폰 알림을 켜지 않았습니다.' }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const teacherName = firstRelation<{ display_name: string }>(assignment.profiles)?.display_name ?? '담당교사'
  const crewName = firstRelation<{ name: string }>(assignment.crews)?.name ?? '담당 크루'
  const bodyText = `${teacherName} 선생님, ${crewName}의 ${attendanceDate} 출석체크를 부탁드립니다.`
  const navigate = 'https://changhyun-leek.github.io/crew-attendance/?role=teacher'
  const payload = JSON.stringify({
    web_push: 8030,
    notification: {
      title: '새벽이슬 출석체크 알림',
      body: bodyText,
      navigate,
      icon: 'https://changhyun-leek.github.io/crew-attendance/pwa-192x192.png',
      badge: 'https://changhyun-leek.github.io/crew-attendance/pwa-64x64.png',
      tag: `attendance-${crewId}-${attendanceDate}`,
      app_badge: '1',
    },
  })
  let sent = 0
  let failed = 0
  await Promise.all(subscriptions.map(async (subscription: any) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'high' })
      sent += 1
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', subscription.id)
    } catch (error: any) {
      failed += 1
      if ([404, 410].includes(Number(error?.statusCode))) await admin.from('push_subscriptions').update({ active: false, updated_at: new Date().toISOString() }).eq('id', subscription.id)
      console.error('push send failed', error?.statusCode ?? error)
    }
  }))
  await admin.from('attendance_reminders').insert({ crew_id: crewId, attendance_date: attendanceDate, target_profile_id: assignment.profile_id, sent_by: executive.id, message: bodyText, sent_count: sent, failed_count: failed })
  return { sent, failed, message: sent ? `${teacherName} 선생님의 휴대폰 ${sent}대에 알림을 보냈습니다.` : '알림을 보내지 못했습니다. 교사의 알림 설정을 확인해주세요.' }
}

async function manageCrew(req: Request, body: Json) {
  await requireExecutive(req)
  if (body.operation === 'create') {
    const name = cleanName(body.name)
    if (!name) throw new Error('크루명을 입력해주세요.')
    const { error } = await admin.from('crews').insert({ name, operating_year: Number(body.year) || new Date().getFullYear() })
    if (error) throw error
  } else if (body.operation === 'assign') {
    await admin.from('crew_assignments').update({ ends_on: kstDate() }).or(`crew_id.eq.${body.crewId},profile_id.eq.${body.profileId}`).is('ends_on', null)
    const { error } = await admin.from('crew_assignments').insert({ crew_id: body.crewId, profile_id: body.profileId, starts_on: kstDate(), is_primary: true })
    if (error) throw error
  } else if (body.operation === 'end') {
    const { error } = await admin.from('crews').update({ active: false, ended_at: kstDate() }).eq('id', body.crewId)
    if (error) throw error
  }
  return { ok: true }
}

async function manageStudent(req: Request, body: Json) {
  await requireExecutive(req)
  if (body.operation === 'create') return addStudent(req, body)
  const membershipId = String(body.membershipId ?? '')
  const { data: membership, error } = await admin.from('crew_memberships').select('id,student_id,crew_id,status').eq('id', membershipId).single()
  if (error) throw error
  if (body.operation === 'status') {
    const status = String(body.status)
    if (!['active', 'long_absence', 'left'].includes(status)) throw new Error('학생 상태가 올바르지 않습니다.')
    const { error: updateError } = await admin.from('crew_memberships').update({
      status,
      status_changed_on: kstDate(),
      ended_on: status === 'left' ? kstDate() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', membership.id)
    if (updateError) throw updateError
    return { ok: true }
  }
  if (body.operation === 'move') {
    const targetCrewId = String(body.targetCrewId ?? '')
    if (!targetCrewId || targetCrewId === membership.crew_id) throw new Error('이동할 다른 크루를 선택해주세요.')
    const { data: maxSort } = await admin.from('crew_memberships').select('sort_order').eq('crew_id', targetCrewId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const { error: endError } = await admin.from('crew_memberships').update({ status: 'left', status_changed_on: kstDate(), ended_on: kstDate(), updated_at: new Date().toISOString() }).eq('id', membership.id)
    if (endError) throw endError
    const { error: insertError } = await admin.from('crew_memberships').insert({ student_id: membership.student_id, crew_id: targetCrewId, sort_order: Number(maxSort?.sort_order ?? -1) + 1 })
    if (insertError) throw insertError
    return { ok: true }
  }
  throw new Error('지원하지 않는 작업입니다.')
}

async function adminWorkspace(req: Request) {
  await requireExecutive(req)
  const [
    { data: announcements, error: announcementError },
    { data: fields, error: fieldError },
    { data: feedback, error: feedbackError },
    { data: crews, error: crewError },
    { data: assignments, error: assignmentError },
    { data: profiles, error: profileError },
    { data: memberships, error: membershipError },
  ] = await Promise.all([
    admin.from('announcements').select('id,title,body,crew_id,active_from,active_until').eq('active', true).order('created_at', { ascending: false }),
    admin.from('custom_fields').select('id,title,description,field_type,options,required,crew_id,active_from,active_until').eq('active', true).order('created_at', { ascending: false }),
    admin.from('feedback_items').select('id,actor_name,actor_role,category,message,page,status,created_at').order('created_at', { ascending: false }).limit(200),
    admin.from('crews').select('id,name,operating_year,active').order('active', { ascending: false }).order('name'),
    admin.from('crew_assignments').select('crew_id,profile_id,ends_on,profiles(display_name)').is('ends_on', null),
    admin.from('profiles').select('id,display_name,role,active').order('role').order('display_name'),
    admin.from('crew_memberships').select('id,crew_id,status,students(id,display_name),crews(name)').neq('status', 'left').order('sort_order'),
  ])
  if (announcementError || fieldError || feedbackError || crewError || assignmentError || profileError || membershipError) {
    throw announcementError ?? fieldError ?? feedbackError ?? crewError ?? assignmentError ?? profileError ?? membershipError
  }
  const assignmentMap = new Map((assignments ?? []).map((item: any) => [item.crew_id, item]))
  return {
    announcements: (announcements ?? []).map((item: any) => ({ id: item.id, title: item.title, body: item.body, crewId: item.crew_id ?? undefined, activeFrom: item.active_from, activeUntil: item.active_until })),
    customFields: (fields ?? []).map((item: any) => ({ id: item.id, title: item.title, description: item.description, fieldType: item.field_type, options: Array.isArray(item.options) ? item.options : [], required: item.required, crewId: item.crew_id ?? undefined, activeFrom: item.active_from, activeUntil: item.active_until })),
    feedback: (feedback ?? []).map((item: any) => ({ id: item.id, actorName: item.actor_name, actorRole: item.actor_role, category: item.category, message: item.message, page: item.page, status: item.status, createdAt: item.created_at })),
    crews: (crews ?? []).map((item: any) => ({
      id: item.id,
      name: item.name,
      operatingYear: item.operating_year,
      active: item.active,
      teacherId: assignmentMap.get(item.id)?.profile_id,
      teacherName: assignmentMap.get(item.id)?.profiles?.display_name,
    })),
    users: (profiles ?? []).map((item: any) => ({ id: item.id, name: item.display_name, role: item.role, active: item.active })),
    memberships: (memberships ?? []).map((item: any) => ({ id: item.id, studentId: item.students.id, studentName: item.students.display_name, crewId: item.crew_id, crewName: item.crews.name, status: item.status })),
  }
}

async function manageUser(req: Request, body: Json) {
  const executive = await requireExecutive(req)
  if (body.operation !== 'set-active') throw new Error('지원하지 않는 작업입니다.')
  const profileId = String(body.profileId ?? '')
  const active = body.active === true
  if (profileId === executive.id && !active) throw new Error('현재 로그인한 임원 계정은 비활성화할 수 없습니다.')
  const { error } = await admin.from('profiles').update({ active, updated_at: new Date().toISOString() }).eq('id', profileId)
  if (error) throw error
  return { ok: true }
}

function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }

async function createAnnouncement(req: Request, body: Json) {
  const profile = await requireExecutive(req)
  const title = String(body.title ?? '').trim().slice(0, 100)
  if (!title || !validDate(body.activeFrom) || !validDate(body.activeUntil) || body.activeUntil < body.activeFrom) throw new Error('공지 제목과 게시 기간을 확인해주세요.')
  const { error } = await admin.from('announcements').insert({ title, body: String(body.body ?? '').trim().slice(0, 1000), crew_id: body.crewId || null, active_from: body.activeFrom, active_until: body.activeUntil, created_by: profile.id })
  if (error) throw error
  return { ok: true }
}

async function createCustomField(req: Request, body: Json) {
  const profile = await requireExecutive(req)
  const title = String(body.title ?? '').trim().slice(0, 100)
  const options = Array.isArray(body.options) ? body.options.map((value) => String(value).trim().slice(0, 50)).filter(Boolean).slice(0, 20) : []
  if (!title || options.length < 2 || !validDate(body.activeFrom) || !validDate(body.activeUntil) || body.activeUntil < body.activeFrom) throw new Error('임시 항목의 제목, 선택지 2개 이상, 기간을 확인해주세요.')
  const { error } = await admin.from('custom_fields').insert({ title, description: String(body.body ?? '').trim().slice(0, 500), field_type: 'select', options, required: Boolean(body.required), crew_id: body.crewId || null, active_from: body.activeFrom, active_until: body.activeUntil, created_by: profile.id })
  if (error) throw error
  return { ok: true }
}

async function submitFeedback(req: Request, body: Json) {
  let actorName: string
  let actorRole: 'teacher' | 'executive' | 'assistant'
  let actorProfileId: string | null = null
  let assistantSessionId: string | null = null
  let crewId: string | null = null
  if (typeof body.token === 'string' && body.token) {
    const assistant = await assistantFromToken(body.token)
    actorName = assistant.display_name; actorRole = 'assistant'; assistantSessionId = assistant.id; crewId = assistant.crew_id
  } else {
    const profile = await currentProfile(req)
    actorName = profile.display_name; actorRole = profile.role; actorProfileId = profile.id
    const assignment: any = profile.role === 'teacher' ? await activeAssignment(profile.id) : null
    crewId = assignment?.crew_id ?? null
  }
  const message = String(body.message ?? '').trim().slice(0, 1000)
  if (message.length < 5) throw new Error('의견 내용을 5자 이상 입력해주세요.')
  const { error } = await admin.from('feedback_items').insert({ actor_name: actorName, actor_role: actorRole, actor_profile_id: actorProfileId, assistant_session_id: assistantSessionId, crew_id: crewId, page: String(body.page ?? '').slice(0, 80), category: String(body.category ?? '개선 의견').slice(0, 50), message })
  if (error) throw error
  return { ok: true }
}

async function updateFeedback(req: Request, body: Json) {
  await requireExecutive(req)
  const status = String(body.status)
  if (!['new', 'reviewing', 'done'].includes(status)) throw new Error('처리 상태가 올바르지 않습니다.')
  const { error } = await admin.from('feedback_items').update({ status, updated_at: new Date().toISOString() }).eq('id', String(body.id ?? ''))
  if (error) throw error
  return { ok: true }
}

async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req.headers.get('origin')) })
  if (req.method !== 'POST') return fail(req, 'POST 요청만 지원합니다.', 405)
  try {
    const body = await req.json() as Json
    const action = String(body.action ?? '')
    const handlers: Record<string, () => Promise<unknown>> = {
      'list-login-teachers': () => loginCards(),
      'teacher-login': () => teacherLogin(body.teacherId, body.pin),
      'get-profile': () => getProfile(req),
      'teacher-change-pin': () => changeOwnPin(req, body),
      'push-config': () => pushConfig(req),
      'push-subscribe': () => subscribePush(req, body),
      'push-unsubscribe': () => unsubscribePush(req, body),
      'get-attendance': () => getAttendance(req, body),
      'mark-attendance': () => markAttendance(req, body),
      'assistant-start': () => assistantStart(body),
      'assistant-correct-name': () => correctAssistantName(body),
      'assistant-mark-attendance': () => assistantMark(body),
      'update-attendance-details': () => updateAttendanceDetails(req, body),
      'assistant-update-attendance-details': () => updateAttendanceDetails(req, body, true),
      'add-student': () => addStudent(req, body),
      'set-membership-status': () => setMembershipStatus(req, body),
      'dashboard': () => dashboard(req, body),
      'admin-workspace': () => adminWorkspace(req),
      'admin-reminder-status': () => reminderStatus(req, body),
      'admin-send-attendance-reminder': () => sendAttendanceReminder(req, body),
      'submit-feedback': () => submitFeedback(req, body),
      'admin-update-feedback': () => updateFeedback(req, body),
      'admin-create-announcement': () => createAnnouncement(req, body),
      'admin-create-custom-field': () => createCustomField(req, body),
      'admin-create-user': () => createUser(req, body),
      'admin-reset-pin': () => resetPin(req, body),
      'admin-manage-crew': () => manageCrew(req, body),
      'admin-manage-student': () => manageStudent(req, body),
      'admin-manage-user': () => manageUser(req, body),
      'bootstrap-executive': () => createUser(req, body, true),
    }
    if (!handlers[action]) return fail(req, '지원하지 않는 요청입니다.', 404)
    return reply(req, await handlers[action]())
  } catch (error) {
    console.error(error)
    return fail(req, error instanceof Error ? error.message : '요청 처리 중 오류가 발생했습니다.', 400)
  }
}

// Supabase Dashboard's current Edge Function editor expects the module-style
// fetch entry point. Keeping the request handler separate also makes the same
// source straightforward to exercise in local checks.
export default { fetch: handleRequest }
