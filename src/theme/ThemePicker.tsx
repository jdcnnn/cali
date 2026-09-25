import { useEffect, useId, useRef, useState } from 'react'
import { useTheme } from './ThemeContext'
import type { ThemePreference } from './ThemeContext'
import './theme.css'

const choices: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Match your device' },
  { value: 'light', label: 'Light', hint: 'Bright and clear' },
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes' },
]

function ThemeIcon({ mode }: { mode: ThemePreference }) {
  if (mode === 'light') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
  if (mode === 'dark') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5 8.5 8.5 0 1 0 20.5 14.3Z" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>
}

export function ThemePicker() {
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionsId = useId()
  const current = choices.find((choice) => choice.value === preference)!

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('pointerdown', handlePointerDown); document.removeEventListener('keydown', handleKeyDown) }
  }, [open])

  return <div className="theme-picker" ref={pickerRef}>
    <button ref={buttonRef} type="button" className="theme-trigger" aria-label={`Appearance: ${current.label}`} aria-expanded={open} aria-controls={open ? optionsId : undefined} onClick={() => setOpen((value) => !value)} title={`Appearance: ${current.label}`}>
      <ThemeIcon mode={preference} />
      <span className="theme-trigger-label">Appearance</span>
      <span className="theme-trigger-current">{current.label}</span>
      <svg className="theme-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="theme-popover" id={optionsId} role="group" aria-label="Choose appearance">
      <p className="theme-popover-title">Appearance</p>
      {choices.map((choice) => <button key={choice.value} type="button" className={`theme-option${preference === choice.value ? ' theme-option--selected' : ''}`} aria-pressed={preference === choice.value} onClick={() => { setPreference(choice.value); setOpen(false); buttonRef.current?.focus() }}>
        <span className="theme-option-icon"><ThemeIcon mode={choice.value} /></span>
        <span className="theme-option-copy"><strong>{choice.label}</strong><small>{choice.hint}</small></span>
        <span className="theme-option-check" aria-hidden="true">{preference === choice.value ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>
}
