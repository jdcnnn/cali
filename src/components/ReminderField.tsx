import { useState } from 'react'
import { reminderLabel, reminderPresets } from '../lib/reminders'
import './reminder-field.css'

function BellIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
}

function ChevronIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
}

function TimePart({ label, value, max, step, onChange }: { label: string; value: number; max: number; step: number; onChange: (value: number) => void }) {
  return <div className="reminder-time-part"><span>{label}</span><div>
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(Math.max(0, value - step))} disabled={value === 0}>−</button>
    <input type="number" inputMode="numeric" min="0" max={max} value={value} aria-label={`Custom reminder ${label.toLowerCase()}`} onChange={event => onChange(Number(event.target.value))} />
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + step))} disabled={value === max}>+</button>
  </div></div>
}

export function ReminderField({ value, onChange, disabled = false, id = 'reminder' }: {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  id?: string
}) {
  const isPreset = value === null || reminderPresets.some(item => item.value && Number(item.value) === value)
  const [custom, setCustom] = useState(!isPreset)
  const customVisible = custom || !isPreset
  const total = value ?? 0
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  function setCustomPart(nextHours: number, nextMinutes: number) {
    const safeHours = Math.max(0, Math.min(168, Number.isFinite(nextHours) ? nextHours : 0))
    const safeMinutes = Math.max(0, Math.min(59, Number.isFinite(nextMinutes) ? nextMinutes : 0))
    onChange(Math.max(1, Math.min(10080, safeHours * 60 + safeMinutes)))
  }

  return <div className={`reminder-field${disabled ? ' is-disabled' : ''}`}>
    <div className="reminder-field-heading"><span className="reminder-field-icon"><BellIcon /></span><span><label htmlFor={id}>Reminder</label><small>Notify me before</small></span></div>
    <div className="reminder-select-shell">
      <select id={id} value={customVisible ? 'custom' : value === null ? '' : String(value)} disabled={disabled} onChange={event => {
        if (event.target.value === 'custom') { setCustom(true); onChange(value ?? 30); return }
        setCustom(false)
        onChange(event.target.value ? Number(event.target.value) : null)
      }}>
        {reminderPresets.map(option => <option value={option.value} key={option.value || 'none'}>{option.label}</option>)}
        <option value="custom">Custom lead time</option>
      </select>
      <ChevronIcon />
    </div>
    {customVisible && !disabled && <section className="reminder-custom" aria-label="Custom reminder lead time">
      <header><span>Custom lead time</span><strong>{reminderLabel(value)}</strong></header>
      <div className="reminder-time-grid"><TimePart label="Hours" value={hours} max={168} step={1} onChange={nextHours => setCustomPart(nextHours, minutes)} /><span className="reminder-time-separator" aria-hidden="true">:</span><TimePart label="Minutes" value={minutes} max={59} step={5} onChange={nextMinutes => setCustomPart(hours, nextMinutes)} /></div>
      <p>Cali will notify you before the scheduled time.</p>
    </section>}
    {disabled && <p className="reminder-disabled-note"><span aria-hidden="true">i</span>Add a specific time to enable a reminder.</p>}
  </div>
}
