import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, Monitor, RefreshCw, Share2, Smartphone, X } from 'lucide-react'

interface InstallChoice {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

type InstallPlatform = 'ios' | 'android' | 'desktop' | 'other'

function isStandalone() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
}

function detectPlatform(): { platform: InstallPlatform; inAppBrowser: boolean } {
  const userAgent = navigator.userAgent.toLowerCase()
  const ios = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /android/.test(userAgent)
  const mobile = ios || android || /mobile/.test(userAgent)
  const inAppBrowser = /kakaotalk|naver|instagram|fbav|fban|line\//.test(userAgent)
  return { platform: ios ? 'ios' : android ? 'android' : mobile ? 'other' : 'desktop', inAppBrowser }
}

function installationSteps(platform: InstallPlatform, inAppBrowser: boolean) {
  if (platform === 'ios') {
    return [
      ...(inAppBrowser ? ['먼저 화면의 메뉴에서 Safari로 열기 또는 다른 브라우저로 열기를 누릅니다.'] : []),
      'Safari 아래쪽의 공유 버튼을 누릅니다.',
      '메뉴에서 홈 화면에 추가를 누릅니다.',
      '오른쪽 위의 추가를 누르면 홈 화면에 아이콘이 생깁니다.',
    ]
  }
  if (platform === 'android') {
    return [
      ...(inAppBrowser ? ['카카오톡 메뉴에서 다른 브라우저로 열기를 누릅니다.'] : []),
      'Chrome 또는 삼성 인터넷의 오른쪽 위 메뉴를 누릅니다.',
      '앱 설치 또는 홈 화면에 추가를 누릅니다.',
      '설치를 확인하면 일반 앱처럼 아이콘으로 실행할 수 있습니다.',
    ]
  }
  if (platform === 'desktop') {
    return [
      'Chrome 또는 Edge 주소창 오른쪽의 설치 아이콘을 누릅니다.',
      '아이콘이 없다면 브라우저 메뉴에서 앱 설치를 선택합니다.',
      '설치를 누르면 바탕 화면이나 시작 메뉴에서 실행할 수 있습니다.',
    ]
  }
  return [
    '브라우저 메뉴를 엽니다.',
    '앱 설치 또는 홈 화면에 추가를 선택합니다.',
    '설치를 확인한 뒤 생성된 아이콘으로 실행합니다.',
  ]
}

function useServiceWorkerUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [needRefresh, setNeedRefresh] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let disposed = false
    let intervalId: number | undefined
    let activeRegistration: ServiceWorkerRegistration | undefined

    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).then((nextRegistration) => {
      if (disposed) return
      activeRegistration = nextRegistration
      setRegistration(nextRegistration)
      if (nextRegistration.waiting && navigator.serviceWorker.controller) setNeedRefresh(true)
      nextRegistration.addEventListener('updatefound', () => {
        const worker = nextRegistration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setNeedRefresh(true)
        })
      })
      intervalId = window.setInterval(() => void nextRegistration.update(), 60 * 60 * 1000)
    }).catch(() => undefined)

    const updateWhenVisible = () => {
      if (document.visibilityState === 'visible') void activeRegistration?.update()
    }
    document.addEventListener('visibilitychange', updateWhenVisible)
    return () => {
      disposed = true
      if (intervalId) window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', updateWhenVisible)
    }
  }, [])

  function updateServiceWorker() {
    const waiting = registration?.waiting
    if (!waiting) {
      void registration?.update()
      return
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  return { needRefresh, setNeedRefresh, updateServiceWorker }
}

export function PwaInstallControl() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState(isStandalone)
  const [message, setMessage] = useState('')
  const environment = useMemo(detectPlatform, [])
  const steps = useMemo(() => installationSteps(environment.platform, environment.inAppBrowser), [environment])

  useEffect(() => {
    const rememberPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }
    const markInstalled = () => {
      setInstalled(true)
      setOpen(false)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', rememberPrompt)
    window.addEventListener('appinstalled', markInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', rememberPrompt)
      window.removeEventListener('appinstalled', markInstalled)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  if (installed) return null

  async function install() {
    if (!promptEvent) return
    setMessage('')
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
      setOpen(false)
    } else {
      setMessage('설치가 취소되었습니다. 필요할 때 다시 설치 버튼을 눌러주세요.')
    }
    setPromptEvent(null)
  }

  const PlatformIcon = environment.platform === 'desktop' ? Monitor : Smartphone

  return <>
    <button className="pwa-install-launcher" onClick={() => setOpen(true)} aria-label="휴대폰 또는 컴퓨터에 출석관리 설치하기">
      <Download aria-hidden="true" />
      <span><strong>앱 설치</strong><small>휴대폰·컴퓨터</small></span>
    </button>
    {open && <div className="modal-backdrop pwa-modal-backdrop" role="presentation">
      <section className="small-dialog pwa-install-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
        <button type="button" className="icon-button close-button" onClick={() => setOpen(false)} aria-label="설치 안내 닫기"><X /></button>
        <div className="pwa-dialog-icon"><PlatformIcon aria-hidden="true" /></div>
        <p className="eyebrow">한 번 설치하면 더 편리합니다</p>
        <h2 id="pwa-install-title">휴대폰·컴퓨터에 설치</h2>
        <p className="pwa-install-copy">홈 화면이나 바탕 화면의 아이콘을 누르면 주소를 다시 찾지 않고 출석관리를 바로 열 수 있습니다.</p>
        {environment.inAppBrowser && <div className="pwa-browser-warning" role="status"><ExternalLink aria-hidden="true" /><span>카카오톡 안에서는 설치가 제한될 수 있습니다. 먼저 다른 브라우저로 열어주세요.</span></div>}
        {promptEvent ? <button type="button" className="primary-button pwa-install-now" onClick={() => void install()}><Download aria-hidden="true" />지금 이 기기에 설치하기</button> : <div className="pwa-manual-guide">
          <div className="pwa-guide-title"><Share2 aria-hidden="true" /><strong>이 기기에서 설치하는 순서</strong></div>
          <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>}
        {message && <p className="inline-error" role="status">{message}</p>}
        <div className="pwa-safety-note"><CheckCircle2 aria-hidden="true" /><span>설치해도 출석 권한과 PIN 보안은 그대로 유지됩니다.</span></div>
      </section>
    </div>}
  </>
}

export function PwaUpdateNotice() {
  const { needRefresh, setNeedRefresh, updateServiceWorker } = useServiceWorkerUpdate()

  if (!needRefresh) return null

  return <div className="pwa-update-notice" role="status">
    <span><strong>새 버전이 준비되었습니다.</strong><small>출석 중이 아니라면 지금 업데이트해주세요.</small></span>
    <button onClick={updateServiceWorker}><RefreshCw aria-hidden="true" />업데이트</button>
    <button className="icon-button" onClick={() => setNeedRefresh(false)} aria-label="업데이트 안내 닫기"><X /></button>
  </div>
}
