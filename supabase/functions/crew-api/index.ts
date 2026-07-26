import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const PUBLISHABLE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!
const SECRET_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIN_PEPPER = Deno.env.get('PIN_PEPPER') ?? ''
const BOOTSTRAP_ADMIN_CODE = Deno.env.get('BOOTSTRAP_ADMIN_CODE') ?? ''
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
    id,status,membership_id,updated_at,actor_type,
    crew_memberships!inner(id,status,sort_order,students!inner(id,display_name)),
    profiles(display_name),assistant_sessions(display_name)
  `).eq('session_id', sessionId)
  if (error) throw error
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
  })).sort((a: any, b: any) => a.sortOrder - b.sortOrder)
  return {
    sessionId: session.id,
    crewId: session.crew_id,
    crewName: (session.crews as any).name,
    attendanceDate: session.attendance_date,
    actor,
    members,
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
  const date = kstDate()
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
    session_id,status,actor_type,marked_at,updated_at,
    crew_memberships!inner(status,students!inner(display_name)),
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
    }
  })
  if (body.crew) rows = rows.filter((row: any) => row.crewName.includes(String(body.crew)))
  if (body.student) rows = rows.filter((row: any) => row.studentName.includes(String(body.student)))
  if (body.status) rows = rows.filter((row: any) => row.attendanceStatus === body.status)
  if (body.actor) rows = rows.filter((row: any) => row.actorName.includes(String(body.actor)))
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
  if (body.operation !== 'create') throw new Error('지원하지 않는 작업입니다.')
  return addStudent(req, body)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req.headers.get('origin')) })
  if (req.method !== 'POST') return fail(req, 'POST 요청만 지원합니다.', 405)
  try {
    const body = await req.json() as Json
    const action = String(body.action ?? '')
    const handlers: Record<string, () => Promise<unknown>> = {
      'list-login-teachers': () => loginCards(),
      'teacher-login': () => teacherLogin(body.teacherId, body.pin),
      'get-profile': () => getProfile(req),
      'get-attendance': () => getAttendance(req, body),
      'mark-attendance': () => markAttendance(req, body),
      'assistant-start': () => assistantStart(body),
      'assistant-correct-name': () => correctAssistantName(body),
      'assistant-mark-attendance': () => assistantMark(body),
      'add-student': () => addStudent(req, body),
      'set-membership-status': () => setMembershipStatus(req, body),
      'dashboard': () => dashboard(req, body),
      'admin-create-user': () => createUser(req, body),
      'admin-reset-pin': () => resetPin(req, body),
      'admin-manage-crew': () => manageCrew(req, body),
      'admin-manage-student': () => manageStudent(req, body),
      'bootstrap-executive': () => createUser(req, body, true),
    }
    if (!handlers[action]) return fail(req, '지원하지 않는 요청입니다.', 404)
    return reply(req, await handlers[action]())
  } catch (error) {
    console.error(error)
    return fail(req, error instanceof Error ? error.message : '요청 처리 중 오류가 발생했습니다.', 400)
  }
})
