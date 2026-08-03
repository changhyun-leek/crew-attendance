import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  History,
  LayoutDashboard,
  ListPlus,
  LockKeyhole,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { api, isDemoMode } from './lib/api'
import { thisWeekSunday } from './lib/date'
import { buildReportText, downloadText, rowsToCsv } from './lib/export'
import { downloadRegistryWorkbook } from './lib/registryXlsx'
import { PwaInstallControl, PwaUpdateNotice } from './PwaInstall'
import { ThemeControl } from './Theme'
import { AttendanceReminderPanel, TeacherNotificationControl } from './PushNotifications'
import type {
  AttendanceExportRow,
  AttendanceMember,
  AttendanceSnapshot,
  AttendanceStatus,
  AuthenticatedProfile,
  ContactStatus,
  CrewLoginCard,
  DashboardSummary,
  FeedbackItem,
  AdminWorkspaceData,
} from './types'

type Screen = 'login' | 'attendance' | 'dashboard'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null)
  const [snapshot, setSnapshot] = useState<AttendanceSnapshot | null>(null)
  const [assistantMode, setAssistantMode] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    api.profile().then((restored) => {
      if (!restored) return
      setProfile(restored)
      setScreen(restored.role === 'executive' ? 'dashboard' : 'attendance')
    }).catch(() => undefined)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  async function logout() {
    await api.logout()
    setProfile(null)
    setSnapshot(null)
    setAssistantMode(false)
    setScreen('login')
  }

  if (screen === 'login') {
    return <><PwaInstallControl /><PwaUpdateNotice /><LoginPage onLogin={(nextProfile) => {
      setProfile(nextProfile)
      setScreen(nextProfile.role === 'executive' ? 'dashboard' : 'attendance')
    }} onAssistant={(nextSnapshot) => {
      setAssistantMode(true)
      setSnapshot(nextSnapshot)
      setScreen('attendance')
    }} /></>
  }

  if (screen === 'dashboard' && profile?.role === 'executive') {
    return <><PwaInstallControl /><PwaUpdateNotice /><ExecutiveDashboard profile={profile} onLogout={logout} /><FeedbackButton onClick={() => setFeedbackOpen(true)} />{feedbackOpen && <FeedbackDialog actorName={profile.name} actorRole="executive" page="임원 화면" onClose={() => setFeedbackOpen(false)} />}</>
  }

  return <><PwaInstallControl /><PwaUpdateNotice /><AttendancePage
    profile={profile}
    initialSnapshot={snapshot}
    assistantMode={assistantMode}
    online={online}
    onLogout={logout}
  /><FeedbackButton onClick={() => setFeedbackOpen(true)} />{feedbackOpen && <FeedbackDialog actorName={snapshot?.actor.name ?? profile?.name ?? '보조교사'} actorRole={assistantMode ? 'assistant' : 'teacher'} page="출석체크" onClose={() => setFeedbackOpen(false)} />}</>
}

function LoginPage({ onLogin, onAssistant }: {
  onLogin: (profile: AuthenticatedProfile) => void
  onAssistant: (snapshot: AttendanceSnapshot) => void
}) {
  const [entry, setEntry] = useState<'choose' | 'teacher' | 'executive' | 'assistant'>(() => {
    const role = new URLSearchParams(window.location.search).get('role')
    return role === 'teacher' || role === 'executive' || role === 'assistant' ? role : 'choose'
  })
  const [cards, setCards] = useState<CrewLoginCard[]>([])
  const [selected, setSelected] = useState<CrewLoginCard | null>(null)
  const [assistantCard, setAssistantCard] = useState<CrewLoginCard | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.loginCards().then(setCards).catch(() => setError('로그인 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')).finally(() => setLoading(false))
  }, [])

  const teachers = cards.filter((card) => card.role !== 'executive')
  const executives = cards.filter((card) => card.role === 'executive')
  const source = entry === 'executive' ? executives : teachers
  const filtered = source.filter((card) => `${card.teacherName} ${card.crewName}`.includes(query.trim()))

  function openEntry(next: 'teacher' | 'executive' | 'assistant') {
    setEntry(next)
    setQuery('')
  }

  return <main className="login-shell">
    <div className="login-theme-control"><ThemeControl /></div>
    <section className="login-hero">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <p className="eyebrow">생명샘동천교회</p>
      <h1>새벽이슬 청소년부<br />출석관리</h1>
      <p className="hero-copy">담당 선생님 이름을 누르고 출석을 시작하세요.</p>
      {isDemoMode && <span className="demo-badge">미리보기 · PIN 1234</span>}
    </section>

    <section className="login-panel" aria-labelledby="teacher-title">
      {entry === 'choose' ? <>
        <div className="section-heading"><div><p className="eyebrow">시작하기</p><h2 id="teacher-title">어떤 선생님이신가요?</h2></div><Users aria-hidden="true" /></div>
        <p className="large-guide">아래에서 해당하는 버튼을 눌러주세요.</p>
        <div className="role-entry-grid">
          <button onClick={() => openEntry('teacher')}><span className="role-number">1</span><span><strong>크루교사</strong><small>내 크루 출석체크와 학생 관리</small></span><span className="card-arrow">›</span></button>
          <button onClick={() => openEntry('executive')}><span className="role-number executive">2</span><span><strong>임원교사</strong><small>전체 출석, 공지와 보고사항 관리</small></span><span className="card-arrow">›</span></button>
          <button onClick={() => openEntry('assistant')}><span className="role-number assistant">3</span><span><strong>보조교사</strong><small>이름만 입력하고 오늘 출석체크</small></span><span className="card-arrow">›</span></button>
        </div>
      </> : <>
        <button className="back-link" onClick={() => setEntry('choose')}>← 처음 선택으로</button>
        <div className="section-heading"><div><p className="eyebrow">{entry === 'teacher' ? '크루교사' : entry === 'executive' ? '임원교사' : '보조교사'}</p><h2 id="teacher-title">{entry === 'assistant' ? '담당 크루를 선택해주세요' : '선생님 이름을 선택해주세요'}</h2></div>{entry === 'executive' ? <ShieldCheck /> : <Users />}</div>
        <label className="teacher-search" htmlFor="teacher-search"><Search /><span>이름 검색</span><input id="teacher-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="선생님 이름을 입력하세요" autoComplete="off" /></label>
        {loading && <LoadingBlock label="교사 목록을 불러오는 중" />}
        {error && <ErrorBlock message={error} />}
        <div className="teacher-grid">
          {filtered.map((card) => <button className="teacher-card" key={card.teacherId} onClick={() => entry === 'assistant' ? setAssistantCard(card) : setSelected(card)}>
            <span className="avatar" aria-hidden="true">{card.teacherName.slice(0, 1)}</span>
            <span><strong>{card.teacherName} 선생님 {card.needsSetup && <em className="first-use-badge">처음 사용</em>}</strong><small>{card.crewName}</small></span>
            <span className="card-arrow" aria-hidden="true">›</span>
          </button>)}
          {!loading && !filtered.length && <p className="empty-result">검색 결과가 없습니다. 이름을 다시 확인해주세요.</p>}
        </div>
      </>}
    </section>

    <footer className="login-footer">학생 출석 정보는 승인된 교사와 임원만 관리합니다.</footer>
    {selected && (selected.needsSetup ? <FirstPinSetupModal card={selected} onClose={() => setSelected(null)} onSuccess={onLogin} /> : <PinModal card={selected} onClose={() => setSelected(null)} onAssistant={() => {
      if (selected.role === 'executive') return
      setAssistantCard(selected)
      setSelected(null)
    }} onSuccess={onLogin} />)}
    {assistantCard && <AssistantModal card={assistantCard} onClose={() => setAssistantCard(null)} onSuccess={onAssistant} />}
  </main>
}

function FirstPinSetupModal({ card, onClose, onSuccess }: {
  card: CrewLoginCard
  onClose: () => void
  onSuccess: (profile: AuthenticatedProfile) => void
}) {
  const [phoneLast4, setPhoneLast4] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!/^\d{4}$/.test(phoneLast4)) return setError('본인 휴대폰 번호의 마지막 4자리를 입력해주세요.')
    if (!/^\d{4,6}$/.test(pin)) return setError('새 PIN은 숫자 4~6자리로 정해주세요.')
    if (pin !== confirmPin) return setError('새 PIN 두 개가 서로 다릅니다.')
    setBusy(true); setError('')
    try { onSuccess(await api.teacherFirstSetup(card.teacherId, phoneLast4, pin)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '처음 사용 설정에 실패했습니다.') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="pin-sheet first-setup-sheet" role="dialog" aria-modal="true" aria-labelledby="first-pin-title">
      <button className="icon-button close-button" onClick={onClose} aria-label="닫기"><X /></button>
      <div className="pin-header"><span className="avatar large">{card.teacherName.slice(0, 1)}</span><div><h2 id="first-pin-title">처음 사용 설정</h2><p>{card.teacherName} 선생님 · {card.crewName}</p></div></div>
      <div className="first-setup-guide"><strong>처음 한 번만 확인합니다</strong><p>교적부에 등록된 본인 휴대폰 번호 끝 4자리를 입력한 뒤, 앞으로 사용할 PIN을 직접 정해주세요.</p>{isDemoMode && <small>미리보기 본인 확인 번호: 0000</small>}</div>
      <form className="first-setup-form" onSubmit={submit}>
        <label>휴대폰 번호 끝 4자리<input autoFocus inputMode="numeric" autoComplete="off" value={phoneLast4} onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="예: 1234" maxLength={4} /></label>
        <label>새 로그인 PIN (숫자 4~6자리)<input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="새 PIN" maxLength={6} /></label>
        <label>새 PIN 한 번 더<input type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="새 PIN 확인" maxLength={6} /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? '설정 중…' : '내 PIN 설정하고 시작'}</button>
      </form>
      <p className="privacy-note"><ShieldCheck size={16} /> 휴대폰 번호 원문은 저장하지 않으며 본인 확인에만 사용합니다.</p>
    </section>
  </div>
}

function PinModal({ card, onClose, onAssistant, onSuccess }: {
  card: CrewLoginCard
  onClose: () => void
  onAssistant: () => void
  onSuccess: (profile: AuthenticatedProfile) => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9]

  async function submit() {
    if (pin.length < 4) return setError('PIN 4~6자리를 입력해주세요.')
    setBusy(true)
    setError('')
    try { onSuccess(await api.teacherLogin(card.teacherId, pin)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '로그인에 실패했습니다.'); setPin('') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy) return
      if (event.key >= '0' && event.key <= '9') {
        setPin((current) => current.length < 6 ? `${current}${event.key}` : current)
      } else if (event.key === 'Backspace') {
        setPin((current) => current.slice(0, -1))
      } else if (event.key === 'Enter') {
        void submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return <div className="modal-backdrop" role="presentation">
    <section className="pin-sheet" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <button className="icon-button close-button" onClick={onClose} aria-label="닫기"><X /></button>
      <div className="pin-header"><span className="avatar large">{card.teacherName.slice(0, 1)}</span><div><h2 id="pin-title">{card.teacherName} {card.role === 'executive' ? '임원' : '선생님'}</h2><p>{card.crewName}</p></div></div>
      <p className="pin-guide">숫자 PIN을 입력해주세요</p>
      <div className="pin-dots" aria-label={`${pin.length}자리 입력됨`}>{[0, 1, 2, 3, 4, 5].map((index) => <span key={index} className={pin.length > index ? 'filled' : ''} />)}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="keypad">
        {digits.map((digit) => <button key={digit} disabled={busy || pin.length >= 6} onClick={() => setPin(`${pin}${digit}`)}>{digit}</button>)}
        <button aria-label="한 자리 지우기" disabled={busy || !pin} onClick={() => setPin(pin.slice(0, -1))}>←</button>
        <button disabled={busy || pin.length >= 6} onClick={() => setPin(`${pin}0`)}>0</button>
        <button className="keypad-confirm" aria-label="PIN 확인" disabled={busy || pin.length < 4} onClick={submit}>{busy ? <RefreshCw className="spin" /> : <Check />}</button>
      </div>
      {card.role !== 'executive' && <button className="assistant-link" onClick={onAssistant}>보조교사로 출석하기</button>}
    </section>
  </div>
}

function AssistantModal({ card, onClose, onSuccess }: {
  card: CrewLoginCard
  onClose: () => void
  onSuccess: (snapshot: AttendanceSnapshot) => void
}) {
  const storageKey = `assistant-recent-${card.crewId}`
  const [recent] = useState<string[]>(() => JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const normalized = name.trim().replace(/\s+/g, ' ')
    if (normalized.length < 2) return setError('보조교사 이름을 두 글자 이상 입력해주세요.')
    setBusy(true)
    try {
      const nextRecent = [normalized, ...recent.filter((value) => value !== normalized)].slice(0, 5)
      localStorage.setItem(storageKey, JSON.stringify(nextRecent))
      onSuccess(await api.assistantStart(card.crewId, normalized))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '출석 화면을 열지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><section className="assistant-sheet" role="dialog" aria-modal="true" aria-labelledby="assistant-title">
    <button className="icon-button close-button" onClick={onClose} aria-label="닫기"><X /></button>
    <p className="eyebrow">{card.crewName}</p><h2 id="assistant-title">보조교사 출석체크</h2>
    <p>변경 기록에 표시할 선생님 이름을 입력해주세요.</p>
    {!!recent.length && <div className="recent-names"><span>최근 이름</span>{recent.map((value) => <button key={value} onClick={() => setName(value)}>{value}</button>)}</div>}
    <form onSubmit={submit}>
      <label htmlFor="assistant-name">보조교사 이름</label>
      <input id="assistant-name" autoFocus autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 홍길동" maxLength={20} />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? '여는 중…' : '이 이름으로 출석체크'}</button>
    </form>
    <p className="privacy-note"><AlertTriangle size={16} /> 당일 출석만 변경할 수 있으며 모든 변경에 입력한 이름이 남습니다.</p>
  </section></div>
}

function AttendancePage({ profile, initialSnapshot, assistantMode, online, onLogout }: {
  profile: AuthenticatedProfile | null
  initialSnapshot: AttendanceSnapshot | null
  assistantMode: boolean
  online: boolean
  onLogout: () => void
}) {
  const [date, setDate] = useState(initialSnapshot?.attendanceDate ?? thisWeekSunday())
  const [data, setData] = useState<AttendanceSnapshot | null>(initialSnapshot)
  const [loading, setLoading] = useState(!initialSnapshot)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const [longOpen, setLongOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [newStudent, setNewStudent] = useState('')
  const [nameEditOpen, setNameEditOpen] = useState(false)
  const [assistantName, setAssistantName] = useState(initialSnapshot?.actor.name ?? '')
  const [detailMember, setDetailMember] = useState<AttendanceMember | null>(null)
  const [pinChangeOpen, setPinChangeOpen] = useState(false)

  const crewId = initialSnapshot?.crewId ?? profile?.crewId ?? ''
  const load = async () => {
    if (assistantMode && initialSnapshot) return
    setLoading(true); setError('')
    try { setData(await api.attendance(crewId, date)) }
    catch { setError('출석 명단을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (crewId) void load() }, [crewId, date])

  const active = data?.members.filter((member) => member.membershipStatus === 'active') ?? []
  const longAbsent = data?.members.filter((member) => member.membershipStatus === 'long_absence') ?? []
  const counts = useMemo(() => ({
    present: active.filter((member) => member.attendanceStatus === 'present').length,
    absent: active.filter((member) => member.attendanceStatus === 'absent').length,
    unchecked: active.filter((member) => member.attendanceStatus === 'unchecked').length,
  }), [active])

  async function mark(member: AttendanceMember, status: AttendanceStatus) {
    if (!data || !online) return
    const next = member.attendanceStatus === status ? 'unchecked' : status
    setData({ ...data, members: data.members.map((item) => item.membershipId === member.membershipId ? { ...item, attendanceStatus: next, actor: data.actor } : item) })
    setSaveState((state) => ({ ...state, [member.membershipId]: 'saving' }))
    try {
      await api.mark(data.sessionId, member.membershipId, next, assistantMode)
      setSaveState((state) => ({ ...state, [member.membershipId]: 'saved' }))
    } catch {
      setSaveState((state) => ({ ...state, [member.membershipId]: 'error' }))
      await load()
    }
  }

  async function markUncheckedAbsent() {
    if (!data || !confirm(`미체크 ${counts.unchecked}명을 모두 결석 처리할까요?`)) return
    for (const member of active.filter((item) => item.attendanceStatus === 'unchecked')) await mark(member, 'absent')
  }

  async function copyReport() {
    if (!data) return
    await navigator.clipboard.writeText(buildReportText(date, data.crewName, data.members))
    alert('보고 문구를 복사했습니다.')
  }

  async function addStudent(event: FormEvent) {
    event.preventDefault()
    const name = newStudent.trim()
    if (!name) return
    await api.addStudent(crewId, name)
    setNewStudent(''); await load()
  }

  async function changeMembership(member: AttendanceMember, status: 'active' | 'long_absence' | 'left') {
    if (status === 'left' && !confirm(`${member.name} 학생을 크루 퇴실 처리할까요? 과거 기록은 보존됩니다.`)) return
    await api.setMembershipStatus(member.membershipId, status)
    await load()
  }

  async function correctAssistantName(event: FormEvent) {
    event.preventDefault()
    const normalized = assistantName.trim().replace(/\s+/g, ' ')
    if (!normalized) return
    const corrected = await api.correctAssistantName(normalized)
    setData(corrected); setNameEditOpen(false)
  }

  return <main className="attendance-shell">
    {!online && <div className="offline-banner" role="alert"><AlertTriangle /> 인터넷 연결이 없습니다. 연결되기 전에는 출석이 저장되지 않습니다.</div>}
    <header className="attendance-header">
      <div><p className="eyebrow">새벽이슬 청소년부</p><h1>{data?.crewName ?? profile?.crewName ?? '출석체크'}</h1></div>
      <button className="header-user" onClick={assistantMode ? () => setNameEditOpen(true) : undefined}>
        <span>{data?.actor.name ?? profile?.name}</span><small>{assistantMode ? '보조교사 · 이름 수정' : '담당교사'}</small>
      </button>
      <ThemeControl variant="compact" />
      <button className="icon-button" onClick={onLogout} aria-label="나가기"><LogOut /></button>
    </header>
    <section className="attendance-sticky">
      <label htmlFor="attendance-date">출석 날짜 <small>이번 주 주일로 자동 설정</small></label>
      <input id="attendance-date" type="date" value={date} disabled={assistantMode} onChange={(event) => setDate(event.target.value)} />
      <div className="count-grid">
        <div className="count present"><span>출석</span><strong>{counts.present}</strong></div>
        <div className="count absent"><span>결석</span><strong>{counts.absent}</strong></div>
        <div className="count unchecked"><span>미체크</span><strong>{counts.unchecked}</strong></div>
      </div>
    </section>
    {loading && <LoadingBlock label="출석 명단을 불러오는 중" />}
    {error && <ErrorBlock message={error} onRetry={load} />}
    {data && <>
      {!!data.announcements.length && <section className="announcement-stack" aria-label="임원 공지">
        {data.announcements.map((item) => <article key={item.id}><Megaphone /><div><strong>{item.title}</strong><p>{item.body}</p></div></article>)}
      </section>}
      <section className="attendance-list" aria-label="학생 출석 명단">
        {active.map((member) => <AttendanceRow key={member.membershipId} member={member} state={saveState[member.membershipId] ?? 'idle'} disabled={!online} onMark={mark} onDetails={() => setDetailMember(member)} />)}
      </section>
      {!!longAbsent.length && <section className="long-absence-card">
        <button className="collapse-button" onClick={() => setLongOpen(!longOpen)} aria-expanded={longOpen}><span>장기결석 {longAbsent.length}명</span><ChevronDown className={longOpen ? 'rotate' : ''} /></button>
        {longOpen && <div>{longAbsent.map((member) => <div className="long-row" key={member.membershipId}><span>{member.name}</span>{!assistantMode && <button onClick={() => changeMembership(member, 'active')}>복귀</button>}</div>)}</div>}
      </section>}
      <section className="attendance-actions">
        {!!counts.unchecked && <button className="outline-danger" onClick={markUncheckedAbsent}>미체크 {counts.unchecked}명 모두 결석 처리</button>}
        <button className="primary-button" onClick={copyReport}><Clipboard /> 보고 문구 복사</button>
        {!assistantMode && <button className="secondary-button" onClick={() => setManageOpen(!manageOpen)}><Settings /> 학생 관리</button>}
        {!assistantMode && <button className="secondary-button" onClick={() => setPinChangeOpen(true)}><LockKeyhole /> 내 PIN 변경</button>}
      </section>
      {!assistantMode && <TeacherNotificationControl />}
      {manageOpen && !assistantMode && <section className="management-card">
        <h2>학생 관리</h2>
        <form className="inline-form" onSubmit={addStudent}><label htmlFor="new-student">새 학생 이름</label><div><input id="new-student" value={newStudent} onChange={(event) => setNewStudent(event.target.value)} /><button>추가</button></div></form>
        <div className="manage-list">{active.map((member) => <div key={member.membershipId}><span>{member.name}</span><div><button onClick={() => changeMembership(member, 'long_absence')}>장기결석</button><button className="text-danger" onClick={() => changeMembership(member, 'left')}>퇴실</button></div></div>)}</div>
      </section>}
    </>}
    {nameEditOpen && <div className="modal-backdrop"><form className="small-dialog" onSubmit={correctAssistantName}><button type="button" className="icon-button close-button" onClick={() => setNameEditOpen(false)} aria-label="닫기"><X /></button><h2>보조교사 이름 수정</h2><p>현재 세션의 표시 이름이 바뀌며 이전 이름도 변경 이력에 남습니다.</p><label htmlFor="corrected-name">보조교사 이름</label><input id="corrected-name" value={assistantName} onChange={(event) => setAssistantName(event.target.value)} /><button className="primary-button">이름 수정</button></form></div>}
    {pinChangeOpen && <PinChangeDialog onClose={() => setPinChangeOpen(false)} />}
    {detailMember && data && <StudentDetailsDialog member={detailMember} fields={data.customFields} assistantMode={assistantMode} onClose={() => setDetailMember(null)} onSave={async (details) => {
      const updated = await api.updateAttendanceDetails(data.sessionId, detailMember.membershipId, details, assistantMode)
      setData(updated); setDetailMember(null)
    }} />}
  </main>
}

function AttendanceRow({ member, state, disabled, onMark, onDetails }: { member: AttendanceMember; state: SaveState; disabled: boolean; onMark: (member: AttendanceMember, status: AttendanceStatus) => void; onDetails: () => void }) {
  return <article className={`attendance-row ${state === 'error' ? 'save-error' : ''}`}>
    <div className="student-name"><strong>{member.name}{(member.specialNote || member.absenceReason) && <span className="note-dot" title="작성된 비고 있음">!</span>}</strong><small>{state === 'saving' ? '저장 중…' : state === 'saved' ? '저장됨' : state === 'error' ? '저장 실패' : member.actor ? `${member.actor.name} 체크` : '아직 미체크'}</small><button className="details-button" onClick={onDetails}><MessageSquare />사유·비고</button></div>
    <div className="status-buttons">
      <button disabled={disabled} className={member.attendanceStatus === 'present' ? 'selected-present' : ''} onClick={() => onMark(member, 'present')}><Check />출석</button>
      <button disabled={disabled} className={member.attendanceStatus === 'absent' ? 'selected-absent' : ''} onClick={() => onMark(member, 'absent')}><X />결석</button>
    </div>
  </article>
}

function PinChangeDialog({ onClose }: { onClose: () => void }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const pinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (newPin !== confirmPin) return setError('새 PIN 두 번이 서로 다릅니다.')
    if (newPin.length < 4) return setError('새 PIN을 숫자 4~6자리로 입력해주세요.')
    setBusy(true)
    try { await api.changePin(currentPin, newPin); setDone(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'PIN을 변경하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="small-dialog pin-change-dialog" onSubmit={submit}><button type="button" className="icon-button close-button" onClick={onClose} aria-label="PIN 변경 닫기"><X /></button>{done ? <><Check className="sent-icon" /><h2>PIN을 변경했습니다</h2><p>다음 로그인부터 새 PIN을 사용해주세요. 현재 로그인은 그대로 유지됩니다.</p><button type="button" className="primary-button" onClick={onClose}>확인</button></> : <><p className="eyebrow">내 로그인 관리</p><h2>내 PIN 변경</h2><p>본인 확인을 위해 현재 PIN을 먼저 입력합니다. 숫자 6자리를 권장합니다.</p><label>현재 PIN<input autoFocus required type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4,6}" value={currentPin} onChange={(event) => setCurrentPin(pinInput(event.target.value))} /></label><label>새 PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,6}" value={newPin} onChange={(event) => setNewPin(pinInput(event.target.value))} /></label><label>새 PIN 한 번 더<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,6}" value={confirmPin} onChange={(event) => setConfirmPin(pinInput(event.target.value))} /></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? '변경 중…' : 'PIN 변경하기'}</button></>}</form></div>
}

function StudentDetailsDialog({ member, fields, assistantMode, onClose, onSave }: { member: AttendanceMember; fields: AttendanceSnapshot['customFields']; assistantMode: boolean; onClose: () => void; onSave: (details: { absenceReason: string; contactStatus: ContactStatus; specialNote?: string; customResponses: Record<string, string> }) => Promise<void> }) {
  const [reason, setReason] = useState(member.absenceReason ?? '')
  const [contact, setContact] = useState<ContactStatus>(member.contactStatus ?? 'not_contacted')
  const [note, setNote] = useState(member.specialNote ?? '')
  const [responses, setResponses] = useState<Record<string, string>>(member.customResponses ?? {})
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await onSave({ absenceReason: reason.trim(), contactStatus: contact, specialNote: assistantMode ? undefined : note.trim(), customResponses: responses }) }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="details-sheet" onSubmit={submit}>
    <button type="button" className="icon-button close-button" onClick={onClose} aria-label="닫기"><X /></button>
    <p className="eyebrow">학생 확인사항</p><h2>{member.name} 학생</h2>
    <label>연락 상태<select value={contact} onChange={(event) => setContact(event.target.value as ContactStatus)}><option value="not_contacted">아직 연락 안 함</option><option value="no_answer">연락 안 됨</option><option value="contacted">연락 완료</option><option value="other">기타</option></select></label>
    <label>결석·특수 사유<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 감기 증상, 가족 일정, 연락 안 됨" maxLength={500} /></label>
    {!assistantMode && <label>임원이 계속 알아야 할 학생 비고<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="예: 장학금 신청 서류 확인 필요" maxLength={1000} /></label>}
    {!!fields.length && <div className="temporary-fields"><h3>임원 요청 확인사항</h3>{fields.map((field) => <label key={field.id}>{field.title}{field.description && <small>{field.description}</small>}{field.fieldType === 'select' ? <select required={field.required} value={responses[field.id] ?? ''} onChange={(event) => setResponses({ ...responses, [field.id]: event.target.value })}><option value="">선택해주세요</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input required={field.required} value={responses[field.id] ?? ''} onChange={(event) => setResponses({ ...responses, [field.id]: event.target.value })} />}</label>)}</div>}
    {assistantMode && <p className="privacy-note"><AlertTriangle size={16} />보조교사는 당일 사유와 임시 확인사항만 작성할 수 있습니다.</p>}
    <button className="primary-button" disabled={busy}>{busy ? '저장 중…' : '사유·비고 저장'}</button>
  </form></div>
}

type AdminTab = 'overview' | 'records' | 'notices' | 'feedback' | 'crews' | 'teachers' | 'students' | 'events'
function ExecutiveDashboard({ profile, onLogout }: { profile: AuthenticatedProfile; onLogout: () => void }) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [filters, setFilters] = useState({ from: thisWeekSunday(), to: thisWeekSunday(), crew: '', student: '', status: '', actor: '', notes: '' })
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [rows, setRows] = useState<AttendanceExportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    try { const data = await api.dashboard(filters); setSummary(data.summary); setRows(data.rows) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function csv() { downloadText(`새벽이슬_출석_${filters.from}_${filters.to}.csv`, rowsToCsv(rows), 'text/csv;charset=utf-8') }
  function xlsx() {
    downloadRegistryWorkbook(`새벽이슬_교적부형식_출석_${filters.from}_${filters.to}.xlsx`, rows)
    setNotice('기존 교적부 형식의 Excel 파일을 만들었습니다. 개인정보 열은 빈칸으로 유지됩니다.')
  }
  function txt() {
    const grouped = rows.reduce<Record<string, AttendanceExportRow[]>>((groups, row) => {
      const key = `${row.attendanceDate}|${row.crewName}`
      groups[key] = [...(groups[key] ?? []), row]
      return groups
    }, {})
    const text = Object.entries(grouped).map(([key, values]) => {
      const [date, crew] = key.split('|')
      const members = values.map((row, index) => ({ membershipId: String(index), studentId: String(index), name: row.studentName, membershipStatus: row.membershipStatus, attendanceStatus: row.attendanceStatus, sortOrder: index }))
      return buildReportText(date, crew, members)
    }).join('\n\n')
    downloadText(`새벽이슬_출석_${filters.from}_${filters.to}.txt`, text)
  }

  const nav = [
    ['overview', '전체 현황', LayoutDashboard], ['records', '출석 기록', BarChart3], ['notices', '공지·임시 항목', Megaphone],
    ['feedback', '오류·개선 의견', MessageSquare], ['crews', '크루 관리', Users], ['teachers', '교사 관리', UserCog], ['students', '학생 관리', UserPlus], ['events', '변경 이력', History],
  ] as const

  return <div className="dashboard-shell">
    <aside className={mobileNav ? 'dashboard-nav open' : 'dashboard-nav'}>
      <div className="dashboard-brand"><div className="brand-mark small"><span /></div><div><strong>새벽이슬</strong><small>출석관리</small></div></div>
      <nav>{nav.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setMobileNav(false) }}><Icon />{label}</button>)}</nav>
      <div className="nav-user"><span>{profile.name}</span><small>임원 관리자</small><ThemeControl variant="nav" /><button onClick={onLogout}><LogOut />로그아웃</button></div>
    </aside>
    <main className="dashboard-main">
      <header className="dashboard-header"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="메뉴"><Menu /></button><div><p className="eyebrow">임원 전용</p><h1>{nav.find(([id]) => id === tab)?.[1]}</h1></div><div className="export-buttons"><button onClick={txt}><Download />TXT</button><button onClick={csv}><Download />CSV</button><button onClick={xlsx}><Download />교적부 XLSX</button></div></header>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="닫기"><X /></button></div>}
      {(tab === 'overview' || tab === 'records') && <>
        {tab === 'overview' && <AttendanceReminderPanel date={thisWeekSunday()} />}
        <section className="filter-bar">
          <label>시작일<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>종료일<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <label>크루<input placeholder="전체 크루" value={filters.crew} onChange={(event) => setFilters({ ...filters, crew: event.target.value })} /></label>
          <label>학생<input placeholder="학생 이름" value={filters.student} onChange={(event) => setFilters({ ...filters, student: event.target.value })} /></label>
          <label>상태<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">전체</option><option value="present">출석</option><option value="absent">결석</option><option value="unchecked">미체크</option></select></label>
          <label>비고<select value={filters.notes} onChange={(event) => setFilters({ ...filters, notes: event.target.value })}><option value="">전체</option><option value="yes">비고 있는 학생만</option></select></label>
          <button className="filter-submit" onClick={load}><Search />조회</button>
        </section>
        {summary && <section className="summary-grid"><SummaryCard label="운영 크루" value={`${summary.totalCrews}개`} /><SummaryCard label="등록 학생" value={`${summary.totalStudents}명`} /><SummaryCard label="출석" value={`${summary.present}명`} tone="green" /><SummaryCard label="결석" value={`${summary.absent}명`} tone="red" /><SummaryCard label="출석률" value={`${summary.attendanceRate}%`} tone="purple" /></section>}
        <RecordsTable rows={rows} loading={loading} />
      </>}
      {(tab === 'crews' || tab === 'teachers' || tab === 'students') && <AdminManagement tab={tab} onDone={() => { setNotice('저장했습니다.'); void load() }} />}
      {(tab === 'notices' || tab === 'feedback') && <ExecutiveWorkspace tab={tab} onNotice={setNotice} />}
      {tab === 'events' && <section className="data-card"><div className="data-card-header"><h2>최근 변경 이력</h2><p>체크자와 변경 전후 상태를 시간순으로 확인합니다.</p></div><RecordsTable rows={rows} loading={loading} compact /></section>}
    </main>
  </div>
}

function ExecutiveWorkspace({ tab, onNotice }: { tab: 'notices' | 'feedback'; onNotice: (message: string) => void }) {
  const [workspace, setWorkspace] = useState<{ announcements: AttendanceSnapshot['announcements']; customFields: AttendanceSnapshot['customFields']; feedback: FeedbackItem[] }>({ announcements: [], customFields: [], feedback: [] })
  const [form, setForm] = useState({ kind: 'announcement', title: '', body: '', options: '', activeFrom: new Date().toISOString().slice(0, 10), activeUntil: '', required: 'false' })
  const [busy, setBusy] = useState(false)
  const load = () => api.adminWorkspace().then(setWorkspace)
  useEffect(() => { void load() }, [])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      if (form.kind === 'announcement') await api.adminAction('admin-create-announcement', form)
      else await api.adminAction('admin-create-custom-field', { ...form, fieldType: 'select', options: form.options.split(',').map((value) => value.trim()).filter(Boolean), required: form.required === 'true' })
      setForm({ ...form, title: '', body: '', options: '' }); onNotice('새 항목을 게시했습니다.'); await load()
    } finally { setBusy(false) }
  }
  if (tab === 'feedback') return <section className="data-card"><div className="data-card-header"><div><h2>교사 의견함</h2><p>새 의견부터 확인하고 처리 상태를 남겨주세요.</p></div></div><div className="feedback-list">{workspace.feedback.map((item) => <article key={item.id} className={item.status === 'new' ? 'new' : ''}><div><span className={`feedback-status ${item.status}`}>{item.status === 'new' ? '새 의견' : item.status === 'reviewing' ? '확인 중' : '완료'}</span><strong>{item.category} · {item.actorName}</strong><small>{item.page} · {item.createdAt.slice(0, 16).replace('T', ' ')}</small></div><p>{item.message}</p><select value={item.status} onChange={async (event) => { await api.adminAction('admin-update-feedback', { id: item.id, status: event.target.value }); await load() }}><option value="new">새 의견</option><option value="reviewing">확인 중</option><option value="done">완료</option></select></article>)}{!workspace.feedback.length && <p className="empty-result">접수된 의견이 없습니다.</p>}</div></section>
  return <section className="workspace-grid"><form className="admin-form workspace-form" onSubmit={submit}><div><p className="eyebrow">임원 게시</p><h2>공지 또는 임시 확인 칸 만들기</h2><p>출석 화면에 즉시 보여줄 안내와 기간 한정 조사 항목을 만듭니다.</p></div><label>종류<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option value="announcement">공지</option><option value="custom">학생별 임시 확인 칸</option></select></label><label>제목<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="예: 수련회 참석 여부" /></label><label>설명<textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="교사에게 보여줄 안내" /></label>{form.kind === 'custom' && <><label>선택 항목(쉼표로 구분)<input required value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} placeholder="신청, 미신청, 고려중" /></label><label>필수 입력<select value={form.required} onChange={(event) => setForm({ ...form, required: event.target.value })}><option value="false">선택</option><option value="true">필수</option></select></label></>}<div className="date-pair"><label>시작일<input type="date" required value={form.activeFrom} onChange={(event) => setForm({ ...form, activeFrom: event.target.value })} /></label><label>종료일<input type="date" required value={form.activeUntil} onChange={(event) => setForm({ ...form, activeUntil: event.target.value })} /></label></div><button className="primary-button" disabled={busy}>{busy ? '게시 중…' : '출석 화면에 게시'}</button></form><div className="workspace-current"><h2>현재 게시 중</h2>{workspace.announcements.map((item) => <article key={item.id}><Megaphone /><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.activeFrom} ~ {item.activeUntil}</small></div></article>)}{workspace.customFields.map((item) => <article key={item.id}><ListPlus /><div><strong>{item.title}</strong><p>{item.options.join(' · ')}</p><small>{item.activeFrom} ~ {item.activeUntil}</small></div></article>)}</div></section>
}

function AdminManagement({ tab, onDone }: { tab: 'crews' | 'teachers' | 'students'; onDone: () => void }) {
  const [workspace, setWorkspace] = useState<AdminWorkspaceData | null>(null)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [crewTeachers, setCrewTeachers] = useState<Record<string, string>>({})
  const [resetPins, setResetPins] = useState<Record<string, string>>({})
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({})
  const [studentSearch, setStudentSearch] = useState('')

  async function load() {
    const data = await api.adminWorkspace()
    setWorkspace(data)
    setCrewTeachers(Object.fromEntries(data.crews.map((crew) => [crew.id, crew.teacherId ?? ''])))
  }
  useEffect(() => { void load() }, [tab])

  async function run(action: string, payload: Record<string, unknown>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return
    setBusy(true)
    try { await api.adminAction(action, payload); await load(); onDone() }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      if (tab === 'crews') await run('admin-manage-crew', { operation: 'create', name, year: Number(extra) || new Date().getFullYear() })
      if (tab === 'teachers') await run('admin-create-user', { name, pin, role: extra || 'teacher' })
      if (tab === 'students') await run('admin-manage-student', { operation: 'create', name, crewId: extra })
      setName(''); setPin(''); setExtra('')
    } catch { /* run() reports a clear message */ }
  }

  if (!workspace) return <LoadingBlock label="관리 목록을 불러오는 중" />
  const activeCrews = workspace.crews.filter((crew) => crew.active)
  const teachers = workspace.users.filter((user) => user.role === 'teacher' && user.active)
  const visibleMemberships = workspace.memberships.filter((member) => member.studentName.includes(studentSearch.trim()))

  return <section className="management-stack">
    <div className="management-page">
      <div className="management-intro"><h2>{tab === 'crews' ? '새 크루 만들기' : tab === 'teachers' ? '교사·임원 등록' : '학생 등록'}</h2><p>이름을 보고 선택할 수 있도록 구성했습니다. 기존 기록은 삭제하지 않습니다.</p></div>
      <form className="admin-form" onSubmit={submit}>
        <label>{tab === 'crews' ? '크루명' : tab === 'teachers' ? '교사 이름' : '학생 이름'}<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        {tab === 'teachers' && <label>처음 사용할 4~6자리 PIN<input required inputMode="numeric" pattern="[0-9]{4,6}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
        <label>{tab === 'crews' ? '운영 연도' : tab === 'teachers' ? '역할' : '소속 크루'}
          {tab === 'teachers' ? <select value={extra || 'teacher'} onChange={(event) => setExtra(event.target.value)}><option value="teacher">담당교사</option><option value="executive">임원교사</option></select> : tab === 'students' ? <select required value={extra} onChange={(event) => setExtra(event.target.value)}><option value="">크루 선택</option>{activeCrews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select> : <input inputMode="numeric" value={extra} onChange={(event) => setExtra(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={String(new Date().getFullYear())} />}
        </label>
        <button className="primary-button" disabled={busy}>{busy ? '저장 중…' : '등록'}</button>
      </form>
      <div className="management-help"><ShieldCheck /><div><strong>기록 보존 원칙</strong><p>장기결석·퇴실·크루 이동·담당교사 교체 후에도 과거 출석은 그대로 남습니다.</p></div></div>
    </div>

    {tab === 'crews' && <div className="management-list"><h2>크루와 담당교사</h2>{workspace.crews.map((crew) => <article key={crew.id} className={!crew.active ? 'inactive' : ''}><div><strong>{crew.name}</strong><small>{crew.operatingYear}년 · {crew.active ? '운영 중' : '운영 종료'}{crew.teacherName ? ` · ${crew.teacherName} 선생님` : ' · 담당교사 미배정'}</small></div>{crew.active && <div className="management-actions"><select aria-label={`${crew.name} 담당교사`} value={crewTeachers[crew.id] ?? ''} onChange={(event) => setCrewTeachers({ ...crewTeachers, [crew.id]: event.target.value })}><option value="">담당교사 선택</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select><button disabled={busy || !crewTeachers[crew.id]} onClick={() => void run('admin-manage-crew', { operation: 'assign', crewId: crew.id, profileId: crewTeachers[crew.id] })}>배정 저장</button><button className="danger-button" disabled={busy} onClick={() => void run('admin-manage-crew', { operation: 'end', crewId: crew.id }, `${crew.name} 운영을 종료할까요? 과거 기록은 유지됩니다.`)}>운영 종료</button></div>}</article>)}</div>}

    {tab === 'teachers' && <div className="management-list"><h2>등록된 교사</h2>{workspace.users.map((user) => <article key={user.id} className={!user.active ? 'inactive' : ''}><div><strong>{user.name}</strong><small>{user.role === 'executive' ? '임원교사' : '담당교사'} · {user.active ? '사용 중' : '비활성'}</small></div><div className="management-actions"><input aria-label={`${user.name} 새 PIN`} inputMode="numeric" placeholder="새 PIN" value={resetPins[user.id] ?? ''} onChange={(event) => setResetPins({ ...resetPins, [user.id]: event.target.value.replace(/\D/g, '').slice(0, 6) })} /><button disabled={busy || (resetPins[user.id]?.length ?? 0) < 4} onClick={() => void run('admin-reset-pin', { profileId: user.id, pin: resetPins[user.id] }, `${user.name} 선생님의 PIN을 초기화할까요?`)}>PIN 초기화</button><button className={user.active ? 'danger-button' : ''} disabled={busy} onClick={() => void run('admin-manage-user', { operation: 'set-active', profileId: user.id, active: !user.active }, `${user.name} 계정을 ${user.active ? '비활성화' : '다시 활성화'}할까요?`)}>{user.active ? '비활성화' : '활성화'}</button></div></article>)}</div>}

    {tab === 'students' && <div className="management-list"><div className="management-list-header"><h2>학생 상태와 크루 이동</h2><input aria-label="학생 이름 검색" placeholder="학생 이름 검색" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} /></div>{visibleMemberships.map((member) => <article key={member.id}><div><strong>{member.studentName}</strong><small>{member.crewName} · {membershipLabel(member.status)}</small></div><div className="management-actions"><select aria-label={`${member.studentName} 상태`} value={member.status} onChange={(event) => void run('admin-manage-student', { operation: 'status', membershipId: member.id, status: event.target.value }, event.target.value === 'left' ? `${member.studentName} 학생을 퇴실 처리할까요?` : undefined)}><option value="active">활동</option><option value="long_absence">장기결석</option><option value="left">퇴실</option></select><select aria-label={`${member.studentName} 이동할 크루`} value={moveTargets[member.id] ?? ''} onChange={(event) => setMoveTargets({ ...moveTargets, [member.id]: event.target.value })}><option value="">이동할 크루</option>{activeCrews.filter((crew) => crew.id !== member.crewId).map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select><button disabled={busy || !moveTargets[member.id]} onClick={() => void run('admin-manage-student', { operation: 'move', membershipId: member.id, targetCrewId: moveTargets[member.id] }, `${member.studentName} 학생을 선택한 크루로 이동할까요?`)}>크루 이동</button></div></article>)}{!visibleMemberships.length && <p className="empty-result">해당 학생이 없습니다.</p>}</div>}
  </section>
}

function AttendanceDataTable({ rows, showCrew }: { rows: AttendanceExportRow[]; showCrew: boolean }) {
  return <div className="table-scroll"><table><thead><tr><th>출석일</th>{showCrew && <th>크루</th>}<th>학생명</th><th>학생상태</th><th>출석상태</th><th>결석 사유·연락</th><th>학생 비고</th><th>체크자</th><th>최종수정</th></tr></thead><tbody>{rows.map((row, index) => <tr className={row.hasImportantNote ? 'important-row' : ''} key={`${row.attendanceDate}-${row.crewName}-${row.studentName}-${index}`}><td>{row.attendanceDate}</td>{showCrew && <td>{row.crewName}</td>}<td><strong>{row.studentName}</strong>{row.hasImportantNote && <span className="important-badge">확인 필요</span>}</td><td>{membershipLabel(row.membershipStatus)}</td><td><span className={`table-status ${row.attendanceStatus}`}>{attendanceLabel(row.attendanceStatus)}</span></td><td>{row.attendanceStatus === 'absent' ? row.absenceReason || contactLabel(row.contactStatus) : '-'}</td><td>{row.specialNote || '-'}</td><td>{row.actorName}<small>{row.actorType}</small></td><td>{row.updatedAt.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody></table></div>
}

function RecordsTable({ rows, loading, compact = false }: { rows: AttendanceExportRow[]; loading: boolean; compact?: boolean }) {
  const groups = useMemo(() => Object.entries(rows.reduce<Record<string, AttendanceExportRow[]>>((result, row) => {
    result[row.crewName] = [...(result[row.crewName] ?? []), row]
    return result
  }, {})).sort(([left], [right]) => left.localeCompare(right, 'ko')), [rows])
  return <section className="data-card"><div className="data-card-header"><div><h2>{compact ? '변경 내역' : '출석 상세'}</h2><p>총 {rows.length}건 · 노란색 표시는 확인할 비고가 있는 학생입니다.</p></div></div>{loading ? <LoadingBlock label="데이터를 불러오는 중" /> : compact ? <AttendanceDataTable rows={rows} showCrew /> : <div className="crew-record-groups">{groups.map(([crewName, crewRows]) => {
    const present = crewRows.filter((row) => row.attendanceStatus === 'present').length
    const absent = crewRows.filter((row) => row.attendanceStatus === 'absent').length
    const unchecked = crewRows.filter((row) => row.attendanceStatus === 'unchecked').length
    const counted = present + absent
    const rate = counted ? Math.round(present / counted * 1000) / 10 : 0
    return <details key={crewName} open={groups.length === 1 ? true : undefined} className="crew-record-group"><summary><span className="crew-record-name"><ChevronDown />{crewName}<small>{crewRows.length}건</small></span><span className="crew-record-stats"><b className="present">출석 {present}</b><b className="absent">결석 {absent}</b><b className="unchecked">미체크 {unchecked}</b><b className="rate">출석률 {rate}%</b></span></summary><AttendanceDataTable rows={crewRows} showCrew={false} /></details>
  })}{!groups.length && <p className="empty-result">조회된 출석 기록이 없습니다.</p>}</div>}</section>
}

function FeedbackButton({ onClick }: { onClick: () => void }) { return <button className="feedback-fab" onClick={onClick}><MessageSquare />오류·개선 의견 보내기</button> }

function FeedbackDialog({ actorName, actorRole, page, onClose }: { actorName: string; actorRole: 'teacher' | 'executive' | 'assistant'; page: string; onClose: () => void }) {
  const [category, setCategory] = useState('오류 신고')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api.submitFeedback({ actorName, actorRole, category, message: message.trim(), page }); setSent(true) }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="small-dialog feedback-dialog" onSubmit={submit}><button type="button" className="icon-button close-button" onClick={onClose} aria-label="닫기"><X /></button>{sent ? <><Check className="sent-icon" /><h2>의견을 보냈습니다</h2><p>임원 화면의 의견함에 저장되었습니다. 확인 후 처리 상태를 남길 수 있습니다.</p><button type="button" className="primary-button" onClick={onClose}>확인</button></> : <><p className="eyebrow">빠른 피드백</p><h2>오류·개선 의견 보내기</h2><p>어려웠던 점이나 바꾸면 좋을 점을 편하게 적어주세요.</p><label>종류<select value={category} onChange={(event) => setCategory(event.target.value)}><option>오류 신고</option><option>사용이 어려움</option><option>개선 의견</option><option>기타</option></select></label><label>내용<textarea required minLength={5} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="예: 학생 이름을 찾기가 어려웠습니다." /></label><button className="primary-button" disabled={busy}>{busy ? '보내는 중…' : '임원에게 보내기'}</button></>}</form></div>
}

function SummaryCard({ label, value, tone = '' }: { label: string; value: string; tone?: string }) { return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{value}</strong></article> }
function LoadingBlock({ label }: { label: string }) { return <div className="loading-block"><RefreshCw className="spin" /><span>{label}</span></div> }
function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="error-block" role="alert"><AlertTriangle /><span>{message}</span>{onRetry && <button onClick={onRetry}>다시 시도</button>}</div> }
function attendanceLabel(value: string) { return value === 'present' ? '출석' : value === 'absent' ? '결석' : '미체크' }
function membershipLabel(value: string) { return value === 'active' ? '활동' : value === 'long_absence' ? '장기결석' : '퇴실' }
function contactLabel(value?: ContactStatus) { return value === 'no_answer' ? '연락 안 됨' : value === 'contacted' ? '연락 완료' : value === 'other' ? '기타' : '아직 연락 안 함' }

export default App
