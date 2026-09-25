import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import './schedule-import.css'

type DraftMeeting = { clientId: string; dayCode: string; startsAt: string; endsAt: string; room: string }
type DraftSubject = { clientId: string; subjectCode: string; title: string; units: string; blockSection: string; meetings: DraftMeeting[] }
type Step = 'choose' | 'crop' | 'text' | 'review' | 'confirm'

const dayOptions = [['M', 'Monday'], ['T', 'Tuesday'], ['W', 'Wednesday'], ['H', 'Thursday'], ['F', 'Friday'], ['S', 'Saturday'], ['U', 'Sunday']]
const newMeeting = (): DraftMeeting => ({ clientId: crypto.randomUUID(), dayCode: '', startsAt: '', endsAt: '', room: '' })
const newSubject = (): DraftSubject => ({ clientId: crypto.randomUUID(), subjectCode: '', title: '', units: '', blockSection: '', meetings: [] })
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

function validate(subjects: DraftSubject[]) {
  if (!subjects.length) return 'Add at least one subject before replacing your schedule.'
  if (subjects.length > 40) return 'The import can contain at most 40 subjects.'
  let meetingCount = 0
  const exactMeetings = new Set<string>()
  for (let index = 0; index < subjects.length; index++) {
    const subject = subjects[index]
    const label = `Subject ${index + 1}`
    if (!clean(subject.subjectCode) || clean(subject.subjectCode).length > 40) return `${label}: enter a code of up to 40 characters.`
    if (!clean(subject.title) || clean(subject.title).length > 200) return `${label}: enter a title of up to 200 characters.`
    if (!clean(subject.blockSection) || clean(subject.blockSection).length > 80) return `${label}: enter a section of up to 80 characters.`
    if (!/^\d{1,2}(\.\d)?$/.test(subject.units) || Number(subject.units) > 30) return `${label}: enter units from 0 to 30 with at most one decimal.`
    for (const meeting of subject.meetings) {
      meetingCount++
      if (meetingCount > 100) return 'The import can contain at most 100 meetings.'
      if (!dayOptions.some(([code]) => code === meeting.dayCode)) return `${label}: choose a day for every meeting.`
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting.startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting.endsAt) || meeting.startsAt >= meeting.endsAt) return `${label}: choose an end time after the start time.`
      if (clean(meeting.room).length > 120 || clean(meeting.room).toUpperCase() === 'N/A') return `${label}: enter a room of up to 120 characters or leave it blank.`
      const key = [clean(subject.subjectCode).toUpperCase(), meeting.dayCode, meeting.startsAt, meeting.endsAt].join('|')
      if (exactMeetings.has(key)) return `${label}: remove a duplicate meeting.`
      exactMeetings.add(key)
    }
  }
  return ''
}

function spatialText(tsv: string | null, fallback: string) {
  if (!tsv) return fallback
  const words = tsv.split('\n').slice(1).map(line => line.split('\t')).filter(columns => columns.length >= 12 && columns[0] === '5' && columns.slice(11).join('\t').trim())
    .map(columns => ({ x: Number(columns[6]), y: Number(columns[7]), word: columns.slice(11).join(' ').trim() }))
    .filter(word => Number.isFinite(word.x) && Number.isFinite(word.y))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  if (!words.length) return fallback
  const lines: Array<{ y: number; words: typeof words }> = []
  for (const word of words) {
    let line = lines.find(item => Math.abs(item.y - word.y) < 9)
    if (!line) { line = { y: word.y, words: [] }; lines.push(line) }
    line.words.push(word)
  }
  return lines.sort((a, b) => a.y - b.y).map(line => line.words.sort((a, b) => a.x - b.x).map(word => `[${word.x}]${word.word}`).join(' ')).join('\n')
}

async function api(path: string, payload: unknown) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again.')
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The server could not complete this request.')
  return result
}

export function ScheduleImport({ currentSubjectCount, onClose, onSaved }: { currentSubjectCount: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const [step, setStep] = useState<Step>('choose')
  const [imageUrl, setImageUrl] = useState('')
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [top, setTop] = useState(20)
  const [bottom, setBottom] = useState(50)
  const [ocr, setOcr] = useState('')
  const [subjects, setSubjects] = useState<DraftSubject[]>([])
  const [revision, setRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null>(null)
  const imageUrlRef = useRef('')
  const stopped = useRef(false)

  useEffect(() => () => {
    stopped.current = true
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    if (workerRef.current) void workerRef.current.terminate()
  }, [])

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12_000_000) { setError('Choose a JPEG, PNG, or WebP image under 12 MB.'); return }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (image.width < 600 || image.height < 400 || image.width * image.height > 45_000_000) { URL.revokeObjectURL(url); setError('Use a readable image between 600 pixels wide and 45 megapixels.'); return }
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = url
      setImageUrl(url)
      setImageSize({ width: image.width, height: image.height })
      setTop(20); setBottom(50); setOcr(''); setSubjects([]); setStep('crop')
    }
    image.onerror = () => { URL.revokeObjectURL(url); setError('This image could not be opened. Try a JPEG, PNG, or WebP file.') }
    image.src = url
  }

  async function readImage() {
    if (!imageUrl) return
    setBusy(true); setError(''); setProgress('Preparing the schedule table...')
    try {
      const image = new Image()
      image.src = imageUrl
      await image.decode()
      const scale = Math.min(1, 2600 / imageSize.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(imageSize.width * scale)
      canvas.height = Math.round(imageSize.height * (bottom - top) / 100 * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image processing is unavailable in this browser.')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, imageSize.height * top / 100, imageSize.width, imageSize.height * (bottom - top) / 100, 0, 0, canvas.width, canvas.height)
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, { logger: message => {
        if (message.status === 'recognizing text') setProgress(`Reading the table… ${Math.round(message.progress * 100)}%`)
      } })
      workerRef.current = worker
      const result = await worker.recognize(canvas, {}, { text: true, tsv: true })
      if (stopped.current) return
      setOcr(spatialText(result.data.tsv, result.data.text).slice(0, 100_000))
      setStep('text')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read the image. Adjust the crop and try again.') }
    finally { if (workerRef.current) { await workerRef.current.terminate(); workerRef.current = null }; setBusy(false); setProgress('') }
  }

  async function parse() {
    setBusy(true); setError('')
    try {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error: revisionError } = await supabase.rpc('cali_schedule_revision')
      if (revisionError) throw revisionError
      setRevision(Number(data))
      const result = await api('/api/schedule/parse', { ocr })
      if (!Array.isArray(result.subjects)) throw new Error('The parser returned no schedule.')
      setSubjects(result.subjects as DraftSubject[])
      setStep('review')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not parse the schedule.') }
    finally { setBusy(false) }
  }

  function changeSubject(id: string, field: keyof Omit<DraftSubject, 'clientId' | 'meetings'>, value: string) {
    setSubjects(previous => previous.map(subject => subject.clientId === id ? { ...subject, [field]: value } : subject))
  }
  function changeMeeting(subjectId: string, meetingId: string, field: keyof Omit<DraftMeeting, 'clientId'>, value: string) {
    setSubjects(previous => previous.map(subject => subject.clientId === subjectId ? { ...subject, meetings: subject.meetings.map(meeting => meeting.clientId === meetingId ? { ...meeting, [field]: value } : meeting) } : subject))
  }
  function addMeeting(subjectId: string) { setSubjects(previous => previous.map(subject => subject.clientId === subjectId ? { ...subject, meetings: [...subject.meetings, newMeeting()] } : subject)) }
  function removeMeeting(subjectId: string, meetingId: string) { setSubjects(previous => previous.map(subject => subject.clientId === subjectId ? { ...subject, meetings: subject.meetings.filter(meeting => meeting.clientId !== meetingId) } : subject)) }

  async function replace() {
    const problem = validate(subjects)
    if (problem) { setError(problem); setStep('review'); return }
    if (revision === null) { setError('Reload the import before saving.'); return }
    setBusy(true); setError('')
    try {
      await api('/api/schedule/replace', { expectedRevision: revision, subjects: subjects.map(subject => ({
        subject_code: clean(subject.subjectCode), title: clean(subject.title), units: Number(subject.units), block_section: clean(subject.blockSection),
        meetings: subject.meetings.map(meeting => ({ day_code: meeting.dayCode, starts_at: meeting.startsAt, ends_at: meeting.endsAt, room: clean(meeting.room) || null })),
      })) })
      await onSaved()
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not replace the schedule. Your previous schedule remains saved.') }
    finally { setBusy(false) }
  }

  const count = subjects.reduce((total, subject) => total + subject.meetings.length, 0)
  return <section className="import-panel" aria-label="Import registration form">
    <div className="import-head"><div><p className="workspace-overline">REGISTRATION FORM</p><h2>Import your schedule</h2><p>Review every class before it replaces your current week.</p></div><button type="button" className="schedule-secondary" onClick={onClose} disabled={busy}>Close</button></div>
    <div className="import-steps" aria-label="Import progress"><span className={step === 'choose' || step === 'crop' ? 'active' : ''}>1 · Image</span><span className={step === 'text' ? 'active' : ''}>2 · Read text</span><span className={step === 'review' ? 'active' : ''}>3 · Review</span><span className={step === 'confirm' ? 'active' : ''}>4 · Replace</span></div>
    {error && <p className="schedule-error" role="alert">{error}</p>}
    {step === 'choose' && <div className="import-choice"><p>Choose a clear image of your registration form. The image stays on this device; only text from the cropped subject table is sent for parsing.</p><div className="import-actions"><button type="button" className="button-primary import-mobile-camera" onClick={() => cameraRef.current?.click()}>Take photo</button><button type="button" className="button-primary" onClick={() => uploadRef.current?.click()}>Upload image</button></div></div>}
    <input ref={cameraRef} className="import-file-input" type="file" accept="image/*" capture="environment" onChange={chooseFile} aria-label="Take a registration form photo" />
    <input ref={uploadRef} className="import-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} aria-label="Upload a registration form image" />
    {step === 'crop' && <div className="import-crop"><p>Keep only the subject table between the blue guides. Leave student details and fee panels outside.</p><div className="import-image-frame"><img src={imageUrl} alt="Registration form preview" /><div className="import-mask import-mask--top" style={{ height: `${top}%` }} /><div className="import-mask import-mask--bottom" style={{ top: `${bottom}%` }} /><div className="import-crop-outline" style={{ top: `${top}%`, height: `${bottom - top}%` }} /></div><div className="import-range"><label>Table begins <input type="range" min="0" max={bottom - 5} value={top} onChange={event => setTop(Number(event.target.value))} /></label><label>Table ends <input type="range" min={top + 5} max="100" value={bottom} onChange={event => setBottom(Number(event.target.value))} /></label></div><div className="import-actions"><button type="button" className="schedule-secondary" onClick={() => uploadRef.current?.click()}>Choose another image</button><button type="button" className="button-primary" onClick={() => { void readImage() }} disabled={busy}>{busy ? progress || 'Reading…' : 'Read table'}</button></div></div>}
    {step === 'text' && <div className="import-text"><p>Check the extracted table text. Remove any personal details before sending it to the parser. You can edit unreadable words here or correct them on the next screen.</p><label>Extracted text<textarea value={ocr} onChange={event => setOcr(event.target.value.slice(0, 100_000))} rows={12} spellCheck={false} /></label><div className="import-actions"><button type="button" className="schedule-secondary" onClick={() => setStep('crop')}>Adjust crop</button><button type="button" className="button-primary" onClick={() => { void parse() }} disabled={busy || ocr.trim().length < 20}>{busy ? 'Parsing…' : 'Create proposal'}</button></div></div>}
    {step === 'review' && <div className="import-review"><p>Check subject codes, units, days, times, and rooms. A subject with no meeting stays in Unscheduled subjects.</p>{subjects.map((subject, index) => <article className="import-subject" key={subject.clientId}><div className="import-subject-head"><h3>Subject {index + 1}</h3><button type="button" className="import-remove" onClick={() => setSubjects(previous => previous.filter(item => item.clientId !== subject.clientId))}>Remove subject</button></div><div className="import-subject-fields"><label>Subject code<input value={subject.subjectCode} maxLength={40} onChange={event => changeSubject(subject.clientId, 'subjectCode', event.target.value)} /></label><label>Units<input type="number" min="0" max="30" step="0.1" value={subject.units} onChange={event => changeSubject(subject.clientId, 'units', event.target.value)} /></label><label className="import-wide">Subject title<input value={subject.title} maxLength={200} onChange={event => changeSubject(subject.clientId, 'title', event.target.value)} /></label><label className="import-wide">Block / section<input value={subject.blockSection} maxLength={80} onChange={event => changeSubject(subject.clientId, 'blockSection', event.target.value)} /></label></div><div className="import-meetings"><div className="import-subject-head"><h4>Meetings</h4><button type="button" className="schedule-secondary" onClick={() => addMeeting(subject.clientId)}>+ Add meeting</button></div>{subject.meetings.length === 0 && <p>No timed meeting. This subject will be unscheduled.</p>}{subject.meetings.map((meeting, meetingIndex) => <div className="import-meeting" key={meeting.clientId}><strong>Meeting {meetingIndex + 1}</strong><label>Day<select value={meeting.dayCode} onChange={event => changeMeeting(subject.clientId, meeting.clientId, 'dayCode', event.target.value)}><option value="">Select day</option>{dayOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label><label>Starts<input type="time" value={meeting.startsAt} onChange={event => changeMeeting(subject.clientId, meeting.clientId, 'startsAt', event.target.value)} /></label><label>Ends<input type="time" value={meeting.endsAt} onChange={event => changeMeeting(subject.clientId, meeting.clientId, 'endsAt', event.target.value)} /></label><label>Room<input value={meeting.room} maxLength={120} placeholder="Optional" onChange={event => changeMeeting(subject.clientId, meeting.clientId, 'room', event.target.value)} /></label><button type="button" className="import-remove" onClick={() => removeMeeting(subject.clientId, meeting.clientId)}>Remove meeting</button></div>)}</div></article>)}<button type="button" className="schedule-secondary" onClick={() => setSubjects(previous => [...previous, newSubject()])}>+ Add subject</button><div className="import-actions"><button type="button" className="schedule-secondary" onClick={() => setStep('text')}>Back to text</button><button type="button" className="button-primary" onClick={() => { const problem = validate(subjects); setError(problem); if (!problem) setStep('confirm') }}>Review replacement</button></div></div>}
    {step === 'confirm' && <div className="import-confirm"><h3>Replace your current schedule?</h3><p>The reviewed proposal has <strong>{subjects.length} subjects</strong> and <strong>{count} timed meetings</strong>. {currentSubjectCount ? `It will replace your ${currentSubjectCount} saved subjects and all their meetings.` : 'It will become your current weekly schedule.'}</p><p>Changes take effect only after this save succeeds.</p><div className="import-actions"><button type="button" className="schedule-secondary" onClick={() => setStep('review')} disabled={busy}>Keep reviewing</button><button type="button" className="button-primary" onClick={() => { void replace() }} disabled={busy}>{busy ? 'Replacing…' : 'Replace schedule'}</button></div></div>}
  </section>
}
