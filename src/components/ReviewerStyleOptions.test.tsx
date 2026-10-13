// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REVIEWER_PREFERENCES } from '../lib/reviewerPreferences'
import { ReviewerStyleOptions } from './ReviewerStyleOptions'

describe('ReviewerStyleOptions', () => {
  afterEach(cleanup)

  it('emits semantic reviewer preferences from the structured controls', async () => {
    const user = userEvent.setup()
    const onPreferencesChange = vi.fn()
    render(<ReviewerStyleOptions
      preferences={DEFAULT_REVIEWER_PREFERENCES}
      detail="standard"
      onPreferencesChange={onPreferencesChange}
      onDetailChange={() => undefined}
    />)

    await user.click(screen.getByRole('radio', { name: /Many/i }))
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ examples: 'many' }))

    await user.click(screen.getByRole('checkbox', { name: /Common mistakes/i }))
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ commonMistakes: true }))

    await user.click(screen.getByRole('radio', { name: /Explanation-first/i }))
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ presentation: 'explanatory' }))
  })

  it('hides the supplementary-example option when examples are disabled', () => {
    render(<ReviewerStyleOptions
      preferences={{ ...DEFAULT_REVIEWER_PREFERENCES, examples: 'none' }}
      detail="concise"
      onPreferencesChange={() => undefined}
      onDetailChange={() => undefined}
    />)

    expect(screen.queryByRole('checkbox', { name: /Allow illustrative examples/i })).toBeNull()
  })
})
