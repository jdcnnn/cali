import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/tasks'
import type { Task, TaskPriority } from '../lib/tasks'
import './calendar.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type CalendarView = 'week' | 'day'
type Subject = { id: string; subject_code: string; title: string; block_section: string }
type Meeting = { id: string; subject_id: string; day_code: DayCode; starts_at: string; ends_at: string; room: string | null }
type PositionedMeeting = Meeting & { lane: number; lanes: number }
type CalendarPreview = { kind: 'task'; task: Task } | { kind: 'class'; meeting: Meeting; date: string }

const dayCodes: DayCode[] = ['U', 'M', 'T', 'W', 'H', 'F', 'S']
const startHour = 7
const endHour = 22
const hourHeight = 64
const timeGutter = 22
const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index)
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

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function clock(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute))
}

function formatCalendarRange(view: CalendarView, selected: Date, weekDates: Date[]) {
  if (view === 'day') return new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(selected)
  const first = weekDates[0]
  const last = weekDates[6]
  const month = (date: Date) => new Intl.DateTimeFormat('en-PH', { month: 'long' }).format(date)
  if (first.getFullYear() !== last.getFullYear()) return `${month(first)} ${first.getDate()}, ${first.getFullYear()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
  if (first.getMonth() !== last.getMonth()) return `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
  return `${month(first)} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
}

function layoutMeetings(meetings: Meeting[]) {
  const sorted = [...meetings].sort((left, right) => left.starts_at.localeCompare(right.starts_at) || left.ends_at.localeCompare(right.ends_at))
  const result: PositionedMeeting[] = []
  let group: Meeting[] = []
  let groupEnd = -1

  function commitGroup() {
    if (!group.length) return
    const laneEnds: number[] = []
    const positioned = group.map(meeting => {
      const start = minutes(meeting.starts_at)
      let lane = laneEnds.findIndex(end => end <= start)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = minutes(meeting.ends_at)
      return { ...meeting, lane, lanes: 1 }
    })
    const lanes = Math.max(1, laneEnds.length)
    result.push(...positioned.map(meeting => ({ ...meeting, lanes })))
    group = []
    groupEnd = -1
  }

  sorted.forEach(meeting => {
    const start = minutes(meeting.starts_at)
    if (group.length && start >= groupEnd) commitGroup()
    group.push(meeting)
    groupEnd = Math.max(groupEnd, minutes(meeting.ends_at))
  })
  commitGroup()
  return result
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
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
  const [view, setView] = useState<CalendarView>('week')
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
  const displayedDates = view === 'week' ? weekDates : [selected]
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    tasks.forEach(task => grouped.set(task.due_date, [...(grouped.get(task.due_date) ?? []), task]))
    grouped.forEach(dayTasks => dayTasks.sort((left, right) => (left.due_time ?? '99:99').localeCompare(right.due_time ?? '99:99') || left.title.localeCompare(right.title)))
    return grouped
  }, [tasks])
  const meetingsByCode = useMemo(() => new Map(dayCodes.map(code => [code, layoutMeetings(meetings.filter(meeting => meeting.day_code === code))])), [meetings])
  const todayKey = localDateKey(now)
  const selectedDayCode = dayCodes[selected.getDay()]
  const selectedMeetings = meetingsByCode.get(selectedDayCode) ?? []
  const selectedTasks = tasksByDate.get(selectedDate) ?? []
  const rangeLabel = formatCalendarRange(view, selected, weekDates)

  function movePeriod(direction: -1 | 1) {
    setSelectedDate(localDateKey(addDays(selected, direction * (view === 'week' ? 7 : 1))))
  }

  if (loading) return <CalendarSkeleton />

  return <div className="calendar-page">
    {error ? <><header className="calendar-heading calendar-heading--standalone"><div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1></div></header><section className="calendar-error" role="alert"><h2>Calendar could not be loaded</h2><p>{error}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setError(cause instanceof Error ? cause.message : 'Could not load your calendar.'); setLoading(false) }) }}>Try again</button></section></> : <section className="calendar-shell">
      <header className="calendar-heading">
        <div><p className="workspace-overline">ACADEMIC CALENDAR</p><h1>Calendar</h1><p>Classes follow the time grid. Deadlines stay in their own lane.</p></div>
        <div className="calendar-view-switch" aria-label="Calendar view"><button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button><button type="button" className={view === 'day' ? 'active' : ''} aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button></div>
      </header>
      <div className="calendar-toolbar" aria-label="Calendar controls">
        <div className="calendar-navigation"><button type="button" className="calendar-today" onClick={() => setSelectedDate(todayKey)}>Today</button><span className="calendar-arrow-group"><button type="button" onClick={() => movePeriod(-1)} aria-label={view === 'week' ? 'Previous week' : 'Previous day'}><ChevronIcon direction="left" /></button><button type="button" onClick={() => movePeriod(1)} aria-label={view === 'week' ? 'Next week' : 'Next day'}><ChevronIcon direction="right" /></button></span><h2 aria-live="polite">{rangeLabel}</h2></div>
      </div>

      {!meetings.length && !tasks.length && <section className="calendar-empty"><div><span aria-hidden="true">+</span><h2>Your calendar is ready</h2><p>Add class meetings or tasks to see them organized here.</p></div><div><NavLink to="/schedules">Add a class</NavLink><NavLink to="/tasks?new=1">Add a task</NavLink></div></section>}

      <section className={`calendar-desktop calendar-desktop--${view}`} aria-label={`${view === 'week' ? 'Weekly' : 'Daily'} calendar`}>
        <div className="calendar-day-headings" style={{ '--calendar-days': displayedDates.length } as React.CSSProperties}><div className="calendar-time-corner" />{displayedDates.map(date => { const key = localDateKey(date); return <button key={key} type="button" className={`${key === todayKey ? 'is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong></button> })}</div>
        <div className="calendar-deadline-row" style={{ '--calendar-days': displayedDates.length } as React.CSSProperties}>
          <div className="calendar-row-label"><span><i aria-hidden="true" />Task deadlines</span></div>
          {displayedDates.map(date => { const key = localDateKey(date); const dayTasks = tasksByDate.get(key) ?? []; return <div key={key} className={`calendar-deadline-cell${key === todayKey ? ' is-today' : ''}`}>{dayTasks.slice(0, view === 'day' ? 8 : 2).map(task => <button key={task.id} type="button" className={`calendar-task-pill calendar-task-pill--${task.priority}`} title={task.title} onClick={() => setPreview({ kind: 'task', task })}><span>{task.title}</span>{task.due_time && <small>{clock(task.due_time)}</small>}</button>)}{dayTasks.length > (view === 'day' ? 8 : 2) && <button type="button" className="calendar-more" onClick={() => { setSelectedDate(key); setView('day') }}>View all</button>}</div> })}
        </div>
        <div className="calendar-section-divider"><span><i aria-hidden="true" />Class schedule</span><small>Times are shown in your local time.</small></div>
        <div className="calendar-time-layout" style={{ '--calendar-height': `${timeGutter + (endHour - startHour) * hourHeight}px`, '--calendar-gutter': `${timeGutter}px` } as React.CSSProperties}>
          <div className="calendar-time-axis">{hours.map(hour => <span key={hour} style={{ top: `${timeGutter + (hour - startHour) * hourHeight}px` }}>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))}</span>)}</div>
          <div className="calendar-time-grid" style={{ '--calendar-days': displayedDates.length } as React.CSSProperties}>
            {displayedDates.map(date => { const key = localDateKey(date); const dayMeetings = (meetingsByCode.get(dayCodes[date.getDay()]) ?? []).filter(meeting => minutes(meeting.ends_at) > startHour * 60 && minutes(meeting.starts_at) < endHour * 60); return <div key={key} className={`calendar-time-column${key === todayKey ? ' is-today' : ''}${date.getDay() === 0 || date.getDay() === 6 ? ' is-weekend' : ''}`}>
              {dayMeetings.map(meeting => { const subject = subjectMap.get(meeting.subject_id); const top = timeGutter + Math.max(0, (minutes(meeting.starts_at) - startHour * 60) / 60 * hourHeight); const bottom = timeGutter + Math.min((endHour - startHour) * hourHeight, (minutes(meeting.ends_at) - startHour * 60) / 60 * hourHeight); return <button key={meeting.id} type="button" className="calendar-class-event" style={{ top: `${top}px`, height: `${Math.max(34, bottom - top)}px`, left: `calc(${meeting.lane / meeting.lanes * 100}% + 4px)`, width: `calc(${100 / meeting.lanes}% - 8px)` }} title={`${subject?.subject_code ?? 'Class'} · ${clock(meeting.starts_at)}–${clock(meeting.ends_at)}`} onClick={() => setPreview({ kind: 'class', meeting, date: key })}><strong>{subject?.subject_code ?? 'Class'}</strong><span>{clock(meeting.starts_at)}–{clock(meeting.ends_at)}</span>{meeting.room && <small>{meeting.room}</small>}</button> })}
              {key === todayKey && now.getHours() >= startHour && now.getHours() < endHour && <div className="calendar-now-line" style={{ top: `${timeGutter + ((now.getHours() * 60 + now.getMinutes()) - startHour * 60) / 60 * hourHeight}px` }}><span /></div>}
            </div> })}
          </div>
        </div>
      </section>

      <section className="calendar-mobile" aria-label="Daily calendar">
        <div className="calendar-mobile-days">{weekDates.map(date => { const key = localDateKey(date); return <button key={key} type="button" className={`${key === todayKey ? 'is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'narrow' }).format(date)}</span><strong>{date.getDate()}</strong>{(tasksByDate.get(key)?.length ?? 0) > 0 && <i />}</button> })}</div>
        <header className="calendar-mobile-date"><p className="workspace-overline">{selectedDate === todayKey ? 'TODAY' : 'SELECTED DAY'}</p><h2>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h2></header>
        <section className="calendar-mobile-section"><header><h3>Deadlines</h3></header>{selectedTasks.length ? <div className="calendar-mobile-list">{selectedTasks.map(task => <button key={task.id} type="button" className="calendar-mobile-task" onClick={() => setPreview({ kind: 'task', task })}><i className={`calendar-priority calendar-priority--${task.priority}`} /><span><strong>{task.title}</strong><small>{subjectMap.get(task.schedule_subject_id ?? '')?.subject_code ?? 'General'}{task.due_time ? ` · ${clock(task.due_time)}` : ''} · {priorityLabels[task.priority]}</small></span></button>)}</div> : <p className="calendar-mobile-empty">No task deadlines this day.</p>}</section>
        <section className="calendar-mobile-section"><header><h3>Classes</h3></header>{selectedMeetings.length ? <div className="calendar-mobile-list">{selectedMeetings.map(meeting => { const subject = subjectMap.get(meeting.subject_id); return <button key={meeting.id} type="button" className="calendar-mobile-class" onClick={() => setPreview({ kind: 'class', meeting, date: selectedDate })}><time>{clock(meeting.starts_at)}</time><span><strong>{subject?.subject_code ?? 'Class'}</strong><small>{subject?.title ?? 'Scheduled class'}{meeting.room ? ` · ${meeting.room}` : ''}</small></span></button> })}</div> : <p className="calendar-mobile-empty">No classes scheduled this day.</p>}</section>
      </section>
      {preview && <CalendarPreviewDialog preview={preview} subjects={subjectMap} onClose={() => setPreview(null)} />}
    </section>}
  </div>
}
