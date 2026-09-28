export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export type Task = {
  id: string
  user_id: string
  schedule_subject_id: string | null
  title: string
  notes: string | null
  due_date: string
  due_time: string | null
  planned_date: string | null
  estimate_minutes: number | null
  priority: TaskPriority
  status: TaskStatus
  position: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type TaskStep = {
  id: string
  task_id: string
  title: string
  position: number
  is_completed: boolean
  created_at: string
  updated_at: string
}

export type TaskSubject = { id: string; subject_code: string; title: string }
export type TaskDraftStep = { id: string; title: string; isCompleted: boolean }

export type TaskDraft = {
  title: string
  notes: string
  subjectId: string
  dueDate: string
  dueTime: string
  plannedDate: string
  estimateMinutes: string
  priority: TaskPriority
  steps: TaskDraftStep[]
}

export type PlannerGroups = { overdue: Task[]; today: Task[]; suggestions: Task[] }
export type UpcomingGroup = { id: 'tomorrow' | 'week' | 'later'; label: string; tasks: Task[] }

export const taskStatuses: { id: TaskStatus; label: string; description: string }[] = [
  { id: 'todo', label: 'To do', description: 'Ready to work on' },
  { id: 'in_progress', label: 'In progress', description: 'Currently underway' },
  { id: 'done', label: 'Done', description: 'Finished work' },
]

export const priorityRank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function emptyTaskDraft(): TaskDraft {
  return { title: '', notes: '', subjectId: '', dueDate: '', dueTime: '', plannedDate: '', estimateMinutes: '', priority: 'medium', steps: [] }
}

export function draftFromTask(task: Task, steps: TaskStep[] = []): TaskDraft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    subjectId: task.schedule_subject_id ?? '',
    dueDate: task.due_date,
    dueTime: task.due_time?.slice(0, 5) ?? '',
    plannedDate: task.planned_date ?? '',
    estimateMinutes: task.estimate_minutes?.toString() ?? '',
    priority: task.priority,
    steps: steps.sort((a, b) => a.position - b.position).map(step => ({ id: step.id, title: step.title, isCompleted: step.is_completed })),
  }
}

export function validateTaskDraft(draft: TaskDraft) {
  const title = draft.title.replace(/\s+/g, ' ').trim()
  if (!title || title.length > 160) return 'Enter a title of up to 160 characters.'
  if (draft.notes.length > 4000) return 'Keep notes to 4,000 characters or fewer.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return 'Choose a due date.'
  if (draft.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime)) return 'Choose a valid due time or leave it blank.'
  if (draft.plannedDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.plannedDate)) return 'Choose a valid planned date or leave it blank.'
  if (draft.plannedDate && draft.plannedDate > draft.dueDate) return 'Plan the task on or before its due date.'
  if (draft.estimateMinutes && (!/^\d+$/.test(draft.estimateMinutes) || Number(draft.estimateMinutes) < 5 || Number(draft.estimateMinutes) > 10080)) return 'Enter an estimate from 5 minutes to 168 hours.'
  if (draft.steps.length > 50) return 'Keep the checklist to 50 steps or fewer.'
  if (draft.steps.some(step => !step.title.trim() || step.title.trim().length > 240)) return 'Each checklist step needs a title of up to 240 characters.'
  return null
}

function localDeadline(task: Pick<Task, 'due_date' | 'due_time'>) {
  const [year, month, day] = task.due_date.split('-').map(Number)
  const [hour, minute] = task.due_time ? task.due_time.split(':').map(Number) : [23, 59]
  return new Date(year, month - 1, day, hour, minute, task.due_time ? 0 : 59, task.due_time ? 0 : 999)
}

export function isTaskOverdue(task: Task, now = new Date()) {
  return task.status !== 'done' && localDeadline(task).getTime() < now.getTime()
}

export function formatTaskDue(task: Pick<Task, 'due_date' | 'due_time'>, now = new Date()) {
  const [year, month, day] = task.due_date.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const difference = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  const dateLabel = difference === 0 ? 'Today' : difference === 1 ? 'Tomorrow' : difference === -1 ? 'Yesterday' : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: year === now.getFullYear() ? undefined : 'numeric' }).format(due)
  if (!task.due_time) return dateLabel
  const time = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(localDeadline(task))
  return `${dateLabel}, ${time}`
}

export function formatEstimate(minutes: number | null) {
  if (!minutes) return ''
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function smartTaskSort(left: Task, right: Task) {
  const statusDifference = Number(right.status === 'in_progress') - Number(left.status === 'in_progress')
  if (statusDifference) return statusDifference
  const deadlineDifference = localDeadline(left).getTime() - localDeadline(right).getTime()
  if (deadlineDifference) return deadlineDifference
  const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority]
  if (priorityDifference) return priorityDifference
  return left.created_at.localeCompare(right.created_at)
}

export function plannerGroups(tasks: Task[], now = new Date()): PlannerGroups {
  const today = localDateKey(now)
  const open = tasks.filter(task => task.status !== 'done')
  const overdue = open.filter(task => isTaskOverdue(task, now)).sort(smartTaskSort)
  const dueOrPlannedToday = open.filter(task => !isTaskOverdue(task, now) && (task.due_date === today || task.planned_date === today)).sort(smartTaskSort)
  const selected = new Set([...overdue, ...dueOrPlannedToday].map(task => task.id))
  const suggestions = dueOrPlannedToday.length ? [] : open.filter(task => !selected.has(task.id) && !isTaskOverdue(task, now)).sort(smartTaskSort).slice(0, 3)
  return { overdue, today: dueOrPlannedToday, suggestions }
}

export function upcomingGroups(tasks: Task[], now = new Date()): UpcomingGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7)
  const tomorrowKey = localDateKey(tomorrow)
  const weekEndKey = localDateKey(weekEnd)
  const open = tasks.filter(task => task.status !== 'done' && !isTaskOverdue(task, now) && task.due_date > localDateKey(today)).sort(smartTaskSort)
  return [
    { id: 'tomorrow', label: 'Tomorrow', tasks: open.filter(task => task.due_date === tomorrowKey) },
    { id: 'week', label: 'Next 7 days', tasks: open.filter(task => task.due_date > tomorrowKey && task.due_date <= weekEndKey) },
    { id: 'later', label: 'Later', tasks: open.filter(task => task.due_date > weekEndKey) },
  ]
}

export function stepsForTask(taskId: string, steps: TaskStep[]) {
  return steps.filter(step => step.task_id === taskId).sort((a, b) => a.position - b.position)
}

export function nextTaskStep(taskId: string, steps: TaskStep[]) {
  return stepsForTask(taskId, steps).find(step => !step.is_completed) ?? null
}

export function taskStepProgress(taskId: string, steps: TaskStep[]) {
  const taskSteps = stepsForTask(taskId, steps)
  return { completed: taskSteps.filter(step => step.is_completed).length, total: taskSteps.length }
}

export function sortForDashboard(tasks: Task[], now = new Date()) {
  const groups = plannerGroups(tasks, now)
  const selected = new Set([...groups.overdue, ...groups.today].map(task => task.id))
  return [...groups.overdue, ...groups.today, ...tasks.filter(task => task.status !== 'done' && !selected.has(task.id)).sort(smartTaskSort)]
}

export function orderedColumns(tasks: Task[]) {
  return Object.fromEntries(taskStatuses.map(({ id }) => [id, tasks.filter(task => task.status === id).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))])) as Record<TaskStatus, Task[]>
}

export function moveTaskInBoard(tasks: Task[], taskId: string, targetStatus: TaskStatus, requestedIndex: number, completedAt = new Date().toISOString()) {
  const task = tasks.find(item => item.id === taskId)
  if (!task) return tasks
  const columns = orderedColumns(tasks)
  const source = columns[task.status].filter(item => item.id !== task.id)
  const target = task.status === targetStatus ? source : columns[targetStatus].filter(item => item.id !== task.id)
  const index = Math.max(0, Math.min(requestedIndex, target.length))
  const moved: Task = { ...task, status: targetStatus, position: index, completed_at: targetStatus === 'done' ? task.completed_at ?? completedAt : null }
  target.splice(index, 0, moved)
  const reordered = new Map<string, Task>()
  if (task.status !== targetStatus) source.forEach((item, position) => reordered.set(item.id, { ...item, position }))
  target.forEach((item, position) => reordered.set(item.id, { ...item, status: targetStatus, position }))
  return tasks.map(item => reordered.get(item.id) ?? item)
}
