import type { Actor, AttendanceMember, AttendanceStatus } from '../types'

export function toggledAttendanceStatus(current: AttendanceStatus, requested: AttendanceStatus): AttendanceStatus {
  return current === requested ? 'unchecked' : requested
}

export function updateMemberAttendance(
  members: AttendanceMember[],
  membershipId: string,
  attendanceStatus: AttendanceStatus,
  actor?: Actor,
): AttendanceMember[] {
  return members.map((member) => member.membershipId === membershipId
    ? { ...member, attendanceStatus, actor }
    : member)
}

export function updateManyMemberAttendances(
  members: AttendanceMember[],
  membershipIds: Iterable<string>,
  attendanceStatus: AttendanceStatus,
  actor?: Actor,
): AttendanceMember[] {
  const targets = new Set(membershipIds)
  return members.map((member) => targets.has(member.membershipId)
    ? { ...member, attendanceStatus, actor }
    : member)
}

export function parseStoredNames(raw: string | null, limit = 5): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().replace(/\s+/g, ' '))
      .filter((item, index, items) => item.length >= 2 && items.indexOf(item) === index)
      .slice(0, limit)
  } catch {
    return []
  }
}
