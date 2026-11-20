import { describe, expect, it } from 'vitest'
import type { AttendanceMember } from '../types'
import { parseStoredNames, toggledAttendanceStatus, updateManyMemberAttendances, updateMemberAttendance } from './attendanceState'

const members: AttendanceMember[] = [
  { membershipId: 'a', studentId: 'student-a', name: '가학생', membershipStatus: 'active', attendanceStatus: 'unchecked', sortOrder: 0 },
  { membershipId: 'b', studentId: 'student-b', name: '나학생', membershipStatus: 'active', attendanceStatus: 'present', sortOrder: 1 },
  { membershipId: 'c', studentId: 'student-c', name: '다학생', membershipStatus: 'active', attendanceStatus: 'unchecked', sortOrder: 2 },
]

describe('attendance state helpers', () => {
  it('toggles the selected status back to unchecked', () => {
    expect(toggledAttendanceStatus('present', 'present')).toBe('unchecked')
    expect(toggledAttendanceStatus('absent', 'present')).toBe('present')
  })

  it('updates only the requested member without reverting other optimistic updates', () => {
    const first = updateMemberAttendance(members, 'a', 'absent')
    const second = updateMemberAttendance(first, 'c', 'absent')

    expect(second.map((member) => member.attendanceStatus)).toEqual(['absent', 'present', 'absent'])
    expect(members.map((member) => member.attendanceStatus)).toEqual(['unchecked', 'present', 'unchecked'])
  })

  it('applies a bulk status update atomically', () => {
    expect(updateManyMemberAttendances(members, ['a', 'c'], 'absent').map((member) => member.attendanceStatus))
      .toEqual(['absent', 'present', 'absent'])
  })

  it('ignores corrupted or invalid recent-name storage', () => {
    expect(parseStoredNames('{broken')).toEqual([])
    expect(parseStoredNames(JSON.stringify([' 홍  길동 ', 123, '홍 길동', 'A', '김은혜'])))
      .toEqual(['홍 길동', '김은혜'])
  })
})
