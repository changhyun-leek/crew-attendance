import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Laptop, Moon, Sun, X } from 'lucide-react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'saebyeokiseul-theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolvedTheme: 'light' | 'dark'
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function storedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemIsDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference)
  const [prefersDark, setPrefersDark] = useState(systemIsDark)
  const resolvedTheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const sync = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#0f0b16' : '#4c1d95')
  }, [resolvedTheme])

  function setPreference(next: ThemePreference) {
    setPreferenceState(next)
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장이 차단된 브라우저에서도 현재 화면의 테마 전환은 유지합니다.
    }
  }

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('ThemeControl must be used inside ThemeProvider')
  return context
}

const choices: Array<{ id: ThemePreference; label: string; description: string; Icon: typeof Sun }> = [
  { id: 'system', label: '기기 설정대로', description: '휴대폰이나 컴퓨터 설정을 따라갑니다.', Icon: Laptop },
  { id: 'light', label: '밝게 보기', description: '밝은 장소에서 글자가 또렷합니다.', Icon: Sun },
  { id: 'dark', label: '어둡게 보기', description: '어두운 장소에서 눈부심을 줄입니다.', Icon: Moon },
]

export function ThemeControl({ variant = 'default' }: { variant?: 'default' | 'compact' | 'nav' }) {
  const { preference, resolvedTheme, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const CurrentIcon = resolvedTheme === 'dark' ? Moon : Sun
  const currentLabel = preference === 'system' ? '자동' : resolvedTheme === 'dark' ? '어둡게' : '밝게'

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  return <>
    <button type="button" className={`theme-trigger ${variant}`} onClick={() => setOpen(true)} aria-label={`화면 모드 설정, 현재 ${currentLabel}`}>
      <CurrentIcon aria-hidden="true" /><span>{variant === 'nav' ? `화면 모드 · ${currentLabel}` : currentLabel}</span>
    </button>
    {open && <div className="modal-backdrop theme-modal-backdrop" role="presentation">
      <section className="small-dialog theme-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-dialog-title">
        <button type="button" className="icon-button close-button" onClick={() => setOpen(false)} aria-label="화면 모드 닫기"><X /></button>
        <p className="eyebrow">보기 편한 화면 선택</p>
        <h2 id="theme-dialog-title">화면 밝기를 선택하세요</h2>
        <p>선택한 화면은 이 기기에서 다음 접속에도 유지됩니다.</p>
        <div className="theme-choice-list">
          {choices.map(({ id, label, description, Icon }) => <button type="button" key={id} className={preference === id ? 'selected' : ''} onClick={() => { setPreference(id); setOpen(false) }} aria-pressed={preference === id}>
            <span className="theme-choice-icon"><Icon aria-hidden="true" /></span>
            <span><strong>{label}</strong><small>{description}</small></span>
            {preference === id && <Check className="theme-choice-check" aria-hidden="true" />}
          </button>)}
        </div>
      </section>
    </div>}
  </>
}

export { STORAGE_KEY }
