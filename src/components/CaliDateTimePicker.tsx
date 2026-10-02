import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { localDateKey } from '../lib/tasks'
import './cali-date-time-picker.css'

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></svg>
}

function ClockIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function monthDates(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = first.getDay() === 0 ? -6 : 1 - first.getDay()
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + mondayOffset)
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
}

function clock(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

function TimeWheel({ label, options, value, onChange, wheelRef }: { label: string; options: string[]; value: string; onChange: (value: string) => void; wheelRef: RefObject<HTMLDivElement | null> }) {
  return <div className="cali-time-column"><span>{label}</span><div ref={wheelRef} className="cali-time-wheel" role="listbox" aria-label={label} onScroll={event => { const index = Math.min(options.length - 1, Math.max(0, Math.round(event.currentTarget.scrollTop / 44))); if (options[index] !== value) onChange(options[index]) }}>{options.map((option, index) => <button key={option} type="button" role="option" aria-selected={value === option} onClick={() => { onChange(option); wheelRef.current?.scrollTo({ top: index * 44, behavior: 'smooth' }) }}>{option}</button>)}</div></div>
}

export function CaliTimePicker({ label, value, onChange, optional = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState('09')
  const [minute, setMinute] = useState('00')
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const hourRef = useRef<HTMLDivElement>(null)
  const minuteRef = useRef<HTMLDivElement>(null)
  const periodRef = useRef<HTMLDivElement>(null)
  const hourOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')), [])
  const minuteOptions = useMemo(() => Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')), [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) { dialog.showModal(); hourRef.current?.scrollTo({ top: hourOptions.indexOf(hour) * 44 }); minuteRef.current?.scrollTo({ top: minuteOptions.indexOf(minute) * 44 }); periodRef.current?.scrollTo({ top: period === 'PM' ? 44 : 0 }) }
    if (!open && dialog?.open) dialog.close()
  }, [open, hour, minute, period, hourOptions, minuteOptions])

  function showPicker() {
    if (disabled) return
    const [hours = 9, minutes = 0] = value ? value.split(':').map(Number) : []
    setHour(String(hours % 12 || 12).padStart(2, '0')); setMinute(String(minutes).padStart(2, '0')); setPeriod(hours < 12 ? 'AM' : 'PM'); setOpen(true)
  }

  return <div className="cali-picker-field"><span>{label}{optional && <small>Optional</small>}</span><button type="button" className={`cali-picker-trigger${value ? '' : ' is-empty'}`} onClick={showPicker} disabled={disabled} aria-label={`${label}: ${value ? clock(value) : 'select time'}`}><span>{value ? clock(value) : 'Select time'}</span><ClockIcon /></button><dialog ref={dialogRef} className="cali-picker-dialog cali-time-dialog" aria-label={`Choose ${label.toLowerCase()}`} onCancel={event => { event.preventDefault(); setOpen(false) }}><div><header><div><p className="workspace-overline">TIME</p><h3>Choose {label.toLowerCase()}</h3></div><button type="button" aria-label="Close time picker" onClick={() => setOpen(false)}><CloseIcon /></button></header><div className="cali-time-parts"><TimeWheel label="Hour" options={hourOptions} value={hour} onChange={setHour} wheelRef={hourRef} /><TimeWheel label="Minute" options={minuteOptions} value={minute} onChange={setMinute} wheelRef={minuteRef} /><TimeWheel label="Period" options={['AM', 'PM']} value={period} onChange={value => setPeriod(value as 'AM' | 'PM')} wheelRef={periodRef} /></div><footer>{optional && value && <button type="button" className="cali-picker-secondary" onClick={() => { onChange(''); setOpen(false) }}>Clear</button>}<button type="button" className="cali-picker-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="button-primary" onClick={() => { const hours = Number(hour) % 12 + (period === 'PM' ? 12 : 0); onChange(`${String(hours).padStart(2, '0')}:${minute}`); setOpen(false) }}>Set time</button></footer></div></dialog></div>
}

export function CaliDatePicker({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => value ? dateFromKey(value) : new Date())
  const [pendingDate, setPendingDate] = useState(() => value || localDateKey(new Date()))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dates = useMemo(() => monthDates(visibleMonth), [visibleMonth])
  const todayKey = localDateKey(new Date())

  useEffect(() => { const dialog = dialogRef.current; if (open && dialog && !dialog.open) dialog.showModal(); if (!open && dialog?.open) dialog.close() }, [open])

  function showPicker() {
    const initial = value || todayKey
    setPendingDate(initial)
    setVisibleMonth(dateFromKey(initial))
    setOpen(true)
  }
  const display = value ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(dateFromKey(value)) : 'Select date'
  const pendingDisplay = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(dateFromKey(pendingDate))

  return <div className="cali-picker-field"><span>{label}</span><button type="button" className={`cali-picker-trigger${value ? '' : ' is-empty'}`} onClick={showPicker} aria-label={`${label}: ${display}`} aria-required={required}><span>{display}</span><CalendarIcon /></button><dialog ref={dialogRef} className="cali-picker-dialog cali-date-dialog" aria-label={`Choose ${label.toLowerCase()}`} onCancel={event => { event.preventDefault(); setOpen(false) }}><div><header><div><p className="workspace-overline">DATE</p><h3>Choose {label.toLowerCase()}</h3></div><button type="button" aria-label="Close date picker" onClick={() => setOpen(false)}><CloseIcon /></button></header><div className="cali-date-selected"><CalendarIcon /><div><span>Selected date</span><strong>{pendingDisplay}</strong></div></div><div className="cali-date-month-nav"><button type="button" aria-label="Previous month" onClick={() => setVisibleMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronIcon direction="left" /></button><h4>{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(visibleMonth)}</h4><button type="button" aria-label="Next month" onClick={() => setVisibleMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronIcon direction="right" /></button></div><div className="cali-date-weekdays" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="cali-date-grid">{dates.map(date => { const key = localDateKey(date); return <button key={key} type="button" className={`${date.getMonth() === visibleMonth.getMonth() ? '' : 'is-outside'}${key === todayKey ? ' is-today' : ''}${key === pendingDate ? ' is-selected' : ''}`} aria-label={new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)} aria-pressed={key === pendingDate} onClick={() => { setPendingDate(key); if (date.getMonth() !== visibleMonth.getMonth()) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1)) }}>{date.getDate()}</button> })}</div><footer><button type="button" className="cali-picker-secondary cali-date-today" onClick={() => { const today = new Date(); setVisibleMonth(today); setPendingDate(todayKey) }}>Today</button><span><button type="button" className="cali-picker-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="button-primary" onClick={() => { onChange(pendingDate); setOpen(false) }}>Set date</button></span></footer></div></dialog></div>
}
