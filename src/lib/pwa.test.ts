import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('설치형 웹앱 설정', () => {
  it('휴대폰과 컴퓨터 설치에 필요한 manifest 정보를 제공한다', () => {
    const manifest = JSON.parse(projectFile('public/manifest.webmanifest')) as {
      display: string
      start_url: string
      icons: Array<{ sizes: string; purpose?: string }>
      shortcuts: Array<{ url: string }>
    }

    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/crew-attendance/')
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true)
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true)
    expect(manifest.icons.some((icon) => icon.purpose?.includes('maskable'))).toBe(true)
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      '/crew-attendance/?role=teacher',
      '/crew-attendance/?role=assistant',
      '/crew-attendance/?role=executive',
    ])
  })

  it('서비스 워커가 출석 API 대신 같은 사이트의 화면 파일만 저장한다', () => {
    const worker = projectFile('scripts/sw-template.js')

    expect(worker).toContain("url.origin !== self.location.origin")
    expect(worker).toContain("!url.pathname.startsWith(new URL(SCOPE_URL).pathname)")
    expect(worker).toContain("request.mode === 'navigate'")
    expect(worker).toContain("'script', 'style', 'image', 'font', 'manifest'")
    expect(worker).not.toContain('supabase.co')
  })

  it('확정된 휴대폰용과 컴퓨터용 아이콘 파일을 함께 제공한다', () => {
    expect(statSync(join(process.cwd(), 'public/mobile-icon-1024x1024.png')).size).toBeGreaterThan(10_000)
    expect(statSync(join(process.cwd(), 'public/desktop-icon-512x512.png')).size).toBeGreaterThan(10_000)
    expect(statSync(join(process.cwd(), 'public/favicon.ico')).size).toBeGreaterThan(1_000)
  })
})
