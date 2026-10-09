import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { formatTaskDue, isTaskOverdue, nextTaskStep, sortForDashboard } from '../lib/tasks'
import type { Task, TaskStep } from '../lib/tasks'
import { StatusIcon } from './StatusIcon'
import './skeleton.css'

export function DashboardTasks({ studentId, now }: { studentId: string; now: Date }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const [taskResult, stepResult] = await Promise.all([
      supabase.from('tasks').select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,planned_date,priority,status,position,completed_at,reminder_minutes,created_at,updated_at').eq('user_id', studentId).neq('status', 'done'),
      supabase.from('task_steps').select('id,task_id,title,position,is_completed,created_at,updated_at').order('position'),
    ])
    if (taskResult.error) throw taskResult.error
    if (stepResult.error) throw stepResult.error
    setTasks((taskResult.data ?? []) as Task[])
    setSteps((stepResult.data ?? []) as TaskStep[])
    setError('')
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void load().catch(() => { if (active) { setError('Tasks are unavailable right now.'); setLoading(false) } })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  const actionable = useMemo(() => sortForDashboard(tasks, now).slice(0, 3), [tasks, now])

  return <section className="dashboard-tasks" aria-labelledby="dashboard-tasks-title">
    <div className="dashboard-tasks-head"><h2 id="dashboard-tasks-title">Tasks</h2><NavLink to="/tasks">View tasks</NavLink></div>
    {loading ? <div className="dashboard-task-skeleton" role="status" aria-label="Loading tasks">{[0, 1, 2].map(index => <span className="cali-skeleton" aria-hidden="true" key={index} />)}</div> : error ? <div className="dashboard-task-message"><p>{error}</p><button type="button" onClick={() => { setLoading(true); void load().catch(() => { setError('Tasks are unavailable right now.'); setLoading(false) }) }}>Try again</button></div> : actionable.length ? <div className="dashboard-task-list">{actionable.map(task => { const next = nextTaskStep(task.id, steps); return <NavLink to="/tasks" key={task.id} className="dashboard-task-item"><span className={`dashboard-task-priority dashboard-task-priority--${task.priority}`} aria-label={`${task.priority} importance`} /><span><strong>{task.title}</strong><small className={isTaskOverdue(task, now) ? 'dashboard-task-due--overdue' : ''}>{isTaskOverdue(task, now) ? 'Overdue · ' : ''}{formatTaskDue(task, now)}{next ? ` · Next: ${next.title}` : ''}</small></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></NavLink> })}</div> : <div className="dashboard-task-empty"><span className="dashboard-task-empty-icon"><StatusIcon name="tasks" /></span><div><strong>Your task list is clear</strong><p>Add a task when you have coursework or a deadline to track.</p></div><NavLink to="/tasks?new=1"><span aria-hidden="true">+</span> Add task</NavLink></div>}
    {actionable.length > 0 && <NavLink to="/tasks?new=1" className="dashboard-task-add">+ Add task</NavLink>}
  </section>
}
