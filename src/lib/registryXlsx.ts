import type { AttendanceExportRow } from '../types'

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const HEADERS = ['26년 크루', '25년 크루', '이름', '25년 나이', '생년월일', '핸드폰', '신급', '도로명 주소', '학교명', '부(연락처)', '모(연락처)', '비고']

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function put16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function put32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function makeZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const entries = Object.entries(files).map(([name, content]) => {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    return { nameBytes, data, crc: crc32(data), offset: 0 }
  })
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.nameBytes.length + entry.data.length, 0)
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0)
  const output = new Uint8Array(localSize + centralSize + 22)
  let offset = 0
  for (const entry of entries) {
    entry.offset = offset
    put32(output, offset, 0x04034b50); put16(output, offset + 4, 20); put16(output, offset + 6, 0x0800)
    put16(output, offset + 8, 0); put16(output, offset + 10, 0); put16(output, offset + 12, 0)
    put32(output, offset + 14, entry.crc); put32(output, offset + 18, entry.data.length); put32(output, offset + 22, entry.data.length)
    put16(output, offset + 26, entry.nameBytes.length); put16(output, offset + 28, 0)
    output.set(entry.nameBytes, offset + 30); output.set(entry.data, offset + 30 + entry.nameBytes.length)
    offset += 30 + entry.nameBytes.length + entry.data.length
  }
  const centralOffset = offset
  for (const entry of entries) {
    put32(output, offset, 0x02014b50); put16(output, offset + 4, 20); put16(output, offset + 6, 20); put16(output, offset + 8, 0x0800)
    put16(output, offset + 10, 0); put16(output, offset + 12, 0); put16(output, offset + 14, 0)
    put32(output, offset + 16, entry.crc); put32(output, offset + 20, entry.data.length); put32(output, offset + 24, entry.data.length)
    put16(output, offset + 28, entry.nameBytes.length); put16(output, offset + 30, 0); put16(output, offset + 32, 0)
    put16(output, offset + 34, 0); put16(output, offset + 36, 0); put32(output, offset + 38, 0); put32(output, offset + 42, entry.offset)
    output.set(entry.nameBytes, offset + 46)
    offset += 46 + entry.nameBytes.length
  }
  put32(output, offset, 0x06054b50); put16(output, offset + 4, 0); put16(output, offset + 6, 0)
  put16(output, offset + 8, entries.length); put16(output, offset + 10, entries.length)
  put32(output, offset + 12, centralSize); put32(output, offset + 16, centralOffset); put16(output, offset + 20, 0)
  return output
}

function xml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function columnName(index: number): string {
  let value = index + 1
  let result = ''
  while (value) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function cell(row: number, column: number, value: string, style = 3): string {
  return `<c r="${columnName(column)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

function statusLabel(row: AttendanceExportRow): string {
  const status = row.attendanceStatus === 'present' ? '출석' : row.attendanceStatus === 'absent' ? '결석' : '미체크'
  const details = [
    row.attendanceStatus === 'absent' && row.absenceReason ? row.absenceReason : '',
    row.attendanceStatus === 'absent' && row.contactStatus === 'no_answer' ? '연락 안 됨' : '',
    row.attendanceStatus === 'absent' && row.contactStatus === 'contacted' ? '연락 완료' : '',
    row.membershipStatus === 'long_absence' ? '장기결석' : row.membershipStatus === 'left' ? '퇴실' : '',
    row.specialNote ?? '',
  ].filter(Boolean)
  return details.length ? `${status} · ${details.join(' / ')}` : status
}

function styleForStatus(status: AttendanceExportRow['attendanceStatus']): number {
  return status === 'present' ? 5 : status === 'absent' ? 6 : 7
}

function sheetXml(date: string, rows: AttendanceExportRow[]): string {
  const grouped = new Map<string, AttendanceExportRow[]>()
  for (const row of rows) grouped.set(row.crewName, [...(grouped.get(row.crewName) ?? []), row])

  const sheetRows: string[] = []
  const merges = ['A1:L1', 'A2:L2']
  sheetRows.push(`<row r="1" ht="30" customHeight="1">${cell(1, 0, `출석부 (${date})`, 1)}</row>`)
  sheetRows.push(`<row r="2" ht="24" customHeight="1">${cell(2, 0, '생명샘동천교회 새벽이슬 청소년부 · 개인정보 항목은 비워 둔 출석 보고용 파일입니다.', 2)}</row>`)

  let rowNumber = 4
  for (const [crewName, crewRows] of grouped) {
    sheetRows.push(`<row r="${rowNumber}" ht="26" customHeight="1">${HEADERS.map((header, index) => cell(rowNumber, index, header, 4)).join('')}</row>`)
    rowNumber += 1
    const firstDataRow = rowNumber
    for (const [index, item] of crewRows.entries()) {
      const values = [index === 0 ? crewName : '', '', item.studentName, '', '', '', '', '', '', '', '', statusLabel(item)]
      sheetRows.push(`<row r="${rowNumber}" ht="25" customHeight="1">${values.map((value, column) => cell(rowNumber, column, value, column === 11 ? styleForStatus(item.attendanceStatus) : 3)).join('')}</row>`)
      rowNumber += 1
    }
    if (crewRows.length > 1) merges.push(`A${firstDataRow}:A${rowNumber - 1}`)
    rowNumber += 1
  }

  if (!rows.length) {
    sheetRows.push(`<row r="4" ht="26" customHeight="1">${HEADERS.map((header, index) => cell(4, index, header, 4)).join('')}</row>`)
    sheetRows.push(`<row r="5" ht="25" customHeight="1">${cell(5, 0, '조회된 출석 기록이 없습니다.', 3)}</row>`)
    merges.push('A5:L5')
    rowNumber = 6
  }

  const widths = [17, 17, 13, 11, 15, 17, 11, 34, 20, 22, 22, 42]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:L${Math.max(5, rowNumber - 1)}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="18"/><color rgb="FF17365D"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
    <font><sz val="10"/><color rgb="FF44546A"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF9EADBA"/></left><right style="thin"><color rgb="FF9EADBA"/></right><top style="thin"><color rgb="FF9EADBA"/></top><bottom style="thin"><color rgb="FF9EADBA"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function safeSheetName(date: string, index: number): string {
  const compact = date.replace(/\D/g, '').slice(2) || `출석${index + 1}`
  return compact.slice(0, 31)
}

export function buildRegistryWorkbook(rows: AttendanceExportRow[]): Uint8Array {
  const byDate = new Map<string, AttendanceExportRow[]>()
  for (const row of rows) byDate.set(row.attendanceDate, [...(byDate.get(row.attendanceDate) ?? []), row])
  if (!byDate.size) byDate.set('출석내역', [])
  const sheets = [...byDate.entries()]
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>새벽이슬 청소년부 출석부</dc:title><dc:creator>새벽이슬 출석관리</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>새벽이슬 출석관리</Application></Properties>`,
    'xl/styles.xml': stylesXml,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map(([date], index) => `<sheet name="${xml(safeSheetName(date, index))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  }
  sheets.forEach(([date, dateRows], index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = sheetXml(date, dateRows) })
  return makeZip(files)
}

export function downloadRegistryWorkbook(filename: string, rows: AttendanceExportRow[]): void {
  const workbook = buildRegistryWorkbook(rows)
  const blob = new Blob([workbook.buffer as ArrayBuffer], { type: MIME })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export { HEADERS as registryHeaders }
