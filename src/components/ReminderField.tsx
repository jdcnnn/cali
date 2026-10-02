import { useState } from 'react'
import { reminderPresets } from '../lib/reminders'
import './reminder-field.css'

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
    <label htmlFor={id}>Reminder</label>
    <select id={id} value={customVisible ? 'custom' : value === null ? '' : String(value)} disabled={disabled} onChange={event => {
      if (event.target.value === 'custom') { setCustom(true); onChange(value ?? 30); return }
      setCustom(false)
      onChange(event.target.value ? Number(event.target.value) : null)
    }}>
      {reminderPresets.map(option => <option value={option.value} key={option.value || 'none'}>{option.label}</option>)}
      <option value="custom">Custom</option>
    </select>
    {customVisible && !disabled && <div className="reminder-custom" aria-label="Custom reminder lead time">
      <label><span>Hours</span><input type="number" inputMode="numeric" min="0" max="168" value={hours} onChange={event => setCustomPart(Number(event.target.value), minutes)} /></label>
      <label><span>Minutes</span><input type="number" inputMode="numeric" min="0" max="59" value={minutes} onChange={event => setCustomPart(hours, Number(event.target.value))} /></label>
    </div>}
    {disabled && <p>Add a specific time to enable a reminder.</p>}
  </div>
}
