import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { DragDropProvider, useDroppable } from '@dnd-kit/react'
import type { DragEndEvent } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { useSearchParams } from 'react-router'
import { OnboardingDropdown } from './OnboardingDropdown'
import { supabase } from '../lib/supabase'
import {
  draftFromTask,
  emptyTaskDraft,
  formatEstimate,
  formatTaskDue,
  isTaskOverdue,
  localDateKey,
  moveTaskInBoard,
  nextTaskStep,
  orderedColumns,
  plannerGroups,
  stepsForTask,
  taskStatuses,
  taskStepProgress,
  upcomingGroups,
  validateTaskDraft,
} from '../lib/tasks'
import type { Task, TaskDraft, TaskPriority, TaskStatus, TaskStep, TaskSubject } from '../lib/tasks'
import './tasks.css'
import './skeleton.css'

type EditorState = { taskId: string | null; draft: TaskDraft; initial: TaskDraft }
type TaskView = 'today' | 'upcoming' | 'board'

const priorityLabels: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
}

function GripIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="7" r="1.4" /><circle cx="16" cy="7" r="1.4" /><circle cx="8" cy="12" r="1.4" /><circle cx="16" cy="12" r="1.4" /><circle cx="8" cy="17" r="1.4" /><circle cx="16" cy="17" r="1.4" /></svg>
}

function TaskProgress({ task, steps }: { task: Task; steps: TaskStep[] }) {
  const progress = taskStepProgress(task.id, steps)
  const next = nextTaskStep(task.id, steps)
  if (!progress.total) return <p className="task-next-step task-next-step--empty">Break this task into steps</p>
  return <div className="task-progress">
    <div><span style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
    <p>{next ? <><strong>Next:</strong> {next.title}</> : 'Checklist complete'}<small>{progress.completed}/{progress.total}</small></p>
  </div>
}

function TaskCard({ task, index, subject, steps, dragDisabled, onEdit, onDelete, onMove }: {
  task: Task
  index: number
  subject?: TaskSubject
  steps: TaskStep[]
  dragDisabled: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (status: TaskStatus) => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: task.id, index, group: task.status, type: 'task', data: { taskId: task.id }, disabled: dragDisabled })
  const overdue = isTaskOverdue(task)

  function closeMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  return <article ref={ref} className={`task-card${isDragging ? ' task-card--dragging' : ''}`}>
    <div className="task-card-top">
      <button ref={handleRef} type="button" className="task-drag-handle" disabled={dragDisabled} aria-label={dragDisabled ? 'Clear filters to drag this task' : `Drag ${task.title}`}><GripIcon /></button>
      <span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</span>
      <details className="task-card-menu">
        <summary aria-label={`Actions for ${task.title}`}><MoreIcon /></summary>
        <div className="task-card-menu-panel">
          <button type="button" onClick={event => { closeMenu(event); onEdit() }}>Edit task</button>
          <p>Move to</p>
          {taskStatuses.filter(status => status.id !== task.status).map(status => <button key={status.id} type="button" onClick={event => { closeMenu(event); onMove(status.id) }}>{status.label}</button>)}
          <button type="button" className="task-menu-delete" onClick={event => { closeMenu(event); onDelete() }}>Delete task</button>
        </div>
      </details>
    </div>
    <h3>{task.title}</h3>
    <TaskProgress task={task} steps={steps} />
    <div className="task-card-meta">
      <span className="task-subject">{subject ? subject.subject_code : 'General'}</span>
      <span className={overdue ? 'task-due task-due--overdue' : 'task-due'}>{overdue ? 'Overdue · ' : ''}{formatTaskDue(task)}</span>
    </div>
  </article>
}

function TaskColumn({ status, tasks, subjects, steps, dragDisabled, onEdit, onDelete, onMove }: {
  status: TaskStatus
  tasks: Task[]
  subjects: Map<string, TaskSubject>
  steps: TaskStep[]
  dragDisabled: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
}) {
  const details = taskStatuses.find(item => item.id === status)!
  const { ref, isDropTarget } = useDroppable({ id: `task-column-${status}`, data: { status }, accept: 'task' })
  return <section ref={ref} id={`task-column-${status}`} className={`task-column${isDropTarget ? ' task-column--target' : ''}`} aria-labelledby={`task-column-${status}-title`}>
    <header><div><h2 id={`task-column-${status}-title`}>{details.label}</h2><p>{details.description}</p></div><span>{tasks.length}</span></header>
    <div className="task-column-list">
      {tasks.map((task, index) => <TaskCard key={task.id} task={task} index={index} subject={task.schedule_subject_id ? subjects.get(task.schedule_subject_id) : undefined} steps={steps} dragDisabled={dragDisabled} onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} onMove={next => onMove(task, next)} />)}
      {!tasks.length && <div className="task-column-empty"><span aria-hidden="true">{status === 'done' ? '✓' : '+'}</span><p>{status === 'todo' ? 'New tasks will start here.' : status === 'in_progress' ? 'Move work here when you begin.' : 'Completed tasks will appear here.'}</p></div>}
    </div>
  </section>
}

function PlannerTaskRow({ task, subject, steps, now, suggestion = false, busy, onEdit, onDelete, onComplete, onPlanToday, onToggleStep }: {
  task: Task
  subject?: TaskSubject
  steps: TaskStep[]
  now: Date
  suggestion?: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onComplete: () => void
  onPlanToday: () => void
  onToggleStep: (step: TaskStep) => void
}) {
  const overdue = isTaskOverdue(task, now)
  const progress = taskStepProgress(task.id, steps)
  const next = nextTaskStep(task.id, steps)
  return <article className="planner-task-row">
    <button type="button" className="planner-task-complete" aria-label={`Mark ${task.title} complete`} onClick={onComplete} disabled={busy}><span /></button>
    <div className="planner-task-main">
      <div className="planner-task-heading"><h3>{task.title}</h3><span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</span></div>
      <div className="planner-task-meta">
        <span>{subject ? subject.subject_code : 'General'}</span>
        <span className={overdue ? 'task-due--overdue' : ''}>{overdue ? 'Overdue · ' : ''}{formatTaskDue(task, now)}</span>
        {task.estimate_minutes && <span>{formatEstimate(task.estimate_minutes)}</span>}
      </div>
      {next ? <button type="button" className="planner-next-action" onClick={() => onToggleStep(next)} disabled={busy}><span aria-hidden="true" /> <strong>Next:</strong> {next.title}<small>{progress.completed}/{progress.total}</small></button> : progress.total ? <p className="planner-checklist-done">✓ Checklist complete · {progress.total}/{progress.total}</p> : <button type="button" className="planner-add-steps" onClick={onEdit}>+ Break this task into steps</button>}
    </div>
    <div className="planner-task-actions">
      {suggestion && <button type="button" className="task-plan-button" onClick={onPlanToday} disabled={busy}>Plan today</button>}
      <details className="task-card-menu"><summary aria-label={`Actions for ${task.title}`}><MoreIcon /></summary><div className="task-card-menu-panel"><button type="button" onClick={onEdit}>Edit task</button><button type="button" className="task-menu-delete" onClick={onDelete}>Delete task</button></div></details>
    </div>
  </article>
}

function PlannerSection({ title, description, tasks, emptyText, ...rowProps }: {
  title: string
  description: string
  tasks: Task[]
  emptyText: string
  subjects: Map<string, TaskSubject>
  steps: TaskStep[]
  now: Date
  suggestion?: boolean
  busy: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onComplete: (task: Task) => void
  onPlanToday: (task: Task) => void
  onToggleStep: (task: Task, step: TaskStep) => void
}) {
  return <section className="planner-section">
    <header><div><h2>{title}</h2><p>{description}</p></div><span>{tasks.length}</span></header>
    {tasks.length ? <div className="planner-task-list">{tasks.map(task => <PlannerTaskRow key={task.id} task={task} subject={task.schedule_subject_id ? rowProps.subjects.get(task.schedule_subject_id) : undefined} steps={rowProps.steps} now={rowProps.now} suggestion={rowProps.suggestion} busy={rowProps.busy} onEdit={() => rowProps.onEdit(task)} onDelete={() => rowProps.onDelete(task)} onComplete={() => rowProps.onComplete(task)} onPlanToday={() => rowProps.onPlanToday(task)} onToggleStep={step => rowProps.onToggleStep(task, step)} />)}</div> : <p className="planner-section-empty">{emptyText}</p>}
  </section>
}

function TaskEditor({ editor, subjects, busy, error, onChange, onSave, onRequestClose }: {
  editor: EditorState
  subjects: TaskSubject[]
  busy: boolean
  error: string
  onChange: (draft: TaskDraft) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onRequestClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  const draft = editor.draft
  function addStep() {
    onChange({ ...draft, steps: [...draft.steps, { id: `new-${Date.now()}-${draft.steps.length}`, title: '', isCompleted: false }] })
  }

  return <dialog ref={dialogRef} className="task-editor-dialog" aria-labelledby="task-editor-title" onCancel={event => { event.preventDefault(); onRequestClose() }}>
    <form className="task-editor" onSubmit={onSave} noValidate>
      <header className="task-editor-header"><div><p className="workspace-overline">TASK DETAILS</p><h2 id="task-editor-title">{editor.taskId ? 'Edit task' : 'Add a task'}</h2><p>{editor.taskId ? 'Update the task and its next steps.' : 'Capture the essentials now. Add planning details if they help.'}</p></div><button type="button" className="task-close" aria-label="Close task editor" onClick={onRequestClose} disabled={busy}><CloseIcon /></button></header>
      <div className="task-editor-body">
        <section className="task-form-section">
          <div className="task-editor-fields">
            <label className="task-field task-field--wide"><span>Task title</span><input autoFocus required maxLength={160} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} placeholder="e.g. Finish laboratory report" /></label>
            <div className="task-field"><span>Subject <small>Optional</small></span><OnboardingDropdown id="task-subject" label="Subject" placeholder="General" value={draft.subjectId} options={[{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))]} onChange={subjectId => onChange({ ...draft, subjectId })} searchable={subjects.length > 6} /></div>
            <label className="task-field"><span>Due date</span><input type="date" required value={draft.dueDate} onChange={event => onChange({ ...draft, dueDate: event.target.value })} /></label>
          </div>
        </section>
        <details className="task-more-details" open={editor.taskId ? true : undefined}>
          <summary>Plan this task <span>Optional time, steps, and notes</span></summary>
          <div className="task-more-details-body">
            <div className="task-editor-fields">
              <label className="task-field"><span>Due time <small>Optional</small></span><input type="time" value={draft.dueTime} onChange={event => onChange({ ...draft, dueTime: event.target.value })} /></label>
              <div className="task-field"><span>Importance</span><OnboardingDropdown id="task-priority" label="Importance" placeholder="Select importance" value={draft.priority} options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))} onChange={priority => onChange({ ...draft, priority: priority as TaskPriority })} /></div>
              <label className="task-field"><span>Plan for <small>Optional</small></span><input type="date" max={draft.dueDate || undefined} value={draft.plannedDate} onChange={event => onChange({ ...draft, plannedDate: event.target.value })} /></label>
              <label className="task-field"><span>Estimate in minutes <small>Optional</small></span><input type="number" min="5" max="10080" step="5" value={draft.estimateMinutes} onChange={event => onChange({ ...draft, estimateMinutes: event.target.value })} placeholder="e.g. 90" /></label>
            </div>
            <section className="task-checklist-editor" aria-labelledby="task-checklist-title">
              <div><div><h3 id="task-checklist-title">Checklist</h3><p>The first unfinished item becomes your next step.</p></div><button type="button" onClick={addStep} disabled={draft.steps.length >= 50}>+ Add step</button></div>
              {draft.steps.length ? <div className="task-checklist-fields">{draft.steps.map((step, index) => <div key={step.id}><span>{index + 1}</span><input maxLength={240} aria-label={`Checklist step ${index + 1}`} value={step.title} onChange={event => onChange({ ...draft, steps: draft.steps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item) })} placeholder="Describe a small, clear action" /><button type="button" aria-label={`Remove checklist step ${index + 1}`} onClick={() => onChange({ ...draft, steps: draft.steps.filter(item => item.id !== step.id) })}>×</button></div>)}</div> : <p className="task-checklist-empty">No steps yet. Add only the steps that make this task easier to start.</p>}
            </section>
            <label className="task-field"><span>Notes <small>Optional</small></span><textarea maxLength={4000} rows={4} value={draft.notes} onChange={event => onChange({ ...draft, notes: event.target.value })} placeholder="Add instructions, links, or useful context..." /><small className="task-character-count">{draft.notes.length.toLocaleString()} / 4,000</small></label>
          </div>
        </details>
        {error && <p className="task-form-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="task-secondary" onClick={onRequestClose} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : editor.taskId ? 'Save changes' : 'Add task'}</button></footer>
    </form>
  </dialog>
}

function TaskConfirmationDialog({ eyebrow, title, description, confirmLabel, busyLabel, busy, danger = true, error = '', onCancel, onConfirm }: { eyebrow: string; title: string; description: string; confirmLabel: string; busyLabel: string; busy: boolean; danger?: boolean; error?: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="task-confirm-dialog" aria-labelledby="task-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div><div className="task-confirm-icon" aria-hidden="true">!</div><p className="workspace-overline">{eyebrow}</p><h2 id="task-confirm-title">{title}</h2><p>{description}</p>{error && <p className="task-form-error" role="alert">{error}</p>}<footer><button type="button" className="task-secondary" autoFocus onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className={danger ? 'task-danger' : 'button-primary'} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button></footer></div></dialog>
}

export function TasksPage({ studentId }: { studentId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<TaskView>('today')
  const [tasks, setTasks] = useState<Task[]>([])
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [subjects, setSubjects] = useState<TaskSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [boardError, setBoardError] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [completing, setCompleting] = useState<Task | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [now] = useState(() => new Date())

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [taskResult, subjectResult, stepResult] = await Promise.all([
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,planned_date,estimate_minutes,priority,status,position,completed_at,created_at,updated_at').eq('user_id', studentId).order('position'),
      supabase.from('schedule_subjects').select('id,subject_code,title').eq('user_id', studentId).order('subject_code'),
      supabase.from('task_steps').select('id,task_id,title,position,is_completed,created_at,updated_at').order('position'),
    ])
    if (taskResult.error) throw taskResult.error
    if (subjectResult.error) throw subjectResult.error
    if (stepResult.error) throw stepResult.error
    setTasks((taskResult.data ?? []) as Task[])
    setSubjects((subjectResult.data ?? []) as TaskSubject[])
    setSteps((stepResult.data ?? []) as TaskStep[])
    setPageError('')
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void load().catch(cause => { if (active) { setPageError(cause instanceof Error ? cause.message : 'Could not load your tasks.'); setLoading(false) } }) }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  useEffect(() => {
    if (!loading && !pageError && searchParams.get('new') === '1' && !editor) {
      const timer = window.setTimeout(() => { openNewTask(); setSearchParams({}, { replace: true }) }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [loading, pageError, searchParams, setSearchParams, editor])

  const filtersActive = subjectFilter !== 'all' || priorityFilter !== 'all'
  const filteredTasks = useMemo(() => tasks.filter(task => {
    const matchesSubject = subjectFilter === 'all' || (subjectFilter === 'general' ? task.schedule_subject_id === null : task.schedule_subject_id === subjectFilter)
    return matchesSubject && (priorityFilter === 'all' || task.priority === priorityFilter)
  }), [tasks, subjectFilter, priorityFilter])
  const columns = useMemo(() => orderedColumns(filteredTasks), [filteredTasks])
  const allColumns = useMemo(() => orderedColumns(tasks), [tasks])
  const todayGroups = useMemo(() => plannerGroups(filteredTasks, now), [filteredTasks, now])
  const futureGroups = useMemo(() => upcomingGroups(filteredTasks, now), [filteredTasks, now])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const subjectFilterOptions = useMemo(() => [{ value: 'all', label: 'All subjects' }, { value: 'general', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))], [subjects])
  const todayEstimate = todayGroups.today.reduce((total, task) => total + (task.estimate_minutes ?? 0), 0)
  const todayUnestimated = todayGroups.today.filter(task => !task.estimate_minutes).length

  function openNewTask() {
    const draft = emptyTaskDraft()
    setFormError(''); setDiscardOpen(false); setEditor({ taskId: null, draft, initial: draft })
  }

  function openEditor(task: Task) {
    const draft = draftFromTask(task, stepsForTask(task.id, steps))
    setFormError(''); setDiscardOpen(false); setEditor({ taskId: task.id, draft, initial: draft })
  }

  function requestEditorClose() {
    if (!editor || busy) return
    if (JSON.stringify(editor.draft) !== JSON.stringify(editor.initial)) setDiscardOpen(true)
    else setEditor(null)
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy || !supabase) return
    const validation = validateTaskDraft(editor.draft)
    if (validation) { setFormError(validation); return }
    setBusy(true); setFormError('')
    const draft = editor.draft
    const details = { title: draft.title.replace(/\s+/g, ' ').trim(), notes: draft.notes.trim() || null, schedule_subject_id: draft.subjectId || null, due_date: draft.dueDate, due_time: draft.dueTime || null, planned_date: draft.plannedDate || null, estimate_minutes: draft.estimateMinutes ? Number(draft.estimateMinutes) : null, priority: draft.priority }
    let savedTask: Task | null = null
    const wasNew = !editor.taskId
    try {
      if (editor.taskId) {
        const { data, error } = await supabase.from('tasks').update(details).eq('id', editor.taskId).eq('user_id', studentId).select().single()
        if (error) throw error
        savedTask = data as Task
      } else {
        const { data: created, error: createError } = await supabase.rpc('cali_create_own_task', { p_title: details.title, p_notes: details.notes, p_schedule_subject_id: details.schedule_subject_id, p_due_date: details.due_date, p_due_time: details.due_time, p_priority: details.priority })
        if (createError) throw createError
        const { data, error } = await supabase.from('tasks').update({ planned_date: details.planned_date, estimate_minutes: details.estimate_minutes }).eq('id', (created as Task).id).eq('user_id', studentId).select().single()
        if (error) throw error
        savedTask = data as Task
      }
      const completedTask = savedTask
      if (!completedTask) throw new Error('The saved task could not be loaded.')
      const { data: savedSteps, error: stepError } = await supabase.rpc('cali_replace_own_task_steps', { p_task_id: completedTask.id, p_steps: draft.steps.map(step => ({ title: step.title.trim(), is_completed: step.isCompleted })) })
      if (stepError) throw stepError
      setTasks(previous => editor.taskId ? previous.map(task => task.id === completedTask.id ? completedTask : task) : [...previous, completedTask])
      setSteps(previous => [...previous.filter(step => step.task_id !== completedTask.id), ...((savedSteps ?? []) as TaskStep[])])
      setEditor(null)
    } catch (cause) {
      if (savedTask && wasNew) {
        const createdTask = savedTask
        setTasks(previous => previous.some(task => task.id === createdTask.id) ? previous : [...previous, createdTask])
        setEditor(previous => previous ? { ...previous, taskId: createdTask.id, initial: draftFromTask(createdTask) } : previous)
        setFormError('The task was created, but its checklist could not be saved. Try saving the details again.')
      } else setFormError(cause instanceof Error ? cause.message : 'Could not save this task. Please try again.')
    } finally { setBusy(false) }
  }

  async function confirmDelete() {
    if (!deleting || busy || !supabase) return
    setBusy(true); setDeleteError('')
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', deleting.id).eq('user_id', studentId)
      if (error) throw error
      setTasks(previous => previous.filter(task => task.id !== deleting.id)); setSteps(previous => previous.filter(step => step.task_id !== deleting.id)); setDeleting(null)
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'Could not delete this task. Please try again.') }
    finally { setBusy(false) }
  }

  async function moveTask(task: Task, targetStatus: TaskStatus, requestedIndex: number) {
    if (!supabase || (task.status === targetStatus && allColumns[targetStatus].findIndex(item => item.id === task.id) === requestedIndex)) return
    const before = tasks
    const targetCount = task.status === targetStatus ? allColumns[targetStatus].length - 1 : allColumns[targetStatus].length
    const desiredIndex = targetStatus === 'done' && task.status !== 'done' ? 0 : requestedIndex
    const index = Math.max(0, Math.min(desiredIndex, targetCount))
    setTasks(moveTaskInBoard(tasks, task.id, targetStatus, index)); setBoardError('')
    try {
      const { error } = await supabase.rpc('cali_move_own_task', { p_task_id: task.id, p_target_status: targetStatus, p_target_index: index })
      if (error) throw error
    } catch (cause) { setTasks(before); setBoardError(cause instanceof Error ? cause.message : 'Could not update the task. Your tasks were restored.') }
  }

  function requestComplete(task: Task) {
    const progress = taskStepProgress(task.id, steps)
    if (progress.total > progress.completed) setCompleting(task)
    else void moveTask(task, 'done', 0)
  }

  async function planToday(task: Task) {
    if (!supabase) return
    const plannedDate = localDateKey()
    const before = tasks
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, planned_date: plannedDate } : item))
    const { error } = await supabase.from('tasks').update({ planned_date: plannedDate }).eq('id', task.id).eq('user_id', studentId)
    if (error) { setTasks(before); setBoardError('Could not add the task to today. Please try again.') }
  }

  async function toggleStep(task: Task, step: TaskStep) {
    if (!supabase || busy) return
    const beforeTasks = tasks; const beforeSteps = steps; const completed = !step.is_completed
    setSteps(previous => previous.map(item => item.id === step.id ? { ...item, is_completed: completed } : item))
    if (completed && task.status === 'todo') setTasks(previous => moveTaskInBoard(previous, task.id, 'in_progress', orderedColumns(previous).in_progress.length))
    const { error } = await supabase.rpc('cali_set_own_task_step_complete', { p_step_id: step.id, p_completed: completed })
    if (error) { setTasks(beforeTasks); setSteps(beforeSteps); setBoardError('Could not update that step. Please try again.') }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (filtersActive || event.canceled) return
    const source = event.operation.source; const target = event.operation.target
    if (!source || !target || !isSortable(source)) return
    const task = tasks.find(item => item.id === source.id)
    if (!task) return
    if (isSortable(target)) { void moveTask(task, target.group as TaskStatus, target.index); return }
    const targetStatus = target.data?.status as TaskStatus | undefined
    if (targetStatus) void moveTask(task, targetStatus, targetStatus === 'done' ? 0 : allColumns[targetStatus].length)
  }

  const rowProps = { subjects: subjectMap, steps, now, busy, onEdit: openEditor, onDelete: (task: Task) => { setDeleteError(''); setDeleting(task) }, onComplete: requestComplete, onPlanToday: (task: Task) => { void planToday(task) }, onToggleStep: (task: Task, step: TaskStep) => { void toggleStep(task, step) } }

  if (loading) return <div className="tasks-page"><header className="tasks-heading"><div><div className="skeleton skeleton-line skeleton-line--short" /><div className="skeleton skeleton-line skeleton-line--title" /></div></header><div className="tasks-planner-loading"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div></div>

  return <div className="tasks-page">
    <header className="tasks-heading"><div><p className="workspace-overline">ACADEMIC WORK</p><h1>Tasks</h1><p>See what needs attention, choose what to work on today, and take the next clear step.</p></div><button type="button" className="button-primary tasks-add" onClick={openNewTask}><span aria-hidden="true">+</span> Add task</button></header>
    {pageError ? <section className="tasks-error-state" role="alert"><h2>Tasks could not be loaded</h2><p>{pageError}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setPageError(cause instanceof Error ? cause.message : 'Could not load your tasks.'); setLoading(false) }) }}>Try again</button></section> : <>
      <div className="task-view-bar">
        <nav className="task-view-tabs" aria-label="Task views">{(['today', 'upcoming', 'board'] as TaskView[]).map(item => <button key={item} type="button" className={view === item ? 'active' : ''} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>{item === 'today' ? 'Today' : item === 'upcoming' ? 'Upcoming' : 'Board'}</button>)}</nav>
        <div className="task-view-filters"><OnboardingDropdown id="task-filter-subject" label="Filter by subject" placeholder="All subjects" value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} /><OnboardingDropdown id="task-filter-priority" label="Filter by importance" placeholder="All importance" value={priorityFilter} options={[{ value: 'all', label: 'All importance' }, { value: 'high', label: 'High importance' }, { value: 'medium', label: 'Medium importance' }, { value: 'low', label: 'Low importance' }]} onChange={priority => setPriorityFilter(priority as 'all' | TaskPriority)} />{filtersActive && <button type="button" onClick={() => { setSubjectFilter('all'); setPriorityFilter('all') }}>Clear</button>}</div>
      </div>
      {boardError && <div className="task-board-error" role="alert"><span>{boardError}</span><button type="button" onClick={() => setBoardError('')} aria-label="Dismiss error"><CloseIcon /></button></div>}
      {view === 'today' && <div className="tasks-planner">
        <div className="planner-summary"><div><span>Today’s plan</span><strong>{todayGroups.today.length} {todayGroups.today.length === 1 ? 'task' : 'tasks'}</strong></div><div><span>Estimated work</span><strong>{todayEstimate ? formatEstimate(todayEstimate) : 'Not estimated'}</strong>{todayUnestimated > 0 && <small>{todayUnestimated} without an estimate</small>}</div></div>
        {todayGroups.overdue.length > 0 && <PlannerSection title="Needs attention" description="Past their deadline and still open." tasks={todayGroups.overdue} emptyText="Nothing overdue." {...rowProps} />}
        <PlannerSection title="Today’s plan" description="Due today or deliberately planned for today." tasks={todayGroups.today} emptyText="Nothing is planned for today yet." {...rowProps} />
        {todayGroups.suggestions.length > 0 && <PlannerSection title="Suggested next" description="Your nearest open work, ready to add to today." tasks={todayGroups.suggestions} emptyText="No suggestions right now." suggestion {...rowProps} />}
      </div>}
      {view === 'upcoming' && <div className="tasks-planner tasks-upcoming">{futureGroups.map(group => <PlannerSection key={group.id} title={group.label} description={group.id === 'tomorrow' ? 'Work due on the next calendar day.' : group.id === 'week' ? 'Deadlines approaching this week.' : 'Work with more time remaining.'} tasks={group.tasks} emptyText={`No tasks due ${group.label.toLowerCase()}.`} {...rowProps} />)}</div>}
      {view === 'board' && <>
        {filtersActive && <p className="task-board-filter-note">Dragging is paused while filters are active. Use each task menu to change progress.</p>}
        <nav className="task-mobile-tabs" aria-label="Kanban columns">{taskStatuses.map(status => <button key={status.id} type="button" onClick={() => document.getElementById(`task-column-${status.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })}>{status.label}<span>{columns[status.id].length}</span></button>)}</nav>
        <DragDropProvider onDragEnd={handleDragEnd}><div className="tasks-board">{taskStatuses.map(status => <TaskColumn key={status.id} status={status.id} tasks={columns[status.id]} subjects={subjectMap} steps={steps} dragDisabled={filtersActive} onEdit={openEditor} onDelete={task => { setDeleteError(''); setDeleting(task) }} onMove={(task, next) => void moveTask(task, next, next === 'done' ? 0 : allColumns[next].length)} />)}</div></DragDropProvider>
      </>}
    </>}
    {editor && <TaskEditor editor={editor} subjects={subjects} busy={busy} error={formError} onChange={draft => setEditor(previous => previous ? { ...previous, draft } : previous)} onSave={saveTask} onRequestClose={requestEditorClose} />}
    {discardOpen && <TaskConfirmationDialog eyebrow="UNSAVED CHANGES" title="Discard your changes?" description="The task details you entered will not be saved." confirmLabel="Discard changes" busyLabel="Discarding..." busy={false} onCancel={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); setEditor(null) }} />}
    {deleting && <TaskConfirmationDialog eyebrow="DELETE TASK" title={`Delete “${deleting.title}”?`} description="This permanently removes the task and its checklist. You cannot undo this action." confirmLabel="Delete task" busyLabel="Deleting..." busy={busy} error={deleteError} onCancel={() => { if (!busy) setDeleting(null) }} onConfirm={() => { void confirmDelete() }} />}
    {completing && <TaskConfirmationDialog eyebrow="UNFINISHED STEPS" title="Complete this task anyway?" description={`There are ${taskStepProgress(completing.id, steps).total - taskStepProgress(completing.id, steps).completed} unfinished checklist steps.`} confirmLabel="Complete task" busyLabel="Completing..." busy={busy} danger={false} onCancel={() => setCompleting(null)} onConfirm={() => { const task = completing; setCompleting(null); void moveTask(task, 'done', 0) }} />}
  </div>
}
