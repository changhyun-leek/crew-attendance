import { useEffect, useState } from 'react'
import { Bell, BellOff, CheckCircle2, RefreshCw, Send } from 'lucide-react'
import { api, isDemoMode } from './lib/api'
import type { AttendanceReminderCrew } from './types'

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
}

export function TeacherNotificationControl() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supported || isDemoMode) return
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => undefined)
  }, [supported])

  async function enable() {
    setBusy(true); setMessage('')
    try {
      if (isDemoMode) { setEnabled(true); setMessage('미리보기에서 알림을 켠 상태입니다.'); return }
      if (!supported) throw new Error('이 휴대폰의 브라우저는 앱 알림을 지원하지 않습니다.')
      if (isIos() && !isStandalone()) throw new Error('아이폰은 먼저 홈 화면에 설치하고, 설치된 새벽이슬 앱 아이콘으로 열어주세요.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('휴대폰 설정에서 새벽이슬 출석 알림을 허용해주세요.')
      const registration = await navigator.serviceWorker.ready
      const config = await api.pushConfig()
      if (!config.publicKey) throw new Error('알림 서버 설정이 아직 완료되지 않았습니다.')
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) })
      await api.savePushSubscription(subscription)
      setEnabled(true); setMessage('이 휴대폰으로 출석 독려 알림을 받을 수 있습니다.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '알림을 켜지 못했습니다.')
    } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setMessage('')
    try {
      if (!isDemoMode) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await api.removePushSubscription(subscription.endpoint)
          await subscription.unsubscribe()
        }
      }
      setEnabled(false); setMessage('이 휴대폰의 출석 알림을 껐습니다.')
    } catch { setMessage('알림 설정을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.') }
    finally { setBusy(false) }
  }

  return <section className={`teacher-notification-card ${enabled ? 'enabled' : ''}`}>
    <div className="notification-card-icon">{enabled ? <Bell /> : <BellOff />}</div>
    <div><strong>휴대폰 출석 알림</strong><p>{enabled ? '임원교사가 보내는 출석 독려 알림을 받습니다.' : '한 번 켜두면 앱을 닫아도 출석 독려 알림을 받을 수 있습니다.'}</p>{message && <small role="status">{message}</small>}</div>
    <button type="button" disabled={busy} onClick={() => void (enabled ? disable() : enable())}>{busy ? '처리 중…' : enabled ? '알림 끄기' : '알림 켜기'}</button>
  </section>
}

function reminderStatusLabel(item: AttendanceReminderCrew) {
  if (item.status === 'completed') return '출석체크 완료'
  if (item.status === 'in_progress') return `체크 중 ${item.checked}/${item.total}명`
  return '아직 시작 안 함'
}

export function AttendanceReminderPanel({ date }: { date: string }) {
  const [crews, setCrews] = useState<AttendanceReminderCrew[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try { setCrews(await api.reminderStatus(date)) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '알림 현황을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [date])

  async function send(item: AttendanceReminderCrew) {
    if (!window.confirm(`${item.teacherName} 선생님에게 ${item.crewName} 출석체크 알림을 보낼까요?`)) return
    setSending(item.crewId); setMessage('')
    try {
      const result = await api.sendAttendanceReminder(item.crewId, date)
      setMessage(result.message)
      await load()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '알림을 보내지 못했습니다.') }
    finally { setSending('') }
  }

  return <section className="reminder-panel">
    <div className="reminder-panel-header"><div><p className="eyebrow">이번 주 출석 독려</p><h2>출석체크 알림 보내기</h2><p>{date} 주일 · 아직 완료하지 않은 크루에만 보낼 수 있습니다.</p></div><button className="icon-button" onClick={() => void load()} aria-label="알림 현황 새로고침"><RefreshCw className={loading ? 'spin' : ''} /></button></div>
    {message && <div className="reminder-message" role="status">{message}</div>}
    <div className="reminder-crew-grid">{crews.map((item) => {
      const completed = item.status === 'completed'
      const unavailable = !item.teacherId || item.notificationDevices < 1
      return <article key={item.crewId} className={completed ? 'completed' : ''}>
        <div className="reminder-crew-title"><strong>{item.crewName}</strong><span className={`reminder-status ${item.status}`}>{completed && <CheckCircle2 />}{reminderStatusLabel(item)}</span></div>
        <p>{item.teacherName ? `${item.teacherName} 선생님` : '담당교사 미배정'} · 알림 기기 {item.notificationDevices}대</p>
        {item.lastReminderAt && <small>최근 발송: {item.lastReminderAt.slice(0, 16).replace('T', ' ')}</small>}
        <button type="button" disabled={completed || unavailable || sending === item.crewId} onClick={() => void send(item)}><Send />{sending === item.crewId ? '보내는 중…' : completed ? '완료됨' : unavailable ? '교사 알림 꺼짐' : '독려 알림 보내기'}</button>
      </article>
    })}{!loading && !crews.length && <p className="empty-result">운영 중인 크루가 없습니다.</p>}</div>
  </section>
}
