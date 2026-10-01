import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/tasks'
import type { Task, TaskPriority } from '../lib/tasks'
import './calendar.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type Subject = { id: string; subject_code: string; title: string; block_section: string }
type Meeting = { id: string; subject_id: string; day_code: DayCode; starts_at: string; ends_at: string; room: string | null }
type CalendarPreview = { kind: 'task'; task: Task } | { kind: 'class'; meeting: Meeting; date: string }

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

function CalendarPreviewDialog({ preview, subjects, onClose }: { preview: CalendarPreview; subjects: Map<string, Subject>; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const subjectId = preview.kind === 'task' ? preview.task.schedule_subject_id : preview.meeting.subject_id
  const subject = subjectId ? subjects.get(subjectId) : undefined
  const date = dateFromKey(preview.kind === 'task' ? preview.task.due_date : preview.date)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  return <dialog ref={dialogRef} className="calendar-preview-dialog" aria-labelledby="calendar-preview-title" onCancel={event => { event.preventDefault(); onClose() }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="calendar-preview">
      <header><div><p className="workspace-overline">{preview.kind === 'task' ? 'TASK DEADLINE' : 'CLASS MEETING'}</p><h2 id="calendar-preview-title">{preview.kind === 'task' ? preview.task.title : subject?.subject_code ?? 'Class meeting'}</h2>{preview.kind === 'class' && subject?.title && <p>{subject.title}</p>}</div><button type="button" aria-label="Close preview" onClick={onClose}><CloseIcon /></button></header>
      <div className="calendar-preview-body">
        <dl>
          <div><dt>Date</dt><dd>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}</dd></div>
          <div><dt>Time</dt><dd>{preview.kind === 'task' ? preview.task.due_time ? clock(preview.task.due_time) : 'No specific time' : `${clock(preview.meeting.starts_at)}–${clock(preview.meeting.ends_at)}`}</dd></div>
          <div><dt>Subject</dt><dd>{subject ? `${subject.subject_code} · ${subject.title}` : 'General'}</dd></div>
          {preview.kind === 'task' ? <div><dt>Importance</dt><dd>{priorityLabels[preview.task.priority]}</dd></div> : <><div><dt>Room</dt><dd>{preview.meeting.room || 'Not specified'}</dd></div><div><dt>Block</dt><dd>{subject?.block_section || 'Not specified'}</dd></div></>}
        </dl>
        {preview.kind === 'task' && preview.task.notes && <section><h3>Notes</h3><p>{preview.task.notes}</p></section>}
      </div>
      <footer><button type="button" className="task-secondary" onClick={onClose}>Close</button><NavLink className="button-primary" to={preview.kind === 'task' ? '/tasks' : '/schedules'}>{preview.kind === 'task' ? 'Open task' : 'Open schedule'}</NavLink></footer>
    </div>
  </dialog>
}

function CalendarSkeleton() {
  return <div className="calendar-page"><div className="calendar-heading"><div><div className="skeleton skeleton-line skeleton-line--short" /><div className="skeleton skeleton-line skeleton-line--title" /></div></div><div className="calendar-skeleton"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div></div>
}

export function CalendarPage({ studentId, now }: { studentId: string; now: Date }) {
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(now))
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [preview, setPreview] = useState<CalendarPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [subjectResult, taskResult] = await Promise.all([
      supabase.from('schedule_subjects').select('id,subject_code,title,block_section').eq('user_id', studentId).order('subject_code'),
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,planned_date,priority,status,position,completed_at,created_at,updated_at').eq('user_id', studentId).neq('status', 'done').order('due_date'),
    ])
    if (subjectResult.error) throw subjectResult.error
    if (taskResult.error) throw taskResult.error
    const nextSubjects = (subjectResult.data ?? []) as Subject[]
    let nextMeetings: Meeting[] = []
    if (nextSubjects.length) {
      const meetingResult = await supabase.from('schedule_meetings').select('id,subject_id,day_code,starts_at,ends_at,room').in('subject_id', nextSubjects.map(subject => subject.id)).order('starts_at')
      if (meetingResult.error) throw meetingResult.error
      nextMeetings = (meetingResult.data ?? []) as Meeting[]
    }
    setSubjects(nextSubjects)
    setMeetings(nextMeetings)
    setTasks((taskResult.data ?? []) as Task[])
    setError('')
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void load().catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'Could not load your calendar.'); setLoading(false) } }) }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

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
  const todayKey = localDateKey(now)
  const selectedDayCode = dayCodes[selected.getDay()]
  const selectedMeetings = meetingsByCode.get(selectedDayCode) ?? []
  const selectedTasks = tasksByDate.get(selectedDate) ?? []
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

      {!meetings.length && !tasks.length && <section className="calendar-empty"><div><span><CalendarEmptyIcon /></span><h2>Nothing scheduled yet</h2><p>Add a class meeting or task deadline to begin filling your calendar.</p></div><div><NavLink to="/schedules">Add a class</NavLink><NavLink to="/tasks?new=1">Add a task</NavLink></div></section>}

      <section className="calendar-month" aria-label="Monthly calendar">
        <div className="calendar-month-board"><div className="calendar-month-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">{monthDates.map(date => { const key = localDateKey(date); const outside = date.getMonth() !== selected.getMonth(); const hasTasks = (tasksByDate.get(key)?.length ?? 0) > 0; const hasMeetings = (meetingsByCode.get(dayCodes[date.getDay()])?.length ?? 0) > 0; return <article key={key} className={`calendar-month-day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}><button type="button" className="calendar-month-select" aria-label={`Show ${new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`} aria-pressed={key === selectedDate} onClick={() => setSelectedDate(key)}><span className="calendar-month-number">{date.getDate()}</span><span className="calendar-month-indicators" aria-hidden="true">{hasMeetings && <span className="calendar-indicator calendar-indicator--class"><ClassIndicatorIcon /></span>}{hasTasks && <span className="calendar-indicator calendar-indicator--task"><DeadlineIndicatorIcon /></span>}</span></button></article> })}</div></div>
        <aside className="calendar-month-agenda" aria-label="Selected day details">
          <header><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : 'SELECTED DAY'}</p><h3>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h3><div className="calendar-legend"><span><i className="calendar-indicator calendar-indicator--class"><ClassIndicatorIcon /></i>Class meeting</span><span><i className="calendar-indicator calendar-indicator--task"><DeadlineIndicatorIcon /></i>Task deadline</span></div></header>
          {selectedTasks.length || selectedMeetings.length ? <div className="calendar-month-agenda-groups">
            {selectedTasks.length > 0 && <section><h4>Task deadlines</h4>{selectedTasks.map(task => <button key={task.id} type="button" className="is-task" onClick={() => setPreview({ kind: 'task', task })}><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'} · {task.due_time ? clock(task.due_time) : priorityLabels[task.priority]}</small></span></button>)}</section>}
            {selectedMeetings.length > 0 && <section><h4>Class meetings</h4>{selectedMeetings.map(meeting => <button key={meeting.id} type="button" className="is-class" onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><span><strong>{subjectMap.get(meeting.subject_id)?.subject_code ?? 'Class'}</strong><small>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}{meeting.room ? ` · ${meeting.room}` : ''}</small></span></button>)}</section>}
          </div> : <div className="calendar-month-agenda-empty"><CalendarEmptyIcon /><strong>This day is clear</strong><p>No class meetings or task deadlines are scheduled.</p></div>}
        </aside>
      </section>
      {preview && <CalendarPreviewDialog preview={preview} subjects={subjectMap} onClose={() => setPreview(null)} />}
    </section>}
  </div>
}
