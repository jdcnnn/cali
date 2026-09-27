import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import { supabase } from '../lib/supabase'
import { formatTaskDue, isTaskOverdue, sortForDashboard } from '../lib/tasks'
import type { Task } from '../lib/tasks'

export function DashboardTasks({ studentId, now }: { studentId: string; now: Date }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error: taskError } = await supabase.from('tasks')
      .select('id,user_id,schedule_subject_id,title,notes,due_date,due_time,priority,status,position,completed_at,created_at,updated_at')
      .eq('user_id', studentId).neq('status', 'done')
    if (taskError) throw taskError
    setTasks((data ?? []) as Task[])
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
    {loading ? <div className="dashboard-task-skeleton" aria-label="Loading tasks"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div> : error ? <div className="dashboard-task-message"><p>{error}</p><button type="button" onClick={() => { setLoading(true); void load().catch(() => { setError('Tasks are unavailable right now.'); setLoading(false) }) }}>Try again</button></div> : actionable.length ? <div className="dashboard-task-list">{actionable.map(task => <NavLink to="/tasks" key={task.id} className="dashboard-task-item"><span className={`dashboard-task-priority dashboard-task-priority--${task.priority}`} aria-label={`${task.priority} priority`} /><span><strong>{task.title}</strong><small className={isTaskOverdue(task, now) ? 'dashboard-task-due--overdue' : ''}>{isTaskOverdue(task, now) ? 'Overdue · ' : ''}{formatTaskDue(task, now)}</small></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></NavLink>)}</div> : <div className="dashboard-task-message"><p>No open tasks yet.</p><NavLink to="/tasks?new=1">Add your first task</NavLink></div>}
    {actionable.length > 0 && <NavLink to="/tasks?new=1" className="dashboard-task-add">+ Add task</NavLink>}
  </section>
}
