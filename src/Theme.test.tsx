import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, ThemeControl, ThemeProvider } from './Theme'

describe('화면 모드', () => {
  afterEach(cleanup)

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  it('어두운 화면 선택을 저장하고 즉시 적용한다', () => {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: /화면 모드 설정/ }))
    fireEvent.click(screen.getByRole('button', { name: /어둡게 보기/ }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('기기 설정대로를 선택하면 저장값을 지운다', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    render(<ThemeProvider><ThemeControl /></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: /화면 모드 설정/ }))
    fireEvent.click(screen.getByRole('button', { name: /기기 설정대로/ }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
