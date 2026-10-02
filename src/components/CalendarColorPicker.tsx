import type { CSSProperties } from 'react'
import { calendarColors, calendarColorValue } from '../lib/calendarColors'
import type { CalendarColorKey } from '../lib/calendarColors'
import './calendar-color-picker.css'

export function CalendarColorPicker({ value, onChange, disabled = false, label = 'Color' }: { value: CalendarColorKey; onChange: (value: CalendarColorKey) => void; disabled?: boolean; label?: string }) {
  return <fieldset className="calendar-color-picker" disabled={disabled}>
    <legend>{label}</legend>
    <div>{calendarColors.map(color => <button key={color.key} type="button" className={value === color.key ? 'is-selected' : ''} style={{ '--picker-color': calendarColorValue(color.key) } as CSSProperties} aria-label={color.name} aria-pressed={value === color.key} title={color.name} onClick={() => onChange(color.key)}><span /><small>{color.name}</small></button>)}</div>
  </fieldset>
}
