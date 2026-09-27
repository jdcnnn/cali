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
  priority: TaskPriority
  status: TaskStatus
  position: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type TaskSubject = { id: string; subject_code: string; title: string }

export type TaskDraft = {
  title: string
  notes: string
  subjectId: string
  dueDate: string
  dueTime: string
  priority: TaskPriority
}

export const taskStatuses: { id: TaskStatus; label: string; description: string }[] = [
  { id: 'todo', label: 'To do', description: 'Ready to work on' },
  { id: 'in_progress', label: 'In progress', description: 'Currently underway' },
  { id: 'done', label: 'Done', description: 'Finished work' },
]

export const priorityRank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

export function emptyTaskDraft(): TaskDraft {
  return { title: '', notes: '', subjectId: '', dueDate: '', dueTime: '', priority: 'medium' }
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    subjectId: task.schedule_subject_id ?? '',
    dueDate: task.due_date,
    dueTime: task.due_time?.slice(0, 5) ?? '',
    priority: task.priority,
  }
}

export function validateTaskDraft(draft: TaskDraft) {
  const title = draft.title.replace(/\s+/g, ' ').trim()
  if (!title || title.length > 160) return 'Enter a title of up to 160 characters.'
  if (draft.notes.length > 4000) return 'Keep notes to 4,000 characters or fewer.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return 'Choose a due date.'
  if (draft.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime)) return 'Choose a valid due time or leave it blank.'
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

export function sortForDashboard(tasks: Task[], now = new Date()) {
  return tasks.filter(task => task.status !== 'done').sort((left, right) => {
    const overdueDifference = Number(isTaskOverdue(right, now)) - Number(isTaskOverdue(left, now))
    if (overdueDifference) return overdueDifference
    const deadlineDifference = localDeadline(left).getTime() - localDeadline(right).getTime()
    if (deadlineDifference) return deadlineDifference
    const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority]
    if (priorityDifference) return priorityDifference
    return left.created_at.localeCompare(right.created_at)
  })
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
