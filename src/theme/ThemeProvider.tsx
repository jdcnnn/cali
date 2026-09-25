import { useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeContext } from './ThemeContext'
import type { ThemePreference } from './ThemeContext'
const storageKey = 'cali-theme'

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(storageKey)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function applyTheme() {
      const resolved = resolveTheme(preference)
      document.documentElement.dataset.theme = resolved
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0C202B' : '#F6FCFF')
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    try { window.localStorage.setItem(storageKey, preference) } catch { /* Storage may be unavailable. */ }
    return () => media.removeEventListener('change', applyTheme)
  }, [preference])

  return <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>
}
