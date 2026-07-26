import { describe, expect, it } from 'vitest'
import { lastSunday, toIsoDate } from './date'

describe('date helpers', () => {
  it('keeps Sunday as the attendance date', () => {
    expect(lastSunday(new Date('2026-07-26T12:00:00+09:00'))).toBe('2026-07-26')
  })

  it('moves weekdays to the previous Sunday', () => {
    expect(lastSunday(new Date('2026-07-29T12:00:00+09:00'))).toBe('2026-07-26')
  })

  it('formats local dates without UTC drift', () => {
    expect(toIsoDate(new Date(2026, 0, 3, 12))).toBe('2026-01-03')
  })
})
