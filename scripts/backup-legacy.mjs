import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = process.env.SUPABASE_URL ?? 'https://zzavmguguvuqgdblmkcj.supabase.co'
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_VY0sNxSFQgHMSItmR5q5pw_4tpdrxWb'
const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function read(table, order) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&order=${order}`, { headers })
  if (!response.ok) throw new Error(`${table} 백업 실패: ${response.status} ${await response.text()}`)
  return response.json()
}

const backup = {
  createdAt: new Date().toISOString(),
  source: baseUrl,
  crewMembers: await read('crew_members', 'sort_order.asc'),
  attendance: await read('attendance', 'date.asc'),
}

const directory = resolve('legacy-backups')
await mkdir(directory, { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const output = resolve(directory, `legacy-${stamp}.json`)
await writeFile(output, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, members: backup.crewMembers.length, attendance: backup.attendance.length }))
