import { supabase } from './supabase'
import { validateMeetings, type ParsedMeeting } from './scheduleValidation'

type ImportResult = { imported: number; skipped: number }
export type ImportProgress = ImportResult & { processed: number; total: number }

export async function importParsedSchedule(
  userId: string,
  meetings: ParsedMeeting[],
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const rows = validateMeetings(meetings)
  const { data: savedSubjects, error: subjectError } = await supabase
    .from('schedule_subjects')
    .select('id, subject_code, block_section')
    .eq('user_id', userId)
  if (subjectError) throw new Error(`Could not read saved subjects: ${subjectError.message}`)

  const subjects = new Map((savedSubjects ?? []).map((subject) => [
    `${subject.subject_code.trim().toUpperCase()}|${subject.block_section.trim().toUpperCase()}`,
    subject.id,
  ]))
  const savedMeetings = new Map<string, Set<string>>()
  let imported = 0
  let skipped = 0
  let processed = 0

  function report() {
    processed++
    onProgress?.({ processed, total: rows.length, imported, skipped })
  }

  for (const row of rows) {
    const subjectKey = `${row.subject_code.toUpperCase()}|${row.block_section.toUpperCase()}`
    let subjectId = subjects.get(subjectKey)
    if (!subjectId) {
      const { data, error } = await supabase.from('schedule_subjects').insert({
        user_id: userId,
        subject_code: row.subject_code,
        title: row.title,
        units: row.units,
        block_section: row.block_section,
      }).select('id').single()
      if (error || !data) throw new Error(`Could not save ${row.subject_code}: ${error?.message ?? 'Unknown error'}`)
      subjectId = data.id
      subjects.set(subjectKey, subjectId)
    }

    if (!savedMeetings.has(subjectId)) {
      const { data, error } = await supabase.from('schedule_meetings')
        .select('day_code, starts_at, ends_at')
        .eq('subject_id', subjectId)
      if (error) throw new Error(`Could not read meetings for ${row.subject_code}: ${error.message}`)
      savedMeetings.set(subjectId, new Set((data ?? []).map((meeting) =>
        `${meeting.day_code}|${meeting.starts_at.slice(0, 5)}|${meeting.ends_at.slice(0, 5)}`)))
    }

    const meetingKey = `${row.day_code}|${row.starts_at}|${row.ends_at}`
    if (savedMeetings.get(subjectId)!.has(meetingKey)) {
      skipped++
      report()
      continue
    }
    const { error } = await supabase.from('schedule_meetings').insert({
      subject_id: subjectId,
      day_code: row.day_code,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      room: row.room || null,
    })
    if (error) throw new Error(`Could not save ${row.subject_code} on ${row.day_code}: ${error.message}`)
    savedMeetings.get(subjectId)!.add(meetingKey)
    imported++
    report()
  }

  return { imported, skipped }
}
