import { describe, expect, it } from 'vitest'
import { emptyTaskDraft, isTaskOverdue, moveTaskInBoard, orderedColumns, sortForDashboard, validateTaskDraft } from './tasks'
import type { Task } from './tasks'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    user_id: 'user-1',
    schedule_subject_id: null,
    title: 'Write report',
    notes: null,
    due_date: '2026-09-27',
    due_time: null,
    priority: 'medium',
    status: 'todo',
    position: 0,
    completed_at: null,
    created_at: '2026-09-20T00:00:00.000Z',
    updated_at: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('task validation', () => {
  it('requires a title and due date', () => {
    expect(validateTaskDraft(emptyTaskDraft())).toBe('Enter a title of up to 160 characters.')
    expect(validateTaskDraft({ ...emptyTaskDraft(), title: 'Read chapter 4' })).toBe('Choose a due date.')
  })

  it('accepts an optional valid due time', () => {
    expect(validateTaskDraft({ ...emptyTaskDraft(), title: 'Read chapter 4', dueDate: '2026-09-30', dueTime: '18:30' })).toBeNull()
    expect(validateTaskDraft({ ...emptyTaskDraft(), title: 'Read chapter 4', dueDate: '2026-09-30', dueTime: '27:10' })).toBe('Choose a valid due time or leave it blank.')
  })
})

describe('deadline behavior', () => {
  it('keeps a date-only task current through the end of its due day', () => {
    const dateOnly = task()
    expect(isTaskOverdue(dateOnly, new Date(2026, 8, 27, 23, 59, 30))).toBe(false)
    expect(isTaskOverdue(dateOnly, new Date(2026, 8, 28, 0, 0, 0))).toBe(true)
  })

  it('uses the optional local due time and never marks done work overdue', () => {
    const timed = task({ due_time: '14:30:00' })
    expect(isTaskOverdue(timed, new Date(2026, 8, 27, 14, 31))).toBe(true)
    expect(isTaskOverdue({ ...timed, status: 'done', completed_at: '2026-09-27T06:00:00.000Z' }, new Date(2026, 8, 28))).toBe(false)
  })
})

describe('board and dashboard ordering', () => {
  it('sorts each Kanban column by its persisted position', () => {
    const columns = orderedColumns([
      task({ id: 'later', position: 2 }),
      task({ id: 'first', position: 0 }),
      task({ id: 'doing', status: 'in_progress', position: 0 }),
    ])
    expect(columns.todo.map(item => item.id)).toEqual(['first', 'later'])
    expect(columns.in_progress.map(item => item.id)).toEqual(['doing'])
  })

  it('reorders within one column and normalizes every position', () => {
    const moved = moveTaskInBoard([
      task({ id: 'first', position: 0 }),
      task({ id: 'second', position: 1 }),
      task({ id: 'third', position: 2 }),
    ], 'third', 'todo', 0)
    const todo = orderedColumns(moved).todo
    expect(todo.map(item => item.id)).toEqual(['third', 'first', 'second'])
    expect(todo.map(item => item.position)).toEqual([0, 1, 2])
  })

  it('moves across columns and maintains completion timestamps', () => {
    const completedAt = '2026-09-27T08:00:00.000Z'
    const done = moveTaskInBoard([task({ id: 'one', position: 0 }), task({ id: 'two', position: 1 })], 'two', 'done', 0, completedAt)
    expect(done.find(item => item.id === 'two')).toMatchObject({ status: 'done', position: 0, completed_at: completedAt })
    expect(done.find(item => item.id === 'one')).toMatchObject({ status: 'todo', position: 0 })
    const reopened = moveTaskInBoard(done, 'two', 'in_progress', 0)
    expect(reopened.find(item => item.id === 'two')).toMatchObject({ status: 'in_progress', completed_at: null })
  })

  it('prioritizes overdue work, then deadline, then priority on the dashboard', () => {
    const now = new Date(2026, 8, 27, 12, 0)
    const sorted = sortForDashboard([
      task({ id: 'tomorrow', due_date: '2026-09-28', priority: 'high' }),
      task({ id: 'overdue', due_date: '2026-09-26', priority: 'low' }),
      task({ id: 'today-low', due_time: '18:00:00', priority: 'low' }),
      task({ id: 'today-high', due_time: '18:00:00', priority: 'high' }),
      task({ id: 'done', status: 'done', completed_at: '2026-09-26T10:00:00.000Z' }),
    ], now)
    expect(sorted.map(item => item.id)).toEqual(['overdue', 'today-high', 'today-low', 'tomorrow'])
  })
})
