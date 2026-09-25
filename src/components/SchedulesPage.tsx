import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { supabase } from '../lib/supabase'
import { StatusIcon } from './StatusIcon'
import { ScheduleImport } from './ScheduleImport'
import './schedules.css'
import './skeleton.css'

type DayCode = 'M' | 'T' | 'W' | 'H' | 'F' | 'S' | 'U'
type Subject = { id: string; user_id: string; subject_code: string; title: string; units: number; block_section: string }
type Meeting = { id: string; subject_id: string; day_code: DayCode; starts_at: string; ends_at: string; room: string | null }
type Draft = { subjectId: string; code: string; title: string; units: string; block: string; day: DayCode; start: string; end: string; room: string }
type Modal = { kind: 'details' | 'delete'; meetingId: string } | { kind: 'editor'; meetingId: string | null; initial: Draft }

const days: { code: DayCode; name: string }[] = [
  { code: 'M', name: 'Monday' }, { code: 'T', name: 'Tuesday' }, { code: 'W', name: 'Wednesday' },
  { code: 'H', name: 'Thursday' }, { code: 'F', name: 'Friday' }, { code: 'S', name: 'Saturday' },
  { code: 'U', name: 'Sunday' },
]
const dayCodeByWeekday: DayCode[] = ['U', 'M', 'T', 'W', 'H', 'F', 'S']

function clock(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

function duration(start: string, end: string) {
  if (!start || !end) return null
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  const minutes = endHour * 60 + endMinute - startHour * 60 - startMinute
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return [hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`, remaining && `${remaining} ${remaining === 1 ? 'minute' : 'minutes'}`].filter(Boolean).join(' ')
}

function newDraft(day: DayCode, subject?: Subject): Draft {
  return { subjectId: subject?.id ?? '', code: subject?.subject_code ?? '', title: subject?.title ?? '', units: subject ? String(subject.units) : '', block: subject?.block_section ?? '', day, start: '', end: '', room: '' }
}

function sanitizeUnits(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [whole, ...decimals] = cleaned.split('.')
  const numberPart = whole.slice(0, 2) || (decimals.length ? '0' : '')
  return decimals.length ? `${numberPart}.${decimals.join('').slice(0, 1)}` : numberPart
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function TimeWheel({ label, options, value, onChange, wheelRef }: { label: string; options: string[]; value: string; onChange: (value: string) => void; wheelRef: RefObject<HTMLDivElement | null> }) {
  return <div className="schedule-time-column">
    <span>{label}</span>
    <div ref={wheelRef} className="schedule-time-wheel" role="listbox" aria-label={label} onScroll={event => {
      const index = Math.min(options.length - 1, Math.max(0, Math.round(event.currentTarget.scrollTop / 44)))
      if (options[index] !== value) onChange(options[index])
    }}>
      {options.map((option, index) => <button key={option} type="button" role="option" aria-selected={value === option} onClick={() => {
        onChange(option)
        wheelRef.current?.scrollTo({ top: index * 44, behavior: 'smooth' })
      }}>{option}</button>)}
    </div>
  </div>
}

function TimePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
    if (open && dialog && !dialog.open) {
      dialog.showModal()
      hourRef.current?.scrollTo({ top: hourOptions.indexOf(hour) * 44 })
      minuteRef.current?.scrollTo({ top: minuteOptions.indexOf(minute) * 44 })
      periodRef.current?.scrollTo({ top: period === 'PM' ? 44 : 0 })
    }
    if (!open && dialog?.open) dialog.close()
  }, [open, hour, minute, period, hourOptions, minuteOptions])

  function showPicker() {
    let nextHour = '09'
    let nextMinute = '00'
    let nextPeriod: 'AM' | 'PM' = 'AM'
    if (value) {
      const [hours, minutes] = value.split(':').map(Number)
      nextHour = String(hours % 12 || 12).padStart(2, '0')
      nextMinute = String(minutes).padStart(2, '0')
      nextPeriod = hours < 12 ? 'AM' : 'PM'
    }
    setHour(nextHour)
    setMinute(nextMinute)
    setPeriod(nextPeriod)
    setOpen(true)
  }

  function applyTime() {
    const hours = Number(hour) % 12 + (period === 'PM' ? 12 : 0)
    onChange(`${String(hours).padStart(2, '0')}:${minute}`)
    setOpen(false)
  }

  return <div className="schedule-field schedule-time-field">
    <span>{label}</span>
    <button type="button" className={`schedule-time-trigger${value ? '' : ' schedule-time-trigger--empty'}`} onClick={showPicker} aria-label={`${label}: ${value ? clock(value) : 'select time'}`}>
      <span>{value ? clock(value) : 'Select time'}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <dialog ref={dialogRef} className="schedule-time-dialog" aria-label={`Choose ${label.toLowerCase()}`} onCancel={event => { event.preventDefault(); setOpen(false) }}>
      <div className="schedule-time-dialog-content">
        <div className="schedule-dialog-head"><div><p className="workspace-overline">MEETING TIME</p><h3>Choose {label.toLowerCase()}</h3></div><button type="button" className="schedule-close" aria-label="Close time picker" onClick={() => setOpen(false)}><CloseIcon /></button></div>
        <div className="schedule-time-parts">
          <TimeWheel label="Hour" options={hourOptions} value={hour} onChange={setHour} wheelRef={hourRef} />
          <TimeWheel label="Minute" options={minuteOptions} value={minute} onChange={setMinute} wheelRef={minuteRef} />
          <TimeWheel label="Period" options={['AM', 'PM']} value={period} onChange={value => setPeriod(value as 'AM' | 'PM')} wheelRef={periodRef} />
        </div>
        <div className="schedule-dialog-actions"><button type="button" className="schedule-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="button-primary" onClick={applyTime}>Set time</button></div>
      </div>
    </dialog>
  </div>
}

function validationError(draft: Draft) {
  if (!cleanText(draft.code) || cleanText(draft.code).length > 40) return 'Enter a subject code of up to 40 characters.'
  if (!cleanText(draft.title) || cleanText(draft.title).length > 200) return 'Enter a subject title of up to 200 characters.'
  if (!cleanText(draft.block) || cleanText(draft.block).length > 80) return 'Enter a block or section of up to 80 characters.'
  const units = Number(draft.units)
  if (!draft.units.trim() || !Number.isFinite(units) || units < 0 || units > 30 || !/^\d+(?:\.\d)?$/.test(draft.units.trim())) return 'Enter units between 0 and 30, with at most one decimal place.'
  if (!draft.start || !draft.end || draft.start >= draft.end) return 'Choose an end time after the start time.'
  if (cleanText(draft.room).length > 120 || cleanText(draft.room).toUpperCase() === 'N/A') return 'Enter a room of up to 120 characters, or leave it blank.'
  return null
}

export function SchedulesPage({ studentId, now }: { studentId: string; now: Date }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [pageError, setPageError] = useState('')
  const [modal, setModal] = useState<Modal | null>(null)
  const [draft, setDraft] = useState<Draft>(newDraft('M'))
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const load = useCallback(async () => {
    if (!supabase) { setPageError('Supabase is not configured.'); setLoading(false); return }
    setPageError('')
    const { data: subjectRows, error: subjectError } = await supabase.from('schedule_subjects')
      .select('id,user_id,subject_code,title,units,block_section').eq('user_id', studentId).order('subject_code')
    if (subjectError) throw subjectError
    const nextSubjects = (subjectRows ?? []) as Subject[]
    let nextMeetings: Meeting[] = []
    if (nextSubjects.length) {
      const { data: meetingRows, error: meetingError } = await supabase.from('schedule_meetings')
        .select('id,subject_id,day_code,starts_at,ends_at,room').in('subject_id', nextSubjects.map(subject => subject.id))
      if (meetingError) throw meetingError
      nextMeetings = (meetingRows ?? []) as Meeting[]
    }
    setSubjects(nextSubjects)
    setMeetings(nextMeetings)
    setLoaded(true)
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void load().catch(error => {
        if (!active) return
        setPageError(error instanceof Error ? error.message : 'Could not load your schedule.')
        setLoading(false)
      })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  useEffect(() => {
    const dialog = dialogRef.current
    if (modal && dialog && !dialog.open) dialog.showModal()
    if (!modal && dialog?.open) dialog.close()
  }, [modal])

  useEffect(() => {
    if (!menuId) return
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.schedule-item-menu')) setMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuId(null) }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeMenu); document.removeEventListener('keydown', closeOnEscape) }
  }, [menuId])

  const dirty = modal?.kind === 'editor' && JSON.stringify(draft) !== JSON.stringify(modal.initial)

  const subjectById = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const meetingsByDay = useMemo(() => new Map(days.map(day => [day.code, meetings.filter(meeting => meeting.day_code === day.code).sort((a, b) => a.starts_at.localeCompare(b.starts_at))])), [meetings])
  const scheduledIds = useMemo(() => new Set(meetings.map(meeting => meeting.subject_id)), [meetings])
  const unscheduled = subjects.filter(subject => !scheduledIds.has(subject.id))
  const selectedMeeting = modal && modal.kind !== 'editor' ? meetings.find(meeting => meeting.id === modal.meetingId) : null
  const selectedSubject = selectedMeeting ? subjectById.get(selectedMeeting.subject_id) : null

  function openEditor(day: DayCode, meeting?: Meeting) {
    const owner = meeting ? subjectById.get(meeting.subject_id) : undefined
    const initial = meeting && owner
      ? { ...newDraft(meeting.day_code, owner), start: meeting.starts_at.slice(0, 5), end: meeting.ends_at.slice(0, 5), room: meeting.room ?? '' }
      : newDraft(day, owner)
    setDraft(initial)
    setFormError('')
    setDiscardPrompt(false)
    setMenuId(null)
    setModal({ kind: 'editor', meetingId: meeting?.id ?? null, initial })
  }

  function requestClose() {
    if (busy) return
    if (dirty && !discardPrompt) { setDiscardPrompt(true); return }
    if (discardPrompt) return
    setModal(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || modal?.kind !== 'editor' || !supabase) return
    const message = validationError(draft)
    if (message) { setFormError(message); return }
    setBusy(true)
    setFormError('')
    let createdSubjectId: string | null = null
    try {
      let subjectId = draft.subjectId
      if (!subjectId) {
        const { data, error } = await supabase.from('schedule_subjects').insert({ user_id: studentId, subject_code: cleanText(draft.code), title: cleanText(draft.title), units: Number(draft.units), block_section: cleanText(draft.block) }).select('id').single()
        if (error) throw error
        subjectId = data.id
        createdSubjectId = data.id
      }
      const payload = { day_code: draft.day, starts_at: draft.start, ends_at: draft.end, room: cleanText(draft.room) || null }
      if (modal.meetingId) {
        const originalMeeting = meetings.find(meeting => meeting.id === modal.meetingId)
        const originalSubject = originalMeeting ? subjectById.get(originalMeeting.subject_id) : null
        if (!originalMeeting || !originalSubject) throw new Error('This meeting is no longer available. Refresh the page.')
        const subjectChanged = cleanText(draft.code) !== originalSubject.subject_code || cleanText(draft.title) !== originalSubject.title || Number(draft.units) !== Number(originalSubject.units) || cleanText(draft.block) !== originalSubject.block_section
        const { error: meetingError } = await supabase.from('schedule_meetings').update(payload).eq('id', modal.meetingId).eq('subject_id', subjectId).select('id').single()
        if (meetingError) throw meetingError
        if (subjectChanged) {
          const { error: subjectError } = await supabase.from('schedule_subjects').update({ subject_code: cleanText(draft.code), title: cleanText(draft.title), units: Number(draft.units), block_section: cleanText(draft.block) }).eq('id', subjectId).eq('user_id', studentId).select('id').single()
          if (subjectError) {
            const { error: rollbackError } = await supabase.from('schedule_meetings').update({ day_code: originalMeeting.day_code, starts_at: originalMeeting.starts_at, ends_at: originalMeeting.ends_at, room: originalMeeting.room }).eq('id', originalMeeting.id).select('id').single()
            if (rollbackError) throw new Error('The save was incomplete. Refresh your schedule before editing again.')
            throw subjectError
          }
        }
      } else {
        const { error } = await supabase.from('schedule_meetings').insert({ subject_id: subjectId, ...payload })
        if (error) throw error
      }
      setModal(null)
      try { await load() } catch { setPageError('Saved, but the schedule could not refresh. Use Try again to reload it.') }
    } catch (error) {
      if (createdSubjectId) {
        const { error: rollbackError } = await supabase.from('schedule_subjects').delete().eq('id', createdSubjectId).eq('user_id', studentId).select('id').single()
        if (rollbackError) setFormError('The meeting was not saved. Refresh the page to check whether its subject remains.')
        else setFormError(error instanceof Error ? error.message : 'Could not save the meeting.')
      } else setFormError(error instanceof Error ? error.message : 'Could not save the meeting.')
    } finally { setBusy(false) }
  }

  async function deleteMeeting() {
    if (busy || modal?.kind !== 'delete' || !supabase) return
    const meeting = meetings.find(item => item.id === modal.meetingId)
    if (!meeting) return
    setBusy(true)
    setFormError('')
    try {
      const { error } = await supabase.from('schedule_meetings').delete().eq('id', meeting.id).eq('subject_id', meeting.subject_id).select('id').single()
      if (error) throw error
      setModal(null)
      try { await load() } catch { setPageError('Deleted, but the schedule could not refresh. Use Try again to reload it.') }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not delete the meeting.')
    } finally { setBusy(false) }
  }

  return <div className="schedule-page">
    <header className="schedule-hero"><div><p className="workspace-overline">CALI WORKSPACE</p><h1>Schedules</h1><p>Keep your classes together in a weekly view.</p></div>{loading ? <span className="schedule-hero-count schedule-hero-count--loading cali-skeleton" role="status" aria-label="Loading meeting count" /> : <span className="schedule-hero-count">{meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'} this week</span>}</header>
    <div className="schedule-import-entry"><button type="button" className="button-primary" onClick={() => setImportOpen(true)} disabled={loading || importOpen}>Import registration form</button><span>Upload a form and review its classes before saving.</span></div>
    {importOpen && <ScheduleImport currentSubjectCount={subjects.length} onClose={() => setImportOpen(false)} onSaved={load} />}
    <div className="schedule-section-heading"><p className="workspace-overline">YOUR WEEK</p><h2>Weekly classes</h2><p>Select a class to see details. Use + on any day to add a meeting.</p></div>
    {pageError && <div className="schedule-error" role="alert"><p>{pageError}</p><button type="button" onClick={() => { setLoading(true); void load().catch(error => { setPageError(error instanceof Error ? error.message : 'Could not load your schedule.'); setLoading(false) }) }}>Try again</button></div>}
    {loading ? <div className="schedule-week-grid" role="status" aria-label="Loading weekly schedule">{days.map(day => <div className="schedule-day-card" key={day.code} aria-hidden="true"><div className="schedule-day-head"><h3>{day.name}</h3><span className="schedule-skeleton-add cali-skeleton" /></div><div className="schedule-day-body"><div className="schedule-skeleton-meeting"><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--short" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--long" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--medium" /></div></div></div>)}</div> : loaded && <div className="schedule-week-grid">{days.map(day => {
      const entries = meetingsByDay.get(day.code) ?? []
      return <section className="schedule-day-card" key={day.code} aria-labelledby={`schedule-${day.code}`}>
        <div className="schedule-day-head"><h3 id={`schedule-${day.code}`}>{day.name}</h3><button type="button" className="schedule-add" aria-label={`Add a meeting on ${day.name}`} title={`Add a meeting on ${day.name}`} onClick={() => openEditor(day.code)}>+</button></div>
        <div className={`schedule-day-body${entries.length ? '' : ' schedule-day-body--empty'}`}>{entries.length ? entries.map(meeting => {
          const subject = subjectById.get(meeting.subject_id)
          if (!subject) return null
          return <article className="schedule-item" key={meeting.id}>
            <button type="button" className="schedule-item-main" onClick={() => { setMenuId(null); setModal({ kind: 'details', meetingId: meeting.id }) }} aria-label={`View ${subject.subject_code} on ${day.name}`}><strong className="schedule-item-code">{subject.subject_code}</strong><span className="schedule-item-title">{subject.title}</span><span className="schedule-item-meta"><span className="schedule-item-meta-group"><small>TIME</small><span className="schedule-item-time">{clock(meeting.starts_at)} - {clock(meeting.ends_at)}</span></span><span className="schedule-item-meta-group schedule-item-room"><small>{meeting.room ? 'ROOM' : 'SECTION'}</small><span className="schedule-item-location">{meeting.room || subject.block_section}</span></span></span></button>
            <div className="schedule-item-menu"><button type="button" className="schedule-menu-trigger" aria-label={`More options for ${subject.subject_code} on ${day.name}`} aria-expanded={menuId === meeting.id} onClick={() => setMenuId(menuId === meeting.id ? null : meeting.id)}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg></button>{menuId === meeting.id && <div className="schedule-menu-panel"><button type="button" onClick={() => openEditor(meeting.day_code, meeting)}>Edit schedule</button><button type="button" className="schedule-menu-danger" onClick={() => { setMenuId(null); setFormError(''); setModal({ kind: 'delete', meetingId: meeting.id }) }}>Delete schedule</button></div>}</div>
          </article>
        }) : <div className="schedule-day-empty"><span className="schedule-day-empty-icon"><StatusIcon name={day.code === dayCodeByWeekday[now.getDay()] ? 'sun' : 'calendar'} /></span><span className="schedule-day-empty-label">{day.code === dayCodeByWeekday[now.getDay()] ? 'No classes today' : 'No classes'}</span>{day.code === dayCodeByWeekday[now.getDay()] && <span className="schedule-day-empty-note">Enjoy the break.</span>}</div>}</div>
      </section>
    })}</div>}
    {!loading && loaded && unscheduled.length > 0 && <section className="schedule-unscheduled"><div className="schedule-section-heading"><div><p className="workspace-overline">NO MEETING TIME</p><h2>Unscheduled subjects</h2></div><p>Use the plus button on the right day to add a meeting for one of these subjects.</p></div><div className="schedule-unscheduled-list">{unscheduled.map(subject => <div key={subject.id}><div><strong>{subject.subject_code}</strong><span>{subject.title}</span></div></div>)}</div></section>}

    <dialog ref={dialogRef} className={`schedule-dialog${modal?.kind === 'editor' && discardPrompt ? ' schedule-dialog--discard' : ''}`} aria-labelledby="schedule-dialog-title" onCancel={event => { event.preventDefault(); requestClose() }}>
      {modal?.kind === 'editor' && <form onSubmit={save}>
        {discardPrompt ? <div className="schedule-dialog-content schedule-discard-content"><p className="workspace-overline">UNSAVED CHANGES</p><h2 id="schedule-dialog-title">Discard your changes?</h2><p>Your edits to this meeting have not been saved.</p><div className="schedule-dialog-actions"><button type="button" className="schedule-secondary" onClick={() => setDiscardPrompt(false)}>Keep editing</button><button type="button" className="schedule-danger" onClick={() => { setDiscardPrompt(false); setModal(null) }}>Discard changes</button></div></div> : <div className="schedule-dialog-content"><div className="schedule-dialog-head"><div><p className="workspace-overline">{modal.meetingId ? 'EDIT MEETING' : 'NEW MEETING'}</p><h2 id="schedule-dialog-title">{modal.meetingId ? 'Edit' : 'Add'} {days.find(day => day.code === draft.day)?.name} Schedule</h2></div><button type="button" aria-label="Close" className="schedule-close" onClick={requestClose}><CloseIcon /></button></div>
          {!modal.meetingId && <label className="schedule-field">Subject<select value={draft.subjectId} onChange={event => { const subject = subjectById.get(event.target.value); setDraft(previous => ({ ...previous, subjectId: event.target.value, code: subject?.subject_code ?? '', title: subject?.title ?? '', units: subject ? String(subject.units) : '', block: subject?.block_section ?? '' })) }}><option value="">New subject</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} - {subject.title}</option>)}</select></label>}
          <section className="schedule-form-section" aria-labelledby="subject-fields-title">
            <div className="schedule-form-section-head"><h3 id="subject-fields-title">Subject details</h3>{Boolean(draft.subjectId && !modal.meetingId) && <span>Using saved subject</span>}</div>
            <div className="schedule-form-grid">
              <label className="schedule-field">Subject code<input value={draft.code} maxLength={40} disabled={Boolean(draft.subjectId && !modal.meetingId)} onChange={event => setDraft(previous => ({ ...previous, code: event.target.value }))} required /></label>
              <label className="schedule-field">Units<input inputMode="decimal" value={draft.units} disabled={Boolean(draft.subjectId && !modal.meetingId)} onChange={event => setDraft(previous => ({ ...previous, units: sanitizeUnits(event.target.value) }))} required /></label>
              <label className="schedule-field schedule-field-wide">Subject title<input value={draft.title} maxLength={200} disabled={Boolean(draft.subjectId && !modal.meetingId)} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} required /></label>
            </div>
          </section>
          <section className="schedule-form-section" aria-labelledby="meeting-fields-title">
            <div className="schedule-form-section-head"><h3 id="meeting-fields-title">Meeting details</h3><span>{days.find(day => day.code === draft.day)?.name}</span></div>
            <div className="schedule-form-grid">
              <TimePicker label="Start time" value={draft.start} onChange={value => setDraft(previous => ({ ...previous, start: value }))} />
              <TimePicker label="End time" value={draft.end} onChange={value => setDraft(previous => ({ ...previous, end: value }))} />
              {duration(draft.start, draft.end) && <p className="schedule-duration">Duration <strong>{duration(draft.start, draft.end)}</strong></p>}
              <label className="schedule-field schedule-field-wide">Room (optional)<input value={draft.room} maxLength={120} onChange={event => setDraft(previous => ({ ...previous, room: event.target.value }))} /></label>
              <label className="schedule-field schedule-field-wide">Block / section<input value={draft.block} maxLength={80} disabled={Boolean(draft.subjectId && !modal.meetingId)} onChange={event => setDraft(previous => ({ ...previous, block: event.target.value }))} required /></label>
            </div>
          </section>
          {modal.meetingId && <p className="schedule-form-note">Changing subject details also updates its meetings on other days.</p>}
          {formError && <p className="schedule-error" role="alert">{formError}</p>}
          <div className="schedule-dialog-actions"><button type="button" className="schedule-secondary" onClick={requestClose} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save schedule'}</button></div>
        </div>}
      </form>}
      {modal?.kind === 'details' && selectedMeeting && selectedSubject && <div className="schedule-dialog-content">
        <div className="schedule-dialog-head schedule-detail-head">
          <div><p className="workspace-overline">MEETING DETAILS</p><h2 id="schedule-dialog-title">{selectedSubject.subject_code}</h2></div>
          <button type="button" aria-label="Close" className="schedule-close" onClick={requestClose}><CloseIcon /></button>
        </div>
        <p className="schedule-detail-title">{selectedSubject.title}</p>
        <div className="schedule-detail-when"><span>{days.find(day => day.code === selectedMeeting.day_code)?.name}</span><strong>{clock(selectedMeeting.starts_at)} - {clock(selectedMeeting.ends_at)}</strong></div>
        <dl className="schedule-detail-list">
          <div><dt>Room</dt><dd>{selectedMeeting.room || 'Not set'}</dd></div>
          <div><dt>Block / section</dt><dd>{selectedSubject.block_section}</dd></div>
          <div><dt>Units</dt><dd>{selectedSubject.units}</dd></div>
        </dl>
      </div>}
      {modal?.kind === 'delete' && selectedMeeting && selectedSubject && <div className="schedule-dialog-content"><p className="workspace-overline">DELETE MEETING</p><h2 id="schedule-dialog-title">Delete this schedule?</h2><p className="schedule-delete-copy">Remove {selectedSubject.subject_code} on {days.find(day => day.code === selectedMeeting.day_code)?.name}, {clock(selectedMeeting.starts_at)} - {clock(selectedMeeting.ends_at)}? Other meetings for this subject will stay saved.</p>{formError && <p className="schedule-error" role="alert">{formError}</p>}<div className="schedule-dialog-actions"><button type="button" className="schedule-secondary" onClick={requestClose} disabled={busy}>Keep schedule</button><button type="button" className="schedule-danger" onClick={() => { void deleteMeeting() }} disabled={busy}>{busy ? 'Deleting...' : 'Delete meeting'}</button></div></div>}
    </dialog>
  </div>
}

