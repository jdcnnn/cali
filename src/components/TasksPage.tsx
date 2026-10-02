import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { OnboardingDropdown } from './OnboardingDropdown'
import { supabase } from '../lib/supabase'
import {
  draftFromTask,
  emptyTaskDraft,
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
type TaskView = 'today' | 'upcoming' | 'completed'

const priorityLabels: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
}

function PlannerTaskRow({ task, subject, steps, now, suggestion = false, busy, onView, onEdit, onDelete, onComplete, onReopen, onPlanToday }: {
  task: Task
  subject?: TaskSubject
  steps: TaskStep[]
  now: Date
  suggestion?: boolean
  busy: boolean
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onComplete: () => void
  onReopen: () => void
  onPlanToday: () => void
}) {
  const completed = task.status === 'done'
  const overdue = isTaskOverdue(task, now)
  const progress = taskStepProgress(task.id, steps)
  const next = nextTaskStep(task.id, steps)

  function closeMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  return <article className="planner-task-row">
    <div className="planner-task-main">
      <button type="button" className="planner-task-open" onClick={onView}>
        <span className="planner-task-heading"><strong>{task.title}</strong><span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</span></span>
        <span className="planner-task-meta">
          <span>{subject ? subject.subject_code : 'General'}</span>
          <span className={overdue ? 'task-due--overdue' : ''}>{overdue ? 'Overdue · ' : ''}{formatTaskDue(task, now)}</span>
        </span>
      </button>
      {completed ? <p className="planner-checklist-done">✓ Completed{task.completed_at ? ` · ${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(task.completed_at))}` : ''}</p> : next ? <div className="planner-next-action"><span aria-hidden="true" /> <strong>Next:</strong> {next.title}<small>{progress.completed}/{progress.total}</small></div> : progress.total ? <p className="planner-checklist-done">✓ All steps complete · {progress.total}/{progress.total}</p> : <button type="button" className="planner-add-steps" onClick={onEdit}><span aria-hidden="true">+</span> Add steps</button>}
    </div>
    <div className="planner-task-actions">
      {suggestion && <button type="button" className="task-plan-button" onClick={onPlanToday} disabled={busy}>Add to today</button>}
      {completed ? <button type="button" className="task-plan-button" onClick={onReopen} disabled={busy}>Reopen</button> : <button type="button" className="task-complete-button" onClick={onComplete} disabled={busy}><span aria-hidden="true">✓</span> Mark done</button>}
      <details className="task-card-menu"><summary aria-label={`Actions for ${task.title}`}><MoreIcon /></summary><div className="task-card-menu-panel"><button type="button" onClick={event => { closeMenu(event); onEdit() }}>Edit task</button><button type="button" className="task-menu-delete" onClick={event => { closeMenu(event); onDelete() }}>Delete task</button></div></details>
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
  onView: (task: Task) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onComplete: (task: Task) => void
  onReopen: (task: Task) => void
  onPlanToday: (task: Task) => void
}) {
  return <section className="planner-section">
    <header><div><h2>{title}</h2><p>{description}</p></div><span>{tasks.length}</span></header>
    {tasks.length ? <div className="planner-task-list">{tasks.map(task => <PlannerTaskRow key={task.id} task={task} subject={task.schedule_subject_id ? rowProps.subjects.get(task.schedule_subject_id) : undefined} steps={rowProps.steps} now={rowProps.now} suggestion={rowProps.suggestion} busy={rowProps.busy} onView={() => rowProps.onView(task)} onEdit={() => rowProps.onEdit(task)} onDelete={() => rowProps.onDelete(task)} onComplete={() => rowProps.onComplete(task)} onReopen={() => rowProps.onReopen(task)} onPlanToday={() => rowProps.onPlanToday(task)} />)}</div> : <p className="planner-section-empty">{emptyText}</p>}
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
      <header className="task-editor-header"><div><p className="workspace-overline">TASK DETAILS</p><h2 id="task-editor-title">{editor.taskId ? 'Edit task' : 'Add a task'}</h2><p>{editor.taskId ? 'Keep the deadline and supporting details up to date.' : 'Set the deadline and add only the details that will help you finish.'}</p></div><button type="button" className="task-close" aria-label="Close task editor" onClick={onRequestClose} disabled={busy}><CloseIcon /></button></header>
      <div className="task-editor-body">
        <section className="task-form-section">
          <div className="task-editor-fields">
            <label className="task-field task-field--wide"><span>Task name</span><input autoFocus required maxLength={160} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} placeholder="e.g. Submit the animation project" /></label>
            <div className="task-field"><span>Subject <small>Optional</small></span><OnboardingDropdown id="task-subject" label="Subject" placeholder="General" value={draft.subjectId} options={[{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))]} onChange={subjectId => onChange({ ...draft, subjectId })} searchable={subjects.length > 6} /></div>
            <label className="task-field"><span>Due date</span><input type="date" required value={draft.dueDate} onChange={event => onChange({ ...draft, dueDate: event.target.value })} /></label>
            <label className="task-field"><span>Due time <small>Optional</small></span><input type="time" value={draft.dueTime} onChange={event => onChange({ ...draft, dueTime: event.target.value })} /></label>
            <div className="task-field"><span>Importance</span><OnboardingDropdown id="task-priority" label="Importance" placeholder="Select importance" value={draft.priority} options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))} onChange={priority => onChange({ ...draft, priority: priority as TaskPriority })} /></div>
          </div>
        </section>
        <section className="task-checklist-editor" aria-labelledby="task-checklist-title">
          <div><div><h3 id="task-checklist-title">Steps</h3><p>Break larger work into actions you can complete one at a time.</p></div><button type="button" onClick={addStep} disabled={draft.steps.length >= 50}>+ Add step</button></div>
          {draft.steps.length ? <div className="task-checklist-fields">{draft.steps.map((step, index) => <div key={step.id}><span>{index + 1}</span><input maxLength={240} aria-label={`Task step ${index + 1}`} value={step.title} onChange={event => onChange({ ...draft, steps: draft.steps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item) })} placeholder="e.g. Draft the introduction" /><button type="button" aria-label={`Remove task step ${index + 1}`} onClick={() => onChange({ ...draft, steps: draft.steps.filter(item => item.id !== step.id) })}>×</button></div>)}</div> : <p className="task-checklist-empty">No steps added. Simple tasks may not need them.</p>}
        </section>
        <label className="task-field"><span>Notes <small>Optional</small></span><textarea maxLength={4000} rows={4} value={draft.notes} onChange={event => onChange({ ...draft, notes: event.target.value })} placeholder="Add requirements, links, or submission details" /><small className="task-character-count">{draft.notes.length.toLocaleString()} / 4,000</small></label>
        {error && <p className="task-form-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="task-secondary" onClick={onRequestClose} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : editor.taskId ? 'Save changes' : 'Add task'}</button></footer>
    </form>
  </dialog>
}

function TaskDetailDialog({ task, subject, steps, now, busy, onClose, onEdit, onComplete, onReopen, onToggleStep }: {
  task: Task
  subject?: TaskSubject
  steps: TaskStep[]
  now: Date
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onComplete: () => void
  onReopen: () => void
  onToggleStep: (step: TaskStep) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  const taskSteps = stepsForTask(task.id, steps)
  const progress = taskStepProgress(task.id, steps)
  const status = taskStatuses.find(item => item.id === task.status)?.label ?? task.status

  return <dialog ref={dialogRef} className="task-detail-dialog" aria-labelledby="task-detail-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <article className="task-detail">
      <header className="task-detail-header">
        <div><p className="workspace-overline">TASK OVERVIEW</p><h2 id="task-detail-title">{task.title}</h2><p>Review the deadline, progress, steps, and notes.</p></div>
        <button type="button" className="task-close" aria-label="Close task overview" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="task-detail-body">
        <div className="task-detail-status"><span className={`task-status task-status--${task.status}`}>{status}</span><span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]} importance</span></div>
        <dl className="task-detail-grid">
          <div><dt>Subject</dt><dd>{subject ? `${subject.subject_code} — ${subject.title}` : 'General'}</dd></div>
          <div><dt>Due</dt><dd className={isTaskOverdue(task, now) ? 'task-due--overdue' : ''}>{isTaskOverdue(task, now) ? 'Overdue · ' : ''}{formatTaskDue(task, now)}</dd></div>
        </dl>
        <section className="task-detail-section">
          <div className="task-detail-section-head"><div><h3>Steps</h3><p>{taskSteps.length ? `${progress.completed} of ${progress.total} complete` : 'No steps added'}</p></div>{taskSteps.length > 0 && <strong>{progress.completed}/{progress.total}</strong>}</div>
          {taskSteps.length ? <ol className="task-detail-checklist">{taskSteps.map(step => <li key={step.id} className={step.is_completed ? 'is-complete' : ''}><span aria-hidden="true">{step.is_completed ? '✓' : ''}</span><p>{step.title}</p><button type="button" onClick={() => onToggleStep(step)} disabled={busy}>{step.is_completed ? 'Undo' : 'Mark done'}</button></li>)}</ol> : <p className="task-detail-empty">This task does not have any steps.</p>}
        </section>
        <section className="task-detail-section"><div className="task-detail-section-head"><div><h3>Notes</h3></div></div><p className={task.notes ? 'task-detail-notes' : 'task-detail-empty'}>{task.notes || 'No notes added.'}</p></section>
      </div>
      <footer className="task-detail-footer"><button type="button" className="task-secondary" onClick={onClose}>Close</button><button type="button" className="task-secondary task-detail-edit" onClick={onEdit}>Edit task</button>{task.status === 'done' ? <button type="button" className="button-primary" onClick={onReopen} disabled={busy}>Reopen task</button> : <button type="button" className="button-primary" onClick={onComplete} disabled={busy}>Mark done</button>}</footer>
    </article>
  </dialog>
}

function TaskConfirmationDialog({ eyebrow, title, description, confirmLabel, busyLabel, busy, danger = true, error = '', onCancel, onConfirm }: { eyebrow: string; title: string; description: string; confirmLabel: string; busyLabel: string; busy: boolean; danger?: boolean; error?: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="task-confirm-dialog" aria-labelledby="task-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div><div className={`task-confirm-icon${danger ? '' : ' task-confirm-icon--positive'}`} aria-hidden="true">{danger ? '!' : '✓'}</div><p className="workspace-overline">{eyebrow}</p><h2 id="task-confirm-title">{title}</h2><p>{description}</p>{error && <p className="task-form-error" role="alert">{error}</p>}<footer><button type="button" className="task-secondary" autoFocus onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className={danger ? 'task-danger' : 'button-primary'} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button></footer></div></dialog>
}

export function TasksPage({ studentId }: { studentId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<TaskView>('today')
  const [tasks, setTasks] = useState<Task[]>([])
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [subjects, setSubjects] = useState<TaskSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [taskUpdateError, setTaskUpdateError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [viewing, setViewing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [completing, setCompleting] = useState<Task | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [now] = useState(() => new Date())

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [taskResult, subjectResult, stepResult] = await Promise.all([
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,planned_date,priority,status,position,completed_at,created_at,updated_at').eq('user_id', studentId).order('position'),
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
    function closeMenusOutside(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      document.querySelectorAll<HTMLDetailsElement>('.task-card-menu[open]').forEach(menu => {
        if (!menu.contains(target)) menu.removeAttribute('open')
      })
    }

    function closeMenusOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      document.querySelectorAll<HTMLDetailsElement>('.task-card-menu[open]').forEach(menu => menu.removeAttribute('open'))
    }

    document.addEventListener('pointerdown', closeMenusOutside, true)
    document.addEventListener('keydown', closeMenusOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenusOutside, true)
      document.removeEventListener('keydown', closeMenusOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!loading && !pageError && searchParams.get('new') === '1' && !editor) {
      const requestedDate = searchParams.get('date') ?? ''
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : ''
      const timer = window.setTimeout(() => { openNewTask(dueDate); setSearchParams({}, { replace: true }) }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [loading, pageError, searchParams, setSearchParams, editor])

  const filtersActive = searchQuery.trim() !== '' || subjectFilter !== 'all' || priorityFilter !== 'all'
  const filteredTasks = useMemo(() => tasks.filter(task => {
    const query = searchQuery.trim().toLocaleLowerCase()
    const matchesSubject = subjectFilter === 'all' || (subjectFilter === 'general' ? task.schedule_subject_id === null : task.schedule_subject_id === subjectFilter)
    const subject = task.schedule_subject_id ? subjects.find(item => item.id === task.schedule_subject_id) : undefined
    const matchesSearch = !query || [task.title, task.notes, subject?.subject_code, subject?.title].filter(Boolean).some(value => value!.toLocaleLowerCase().includes(query))
    return matchesSearch && matchesSubject && (priorityFilter === 'all' || task.priority === priorityFilter)
  }), [tasks, subjects, searchQuery, subjectFilter, priorityFilter])
  const allColumns = useMemo(() => orderedColumns(tasks), [tasks])
  const todayGroups = useMemo(() => plannerGroups(filteredTasks, now), [filteredTasks, now])
  const futureGroups = useMemo(() => upcomingGroups(filteredTasks, now), [filteredTasks, now])
  const completedTasks = useMemo(() => filteredTasks.filter(task => task.status === 'done').sort((left, right) => (right.completed_at ?? '').localeCompare(left.completed_at ?? '') || right.updated_at.localeCompare(left.updated_at)), [filteredTasks])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const subjectFilterOptions = useMemo(() => [{ value: 'all', label: 'All subjects' }, { value: 'general', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))], [subjects])

  function openNewTask(dueDate = '') {
    const draft = { ...emptyTaskDraft(), dueDate }
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
    const details = { title: draft.title.replace(/\s+/g, ' ').trim(), notes: draft.notes.trim() || null, schedule_subject_id: draft.subjectId || null, due_date: draft.dueDate, due_time: draft.dueTime || null, planned_date: draft.plannedDate || null, priority: draft.priority }
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
        const { data, error } = await supabase.from('tasks').update({ planned_date: details.planned_date }).eq('id', (created as Task).id).eq('user_id', studentId).select().single()
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
        setFormError('The task was created, but its steps could not be saved. Try saving again.')
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
    setTasks(moveTaskInBoard(tasks, task.id, targetStatus, index)); setTaskUpdateError('')
    try {
      const { error } = await supabase.rpc('cali_move_own_task', { p_task_id: task.id, p_target_status: targetStatus, p_target_index: index })
      if (error) throw error
    } catch (cause) { setTasks(before); setTaskUpdateError(cause instanceof Error ? cause.message : 'Could not update the task. Your tasks were restored.') }
  }

  function requestComplete(task: Task) {
    setCompleting(task)
  }

  async function planToday(task: Task) {
    if (!supabase) return
    const plannedDate = localDateKey()
    const before = tasks
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, planned_date: plannedDate } : item))
    const { error } = await supabase.from('tasks').update({ planned_date: plannedDate }).eq('id', task.id).eq('user_id', studentId)
    if (error) { setTasks(before); setTaskUpdateError('Could not add the task to today. Please try again.') }
  }

  async function toggleStep(task: Task, step: TaskStep) {
    if (!supabase || busy) return
    const beforeTasks = tasks; const beforeSteps = steps; const completed = !step.is_completed
    setBusy(true)
    setSteps(previous => previous.map(item => item.id === step.id ? { ...item, is_completed: completed } : item))
    if (completed && task.status === 'todo') {
      setTasks(previous => moveTaskInBoard(previous, task.id, 'in_progress', orderedColumns(previous).in_progress.length))
      setViewing(previous => previous?.id === task.id ? { ...previous, status: 'in_progress' } : previous)
    }
    try {
      const { error } = await supabase.rpc('cali_set_own_task_step_complete', { p_step_id: step.id, p_completed: completed })
      if (error) throw error
    } catch {
      setTasks(beforeTasks); setSteps(beforeSteps); setViewing(previous => previous?.id === task.id ? task : previous); setTaskUpdateError('Could not update that step. Please try again.')
    } finally { setBusy(false) }
  }

  const rowProps = { subjects: subjectMap, steps, now, busy, onView: (task: Task) => setViewing(task), onEdit: openEditor, onDelete: (task: Task) => { setDeleteError(''); setDeleting(task) }, onComplete: requestComplete, onReopen: (task: Task) => { void moveTask(task, 'in_progress', allColumns.in_progress.length) }, onPlanToday: (task: Task) => { void planToday(task) } }

  if (loading) return <div className="tasks-page"><header className="tasks-heading"><div><div className="skeleton skeleton-line skeleton-line--short" /><div className="skeleton skeleton-line skeleton-line--title" /></div></header><div className="tasks-planner-loading"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div></div>

  return <div className="tasks-page">
    <header className="tasks-heading"><div><p className="workspace-overline">ACADEMIC WORK</p><h1>Tasks</h1><p>Track coursework, deadlines, and the next step for each task.</p></div><button type="button" className="button-primary tasks-add" onClick={() => openNewTask()}><span aria-hidden="true">+</span> Add task</button></header>
    {pageError ? <section className="tasks-error-state" role="alert"><h2>Tasks could not be loaded</h2><p>{pageError}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setPageError(cause instanceof Error ? cause.message : 'Could not load your tasks.'); setLoading(false) }) }}>Try again</button></section> : <>
      <div className="task-view-bar">
        <nav className="task-view-tabs" aria-label="Task views">{(['today', 'upcoming', 'completed'] as TaskView[]).map(item => <button key={item} type="button" className={view === item ? 'active' : ''} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>{item === 'today' ? 'Today' : item === 'upcoming' ? 'Upcoming' : 'Completed'}</button>)}</nav>
        <div className="task-view-filters"><label className="task-search"><SearchIcon /><input type="search" aria-label="Search tasks" placeholder="Search tasks" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} /></label><OnboardingDropdown id="task-filter-subject" label="Filter by subject" placeholder="All subjects" value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} /><OnboardingDropdown id="task-filter-priority" label="Filter by importance" placeholder="Any importance" value={priorityFilter} options={[{ value: 'all', label: 'Any importance' }, { value: 'high', label: 'High importance' }, { value: 'medium', label: 'Medium importance' }, { value: 'low', label: 'Low importance' }]} onChange={priority => setPriorityFilter(priority as 'all' | TaskPriority)} />{filtersActive && <button type="button" onClick={() => { setSearchQuery(''); setSubjectFilter('all'); setPriorityFilter('all') }}>Clear filters</button>}</div>
      </div>
      {taskUpdateError && <div className="task-update-error" role="alert"><span>{taskUpdateError}</span><button type="button" onClick={() => setTaskUpdateError('')} aria-label="Dismiss error"><CloseIcon /></button></div>}
      {view === 'today' && <div className="tasks-planner">
        {todayGroups.overdue.length > 0 && <PlannerSection title="Needs attention" description="Open tasks past their due date." tasks={todayGroups.overdue} emptyText="No overdue tasks." {...rowProps} />}
        <PlannerSection title="Today’s tasks" description="Due today or added here for focus." tasks={todayGroups.today} emptyText="No tasks are due or added for today." {...rowProps} />
        {todayGroups.suggestions.length > 0 && <PlannerSection title="Next up" description="Nearest upcoming deadlines you can add to today." tasks={todayGroups.suggestions} emptyText="No upcoming tasks to suggest." suggestion {...rowProps} />}
      </div>}
      {view === 'upcoming' && <div className="tasks-planner tasks-upcoming">{futureGroups.map(group => <PlannerSection key={group.id} title={group.label} description={group.id === 'tomorrow' ? 'Tasks due tomorrow.' : group.id === 'week' ? 'Tasks due within the next seven days.' : 'Tasks due after the next seven days.'} tasks={group.tasks} emptyText={`No tasks due ${group.label.toLowerCase()}.`} {...rowProps} />)}</div>}
      {view === 'completed' && <div className="tasks-planner"><PlannerSection title="Completed tasks" description="Finished work, newest first." tasks={completedTasks} emptyText="No completed tasks yet." {...rowProps} /></div>}
    </>}
    {viewing && <TaskDetailDialog task={viewing} subject={viewing.schedule_subject_id ? subjectMap.get(viewing.schedule_subject_id) : undefined} steps={steps} now={now} busy={busy} onClose={() => setViewing(null)} onEdit={() => { const task = viewing; setViewing(null); openEditor(task) }} onComplete={() => { const task = viewing; setViewing(null); requestComplete(task) }} onReopen={() => { const task = viewing; setViewing(null); void moveTask(task, 'in_progress', allColumns.in_progress.length) }} onToggleStep={step => { void toggleStep(viewing, step) }} />}
    {editor && <TaskEditor editor={editor} subjects={subjects} busy={busy} error={formError} onChange={draft => setEditor(previous => previous ? { ...previous, draft } : previous)} onSave={saveTask} onRequestClose={requestEditorClose} />}
    {discardOpen && <TaskConfirmationDialog eyebrow="UNSAVED CHANGES" title="Discard your changes?" description="The task details you entered will not be saved." confirmLabel="Discard changes" busyLabel="Discarding..." busy={false} onCancel={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); setEditor(null) }} />}
    {deleting && <TaskConfirmationDialog eyebrow="DELETE TASK" title={`Delete “${deleting.title}”?`} description="This permanently removes the task, its steps, and its notes. This cannot be undone." confirmLabel="Delete task" busyLabel="Deleting..." busy={busy} error={deleteError} onCancel={() => { if (!busy) setDeleting(null) }} onConfirm={() => { void confirmDelete() }} />}
    {completing && <TaskConfirmationDialog eyebrow="MARK TASK DONE" title={`Complete “${completing.title}”?`} description={taskStepProgress(completing.id, steps).total > taskStepProgress(completing.id, steps).completed ? `This task still has ${taskStepProgress(completing.id, steps).total - taskStepProgress(completing.id, steps).completed} unfinished steps. It will leave your active lists, but its details and steps will remain saved.` : 'This task will leave your active lists, but its details and steps will remain saved.'} confirmLabel="Mark done" busyLabel="Completing..." busy={busy} danger={false} onCancel={() => setCompleting(null)} onConfirm={() => { const task = completing; setCompleting(null); void moveTask(task, 'done', 0) }} />}
  </div>
}
