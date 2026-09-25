export type ParsedMeeting = {
  subject_code: string
  title: string
  units: number
  block_section: string
  day_code: string
  starts_at: string
  ends_at: string
  room: string
}

const days = new Set(['M', 'T', 'W', 'H', 'F', 'S', 'U'])
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizeMeetingsForReview(value: unknown): ParsedMeeting[] {
  if (!Array.isArray(value)) throw new Error('We could not read the class list from this form.')
  return value.filter((item) => item && typeof item === 'object').map((item) => {
    const row = item as Record<string, unknown>
    const string = (key: string) => typeof row[key] === 'string' ? (row[key] as string).trim() : ''
    const units = row.units == null || row.units === '' ? Number.NaN : Number(row.units)
    return {
      subject_code: string('subject_code'), title: string('title'),
      units: Number.isFinite(units) ? units : Number.NaN,
      block_section: string('block_section'), day_code: string('day_code').toUpperCase(),
      starts_at: string('starts_at'), ends_at: string('ends_at'),
      room: string('room').toUpperCase() === 'N/A' ? '' : string('room'),
    }
  })
}

export function validateMeetings(value: unknown): ParsedMeeting[] {
  if (!Array.isArray(value)) throw new Error('The parser returned an invalid schedule.')

  return value.map((item, index) => {
    const row = item as Partial<ParsedMeeting> | null
    const label = `Meeting ${index + 1}`
    if (!row || typeof row !== 'object') throw new Error(`${label} is invalid.`)

    const subject_code = typeof row.subject_code === 'string' ? row.subject_code.trim() : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const block_section = typeof row.block_section === 'string' ? row.block_section.trim() : ''
    const day_code = typeof row.day_code === 'string' ? row.day_code.trim().toUpperCase() : ''
    const starts_at = typeof row.starts_at === 'string' ? row.starts_at.trim() : ''
    const ends_at = typeof row.ends_at === 'string' ? row.ends_at.trim() : ''
    const room = typeof row.room === 'string' ? row.room.trim() : ''
    const units = row.units

    if (!subject_code || subject_code.length > 40) throw new Error(`${label} needs a valid subject code.`)
    if (!title || title.length > 200) throw new Error(`${label} needs a valid subject name.`)
    if (!block_section || block_section.length > 80) throw new Error(`${label} needs a valid block or section.`)
    if (!days.has(day_code)) throw new Error(`${label} needs a day.`)
    if (!timePattern.test(starts_at) || !timePattern.test(ends_at)) throw new Error(`${label} needs valid start and end times.`)
    if (starts_at >= ends_at) throw new Error(`${label} must end after it starts.`)
    if (typeof units !== 'number' || !Number.isFinite(units) || units < 0 || units > 30 ||
      Math.round(units * 10) !== units * 10) throw new Error(`${label} needs units from 0 to 30, with at most one decimal place.`)
    if (room.length > 120) throw new Error(`${label} has a room name that is too long.`)

    return { subject_code, title, units, block_section, day_code, starts_at, ends_at,
      room: room.toUpperCase() === 'N/A' ? '' : room }
  })
}
