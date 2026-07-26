export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function lastSunday(base = new Date()): string {
  const date = new Date(base)
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - date.getDay())
  return toIsoDate(date)
}

/** 월요일부터 일요일까지를 한 주로 보고, 그 주의 주일 날짜를 반환합니다. */
export function thisWeekSunday(base = new Date()): string {
  const date = new Date(base)
  date.setHours(12, 0, 0, 0)
  const daysUntilSunday = (7 - date.getDay()) % 7
  date.setDate(date.getDate() + daysUntilSunday)
  return toIsoDate(date)
}

export function formatKoreanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${year}년 ${month}월 ${day}일`
}
