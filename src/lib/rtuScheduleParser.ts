export type ScheduleDayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'

export type OcrPoint = { x: number; y: number }
export type OcrLine = { poly: OcrPoint[]; text: string; score: number }

export type ImportedMeetingDraft = {
  id: string
  dayCode: ScheduleDayCode
  startsAt: string
  endsAt: string
  room: string
  confidence: number
}

export type ImportedSubjectDraft = {
  id: string
  subjectCode: string
  title: string
  units: string
  blockSection: string
  meetings: ImportedMeetingDraft[]
  confidence: number
}

export type ImportWarning = {
  id: string
  subjectId?: string
  meetingId?: string
  message: string
}

export type ImportedScheduleDraft = {
  statedUnits: number | null
  subjects: ImportedSubjectDraft[]
  warnings: ImportWarning[]
}

export type ImportedScheduleIssue = {
  id: string
  message: string
  targetId: string
}

type Box = OcrLine & {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
  height: number
}

type Row = {
  centerY: number
  boxes: Box[]
}

type ParsedRow = {
  code: string
  title: string
  units: string
  section: string
  schedule: string
  room: string
  confidence: number
}

const DAY_CODES = new Set<ScheduleDayCode>(['M', 'T', 'W', 'H', 'F', 'S', 'U'])
const LOW_CONFIDENCE = 0.85

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function comparable(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toBox(line: OcrLine): Box | null {
  if (!line.poly.length || !clean(line.text)) return null
  const xs = line.poly.map(point => point.x)
  const ys = line.poly.map(point => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    ...line,
    text: clean(line.text),
    score: Number.isFinite(line.score) ? Math.max(0, Math.min(1, line.score)) : 0,
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    height: Math.max(1, bottom - top),
  }
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function groupRows(boxes: Box[], slope = 0) {
  const tolerance = Math.max(6, median(boxes.map(box => box.height)) * 0.9)
  const rows: Row[] = []
  const adjustedY = (box: Box) => box.centerY - slope * box.centerX
  for (const box of [...boxes].sort((a, b) => adjustedY(a) - adjustedY(b) || a.left - b.left)) {
    let closest: Row | undefined
    let closestDistance = Number.POSITIVE_INFINITY
    for (const row of rows) {
      const distance = Math.abs(row.centerY - adjustedY(box))
      if (distance <= tolerance && distance < closestDistance) {
        closest = row
        closestDistance = distance
      }
    }
    if (!closest) rows.push({ centerY: adjustedY(box), boxes: [box] })
    else {
      closest.boxes.push(box)
      closest.centerY = closest.boxes.reduce((sum, item) => sum + adjustedY(item), 0) / closest.boxes.length
    }
  }
  return rows.sort((a, b) => a.centerY - b.centerY)
}

function joinColumn(boxes: Box[]) {
  return clean([...boxes].sort((a, b) => a.left - b.left).map(box => box.text).join(' '))
}

function rowConfidence(boxes: Box[]) {
  return boxes.length ? Math.min(...boxes.map(box => box.score)) : 0
}

function normalizeCode(value: string) {
  return clean(value)
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*[-]\s*/g, '-')
    .replace(/\s+/g, '')
    .replace(/^(?:11P|I1P|TTP|TTF)(?=\d)/, 'ITP')
    .replace(/^(?:1CS|JCS)(?=-)/, 'ICS')
    .replace(/[.]$/, '')
}

function normalizeNumeric(value: string) {
  return value.toUpperCase().replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/,/g, '.')
}

function normalizeUnits(value: string) {
  const match = normalizeNumeric(value).match(/\d{1,2}(?:\.\d{1,2})?/)
  if (!match) return ''
  const amount = Number(match[0])
  return Number.isFinite(amount) ? String(amount) : ''
}

function normalizeClock(hourText: string, minuteText: string, periodText: string) {
  const hour = Number(normalizeNumeric(hourText))
  const minute = Number(normalizeNumeric(minuteText))
  const period = periodText.toUpperCase()
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const hours24 = hour % 12 + (period === 'P' ? 12 : 0)
  return `${String(hours24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseMeetings(value: string, room: string, confidence: number) {
  const source = value
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[–—]/g, '-')
    .replace(/^\s*3(?=\s*\d)/, 'S')
    .replace(/^\s*([MTWHFSU])[.:]\s*/, '$1 ')
    .replace(/^\s*([MTWHFSU])\s*(\d{1,2})[-](\d{2})(?=[AP8])/, '$1 $2:$3')
    .replace(/^\s*([MTWHFSU])\s*(\d{1,2})(\d{2})(?=[AP8])/, '$1 $2:$3')
    .replace(/(\d{2}[AP8])\s*:\s*(?=\d{1,2}:)/, '$1 - ')
    .replace(/(\d{1,2}:\d{2})0(?=\s*$)/, '$1P')
    .replace(/8(?=\s*-)/, 'A')
    .replace(/0\/(?=:)/g, '07')
    .replace(/\/(\d)(?=:)/g, '7$1')
    .replace(/(\d)[.,](\d{2})/g, '$1:$2')
    .replace(/\bA\.?M\.?\b/g, 'A')
    .replace(/\bP\.?M\.?\b/g, 'P')
  if (/N\s*\/?\s*A/.test(source)) return { meetings: [] as ImportedMeetingDraft[], invalid: false }
  const pattern = /(?:^|\s)([MTWHFSU])\s*(\d{1,2})\s*:\s*(\d{2})\s*([AP])\s*-\s*(\d{1,2})\s*:\s*(\d{2})\s*([AP])(?=\s|$)/g
  const meetings: ImportedMeetingDraft[] = []
  for (const match of source.matchAll(pattern)) {
    const dayCode = match[1] as ScheduleDayCode
    const startsAt = normalizeClock(match[2], match[3], match[4])
    const endsAt = normalizeClock(match[5], match[6], match[7])
    if (!DAY_CODES.has(dayCode) || !startsAt || !endsAt || startsAt >= endsAt) continue
    meetings.push({
      id: makeId('meeting'),
      dayCode,
      startsAt,
      endsAt,
      room: /^N\s*\/?\s*A$/i.test(clean(room)) ? '' : clean(room).toUpperCase(),
      confidence,
    })
  }
  return { meetings, invalid: meetings.length === 0 && clean(value).length > 0 }
}

function isLikelySubjectCode(value: string) {
  return /^[A-Z]{2,}(?:-[A-Z]+)?\d+[A-Z]*$/.test(normalizeCode(value))
}

function parseTableRow(row: Row, width: number): ParsedRow {
  const columns: Box[][] = [[], [], [], [], [], []]
  for (const box of row.boxes) {
    const x = box.left / width
    const index = x < 0.14 ? 0 : x < 0.45 ? 1 : x < 0.515 ? 2 : x < 0.62 ? 3 : x < 0.84 ? 4 : 5
    columns[index].push(box)
  }
  return {
    code: joinColumn(columns[0]),
    title: joinColumn(columns[1]),
    units: joinColumn(columns[2]),
    section: joinColumn(columns[3]),
    schedule: joinColumn(columns[4]),
    room: joinColumn(columns[5]),
    confidence: rowConfidence(row.boxes),
  }
}

function findHeaderGeometry(boxes: Box[]) {
  const classroom = boxes.find(box => comparable(box.text) === 'classroom')
  const candidates = boxes.filter(box => {
    const value = comparable(box.text)
    const isHeading = value.includes('subjectc') || value.includes('subjectd') || value.startsWith('unit') || value.includes('sectioncode') || value.startsWith('schedu') || value === 'classroom'
    return isHeading && (!classroom || Math.abs(box.centerY - classroom.centerY) < Math.max(60, classroom.height * 4))
  })
  if (candidates.length < 2) return null
  const meanX = candidates.reduce((sum, box) => sum + box.centerX, 0) / candidates.length
  const meanY = candidates.reduce((sum, box) => sum + box.centerY, 0) / candidates.length
  const denominator = candidates.reduce((sum, box) => sum + (box.centerX - meanX) ** 2, 0)
  const slope = denominator ? candidates.reduce((sum, box) => sum + (box.centerX - meanX) * (box.centerY - meanY), 0) / denominator : 0
  return { y: meanY - slope * meanX, slope: Math.max(-0.05, Math.min(0.05, slope)) }
}

function findTableEndY(boxes: Box[], headerY: number, height: number) {
  const candidates = boxes.filter(box => box.centerY > headerY && (() => {
    const value = comparable(box.text)
    return value.includes('miscellaneousfee') || value.includes('assessmentdetails') || value.includes('discountdetails')
  })())
  return candidates.length ? Math.min(...candidates.map(box => box.top)) : Math.min(height, headerY + height * 0.32)
}

function findLabeledValue(boxes: Box[], label: string, width: number) {
  const labelBox = boxes.find(box => comparable(box.text).includes(label))
  if (!labelBox) return ''
  const peers = boxes
    .filter(box => box.left > labelBox.right && Math.abs(box.centerY - labelBox.centerY) <= Math.max(12, labelBox.height * 1.5))
    .sort((a, b) => a.left - b.left)
  if (peers.length) return peers[0].text
  const rightSide = boxes
    .filter(box => box.left / width > 0.72 && Math.abs(box.centerY - labelBox.centerY) <= Math.max(18, labelBox.height * 2))
    .sort((a, b) => a.left - b.left)
  return rightSide[0]?.text ?? ''
}

function findStatedUnits(boxes: Box[], width: number) {
  const exact = findLabeledValue(boxes, 'totalnoofunits', width)
  if (exact) return exact
  const label = boxes.find(box => {
    const value = comparable(box.text)
    return value.includes('totalnoof') || (value.includes('total') && value.includes('unit'))
  })
  if (!label) return ''
  return boxes
    .filter(box => box.left > label.right && Math.abs(box.centerY - label.centerY) <= Math.max(18, label.height * 2))
    .sort((a, b) => a.left - b.left)[0]?.text ?? ''
}

export function parseRtuSchedule(lines: OcrLine[], image: { width: number; height: number }): ImportedScheduleDraft {
  const boxes = lines.map(toBox).filter((box): box is Box => Boolean(box))
  const warnings: ImportWarning[] = []
  const formTitleFound = boxes.some(box => comparable(box.text).includes('registrationassessmentform'))
  const universityFound = boxes.some(box => comparable(box.text).includes('rizaltechnologicaluniversity'))
  if (!formTitleFound && !universityFound) throw new Error('This does not look like an RTU registration form.')

  const header = findHeaderGeometry(boxes)
  if (header === null) throw new Error('The schedule table headings could not be found. Try a clearer, straighter photo.')
  const headerY = header.y + header.slope * (image.width / 2)
  const tableEndY = findTableEndY(boxes, headerY, image.height)
  const medianHeight = median(boxes.map(box => box.height))
  const tableBoxes = boxes.filter(box => box.centerY > headerY + medianHeight * 0.65 && box.centerY < tableEndY)
  const parsedRows = groupRows(tableBoxes, header.slope).map(row => parseTableRow(row, image.width))

  const subjects: ImportedSubjectDraft[] = []
  let current: ImportedSubjectDraft | null = null
  for (const row of parsedRows) {
    const code = normalizeCode(row.code)
    if (isLikelySubjectCode(code)) {
      current = {
        id: makeId('subject'),
        subjectCode: code,
        title: clean(row.title),
        units: normalizeUnits(row.units),
        blockSection: normalizeCode(`${row.units} ${row.section}`.match(/(?:ICS|1CS|JCS)-[A-Z0-9-]+/i)?.[0] ?? row.section),
        meetings: [],
        confidence: row.confidence,
      }
      subjects.push(current)
      const parsed = parseMeetings(row.schedule, row.room, row.confidence)
      current.meetings.push(...parsed.meetings)
      if (parsed.invalid) warnings.push({ id: makeId('warning'), subjectId: current.id, message: `Check the meeting time read for ${code}.` })
      if (row.confidence < LOW_CONFIDENCE) warnings.push({ id: makeId('warning'), subjectId: current.id, message: `Review ${code}; part of this row was read with low confidence.` })
      continue
    }

    if (current && clean(row.schedule)) {
      const parsed = parseMeetings(row.schedule, row.room, row.confidence)
      current.meetings.push(...parsed.meetings)
      if (parsed.invalid) warnings.push({ id: makeId('warning'), subjectId: current.id, message: `Check an additional meeting read for ${current.subjectCode}.` })
      continue
    }

    if (current && clean(row.title) && !row.units && !row.section) {
      current.title = clean(`${current.title} ${row.title}`)
      current.confidence = Math.min(current.confidence, row.confidence)
      continue
    }

    if (row.title || row.units || row.section) warnings.push({ id: makeId('warning'), message: 'A table row could not be matched to a subject. Compare the review with the image.' })
  }

  if (!subjects.length) throw new Error('No subjects could be read from the schedule table.')

  const statedUnitsText = findStatedUnits(boxes, image.width)
  const statedUnitsValue = normalizeUnits(statedUnitsText)
  const statedUnits = statedUnitsValue ? Number(statedUnitsValue) : null
  const extractedUnits = Number(subjects.reduce((sum, subject) => sum + (Number(subject.units) || 0), 0).toFixed(2))
  if (statedUnits !== null && Math.abs(statedUnits - extractedUnits) > 0.05) {
    warnings.push({ id: makeId('warning'), message: `The form states ${statedUnits} units, but the extracted subjects total ${extractedUnits}. Review the units before replacing your schedule.` })
  }

  return {
    statedUnits,
    subjects,
    warnings,
  }
}

export function getImportedScheduleIssues(subjects: ImportedSubjectDraft[]): ImportedScheduleIssue[] {
  const issues: ImportedScheduleIssue[] = []
  const addIssue = (message: string, targetId: string) => issues.push({ id: `${targetId}-${issues.length}`, message, targetId })
  if (!subjects.length) {
    addIssue('Add at least one subject.', 'schedule-scan-subjects')
    return issues
  }
  const subjectKeys = new Set<string>()
  for (const subject of subjects) {
    const label = subject.subjectCode || 'A subject'
    const subjectTarget = `schedule-scan-subject-${subject.id}`
    if (!subject.subjectCode) addIssue('Add a subject code.', `${subjectTarget}-code`)
    else if (subject.subjectCode.length > 40) addIssue(`${label}: Shorten the subject code.`, `${subjectTarget}-code`)
    if (!clean(subject.title)) addIssue(`${label}: Add a subject title.`, `${subjectTarget}-title`)
    else if (clean(subject.title).length > 200) addIssue(`${label}: Shorten the subject title.`, `${subjectTarget}-title`)
    const units = Number(subject.units)
    if (!subject.units) addIssue(`${label}: Add the units.`, `${subjectTarget}-units`)
    else if (!Number.isFinite(units) || units < 0 || units > 30 || !/^\d+(?:\.\d)?$/.test(subject.units)) addIssue(`${label}: Check the units.`, `${subjectTarget}-units`)
    if (!clean(subject.blockSection)) addIssue(`${label}: Add a block section.`, `${subjectTarget}-section`)
    else if (clean(subject.blockSection).length > 80) addIssue(`${label}: Shorten the block section.`, `${subjectTarget}-section`)
    const subjectKey = `${subject.subjectCode.toLowerCase()}\u001f${subject.blockSection.toLowerCase()}`
    if (subjectKeys.has(subjectKey)) addIssue(`${label}: Remove the duplicate subject.`, subjectTarget)
    subjectKeys.add(subjectKey)
    const meetingKeys = new Set<string>()
    for (const meeting of subject.meetings) {
      const meetingTarget = `${subjectTarget}-meeting-${meeting.id}`
      if (!DAY_CODES.has(meeting.dayCode)) addIssue(`${label}: Choose a meeting day.`, `${meetingTarget}-day`)
      if (!/^\d{2}:\d{2}$/.test(meeting.startsAt) || !/^\d{2}:\d{2}$/.test(meeting.endsAt) || meeting.startsAt >= meeting.endsAt) addIssue(`${label}: Check the meeting time.`, `${meetingTarget}-starts`)
      if (clean(meeting.room).length > 120) addIssue(`${label}: Shorten the room name.`, `${meetingTarget}-room`)
      else if (clean(meeting.room).toUpperCase() === 'N/A') addIssue(`${label}: Clear the room if it is unknown.`, `${meetingTarget}-room`)
      const meetingKey = `${meeting.dayCode}\u001f${meeting.startsAt}\u001f${meeting.endsAt}`
      if (meetingKeys.has(meetingKey)) addIssue(`${label}: Remove the duplicate meeting.`, meetingTarget)
      meetingKeys.add(meetingKey)
    }
  }
  return issues
}

export function validateImportedSchedule(subjects: ImportedSubjectDraft[]) {
  return getImportedScheduleIssues(subjects).map(issue => issue.message)
}
