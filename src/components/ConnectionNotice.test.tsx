// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionNotice } from './ConnectionNotice'

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setOnline(true)
})

describe('ConnectionNotice', () => {
  it('announces an offline initial state', () => {
    setOnline(false)
    render(<ConnectionNotice />)
    expect(screen.getByRole('alert').textContent).toContain("You're offline")
  })

  it('announces recovery and then dismisses itself', () => {
    vi.useFakeTimers()
    setOnline(false)
    render(<ConnectionNotice />)

    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.getByRole('status').textContent).toContain('Cali is back online')

    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
