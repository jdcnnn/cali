import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { getImportedScheduleIssues, parseRtuSchedule } from '../lib/rtuScheduleParser'
import type { ImportedMeetingDraft, ImportedScheduleDraft, ImportedSubjectDraft, ScheduleDayCode } from '../lib/rtuScheduleParser'
import { runScheduleOcr } from '../lib/scheduleOcr'
import './schedule-scan.css'

const days: { code: ScheduleDayCode; name: string }[] = [
  { code: 'M', name: 'Monday' }, { code: 'T', name: 'Tuesday' }, { code: 'W', name: 'Wednesday' },
  { code: 'H', name: 'Thursday' }, { code: 'F', name: 'Friday' }, { code: 'S', name: 'Saturday' },
  { code: 'U', name: 'Sunday' },
]

type Stage = 'select' | 'processing' | 'review' | 'saving'
type PendingRemoval =
  | { kind: 'subject'; subjectId: string; label: string }
  | { kind: 'meeting'; subjectId: string; meetingId: string; label: string }

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function subjectNeedsAttention(subject: ImportedSubjectDraft) {
  return !clean(subject.subjectCode) || !clean(subject.title) || !clean(subject.blockSection) || !/^\d+(?:\.\d)?$/.test(subject.units)
}

function meetingNeedsAttention(meeting: ImportedMeetingDraft) {
  return !/^\d{2}:\d{2}$/.test(meeting.startsAt) || !/^\d{2}:\d{2}$/.test(meeting.endsAt) || meeting.startsAt >= meeting.endsAt
}

export function ScheduleScanner({ currentSubjectCount, onSaved }: { currentSubjectCount: number; onSaved: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const validationRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('select')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [schedule, setSchedule] = useState<ImportedScheduleDraft | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  const validationIssues = useMemo(() => schedule ? getImportedScheduleIssues(schedule.subjects) : [], [schedule])
  const validationErrors = validationIssues.map(issue => issue.message)
  const reviewNotes = useMemo(() => {
    if (!schedule) return []
    const subjectCodes = [...new Set(schedule.warnings
      .map(warning => schedule.subjects.find(subject => subject.id === warning.subjectId)?.subjectCode)
      .filter((code): code is string => Boolean(code)))]
    const notes: string[] = []
    if (subjectCodes.length) notes.push(`Check ${subjectCodes.join(', ')} against your form.`)
    const unitsWarning = schedule.warnings.find(warning => warning.message.startsWith('The form states'))
    if (unitsWarning) notes.push(unitsWarning.message)
    if (schedule.warnings.some(warning => !warning.subjectId && warning !== unitsWarning)) notes.push('Check the subject and meeting counts.')
    return notes
  }, [schedule])
  const busy = stage === 'processing' || stage === 'saving'

  function goToIssue(targetId: string) {
    const target = document.getElementById(targetId)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => target.focus({ preventScroll: true }), 350)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setFile(null)
    setSchedule(null)
    setStage('select')
    setStatus('')
    setError('')
    setConfirming(false)
    setPendingRemoval(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function closeScanner() {
    if (busy) return
    setOpen(false)
    reset()
  }

  function chooseFile(nextFile: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : '')
    setFile(nextFile)
    setSchedule(null)
    setError('')
    setConfirming(false)
  }

  async function scan() {
    if (!file || busy) return
    setStage('processing')
    setError('')
    setStatus('Preparing the image…')
    try {
      const result = await runScheduleOcr(file, setStatus)
      setStatus('Building your editable schedule…')
      const parsed = parseRtuSchedule(result.lines, result.image)
      setSchedule(parsed)
      setStage('review')
      setStatus(`Scanned on this device in ${Math.max(1, Math.round(result.elapsedMs / 1000))} seconds.`)
    } catch (caught) {
      setStage('select')
      setError(caught instanceof Error ? caught.message : 'The schedule could not be read. Try a clearer image or add it manually.')
      setStatus('')
    }
  }

  function updateSubject(subjectId: string, patch: Partial<ImportedSubjectDraft>) {
    setSchedule(previous => previous ? {
      ...previous,
      warnings: previous.warnings.filter(warning => warning.subjectId !== subjectId),
      subjects: previous.subjects.map(subject => subject.id === subjectId ? { ...subject, ...patch, confidence: 1 } : subject),
    } : previous)
  }

  function updateMeeting(subjectId: string, meetingId: string, patch: Partial<ImportedMeetingDraft>) {
    setSchedule(previous => previous ? {
      ...previous,
      warnings: previous.warnings.filter(warning => warning.subjectId !== subjectId && warning.meetingId !== meetingId),
      subjects: previous.subjects.map(subject => subject.id === subjectId
        ? { ...subject, meetings: subject.meetings.map(meeting => meeting.id === meetingId ? { ...meeting, ...patch, confidence: 1 } : meeting) }
        : subject),
    } : previous)
  }

  function addMeeting(subjectId: string) {
    const meeting: ImportedMeetingDraft = { id: newId('meeting'), dayCode: 'M', startsAt: '09:00', endsAt: '10:00', room: '', confidence: 1 }
    setSchedule(previous => previous ? {
      ...previous,
      subjects: previous.subjects.map(subject => subject.id === subjectId ? { ...subject, meetings: [...subject.meetings, meeting] } : subject),
    } : previous)
  }

  function confirmRemoval() {
    if (!pendingRemoval) return
    if (pendingRemoval.kind === 'subject') {
      setSchedule(previous => previous ? {
        ...previous,
        warnings: previous.warnings.filter(warning => warning.subjectId !== pendingRemoval.subjectId),
        subjects: previous.subjects.filter(subject => subject.id !== pendingRemoval.subjectId),
      } : previous)
    } else {
      setSchedule(previous => previous ? {
        ...previous,
        warnings: previous.warnings.filter(warning => warning.subjectId !== pendingRemoval.subjectId && warning.meetingId !== pendingRemoval.meetingId),
        subjects: previous.subjects.map(subject => subject.id === pendingRemoval.subjectId ? { ...subject, meetings: subject.meetings.filter(meeting => meeting.id !== pendingRemoval.meetingId) } : subject),
      } : previous)
    }
    setPendingRemoval(null)
  }

  async function replaceSchedule() {
    if (!schedule || validationErrors.length || !supabase || stage === 'saving') return
    setStage('saving')
    setError('')
    const payload = schedule.subjects.map(subject => ({
      subject_code: clean(subject.subjectCode),
      title: clean(subject.title),
      units: Number(subject.units),
      block_section: clean(subject.blockSection),
      meetings: subject.meetings.map(meeting => ({
        day_code: meeting.dayCode,
        starts_at: meeting.startsAt,
        ends_at: meeting.endsAt,
        room: clean(meeting.room) || null,
      })),
    }))
    const { error: saveError } = await supabase.rpc('replace_own_schedule', { p_subjects: payload })
    if (saveError) {
      setStage('review')
      setConfirming(false)
      setError(saveError.message || 'The schedule could not be replaced.')
      return
    }
    try {
      await onSaved()
      setOpen(false)
      reset()
    } catch {
      setStage('review')
      setConfirming(false)
      setError('The schedule was replaced, but the page could not refresh. Close this window and use Try again.')
    }
  }

  return <>
    <button type="button" className="schedule-scan-trigger" onClick={() => { reset(); setOpen(true) }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10M7 15h7" /></svg>
      Scan form
    </button>
    <dialog ref={dialogRef} className="schedule-scan-dialog" aria-labelledby="schedule-scan-title" onCancel={event => { event.preventDefault(); if (pendingRemoval) setPendingRemoval(null); else closeScanner() }}>
      <div className="schedule-scan-head">
        <div><p className="workspace-overline">SCHEDULE IMPORT</p><h2 id="schedule-scan-title">{stage === 'review' || stage === 'saving' ? 'Check the scanned schedule' : stage === 'processing' ? 'Reading your form' : 'Upload registration form'}</h2></div>
        <button type="button" className="schedule-close" aria-label="Close schedule scanner" onClick={closeScanner} disabled={busy}><CloseIcon /></button>
      </div>

      <ol className="schedule-scan-steps" aria-label="Schedule import progress">
        <li className={stage === 'select' || stage === 'processing' ? 'is-active' : 'is-complete'}><span>1</span>Choose image</li>
        <li className={stage === 'review' && !confirming ? 'is-active' : stage === 'saving' || confirming ? 'is-complete' : ''}><span>2</span>Check details</li>
        <li className={stage === 'saving' || confirming ? 'is-active' : ''}><span>3</span>Save schedule</li>
      </ol>

      {stage === 'select' && <div className="schedule-scan-body">
        <p className="schedule-scan-intro">Add a clear photo or scan of your RTU registration form. Cali reads the class table and lets you correct every field before saving.</p>
        <div className="schedule-scan-privacy"><span aria-hidden="true">✓</span><div><strong>Private and free</strong><p>The image stays on this device. It is never uploaded or stored.</p></div></div>
        <input ref={inputRef} className="schedule-scan-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} />
        <button type="button" className={`schedule-scan-picker${previewUrl ? ' schedule-scan-picker--selected' : ''}`} onClick={() => inputRef.current?.click()}>
          {previewUrl ? <><img src={previewUrl} alt="Selected registration form preview" /><span className="schedule-scan-change">Choose a different image</span></> : <span className="schedule-scan-picker-empty"><span className="schedule-scan-picker-icon" aria-hidden="true">＋</span><strong>Choose a registration form image</strong><small>JPG, PNG, or WebP · up to 12 MB</small></span>}
        </button>
        {file && <div className="schedule-scan-file"><span><strong>Ready to scan:</strong> {file.name}</span><button type="button" onClick={() => chooseFile(null)}>Remove</button></div>}
        <p className="schedule-scan-tip"><strong>For the best result:</strong> show the full page, use even lighting, and keep the class table straight and readable.</p>
        {error && <p className="schedule-scan-error" role="alert">{error}</p>}
        <div className="schedule-scan-actions"><button type="button" className="schedule-secondary" onClick={closeScanner}>Cancel</button><button type="button" className="schedule-scan-primary" disabled={!file} onClick={() => { void scan() }}>Scan schedule</button></div>
      </div>}

      {stage === 'processing' && <div className="schedule-scan-processing" role="status" aria-live="polite">
        <span className="schedule-scan-spinner" aria-hidden="true" />
        <strong>{status}</strong>
        <p>The first scan can take about a minute. Keep this window open.</p>
        <span className="schedule-scan-processing-note">Your image remains on this device.</span>
      </div>}

      {(stage === 'review' || stage === 'saving') && schedule && <div className="schedule-scan-review">
        <div className="schedule-scan-summary">
          <div><strong>{schedule.subjects.length}</strong><span>subjects</span></div>
          <div><strong>{schedule.subjects.reduce((sum, subject) => sum + subject.meetings.length, 0)}</strong><span>meetings</span></div>
          <div><strong>{schedule.subjects.reduce((sum, subject) => sum + (Number(subject.units) || 0), 0)}</strong><span>units</span></div>
        </div>
        <p className="schedule-scan-local-note"><strong>Scan complete.</strong> Check the details below against your form, especially the yellow cards.</p>
        {(reviewNotes.length > 0 || validationErrors.length > 0) && <div ref={validationRef} className="schedule-review-status" tabIndex={-1}>
          <div className="schedule-review-status-head">
            <div><strong>Review status</strong><p>Complete these steps, then save your schedule.</p></div>
            <span className={validationErrors.length ? 'is-required' : ''}>{validationErrors.length ? `${validationErrors.length} to add` : 'Check details'}</span>
          </div>
          {reviewNotes.length > 0 && <div className="schedule-review-task schedule-review-task--check" role="status">
            <span className="schedule-review-task-icon" aria-hidden="true">!</span>
            <div><strong>Check against your form</strong><ul>{reviewNotes.map(note => <li key={note}>{note}</li>)}</ul></div>
          </div>}
          {validationErrors.length > 0 && <div className="schedule-review-task schedule-review-task--required" role="alert">
            <span className="schedule-review-task-icon" aria-hidden="true">+</span>
            <div><strong>{validationIssues.length} {validationIssues.length === 1 ? 'detail' : 'details'} to add</strong><ul>{validationIssues.map(issue => <li key={issue.id}><button type="button" onClick={() => goToIssue(issue.targetId)}>{issue.message}<span aria-hidden="true">Go to field →</span></button></li>)}</ul></div>
          </div>}
        </div>}
        {error && <p className="schedule-scan-error" role="alert">{error}</p>}

        <div id="schedule-scan-subjects" className="schedule-scan-subjects" tabIndex={-1}>{schedule.subjects.map((subject, subjectIndex) => <article id={`schedule-scan-subject-${subject.id}`} tabIndex={-1} className={`schedule-scan-subject${subject.confidence < 0.85 ? ' schedule-scan-subject--check' : ''}${subjectNeedsAttention(subject) ? ' schedule-scan-subject--invalid' : ''}`} key={subject.id}>
          <div className="schedule-scan-subject-head"><div><span>Subject {subjectIndex + 1}</span><strong>{subject.subjectCode || 'Missing code'}</strong></div><button type="button" onClick={() => setPendingRemoval({ kind: 'subject', subjectId: subject.id, label: subject.subjectCode || `Subject ${subjectIndex + 1}` })} disabled={busy}>Remove subject</button></div>
          <div className="schedule-scan-fields">
            <label>Subject code<input id={`schedule-scan-subject-${subject.id}-code`} value={subject.subjectCode} maxLength={40} placeholder="Add subject code" aria-invalid={!clean(subject.subjectCode)} onChange={event => updateSubject(subject.id, { subjectCode: event.target.value.toUpperCase() })} disabled={busy} /></label>
            <label>Units<input id={`schedule-scan-subject-${subject.id}-units`} value={subject.units} inputMode="decimal" placeholder="Add units" aria-invalid={!/^\d+(?:\.\d)?$/.test(subject.units)} onChange={event => updateSubject(subject.id, { units: event.target.value.replace(/[^\d.]/g, '').slice(0, 4) })} disabled={busy} /></label>
            <label className="schedule-scan-wide">Subject title<input id={`schedule-scan-subject-${subject.id}-title`} value={subject.title} maxLength={200} placeholder="Add subject title" aria-invalid={!clean(subject.title)} onChange={event => updateSubject(subject.id, { title: event.target.value })} disabled={busy} /></label>
            <label className="schedule-scan-wide">Block / section<input id={`schedule-scan-subject-${subject.id}-section`} value={subject.blockSection} maxLength={80} placeholder="Add block section" aria-invalid={!clean(subject.blockSection)} onChange={event => updateSubject(subject.id, { blockSection: event.target.value.toUpperCase() })} disabled={busy} /></label>
          </div>
          <div className="schedule-scan-meetings-head"><strong>Meetings</strong><button type="button" onClick={() => addMeeting(subject.id)} disabled={busy}>+ Add meeting</button></div>
          {subject.meetings.length === 0 ? <p className="schedule-scan-unscheduled">No class time was found. Add a meeting if the subject has one; otherwise it will be saved as unscheduled.</p> : <div className="schedule-scan-meetings">{subject.meetings.map(meeting => <div id={`schedule-scan-subject-${subject.id}-meeting-${meeting.id}`} tabIndex={-1} className={`schedule-scan-meeting${meeting.confidence < 0.85 ? ' schedule-scan-meeting--check' : ''}${meetingNeedsAttention(meeting) ? ' schedule-scan-meeting--invalid' : ''}`} key={meeting.id}>
            <label>Day<select id={`schedule-scan-subject-${subject.id}-meeting-${meeting.id}-day`} value={meeting.dayCode} onChange={event => updateMeeting(subject.id, meeting.id, { dayCode: event.target.value as ScheduleDayCode })} disabled={busy}>{days.map(day => <option value={day.code} key={day.code}>{day.name}</option>)}</select></label>
            <label>Starts<input id={`schedule-scan-subject-${subject.id}-meeting-${meeting.id}-starts`} type="time" value={meeting.startsAt} aria-invalid={!/^\d{2}:\d{2}$/.test(meeting.startsAt) || meeting.startsAt >= meeting.endsAt} onChange={event => updateMeeting(subject.id, meeting.id, { startsAt: event.target.value })} disabled={busy} /></label>
            <label>Ends<input id={`schedule-scan-subject-${subject.id}-meeting-${meeting.id}-ends`} type="time" value={meeting.endsAt} aria-invalid={!/^\d{2}:\d{2}$/.test(meeting.endsAt) || meeting.startsAt >= meeting.endsAt} onChange={event => updateMeeting(subject.id, meeting.id, { endsAt: event.target.value })} disabled={busy} /></label>
            <label>Room<input id={`schedule-scan-subject-${subject.id}-meeting-${meeting.id}-room`} value={meeting.room} maxLength={120} placeholder="Optional" onChange={event => updateMeeting(subject.id, meeting.id, { room: event.target.value.toUpperCase() })} disabled={busy} /></label>
            <button type="button" aria-label={`Remove meeting from ${subject.subjectCode}`} onClick={() => setPendingRemoval({ kind: 'meeting', subjectId: subject.id, meetingId: meeting.id, label: subject.subjectCode || `Subject ${subjectIndex + 1}` })} disabled={busy}>Remove</button>
          </div>)}</div>}
        </article>)}</div>

        {confirming && <div className="schedule-scan-confirm" role="alert"><strong>{currentSubjectCount ? 'Replace your saved schedule?' : 'Save this schedule?'}</strong><p>{currentSubjectCount ? `CALI will remove your ${currentSubjectCount} saved ${currentSubjectCount === 1 ? 'subject' : 'subjects'} and replace them with the reviewed details above.` : 'CALI will add the reviewed subjects and meetings to your schedule.'}</p><div><button type="button" className="schedule-secondary" onClick={() => setConfirming(false)} disabled={busy}>Go back</button><button type="button" className="schedule-danger" onClick={() => { void replaceSchedule() }} disabled={busy}>{stage === 'saving' ? 'Saving…' : currentSubjectCount ? 'Replace schedule' : 'Save schedule'}</button></div></div>}
        <div className="schedule-scan-review-actions">
          {validationErrors.length > 0 && <button type="button" className="schedule-scan-issues-link" onClick={() => { validationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); validationRef.current?.focus({ preventScroll: true }) }} disabled={busy}>View {validationErrors.length} missing {validationErrors.length === 1 ? 'detail' : 'details'}</button>}
          <button type="button" className="schedule-secondary" onClick={() => { setStage('select'); setSchedule(null); setConfirming(false); setError('') }} disabled={busy}>Start over</button><button type="button" className="schedule-scan-primary" onClick={() => setConfirming(true)} disabled={busy || validationErrors.length > 0}>{currentSubjectCount ? 'Continue to replace' : 'Continue to save'}</button>
        </div>
      </div>}

      {pendingRemoval && <div className="schedule-remove-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPendingRemoval(null) }}>
        <div className="schedule-remove-dialog" role="alertdialog" aria-modal="true" aria-labelledby="schedule-remove-title" aria-describedby="schedule-remove-description">
          <span className="schedule-remove-icon" aria-hidden="true">−</span>
          <h3 id="schedule-remove-title">{pendingRemoval.kind === 'subject' ? `Remove ${pendingRemoval.label}?` : 'Remove this meeting?'}</h3>
          <p id="schedule-remove-description">{pendingRemoval.kind === 'subject' ? 'This subject and all of its meetings will be removed from the scanned schedule.' : `This meeting will be removed from ${pendingRemoval.label}.`}</p>
          <div><button type="button" className="schedule-secondary" autoFocus onClick={() => setPendingRemoval(null)}>Keep it</button><button type="button" className="schedule-danger" onClick={confirmRemoval}>{pendingRemoval.kind === 'subject' ? 'Remove subject' : 'Remove meeting'}</button></div>
        </div>
      </div>}
    </dialog>
  </>
}
