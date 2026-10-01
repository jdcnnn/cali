import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/tasks'
import type { Task, TaskPriority } from '../lib/tasks'
import './calendar.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type CalendarView = 'month' | 'week' | 'day'
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

function formatCalendarRange(view: CalendarView, selected: Date, weekDates: Date[]) {
  if (view === 'month') return new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(selected)
  if (view === 'day') return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(selected)
  const first = weekDates[0]
  const last = weekDates[6]
  const month = (date: Date) => new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(date)
  if (first.getFullYear() !== last.getFullYear()) return `${month(first)} ${first.getDate()}, ${first.getFullYear()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
  if (first.getMonth() !== last.getMonth()) return `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
  return `${month(first)} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
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
  const [view, setView] = useState<CalendarView>('month')
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
  const weekStart = useMemo(() => startOfWeek(selected), [selected])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
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
  const rangeLabel = formatCalendarRange(view, selected, weekDates)

  function movePeriod(direction: -1 | 1) {
    if (view === 'month') {
      setSelectedDate(localDateKey(new Date(selected.getFullYear(), selected.getMonth() + direction, 1)))
      return
    }
    setSelectedDate(localDateKey(addDays(selected, direction * (view === 'week' ? 7 : 1))))
  }

  if (loading) return <CalendarSkeleton />

  return <div className="calendar-page">
    {error ? <><header className="calendar-heading calendar-heading--standalone"><div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1></div></header><section className="calendar-error" role="alert"><h2>Calendar could not be loaded</h2><p>{error}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setError(cause instanceof Error ? cause.message : 'Could not load your calendar.'); setLoading(false) }) }}>Try again</button></section></> : <section className="calendar-shell">
      <header className="calendar-heading">
        <div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1><p>See class meetings and task deadlines clearly, without the timetable.</p></div>
        <div className="calendar-view-switch" aria-label="Calendar view"><button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button><button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button><button type="button" className={view === 'day' ? 'active' : ''} aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button></div>
      </header>
      <div className="calendar-toolbar" aria-label="Calendar controls">
        <div className="calendar-navigation"><button type="button" className="calendar-today" onClick={() => setSelectedDate(todayKey)}>Today</button><span className="calendar-arrow-group"><button type="button" onClick={() => movePeriod(-1)} aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}><ChevronIcon direction="left" /></button><button type="button" onClick={() => movePeriod(1)} aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}><ChevronIcon direction="right" /></button></span><h2 aria-live="polite">{rangeLabel}</h2></div>
      </div>

      {!meetings.length && !tasks.length && <section className="calendar-empty"><div><span><CalendarEmptyIcon /></span><h2>Nothing scheduled yet</h2><p>Add a class meeting or task deadline to begin filling your calendar.</p></div><div><NavLink to="/schedules">Add a class</NavLink><NavLink to="/tasks?new=1">Add a task</NavLink></div></section>}

      {view === 'month' && <section className="calendar-month" aria-label="Monthly calendar">
        <div className="calendar-month-board"><div className="calendar-month-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">{monthDates.map(date => { const key = localDateKey(date); const outside = date.getMonth() !== selected.getMonth(); const hasTasks = (tasksByDate.get(key)?.length ?? 0) > 0; const hasMeetings = (meetingsByCode.get(dayCodes[date.getDay()])?.length ?? 0) > 0; return <article key={key} className={`calendar-month-day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}><button type="button" className="calendar-month-select" aria-label={`Show ${new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`} aria-pressed={key === selectedDate} onClick={() => setSelectedDate(key)}><span>{date.getDate()}</span><i aria-hidden="true">{hasMeetings && <b className="is-class" />}{hasTasks && <b className="is-task" />}</i></button></article> })}</div></div>
        <aside className="calendar-month-agenda" aria-label="Selected day details">
          <header><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : 'SELECTED DAY'}</p><h3>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h3><div className="calendar-legend"><span><i className="is-class" />Class meeting</span><span><i className="is-task" />Task deadline</span></div></header>
          {selectedTasks.length || selectedMeetings.length ? <div className="calendar-month-agenda-groups">
            {selectedTasks.length > 0 && <section><h4>Task deadlines</h4>{selectedTasks.map(task => <button key={task.id} type="button" className="is-task" onClick={() => setPreview({ kind: 'task', task })}><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'} · {task.due_time ? clock(task.due_time) : priorityLabels[task.priority]}</small></span></button>)}</section>}
            {selectedMeetings.length > 0 && <section><h4>Class meetings</h4>{selectedMeetings.map(meeting => <button key={meeting.id} type="button" className="is-class" onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><span><strong>{subjectMap.get(meeting.subject_id)?.subject_code ?? 'Class'}</strong><small>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}{meeting.room ? ` · ${meeting.room}` : ''}</small></span></button>)}</section>}
          </div> : <div className="calendar-month-agenda-empty"><CalendarEmptyIcon /><strong>This day is clear</strong><p>No class meetings or task deadlines are scheduled.</p></div>}
        </aside>
      </section>}

      {view === 'week' && <section className="calendar-week" aria-label="Weekly calendar">{weekDates.map(date => { const key = localDateKey(date); const dayTasks = tasksByDate.get(key) ?? []; const dayMeetings = meetingsByCode.get(dayCodes[date.getDay()]) ?? []; return <article key={key} className={`calendar-week-day${key === todayKey ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}>
        <button type="button" className="calendar-week-date" onClick={() => setSelectedDate(key)}><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong></button>
        {!dayTasks.length && !dayMeetings.length ? <div className="calendar-week-empty"><CalendarEmptyIcon /><span>Nothing planned</span></div> : <>{dayTasks.length > 0 && <section className="calendar-week-group calendar-week-group--tasks"><h3><i aria-hidden="true" />Task deadlines</h3>{dayTasks.map(task => <button key={task.id} type="button" className="calendar-week-event calendar-week-event--task" onClick={() => setPreview({ kind: 'task', task })}><strong>{task.title}</strong><small>{task.due_time ? clock(task.due_time) : priorityLabels[task.priority]}</small></button>)}</section>}{dayMeetings.length > 0 && <section className="calendar-week-group calendar-week-group--classes"><h3><i aria-hidden="true" />Class meetings</h3>{dayMeetings.map(meeting => <button key={meeting.id} type="button" className="calendar-week-event calendar-week-event--class" onClick={() => setPreview({ kind: 'class', meeting, date: key })}><strong>{subjectMap.get(meeting.subject_id)?.subject_code ?? 'Class'}</strong><small>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}</small></button>)}</section>}</>}
      </article> })}</section>}

      {view === 'day' && <section className="calendar-day-view" aria-label="Daily calendar">
        <header><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(selected).toUpperCase()}</p><h2>{new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(selected)}</h2></header>
        <div className="calendar-day-sections"><section className="calendar-day-section calendar-day-section--tasks"><header><i aria-hidden="true" /><div><h3>Task deadlines</h3><p>Work due on this date.</p></div></header>{selectedTasks.length ? <div>{selectedTasks.map(task => <button key={task.id} type="button" onClick={() => setPreview({ kind: 'task', task })}><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'} · {priorityLabels[task.priority]}</small></span><time>{task.due_time ? clock(task.due_time) : 'Any time'}</time></button>)}</div> : <div className="calendar-day-empty"><CalendarEmptyIcon /><strong>No task deadlines</strong><span>Your workload is clear for this date.</span></div>}</section>
        <section className="calendar-day-section calendar-day-section--classes"><header><i aria-hidden="true" /><div><h3>Class meetings</h3><p>Classes scheduled on this date.</p></div></header>{selectedMeetings.length ? <div>{selectedMeetings.map(meeting => { const subject = subjectMap.get(meeting.subject_id); return <button key={meeting.id} type="button" onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><span><strong>{subject?.subject_code ?? 'Class'}</strong><small>{subject?.title ?? 'Scheduled class'}{meeting.room ? ` · ${meeting.room}` : ''}</small></span><time>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}</time></button> })}</div> : <div className="calendar-day-empty"><CalendarEmptyIcon /><strong>No class meetings</strong><span>Your class schedule is clear for this date.</span></div>}</section></div>
      </section>}

      {view !== 'month' && <section className="calendar-mobile" aria-label="Daily calendar">
        <div className="calendar-mobile-days">{weekDates.map(date => { const key = localDateKey(date); return <button key={key} type="button" className={`${key === todayKey ? 'is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'narrow' }).format(date)}</span><strong>{date.getDate()}</strong></button> })}</div>
        <header className="calendar-mobile-date"><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : 'SELECTED DAY'}</p><h2>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h2></header>
        <section className="calendar-mobile-section"><header><h3>Deadlines</h3></header>{selectedTasks.length ? <div className="calendar-mobile-list">{selectedTasks.map(task => <button key={task.id} type="button" className="calendar-mobile-task" onClick={() => setPreview({ kind: 'task', task })}><i className={`calendar-priority calendar-priority--${task.priority}`} /><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'}{task.due_time ? ` · ${clock(task.due_time)}` : ''} · {priorityLabels[task.priority]}</small></span></button>)}</div> : <div className="calendar-mobile-empty"><CalendarEmptyIcon /><strong>No deadlines</strong><span>No work is due on this date.</span></div>}</section>
        <section className="calendar-mobile-section"><header><h3>Classes</h3></header>{selectedMeetings.length ? <div className="calendar-mobile-list">{selectedMeetings.map(meeting => { const subject = subjectMap.get(meeting.subject_id); return <button key={meeting.id} type="button" className="calendar-mobile-class" onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><time>{clock(meeting.starts_at)}</time><span><strong>{subject?.subject_code ?? 'Class'}</strong><small>{subject?.title ?? 'Scheduled class'}{meeting.room ? ` · ${meeting.room}` : ''}</small></span></button> })}</div> : <div className="calendar-mobile-empty"><CalendarEmptyIcon /><strong>No classes</strong><span>No class meetings are scheduled.</span></div>}</section>
      </section>}
      {preview && <CalendarPreviewDialog preview={preview} subjects={subjectMap} onClose={() => setPreview(null)} />}
    </section>}
  </div>
}
