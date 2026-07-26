export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function lastSunday(base = new Date()): string {
  const date = new Date(base)
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - date.getDay())
  return toIsoDate(date)
}

export function formatKoreanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${year}년 ${month}월 ${day}일`
}
