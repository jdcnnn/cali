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
  formatTaskDue,
  isTaskOverdue,
  moveTaskInBoard,
  orderedColumns,
  taskStatuses,
  validateTaskDraft,
} from '../lib/tasks'
import type { Task, TaskDraft, TaskPriority, TaskStatus, TaskSubject } from '../lib/tasks'
import './tasks.css'
import './skeleton.css'

type EditorState = { taskId: string | null; draft: TaskDraft; initial: TaskDraft }

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

function TaskCard({ task, index, subject, dragDisabled, onEdit, onDelete, onMove }: {
  task: Task
  index: number
  subject?: TaskSubject
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
    {task.notes && <p className="task-card-notes">{task.notes}</p>}
    <div className="task-card-meta">
      <span className="task-subject">{subject ? subject.subject_code : 'General'}</span>
      <span className={overdue ? 'task-due task-due--overdue' : 'task-due'}>{overdue ? 'Overdue · ' : ''}{formatTaskDue(task)}</span>
    </div>
  </article>
}

function TaskColumn({ status, tasks, subjects, dragDisabled, onEdit, onDelete, onMove }: {
  status: TaskStatus
  tasks: Task[]
  subjects: Map<string, TaskSubject>
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
      {tasks.map((task, index) => <TaskCard key={task.id} task={task} index={index} subject={task.schedule_subject_id ? subjects.get(task.schedule_subject_id) : undefined} dragDisabled={dragDisabled} onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} onMove={next => onMove(task, next)} />)}
      {!tasks.length && <div className="task-column-empty"><span aria-hidden="true">{status === 'done' ? '✓' : '+'}</span><p>{status === 'todo' ? 'New tasks will start here.' : status === 'in_progress' ? 'Move work here when you begin.' : 'Completed tasks will appear here.'}</p></div>}
    </div>
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
  return <dialog ref={dialogRef} className="task-editor-dialog" aria-labelledby="task-editor-title" onCancel={event => { event.preventDefault(); onRequestClose() }}>
    <form className="task-editor" onSubmit={onSave} noValidate>
      <header className="task-editor-header"><div><p className="workspace-overline">TASK DETAILS</p><h2 id="task-editor-title">{editor.taskId ? 'Edit task' : 'Add a task'}</h2><p>{editor.taskId ? 'Update the details and deadline for this task.' : 'Capture the work, then move it across your board.'}</p></div><button type="button" className="task-close" aria-label="Close task editor" onClick={onRequestClose} disabled={busy}><CloseIcon /></button></header>
      <div className="task-editor-body">
        <section className="task-form-section" aria-labelledby="task-basics-title">
          <div className="task-form-section-heading"><div><h3 id="task-basics-title">Task information</h3><p>What needs to be done?</p></div><span>1 of 3</span></div>
          <div className="task-editor-fields">
            <label className="task-field task-field--wide"><span>Task title</span><input autoFocus required maxLength={160} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} placeholder="e.g. Finish laboratory report" /></label>
            <div className="task-field"><span>Subject <small>Optional</small></span><OnboardingDropdown id="task-subject" label="Subject" placeholder="General" value={draft.subjectId} options={[{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))]} onChange={subjectId => onChange({ ...draft, subjectId })} searchable={subjects.length > 6} /></div>
            <div className="task-field"><span>Priority</span><OnboardingDropdown id="task-priority" label="Priority" placeholder="Select priority" value={draft.priority} options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))} onChange={priority => onChange({ ...draft, priority: priority as TaskPriority })} /></div>
          </div>
        </section>
        <section className="task-form-section" aria-labelledby="task-deadline-title">
          <div className="task-form-section-heading"><div><h3 id="task-deadline-title">Deadline</h3><p>Choose when this task is due.</p></div><span>2 of 3</span></div>
          <div className="task-editor-fields">
            <label className="task-field"><span>Due date</span><input type="date" required value={draft.dueDate} onChange={event => onChange({ ...draft, dueDate: event.target.value })} /></label>
            <label className="task-field"><span>Due time <small>Optional</small></span><input type="time" value={draft.dueTime} onChange={event => onChange({ ...draft, dueTime: event.target.value })} /></label>
          </div>
        </section>
        <section className="task-form-section" aria-labelledby="task-notes-title">
          <div className="task-form-section-heading"><div><h3 id="task-notes-title">Notes</h3><p>Add context that will help you finish.</p></div><span>3 of 3</span></div>
          <label className="task-field"><span>Notes <small>Optional</small></span><textarea maxLength={4000} rows={4} value={draft.notes} onChange={event => onChange({ ...draft, notes: event.target.value })} placeholder="Add instructions, links, or a short checklist..." /><small className="task-character-count">{draft.notes.length.toLocaleString()} / 4,000</small></label>
        </section>
        {error && <p className="task-form-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="task-secondary" onClick={onRequestClose} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : editor.taskId ? 'Save changes' : 'Add task'}</button></footer>
    </form>
  </dialog>
}

function TaskConfirmationDialog({ eyebrow, title, description, confirmLabel, busyLabel, busy, error = '', onCancel, onConfirm }: { eyebrow: string; title: string; description: string; confirmLabel: string; busyLabel: string; busy: boolean; error?: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="task-confirm-dialog" aria-labelledby="task-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div><div className="task-confirm-icon" aria-hidden="true">!</div><p className="workspace-overline">{eyebrow}</p><h2 id="task-confirm-title">{title}</h2><p>{description}</p>{error && <p className="task-form-error" role="alert">{error}</p>}<footer><button type="button" className="task-secondary" autoFocus onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="task-danger" onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button></footer></div></dialog>
}

export function TasksPage({ studentId }: { studentId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState<Task[]>([])
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
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [taskResult, subjectResult] = await Promise.all([
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,priority,status,position,completed_at,created_at,updated_at').eq('user_id', studentId).order('position'),
      supabase.from('schedule_subjects').select('id,subject_code,title').eq('user_id', studentId).order('subject_code'),
    ])
    if (taskResult.error) throw taskResult.error
    if (subjectResult.error) throw subjectResult.error
    setTasks((taskResult.data ?? []) as Task[])
    setSubjects((subjectResult.data ?? []) as TaskSubject[])
    setPageError('')
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void load().catch(cause => { if (active) { setPageError(cause instanceof Error ? cause.message : 'Could not load your tasks.'); setLoading(false) } })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  useEffect(() => {
    if (!loading && !pageError && searchParams.get('new') === '1' && !editor) {
      const timer = window.setTimeout(() => {
        openNewTask()
        setSearchParams({}, { replace: true })
      }, 0)
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
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const subjectFilterOptions = useMemo(() => [{ value: 'all', label: 'All subjects' }, { value: 'general', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: `${subject.subject_code} — ${subject.title}` }))], [subjects])

  function openNewTask() {
    const draft = emptyTaskDraft()
    setFormError('')
    setDiscardOpen(false)
    setEditor({ taskId: null, draft, initial: draft })
  }

  function openEditor(task: Task) {
    const draft = draftFromTask(task)
    setFormError('')
    setDiscardOpen(false)
    setEditor({ taskId: task.id, draft, initial: draft })
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
    setBusy(true)
    setFormError('')
    const draft = editor.draft
    const details = {
      title: draft.title.replace(/\s+/g, ' ').trim(),
      notes: draft.notes.trim() || null,
      schedule_subject_id: draft.subjectId || null,
      due_date: draft.dueDate,
      due_time: draft.dueTime || null,
      priority: draft.priority,
    }
    try {
      if (editor.taskId) {
        const { data, error } = await supabase.from('tasks').update(details).eq('id', editor.taskId).eq('user_id', studentId).select().single()
        if (error) throw error
        setTasks(previous => previous.map(task => task.id === editor.taskId ? data as Task : task))
      } else {
        const { data, error } = await supabase.rpc('cali_create_own_task', {
          p_title: details.title,
          p_notes: details.notes,
          p_schedule_subject_id: details.schedule_subject_id,
          p_due_date: details.due_date,
          p_due_time: details.due_time,
          p_priority: details.priority,
        })
        if (error) throw error
        setTasks(previous => [...previous, data as Task])
      }
      setEditor(null)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save this task. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting || busy || !supabase) return
    setBusy(true)
    setDeleteError('')
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', deleting.id).eq('user_id', studentId)
      if (error) throw error
      setTasks(previous => previous.filter(task => task.id !== deleting.id))
      setDeleting(null)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete this task. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function moveTask(task: Task, targetStatus: TaskStatus, requestedIndex: number) {
    if (!supabase || (task.status === targetStatus && allColumns[targetStatus].findIndex(item => item.id === task.id) === requestedIndex)) return
    const before = tasks
    const targetCount = task.status === targetStatus ? allColumns[targetStatus].length - 1 : allColumns[targetStatus].length
    const desiredIndex = targetStatus === 'done' && task.status !== 'done' ? 0 : requestedIndex
    const index = Math.max(0, Math.min(desiredIndex, targetCount))
    const nextTasks = moveTaskInBoard(tasks, task.id, targetStatus, index)
    setTasks(nextTasks)
    setBoardError('')
    try {
      const { error } = await supabase.rpc('cali_move_own_task', { p_task_id: task.id, p_target_status: targetStatus, p_target_index: index })
      if (error) throw error
    } catch (cause) {
      setTasks(before)
      setBoardError(cause instanceof Error ? cause.message : 'Could not move the task. Your board was restored.')
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (filtersActive || event.canceled) return
    const source = event.operation.source
    const target = event.operation.target
    if (!source || !target || !isSortable(source)) return
    const task = tasks.find(item => item.id === source.id)
    if (!task) return
    if (isSortable(target)) {
      const targetStatus = target.group as TaskStatus
      void moveTask(task, targetStatus, target.index)
      return
    }
    const targetStatus = target.data?.status as TaskStatus | undefined
    if (targetStatus) void moveTask(task, targetStatus, targetStatus === 'done' ? 0 : allColumns[targetStatus].length)
  }

  if (loading) return <div className="tasks-page"><header className="tasks-heading"><div><div className="skeleton skeleton-line skeleton-line--short" /><div className="skeleton skeleton-line skeleton-line--title" /></div></header><div className="tasks-board tasks-board--loading">{taskStatuses.map(status => <div className="task-column" key={status.id}><div className="skeleton skeleton-block" /></div>)}</div></div>

  return <div className="tasks-page">
    <header className="tasks-heading"><div><p className="workspace-overline">ACADEMIC WORK</p><h1>Tasks</h1><p>Organize coursework, focus on what is active, and keep progress visible.</p></div><button type="button" className="button-primary tasks-add" onClick={openNewTask}><span aria-hidden="true">+</span> Add task</button></header>

    {pageError ? <section className="tasks-error-state" role="alert"><h2>Tasks could not be loaded</h2><p>{pageError}</p><button type="button" className="button-primary" onClick={() => { setLoading(true); void load().catch(cause => { setPageError(cause instanceof Error ? cause.message : 'Could not load your tasks.'); setLoading(false) }) }}>Try again</button></section> : <>
      <div className="task-toolbar" aria-label="Task filters">
        <div className="task-toolbar-heading"><div><h2>Board filters</h2><p>{filtersActive ? 'Showing a focused view. Dragging is paused.' : 'Narrow the board by subject or priority.'}</p></div>{filtersActive && <button type="button" onClick={() => { setSubjectFilter('all'); setPriorityFilter('all') }}>Clear filters</button>}</div>
        <div className="task-filter"><span>Subject</span><OnboardingDropdown id="task-filter-subject" label="Filter by subject" placeholder="All subjects" value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} /></div>
        <div className="task-filter"><span>Priority</span><OnboardingDropdown id="task-filter-priority" label="Filter by priority" placeholder="All priorities" value={priorityFilter} options={[{ value: 'all', label: 'All priorities' }, { value: 'high', label: 'High priority' }, { value: 'medium', label: 'Medium priority' }, { value: 'low', label: 'Low priority' }]} onChange={priority => setPriorityFilter(priority as 'all' | TaskPriority)} /></div>
        <p className="task-toolbar-tip"><span aria-hidden="true">↔</span>{filtersActive ? 'Use each card menu to change progress while filters are active.' : 'Drag cards between columns or use a card menu.'}</p>
      </div>

      {boardError && <div className="task-board-error" role="alert"><span>{boardError}</span><button type="button" onClick={() => setBoardError('')} aria-label="Dismiss error"><CloseIcon /></button></div>}

      <nav className="task-mobile-tabs" aria-label="Kanban columns">{taskStatuses.map(status => <button key={status.id} type="button" onClick={() => document.getElementById(`task-column-${status.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })}>{status.label}<span>{columns[status.id].length}</span></button>)}</nav>

      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className="tasks-board">{taskStatuses.map(status => <TaskColumn key={status.id} status={status.id} tasks={columns[status.id]} subjects={subjectMap} dragDisabled={filtersActive} onEdit={openEditor} onDelete={task => { setDeleteError(''); setDeleting(task) }} onMove={(task, next) => void moveTask(task, next, next === 'done' ? 0 : allColumns[next].length)} />)}</div>
      </DragDropProvider>
    </>}

    {editor && <TaskEditor editor={editor} subjects={subjects} busy={busy} error={formError} onChange={draft => setEditor(previous => previous ? { ...previous, draft } : previous)} onSave={saveTask} onRequestClose={requestEditorClose} />}
    {discardOpen && <TaskConfirmationDialog eyebrow="UNSAVED CHANGES" title="Discard your changes?" description="The task details you entered will not be saved." confirmLabel="Discard changes" busyLabel="Discarding..." busy={false} onCancel={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); setEditor(null) }} />}
    {deleting && <TaskConfirmationDialog eyebrow="DELETE TASK" title={`Delete “${deleting.title}”?`} description="This permanently removes the task. You cannot undo this action." confirmLabel="Delete task" busyLabel="Deleting..." busy={busy} error={deleteError} onCancel={() => { if (!busy) setDeleting(null) }} onConfirm={() => { void confirmDelete() }} />}
  </div>
}
