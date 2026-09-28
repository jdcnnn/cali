import { useMemo } from 'react'
import { localDateKey } from '../lib/tasks'
import type { Task, TaskSubject } from '../lib/tasks'

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}

export function TaskCalendar({ tasks, subjects, month, selectedDate, now, onMonthChange, onSelectDate, onViewTask, onAddTask }: {
  tasks: Task[]
  subjects: Map<string, TaskSubject>
  month: Date
  selectedDate: string
  now: Date
  onMonthChange: (month: Date) => void
  onSelectDate: (date: string) => void
  onViewTask: (task: Task) => void
  onAddTask: (date: string) => void
}) {
  const today = localDateKey(now)
  const days = useMemo(() => calendarDays(month), [month])
  const openTasks = useMemo(() => tasks.filter(task => task.status !== 'done'), [tasks])
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    openTasks.forEach(task => grouped.set(task.due_date, [...(grouped.get(task.due_date) ?? []), task]))
    grouped.forEach(dayTasks => dayTasks.sort((left, right) => (left.due_time ?? '99:99').localeCompare(right.due_time ?? '99:99') || left.title.localeCompare(right.title)))
    return grouped
  }, [openTasks])
  const selectedTasks = tasksByDate.get(selectedDate) ?? []
  const selected = dateFromKey(selectedDate)
  const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(month)
  const selectedLabel = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: selected.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(selected)

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1)
    onMonthChange(next)
    onSelectDate(localDateKey(next))
  }

  function selectDay(date: Date) {
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1))
    onSelectDate(localDateKey(date))
  }

  function returnToToday() {
    onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1))
    onSelectDate(today)
  }

  return <section className="task-calendar" aria-labelledby="task-calendar-title">
    <header className="task-calendar-header">
      <div><p className="workspace-overline">DEADLINE CALENDAR</p><h2 id="task-calendar-title">{monthLabel}</h2><p>See when your open tasks are due.</p></div>
      <div className="task-calendar-controls"><button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ArrowIcon direction="left" /></button><button type="button" className="task-calendar-today" onClick={returnToToday}>Today</button><button type="button" onClick={() => changeMonth(1)} aria-label="Next month"><ArrowIcon direction="right" /></button></div>
    </header>
    <div className="task-calendar-layout">
      <div className="task-calendar-grid-wrap">
        <div className="task-calendar-weekdays" aria-hidden="true">{weekdayLabels.map(day => <span key={day}>{day}</span>)}</div>
        <div className="task-calendar-grid">{days.map(date => {
          const key = localDateKey(date)
          const dayTasks = tasksByDate.get(key) ?? []
          const outside = date.getMonth() !== month.getMonth()
          return <div key={key} className={`task-calendar-day${outside ? ' is-outside' : ''}${key === today ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}>
            <button type="button" className="task-calendar-date" onClick={() => selectDay(date)} aria-label={`${new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)}${dayTasks.length ? `, ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'} due` : ', no tasks due'}`} aria-pressed={key === selectedDate}><time dateTime={key}>{date.getDate()}</time>{dayTasks.length > 0 && <span className="task-calendar-day-count">{dayTasks.length}</span>}</button>
            <div className="task-calendar-events">{dayTasks.slice(0, 2).map(task => <button key={task.id} type="button" className={`task-calendar-event task-calendar-event--${task.priority}`} onClick={() => onViewTask(task)} title={task.title}>{task.title}</button>)}{dayTasks.length > 2 && <button type="button" className="task-calendar-more" onClick={() => selectDay(date)}>+{dayTasks.length - 2} more</button>}</div>
          </div>
        })}</div>
      </div>
      <aside className="task-calendar-agenda" aria-labelledby="task-calendar-agenda-title">
        <header><div><p className="workspace-overline">SELECTED DATE</p><h3 id="task-calendar-agenda-title">{selectedLabel}</h3></div><button type="button" onClick={() => onAddTask(selectedDate)}><span aria-hidden="true">+</span> Add task</button></header>
        {selectedTasks.length ? <div className="task-calendar-agenda-list">{selectedTasks.map(task => {
          const subject = task.schedule_subject_id ? subjects.get(task.schedule_subject_id) : undefined
          return <button key={task.id} type="button" onClick={() => onViewTask(task)}><span className={`task-calendar-priority task-calendar-priority--${task.priority}`} aria-hidden="true" /><span><strong>{task.title}</strong><small>{subject?.subject_code ?? 'General'}{task.due_time ? ` · ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Number(task.due_time.slice(0, 2)), Number(task.due_time.slice(3, 5))))}` : ''}</small></span></button>
        })}</div> : <div className="task-calendar-empty"><span aria-hidden="true">✓</span><strong>No tasks due</strong><p>This date is clear. Add a task only if you need one.</p></div>}
      </aside>
    </div>
  </section>
}
