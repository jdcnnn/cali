import { useCallback, useEffect, useRef, useState } from 'react'
import { runOCR, type OcrUpdate } from '../lib/ocr'
import { parseScheduleFromOCR, type ParsedMeeting } from '../lib/parseSchedule'
import { importParsedSchedule, type ImportProgress } from '../lib/scheduleImport'
import { validateMeetings } from '../lib/scheduleValidation'
import { supabase } from '../lib/supabase'
import './schedule-import.css'

type Step = 'choose' | 'reading' | 'organizing' | 'review' | 'saving' | 'done' | 'error'
const days: Record<string, string> = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', H: 'Thursday', F: 'Friday', S: 'Saturday', U: 'Sunday' }

function clock(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 'Check time'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

function readingDetail(status: string | undefined) {
  switch (status) {
    case 'loading tesseract core': return 'Opening the image reader'
    case 'initializing tesseract': return 'Getting the image reader ready'
    case 'loading language traineddata': return 'Getting ready to read words'
    case 'initializing api': return 'Finishing image setup'
    case 'recognizing text': return 'Reading text in the image'
    default: return 'Opening the image'
  }
}

function needsAttention(meeting: ParsedMeeting) {
  try { validateMeetings([meeting]); return false } catch { return true }
}

export function ScheduleParser({ initialFile, canUseCamera, onClose, onDone }: { initialFile: File | null; canUseCamera: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>(initialFile ? 'reading' : 'choose')
  const [file, setFile] = useState<File | null>(initialFile)
  const [ocrUpdate, setOcrUpdate] = useState<OcrUpdate | null>(null)
  const [parseElapsed, setParseElapsed] = useState(0)
  const [saveProgress, setSaveProgress] = useState<ImportProgress | null>(null)
  const [meetings, setMeetings] = useState<ParsedMeeting[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [errorStage, setErrorStage] = useState<'image' | 'classes'>('image')
  const [result, setResult] = useState({ imported: 0, skipped: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const startedRef = useRef(false)
  const runRef = useRef(0)
  const parseStartedAt = useRef(0)

  useEffect(() => {
    if (step !== 'organizing') return
    const timer = window.setInterval(() => setParseElapsed(Math.floor((Date.now() - parseStartedAt.current) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [step])

  const readFile = useCallback(async (nextFile: File) => {
    const run = ++runRef.current
    let stage: 'image' | 'classes' = 'image'
    setError('')
    setOcrUpdate(null)
    setMeetings([])
    setEditingIndex(null)
    setFile(nextFile)
    try {
      if (!nextFile.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(nextFile.name)) throw new Error('Choose a photo or image of your registration form.')
      if (nextFile.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.')
      setStep('reading')
      const text = await runOCR(nextFile, (update) => { if (run === runRef.current) setOcrUpdate(update) })
      if (run !== runRef.current) return
      if (!text.trim()) throw new Error('We could not find text in that image. Try a brighter, sharper photo.')
      parseStartedAt.current = Date.now()
      setParseElapsed(0)
      setStep('organizing')
      stage = 'classes'
      const parsed = await parseScheduleFromOCR(text)
      if (run !== runRef.current) return
      setMeetings(parsed)
      setStep('review')
    } catch (reason) {
      if (run !== runRef.current) return
      setErrorStage(stage)
      setError(reason instanceof Error ? reason.message : 'We could not read that form.')
      setStep('error')
    }
  }, [])

  useEffect(() => {
    if (initialFile && !startedRef.current) {
      startedRef.current = true
      void readFile(initialFile)
    }
  }, [initialFile, readFile])

  function chooseFile() { inputRef.current?.click() }
  function takePhoto() { cameraRef.current?.click() }
  function updateRow(index: number, changes: Partial<ParsedMeeting>) {
    setMeetings((previous) => previous.map((row, i) => i === index ? { ...row, ...changes } : row))
    setError('')
  }
  function addMeeting() {
    setMeetings((previous) => [{ subject_code: '', title: '', units: Number.NaN, block_section: '', day_code: '', starts_at: '', ends_at: '', room: '' }, ...previous])
    setEditingIndex(0)
    setError('')
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#schedule-import-row-0 input')?.focus())
  }

  async function save() {
    try {
      setError('')
      const reviewed = validateMeetings(meetings)
      if (!supabase) throw new Error('Your account is unavailable. Please sign in again.')
      setSaveProgress({ processed: 0, total: reviewed.length, imported: 0, skipped: 0 })
      setStep('saving')
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Please sign in again to save your classes.')
      const saved = await importParsedSchedule(user.id, reviewed, setSaveProgress)
      setResult(saved)
      setStep('done')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'We could not save your classes.'
      setError(message)
      const rowNumber = /^Meeting (\d+)/.exec(message)
      if (rowNumber) {
        const index = Number(rowNumber[1]) - 1
        setEditingIndex(index)
        requestAnimationFrame(() => document.getElementById(`schedule-import-row-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
      }
      setStep('review')
    }
  }

  const working = step === 'reading' || step === 'organizing' || step === 'saving'
  const current = step === 'choose' || step === 'error' ? 1 : step === 'review' ? 2 : step === 'done' ? 3 : step === 'saving' ? 3 : 1

  return <section className="schedule-import" aria-labelledby="schedule-import-title" aria-busy={working}>
    <input ref={inputRef} type="file" accept="image/*" className="schedule-parser-hidden" aria-label="Choose a registration form image" onChange={(event) => {
      const next = event.target.files?.[0]
      event.target.value = ''
      if (next) void readFile(next)
    }} />
    {canUseCamera && <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="schedule-parser-hidden" aria-label="Take a photo of the registration form" onChange={(event) => {
      const next = event.target.files?.[0]
      event.target.value = ''
      if (next) void readFile(next)
    }} />}
    <div className="schedule-import-head">
      <div>
        <p className="workspace-overline">IMPORT FROM FORM</p>
        <h2 id="schedule-import-title">Add classes from your registration form</h2>
        <p>Choose a clear photo or screenshot. Check every class before adding it to your week.</p>
      </div>
      <div className="schedule-import-head-actions">
        {file && <div className="schedule-import-file"><span className="schedule-import-file-icon" aria-hidden="true">▧</span><span title={file.name}>{file.name}</span></div>}
        <button type="button" className="schedule-import-close" onClick={onClose} disabled={step === 'saving'} aria-label="Close form import">×</button>
      </div>
    </div>
    <ol className="schedule-import-steps" aria-label="Import steps">
      {['Choose form', 'Review classes', 'Add to week'].map((label, index) => <li key={label} className={index + 1 === current ? 'is-current' : index + 1 < current ? 'is-complete' : ''} aria-current={index + 1 === current ? 'step' : undefined}><span>{index + 1 < current ? '✓' : index + 1}</span>{label}</li>)}
    </ol>

    {step === 'choose' && <div className="schedule-import-prompt">
      <div className="schedule-import-icon" aria-hidden="true">▧</div>
      <h3>Choose your form</h3>
      <p>Make sure the subject names, days, times, and rooms are readable. A cropped image of the schedule table works well.</p>
      <div className="schedule-import-actions">{canUseCamera && <button type="button" className="button-primary" onClick={takePhoto}>Take photo</button>}<button type="button" className={canUseCamera ? 'schedule-secondary' : 'button-primary'} onClick={chooseFile}>Upload image</button></div>
      <small>Photo or screenshot · Up to 12 MB</small>
    </div>}

    {working && <div className="schedule-import-progress" role="status" aria-live="polite">
      <div className="schedule-import-progress-icon" aria-hidden="true"><span /></div>
      <h3>{step === 'reading' ? 'Reading your form' : step === 'organizing' ? 'Finding your classes' : 'Adding classes to your week'}</h3>
      <p>{step === 'reading' ? readingDetail(ocrUpdate?.status) : step === 'organizing' ? 'Checking the class details in your form' : `${saveProgress?.processed ?? 0} of ${saveProgress?.total ?? meetings.length} meetings checked`}</p>
      {step === 'reading' && ocrUpdate?.percent != null && <div className="schedule-import-meter" role="progressbar" aria-label="Reading text in the image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ocrUpdate.percent}><span style={{ width: `${ocrUpdate.percent}%` }} /></div>}
      {step === 'saving' && saveProgress && <div className="schedule-import-meter" role="progressbar" aria-label="Meetings checked" aria-valuemin={0} aria-valuemax={saveProgress.total} aria-valuenow={saveProgress.processed}><span style={{ width: `${saveProgress.total ? saveProgress.processed / saveProgress.total * 100 : 0}%` }} /></div>}
      <small>{step === 'reading' ? ocrUpdate?.percent != null ? `Image reading ${ocrUpdate.percent}%` : 'Preparing' : step === 'organizing' ? `${parseElapsed}s elapsed` : `${saveProgress?.imported ?? 0} added · ${saveProgress?.skipped ?? 0} already saved`}</small>
    </div>}

    {step === 'error' && <div className="schedule-import-message schedule-import-error" role="alert"><span className="schedule-import-message-icon" aria-hidden="true">!</span><h3>{errorStage === 'image' ? 'We could not read this image' : 'We could not find your classes'}</h3><p>{error}</p><div className="schedule-import-actions">{canUseCamera && <button type="button" className="button-primary" onClick={takePhoto}>Take another photo</button>}<button type="button" className={canUseCamera ? 'schedule-secondary' : 'button-primary'} onClick={chooseFile}>Upload another image</button></div><button type="button" className="schedule-import-text-action" onClick={onDone}>Add classes manually</button></div>}

    {step === 'review' && <div className="schedule-import-review">
      <div className="schedule-import-review-head"><div><p className="workspace-overline">CHECK YOUR CLASSES</p><h3>{meetings.length} meeting{meetings.length === 1 ? '' : 's'} to review</h3><p>Compare every detail with your form. Edit, add, or delete meetings before saving.</p></div><button type="button" className="schedule-secondary schedule-import-add" onClick={addMeeting}>+ Add missing meeting</button></div>
      <div className="schedule-import-review-replace"><span>Wrong image?</span>{canUseCamera && <button type="button" onClick={takePhoto}>Take another photo</button>}<button type="button" onClick={chooseFile}>Upload another image</button></div>
      <div className="schedule-import-list">{meetings.map((meeting, index) => <article key={index} id={`schedule-import-row-${index}`} className="schedule-import-row">
        <div className="schedule-import-row-main"><span className="schedule-import-row-number">{index + 1}</span><div><strong>{meeting.subject_code || 'Subject code needed'}</strong>{needsAttention(meeting) && <span className="schedule-import-attention">Needs attention</span>}<p>{meeting.title || 'Subject name needed'}</p><small>{days[meeting.day_code] ?? 'Choose day'} · {clock(meeting.starts_at)}–{clock(meeting.ends_at)}{meeting.room ? ` · ${meeting.room}` : ''}</small><div className="schedule-import-row-details"><span>{meeting.block_section || 'Section needed'}</span><span>{Number.isFinite(meeting.units) ? `${meeting.units} unit${meeting.units === 1 ? '' : 's'}` : 'Units needed'}</span></div></div></div>
        <div className="schedule-import-row-actions"><button type="button" className="schedule-secondary" aria-expanded={editingIndex === index} onClick={() => setEditingIndex(editingIndex === index ? null : index)}>{editingIndex === index ? 'Done editing' : 'Edit'}</button><button type="button" className="schedule-import-remove" onClick={() => { setMeetings((previous) => previous.filter((_, i) => i !== index)); setEditingIndex(null); setError('') }} aria-label={`Delete ${meeting.subject_code || `meeting ${index + 1}`}`}>Delete</button></div>
        {editingIndex === index && <div className="schedule-import-edit">
          <label>Subject code<input value={meeting.subject_code} maxLength={40} onChange={(e) => updateRow(index, { subject_code: e.target.value })} /></label>
          <label>Subject name<input value={meeting.title} maxLength={200} onChange={(e) => updateRow(index, { title: e.target.value })} /></label>
          <label>Units<input type="number" min="0" max="30" step="0.1" value={Number.isFinite(meeting.units) ? meeting.units : ''} onChange={(e) => updateRow(index, { units: e.target.value === '' ? Number.NaN : Number(e.target.value) })} /></label>
          <label>Block / section<input value={meeting.block_section} maxLength={80} onChange={(e) => updateRow(index, { block_section: e.target.value })} /></label>
          <label>Day<select value={meeting.day_code} onChange={(e) => updateRow(index, { day_code: e.target.value })}><option value="">Choose day</option>{Object.entries(days).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label>Start time<input type="time" value={meeting.starts_at} onChange={(e) => updateRow(index, { starts_at: e.target.value })} /></label>
          <label>End time<input type="time" value={meeting.ends_at} onChange={(e) => updateRow(index, { ends_at: e.target.value })} /></label>
          <label>Room<input value={meeting.room} maxLength={120} onChange={(e) => updateRow(index, { room: e.target.value })} /></label>
        </div>}
      </article>)}</div>
      {meetings.length === 0 && <div className="schedule-import-empty">No meetings found in this image. Add a meeting above or use another image.</div>}
      {error && <p className="schedule-error" role="alert">{error}</p>}
      <div className="schedule-import-footer"><span>Classes are added only after you confirm.</span><button type="button" className="button-primary" disabled={meetings.length === 0} onClick={() => void save()}>Add {meetings.length} meeting{meetings.length === 1 ? '' : 's'} to my week</button></div>
    </div>}

    {step === 'done' && <div className="schedule-import-message schedule-import-success" role="status"><span className="schedule-import-message-icon" aria-hidden="true">✓</span><h3>{result.imported ? 'Your week is ready' : 'These meetings are already in your week'}</h3><p>{result.imported} meeting{result.imported === 1 ? '' : 's'} added{result.skipped ? ` · ${result.skipped} already saved` : ''}.</p><button type="button" className="button-primary" onClick={onDone}>View my week</button></div>}
  </section>
}
