// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaliSelect } from './CaliSelect'

const options = [
  { value: 'quick', label: 'Quick' },
  { value: 'detailed', label: 'Detailed' },
]

afterEach(cleanup)

describe('CaliSelect', () => {
  it('opens an accessible listbox and returns the selected value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CaliSelect value="quick" options={options} onChange={onChange} ariaLabel="Detail level" />)

    await user.click(screen.getByRole('button', { name: 'Detail level' }))
    expect(screen.getByRole('listbox', { name: 'Detail level' })).toBeTruthy()
    await user.click(screen.getByRole('option', { name: 'Detailed' }))

    expect(onChange).toHaveBeenCalledWith('detailed')
    expect(screen.queryByRole('listbox', { name: 'Detail level' })).toBeNull()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<CaliSelect value="quick" options={options} onChange={() => undefined} ariaLabel="Detail level" />)
    const trigger = screen.getByRole('button', { name: 'Detail level' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox', { name: 'Detail level' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
