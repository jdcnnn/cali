import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { NavLink, useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { calendarColorValue, defaultCalendarColor } from '../lib/calendarColors'
import type { CalendarColorKey } from '../lib/calendarColors'
import { localDateKey } from '../lib/tasks'
import type { Task, TaskPriority } from '../lib/tasks'
import { CalendarColorPicker } from './CalendarColorPicker'
import { CaliDatePicker, CaliTimePicker } from './CaliDateTimePicker'
import { ConfirmationIcon } from './ConfirmationIcon'
import { ReminderField } from './ReminderField'
import { reminderLabel } from '../lib/reminders'
import { enablePushNotifications } from '../lib/pushNotifications'
import './calendar.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type Subject = { id: string; subject_code: string; title: string; block_section: string; color_key: CalendarColorKey }
type Meeting = { id: string; subject_id: string; day_code: DayCode; starts_at: string; ends_at: string; room: string | null; reminder_minutes: number | null }
type CalendarEvent = { id: string; user_id: string; title: string; event_date: string; starts_at: string | null; ends_at: string | null; location: string | null; notes: string | null; color_key: CalendarColorKey; reminder_minutes: number | null; created_at: string; updated_at: string }
type EventDraft = { title: string; date: string; start: string; end: string; location: string; notes: string; colorKey: CalendarColorKey; reminderMinutes: number | null }
type CalendarPreview = { kind: 'task'; task: Task } | { kind: 'class'; meeting: Meeting; date: string } | { kind: 'event'; event: CalendarEvent }

const dayCodes: DayCode[] = ['U', 'M', 'T', 'W', 'H', 'F', 'S']
const priorityLabels: Record<TaskPriority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = result.getDay() === 0 ? -6 : 1 - result.getDay()
  result.setDate(result.getDate() + offset)
  return result
}

function addDays(date: Date, amount: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

function monthGridDates(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function clock(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute))
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function CalendarEmptyIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m5 5 2 2 4-4" /></svg>
}

function ClassIndicatorIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-5 9 5-9 5-9-5Z" /><path d="M7 12.2V16c3 2 7 2 10 0v-3.8M21 10v5" /></svg>
}

function DeadlineIndicatorIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h5m-5 4 2 2 4-4" /></svg>
}

function EventIndicatorIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m18.5 16 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></svg>
}

function emptyEventDraft(date: string): EventDraft {
  return { title: '', date, start: '', end: '', location: '', notes: '', colorKey: 'violet', reminderMinutes: null }
}

function eventDraftFrom(event: CalendarEvent): EventDraft {
  return { title: event.title, date: event.event_date, start: event.starts_at ?? '', end: event.ends_at ?? '', location: event.location ?? '', notes: event.notes ?? '', colorKey: event.color_key, reminderMinutes: event.reminder_minutes }
}

function EventEditorDialog({ studentId, initialDate, existingEvent, onClose, onSaved }: { studentId: string; initialDate: string; existingEvent?: CalendarEvent; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(() => existingEvent ? eventDraftFrom(existingEvent) : emptyEventDraft(initialDate))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !supabase) return
    const title = draft.title.replace(/\s+/g, ' ').trim()
    const location = draft.location.replace(/\s+/g, ' ').trim()
    const notes = draft.notes.trim()
    if (!title || title.length > 160) { setError('Enter an event title of up to 160 characters.'); return }
    if (!draft.date) { setError('Choose an event date.'); return }
    if (draft.end && (!draft.start || draft.end <= draft.start)) { setError('Choose an end time after the start time.'); return }
    if (location.length > 160 || notes.length > 4000) { setError('Shorten the location or notes.'); return }
    if (draft.reminderMinutes && !draft.start) { setError('Add a start time before choosing a reminder.'); return }
    if (draft.reminderMinutes) void enablePushNotifications().catch(() => undefined)
    setBusy(true)
    setError('')
    try {
      const details = { title, event_date: draft.date, starts_at: draft.start || null, ends_at: draft.end || null, location: location || null, notes: notes || null, color_key: draft.colorKey, reminder_minutes: draft.reminderMinutes }
      const query = existingEvent
        ? supabase.from('calendar_events').update(details).eq('id', existingEvent.id).eq('user_id', studentId)
        : supabase.from('calendar_events').insert({ user_id: studentId, ...details })
      const { error: saveError } = await query
      if (saveError) throw saveError
      await onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the event.')
      setBusy(false)
    }
  }

  async function deleteEvent() {
    if (busy || !supabase || !existingEvent) return
    setBusy(true)
    setError('')
    try {
      const { error: deleteError } = await supabase.from('calendar_events').delete().eq('id', existingEvent.id).eq('user_id', studentId)
      if (deleteError) throw deleteError
      await onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the event.')
      setBusy(false)
    }
  }

  return <dialog ref={dialogRef} className={`calendar-event-dialog${confirmDelete ? ' is-confirmation' : ''}`} aria-labelledby="calendar-event-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    {confirmDelete && existingEvent ? <div className="calendar-event-confirm">
      <ConfirmationIcon kind={busy ? 'loading' : 'error'} />
      <p className="workspace-overline">DELETE EVENT</p>
      <h2 id="calendar-event-title">Delete “{existingEvent.title}”?</h2>
      <p>This permanently removes the event and its reminder. This cannot be undone.</p>
      {error && <p className="calendar-event-error" role="alert">{error}</p>}
      <footer><button type="button" className="task-secondary" autoFocus onClick={() => { setConfirmDelete(false); setError('') }} disabled={busy}>Keep event</button><button type="button" className="calendar-event-danger" onClick={() => { void deleteEvent() }} disabled={busy}>{busy ? 'Deleting...' : 'Delete event'}</button></footer>
    </div> : <form onSubmit={save}>
      <header><div><p className="workspace-overline">{existingEvent ? 'EDIT EVENT' : 'NEW EVENT'}</p><h2 id="calendar-event-title">{existingEvent ? 'Edit event' : 'Add event'}</h2><p>{existingEvent ? 'Update this event and its reminder.' : 'Create a dated event for your calendar.'}</p></div><button type="button" aria-label="Close event form" onClick={onClose} disabled={busy}><CloseIcon /></button></header>
      <div className="calendar-event-body">
        <label className="calendar-event-field calendar-event-field--wide"><span>Title</span><input value={draft.title} maxLength={160} autoFocus onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} required /></label>
        <div className="calendar-event-grid"><CaliDatePicker label="Date" value={draft.date} onChange={date => setDraft(previous => ({ ...previous, date }))} required /><label className="calendar-event-field"><span>Location <small>Optional</small></span><input value={draft.location} maxLength={160} onChange={event => setDraft(previous => ({ ...previous, location: event.target.value }))} /></label><CaliTimePicker label="Start time" value={draft.start} onChange={start => setDraft(previous => ({ ...previous, start, end: start ? previous.end : '', reminderMinutes: start ? previous.reminderMinutes : null }))} optional /><CaliTimePicker label="End time" value={draft.end} onChange={end => setDraft(previous => ({ ...previous, end }))} optional disabled={!draft.start} /><ReminderField id="event-reminder" value={draft.reminderMinutes} onChange={reminderMinutes => setDraft(previous => ({ ...previous, reminderMinutes }))} disabled={!draft.start} /></div>
        <label className="calendar-event-field calendar-event-field--wide"><span>Notes <small>Optional</small></span><textarea value={draft.notes} maxLength={4000} rows={4} onChange={event => setDraft(previous => ({ ...previous, notes: event.target.value }))} /></label>
        <CalendarColorPicker value={draft.colorKey} onChange={colorKey => setDraft(previous => ({ ...previous, colorKey }))} label="Event color" />
        {error && <p className="calendar-event-error" role="alert">{error}</p>}
      </div>
      <footer className={existingEvent ? 'calendar-event-editor-actions' : undefined}>{existingEvent && <button type="button" className="calendar-event-delete" onClick={() => { setError(''); setConfirmDelete(true) }} disabled={busy}>Delete event</button>}<span><button type="button" className="task-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : existingEvent ? 'Save changes' : 'Add event'}</button></span></footer>
    </form>}
  </dialog>
}

function CalendarPreviewDialog({ preview, subjects, onClose, onEditEvent }: { preview: CalendarPreview; subjects: Map<string, Subject>; onClose: () => void; onEditEvent: (event: CalendarEvent) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const subjectId = preview.kind === 'task' ? preview.task.schedule_subject_id : preview.kind === 'class' ? preview.meeting.subject_id : null
  const subject = subjectId ? subjects.get(subjectId) : undefined
  const date = dateFromKey(preview.kind === 'task' ? preview.task.due_date : preview.kind === 'class' ? preview.date : preview.event.event_date)
  const title = preview.kind === 'task' ? preview.task.title : preview.kind === 'class' ? subject?.subject_code ?? 'Class meeting' : preview.event.title
  const time = preview.kind === 'task' ? preview.task.due_time ? clock(preview.task.due_time) : 'No specific time' : preview.kind === 'class' ? `${clock(preview.meeting.starts_at)}–${clock(preview.meeting.ends_at)}` : preview.event.starts_at ? `${clock(preview.event.starts_at)}${preview.event.ends_at ? `–${clock(preview.event.ends_at)}` : ''}` : 'No specific time'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  return <dialog ref={dialogRef} className="calendar-preview-dialog" aria-labelledby="calendar-preview-title" onCancel={event => { event.preventDefault(); onClose() }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="calendar-preview">
      <header><div><p className="workspace-overline">{preview.kind === 'task' ? 'TASK DEADLINE' : preview.kind === 'class' ? 'CLASS MEETING' : 'EVENT'}</p><h2 id="calendar-preview-title">{title}</h2>{preview.kind === 'class' && subject?.title && <p>{subject.title}</p>}</div><button type="button" aria-label="Close preview" onClick={onClose}><CloseIcon /></button></header>
      <div className="calendar-preview-body">
        <dl>
          <div><dt>Date</dt><dd>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}</dd></div>
          <div><dt>Time</dt><dd>{time}</dd></div>
          {preview.kind === 'event' ? <div><dt>Location</dt><dd>{preview.event.location || 'Not specified'}</dd></div> : <div><dt>Subject</dt><dd>{subject ? `${subject.subject_code} · ${subject.title}` : 'General'}</dd></div>}
          <div><dt>Reminder</dt><dd>{reminderLabel(preview.kind === 'task' ? preview.task.reminder_minutes : preview.kind === 'class' ? preview.meeting.reminder_minutes : preview.event.reminder_minutes)}</dd></div>
          {preview.kind === 'task' ? <div><dt>Importance</dt><dd>{priorityLabels[preview.task.priority]}</dd></div> : preview.kind === 'class' ? <><div><dt>Room</dt><dd>{preview.meeting.room || 'Not specified'}</dd></div><div><dt>Block</dt><dd>{subject?.block_section || 'Not specified'}</dd></div></> : null}
        </dl>
        {preview.kind === 'task' && preview.task.notes && <section><h3>Notes</h3><p>{preview.task.notes}</p></section>}
        {preview.kind === 'event' && preview.event.notes && <section><h3>Notes</h3><p>{preview.event.notes}</p></section>}
      </div>
      <footer><button type="button" className="task-secondary" onClick={onClose}>Close</button>{preview.kind === 'event' ? <button type="button" className="button-primary" onClick={() => onEditEvent(preview.event)}>Edit event</button> : <NavLink className="button-primary" to={preview.kind === 'task' ? '/tasks' : '/schedules'}>{preview.kind === 'task' ? 'Open task' : 'Open schedule'}</NavLink>}</footer>
    </div>
  </dialog>
}

function CalendarSkeleton() {
  return <div className="calendar-page calendar-page--loading" aria-label="Loading calendar" aria-busy="true"><section className="calendar-shell calendar-loading-shell">
    <header className="calendar-heading calendar-loading-heading"><div><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--short" /><span className="cali-skeleton calendar-loading-title" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--medium" /></div></header>
    <div className="calendar-loading-toolbar"><span className="cali-skeleton calendar-loading-today" /><span className="cali-skeleton calendar-loading-arrows" /><span className="cali-skeleton calendar-loading-month-label" /></div>
    <div className="calendar-loading-layout"><div className="calendar-loading-board"><div className="calendar-loading-weekdays">{Array.from({ length: 7 }, (_, index) => <span className="cali-skeleton cali-skeleton-line" key={index} />)}</div><div className="calendar-loading-grid">{Array.from({ length: 42 }, (_, index) => <span key={index}><i className="cali-skeleton" />{index % 3 === 0 && <b className="cali-skeleton" />}</span>)}</div></div><aside className="calendar-loading-agenda"><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--short" /><span className="cali-skeleton calendar-loading-agenda-title" /><div className="calendar-loading-legend">{[0, 1, 2].map(item => <span className="cali-skeleton" key={item} />)}</div>{[0, 1, 2].map(item => <div className="calendar-loading-card" key={item}><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--long" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--medium" /></div>)}</aside></div>
  </section></div>
}

export function CalendarPage({ studentId, now }: { studentId: string; now: Date }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDate = searchParams.get('date')
  const [selectedDate, setSelectedDate] = useState(() => requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : localDateKey(now))
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [preview, setPreview] = useState<CalendarPreview | null>(null)
  const [eventEditorOpen, setEventEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [subjectResult, taskResult, eventResult] = await Promise.all([
      supabase.from('schedule_subjects').select('id,subject_code,title,block_section,color_key').eq('user_id', studentId).order('subject_code'),
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,planned_date,priority,status,position,completed_at,reminder_minutes,created_at,updated_at').eq('user_id', studentId).neq('status', 'done').order('due_date'),
      supabase.from('calendar_events').select('id,user_id,title,event_date,starts_at,ends_at,location,notes,color_key,reminder_minutes,created_at,updated_at').eq('user_id', studentId).order('event_date').order('starts_at'),
    ])
    if (subjectResult.error) throw subjectResult.error
    if (taskResult.error) throw taskResult.error
    if (eventResult.error) throw eventResult.error
    const nextSubjects = (subjectResult.data ?? []) as Subject[]
    let nextMeetings: Meeting[] = []
    if (nextSubjects.length) {
      const meetingResult = await supabase.from('schedule_meetings').select('id,subject_id,day_code,starts_at,ends_at,room,reminder_minutes').in('subject_id', nextSubjects.map(subject => subject.id)).order('starts_at')
      if (meetingResult.error) throw meetingResult.error
      nextMeetings = (meetingResult.data ?? []) as Meeting[]
    }
    setSubjects(nextSubjects)
    setMeetings(nextMeetings)
    setTasks((taskResult.data ?? []) as Task[])
    setEvents((eventResult.data ?? []) as CalendarEvent[])
    setError('')
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void load().catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'Could not load your calendar.'); setLoading(false) } }) }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  useEffect(() => {
    if (loading || preview) return
    const eventId = searchParams.get('event')
    if (!eventId) return
    const selectedEvent = events.find(event => event.id === eventId)
    const timer = window.setTimeout(() => {
      if (selectedEvent) {
        setSelectedDate(selectedEvent.event_date)
        setPreview({ kind: 'event', event: selectedEvent })
      }
      setSearchParams({}, { replace: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [events, loading, preview, searchParams, setSearchParams])

  const selected = useMemo(() => dateFromKey(selectedDate), [selectedDate])
  const monthDates = useMemo(() => monthGridDates(selected), [selected])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    tasks.forEach(task => grouped.set(task.due_date, [...(grouped.get(task.due_date) ?? []), task]))
    grouped.forEach(dayTasks => dayTasks.sort((left, right) => (left.due_time ?? '99:99').localeCompare(right.due_time ?? '99:99') || left.title.localeCompare(right.title)))
    return grouped
  }, [tasks])
  const meetingsByCode = useMemo(() => new Map(dayCodes.map(code => [code, meetings.filter(meeting => meeting.day_code === code).sort((left, right) => left.starts_at.localeCompare(right.starts_at))])), [meetings])
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>()
    events.forEach(event => grouped.set(event.event_date, [...(grouped.get(event.event_date) ?? []), event]))
    grouped.forEach(dayEvents => dayEvents.sort((left, right) => (left.starts_at ?? '99:99').localeCompare(right.starts_at ?? '99:99') || left.title.localeCompare(right.title)))
    return grouped
  }, [events])
  const todayKey = localDateKey(now)
  const selectedDayCode = dayCodes[selected.getDay()]
  const selectedMeetings = meetingsByCode.get(selectedDayCode) ?? []
  const selectedTasks = tasksByDate.get(selectedDate) ?? []
  const selectedEvents = eventsByDate.get(selectedDate) ?? []
  const rangeLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(selected)

  function movePeriod(direction: -1 | 1) {
    setSelectedDate(localDateKey(new Date(selected.getFullYear(), selected.getMonth() + direction, 1)))
  }

  if (loading) return <CalendarSkeleton />

  return <div className="calendar-page">
    {error ? <><header className="calendar-heading calendar-heading--standalone"><div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1></div></header><section className="calendar-error" role="alert"><h2>Calendar could not be loaded</h2><p>{error}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setError(cause instanceof Error ? cause.message : 'Could not load your calendar.'); setLoading(false) }) }}>Try again</button></section></> : <section className="calendar-shell">
      <header className="calendar-heading">
        <div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1><p>See your class meetings and task deadlines in one clear monthly view.</p></div>
      </header>
      <div className="calendar-toolbar" aria-label="Calendar controls">
        <div className="calendar-navigation"><button type="button" className="calendar-today" onClick={() => setSelectedDate(todayKey)}>Today</button><span className="calendar-arrow-group"><button type="button" onClick={() => movePeriod(-1)} aria-label="Previous month"><ChevronIcon direction="left" /></button><button type="button" onClick={() => movePeriod(1)} aria-label="Next month"><ChevronIcon direction="right" /></button></span><h2 aria-live="polite">{rangeLabel}</h2></div>
      </div>

      {!meetings.length && !tasks.length && !events.length && <section className="calendar-empty"><div><span><CalendarEmptyIcon /></span><h2>Nothing scheduled yet</h2><p>Add a class meeting, task deadline, or event to begin filling your calendar.</p></div><div><NavLink to={`/schedules?new=1&day=${selectedDayCode}`}>Add a class</NavLink><NavLink to={`/tasks?new=1&date=${selectedDate}`}>Add a task</NavLink><button type="button" onClick={() => { setEditingEvent(null); setEventEditorOpen(true) }}>Add an event</button></div></section>}

      <section className="calendar-month" aria-label="Monthly calendar">
        <div className="calendar-month-board"><div className="calendar-month-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">{monthDates.map(date => { const key = localDateKey(date); const outside = date.getMonth() !== selected.getMonth(); const hasTasks = (tasksByDate.get(key)?.length ?? 0) > 0; const dayMeetings = meetingsByCode.get(dayCodes[date.getDay()]) ?? []; const dayEvents = eventsByDate.get(key) ?? []; const firstClassColor = subjectMap.get(dayMeetings[0]?.subject_id)?.color_key ?? defaultCalendarColor; const firstEventColor = dayEvents[0]?.color_key ?? 'violet'; return <article key={key} className={`calendar-month-day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}><button type="button" className="calendar-month-select" aria-label={`Show ${new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`} aria-pressed={key === selectedDate} onClick={() => setSelectedDate(key)}><span className="calendar-month-number">{date.getDate()}</span><span className="calendar-month-indicators" aria-hidden="true">{dayMeetings.length > 0 && <span className="calendar-indicator" style={{ color: calendarColorValue(firstClassColor) }}><ClassIndicatorIcon /></span>}{hasTasks && <span className="calendar-indicator calendar-indicator--task"><DeadlineIndicatorIcon /></span>}{dayEvents.length > 0 && <span className="calendar-indicator" style={{ color: calendarColorValue(firstEventColor) }}><EventIndicatorIcon /></span>}</span></button></article> })}</div></div>
        <aside className="calendar-month-agenda" aria-label="Selected day details">
          <header><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : 'SELECTED DAY'}</p><h3>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h3><div className="calendar-legend"><span><i className="calendar-indicator calendar-indicator--class"><ClassIndicatorIcon /></i>Class meeting</span><span><i className="calendar-indicator calendar-indicator--task"><DeadlineIndicatorIcon /></i>Task deadline</span><span><i className="calendar-indicator calendar-indicator--event"><EventIndicatorIcon /></i>Event</span></div></header>
          {selectedTasks.length || selectedMeetings.length || selectedEvents.length ? <div className="calendar-month-agenda-groups">
            {selectedTasks.length > 0 && <section><h4>Task deadlines</h4>{selectedTasks.map(task => <button key={task.id} type="button" className="is-task" onClick={() => setPreview({ kind: 'task', task })}><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'} · {task.due_time ? clock(task.due_time) : priorityLabels[task.priority]}</small></span></button>)}</section>}
            {selectedMeetings.length > 0 && <section><h4>Class meetings</h4>{selectedMeetings.map(meeting => { const subject = subjectMap.get(meeting.subject_id); return <button key={meeting.id} type="button" className="is-class" style={{ '--entry-color': calendarColorValue(subject?.color_key) } as CSSProperties} onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><span><strong>{subject?.subject_code ?? 'Class'}</strong><small>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}{meeting.room ? ` · ${meeting.room}` : ''}</small></span></button> })}</section>}
            {selectedEvents.length > 0 && <section><h4>Events</h4>{selectedEvents.map(event => <button key={event.id} type="button" className="is-event" style={{ '--entry-color': calendarColorValue(event.color_key) } as CSSProperties} onClick={() => setPreview({ kind: 'event', event })}><span><strong>{event.title}</strong><small>{event.starts_at ? clock(event.starts_at) : 'All day'}{event.location ? ` · ${event.location}` : ''}</small></span></button>)}</section>}
          </div> : <div className="calendar-month-agenda-empty"><CalendarEmptyIcon /><strong>This day is clear</strong><p>No class meetings, task deadlines, or events are scheduled.</p></div>}
        </aside>
      </section>
      {preview && <CalendarPreviewDialog preview={preview} subjects={subjectMap} onClose={() => setPreview(null)} onEditEvent={event => { setPreview(null); setEditingEvent(event); setEventEditorOpen(true) }} />}
      <details className="calendar-create"><summary aria-label="Add to calendar"><span>+</span></summary><div><p>ADD TO CALENDAR</p><NavLink to={`/schedules?new=1&day=${selectedDayCode}`}><ClassIndicatorIcon /><span><strong>Class meeting</strong><small>Add to Schedules</small></span></NavLink><NavLink to={`/tasks?new=1&date=${selectedDate}`}><DeadlineIndicatorIcon /><span><strong>Task deadline</strong><small>Due on selected date</small></span></NavLink><button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setEditingEvent(null); setEventEditorOpen(true) }}><EventIndicatorIcon /><span><strong>Event</strong><small>Add to selected date</small></span></button></div></details>
      {eventEditorOpen && <EventEditorDialog studentId={studentId} initialDate={selectedDate} existingEvent={editingEvent ?? undefined} onClose={() => { setEventEditorOpen(false); setEditingEvent(null) }} onSaved={load} />}
    </section>}
  </div>
}
