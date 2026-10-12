import { describe, expect, it } from 'vitest'
import { compactDuration } from './duration'
import { reminderLabel } from './reminders'

describe('compact schedule durations', () => {
  it.each([
    [1, '1 min'], [25, '25 mins'], [60, '1 hr'],
    [61, '1 hr 1 min'], [85, '1 hr 25 mins'], [120, '2 hrs'],
    [122, '2 hrs 2 mins'], [0, '0 mins'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(compactDuration(minutes)).toBe(expected)
  })
  it('keeps reminders consistent without changing preset labels', () => {
    expect(reminderLabel(1)).toBe('1 min before')
    expect(reminderLabel(25)).toBe('25 mins before')
    expect(reminderLabel(61)).toBe('1 hr 1 min before')
    expect(reminderLabel(85)).toBe('1 hr 25 mins before')
    expect(reminderLabel(30)).toBe('30 minutes before')
    expect(reminderLabel(null)).toBe('No reminder')
  })
})
