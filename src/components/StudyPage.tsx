import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { extractReviewerFile } from '../lib/reviewerExtraction'
import {
  EMPTY_REVIEWER_DOCUMENT,
  formatReviewerDate,
  reviewerMatches,
  validateSourceText,
  type Reviewer,
  type ReviewerAiDraft,
  type ReviewerDetail,
  type ReviewerSourceType,
  type ReviewerSubject,
} from '../lib/reviewers'
import './study.css'
import './skeleton.css'

type Notice = { kind: 'error' | 'success'; text: string } | null
type AiPreview = Pick<ReviewerAiDraft, 'request_id' | 'title' | 'content'>

const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Underline,
]

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
}

function DocumentView({ content, editable = false, onEditor }: { content: JSONContent; editable?: boolean; onEditor?: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: editorExtensions, content, editable, immediatelyRender: false })
  useEffect(() => { if (editor) onEditor?.(editor) }, [editor, onEditor])
  useEffect(() => {
    if (editor && !editable && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content)
  }, [content, editable, editor])
  return <EditorContent editor={editor} className={editable ? 'reviewer-editor-content' : 'reviewer-document'} />
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="reviewer-toolbar" aria-hidden="true" />
  const run = (action: () => void) => action()
  const link = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link URL', current ?? 'https://')
    if (href === null) return
    if (!href.trim()) editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }
  const button = (label: string, active: boolean, action: () => void) => <button type="button" className={active ? 'is-active' : ''} aria-label={label} title={label} onClick={() => run(action)}>{label}</button>
  return <div className="reviewer-toolbar" aria-label="Reviewer formatting">
    <select aria-label="Text style" value={editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'} onChange={event => {
      const value = event.target.value
      if (value === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run()
      else if (value === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run()
      else editor.chain().focus().setParagraph().run()
    }}><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>
    {button('B', editor.isActive('bold'), () => { editor.chain().focus().toggleBold().run() })}
    {button('I', editor.isActive('italic'), () => { editor.chain().focus().toggleItalic().run() })}
    {button('U', editor.isActive('underline'), () => { editor.chain().focus().toggleUnderline().run() })}
    {button('S', editor.isActive('strike'), () => { editor.chain().focus().toggleStrike().run() })}
    {button('Highlight', editor.isActive('highlight'), () => { editor.chain().focus().toggleHighlight({ color: '#fff0a8' }).run() })}
    <input type="color" aria-label="Text color" title="Text color" value="#12384d" onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
    {button('Bullets', editor.isActive('bulletList'), () => { editor.chain().focus().toggleBulletList().run() })}
    {button('Numbers', editor.isActive('orderedList'), () => { editor.chain().focus().toggleOrderedList().run() })}
    {button('Quote', editor.isActive('blockquote'), () => { editor.chain().focus().toggleBlockquote().run() })}
    {button('Code', editor.isActive('codeBlock'), () => { editor.chain().focus().toggleCodeBlock().run() })}
    {button('Link', editor.isActive('link'), link)}
    {button('Left', editor.isActive({ textAlign: 'left' }), () => { editor.chain().focus().setTextAlign('left').run() })}
    {button('Center', editor.isActive({ textAlign: 'center' }), () => { editor.chain().focus().setTextAlign('center').run() })}
    {button('Divider', false, () => { editor.chain().focus().setHorizontalRule().run() })}
    {button('Undo', false, () => { editor.chain().focus().undo().run() })}
    {button('Redo', false, () => { editor.chain().focus().redo().run() })}
  </div>
}

function ReviewerEditor({ reviewer, subjects, onSaved, onClose }: { reviewer: Reviewer; subjects: ReviewerSubject[]; onSaved: (reviewer: Reviewer) => void; onClose: () => void }) {
  const [title, setTitle] = useState(reviewer.title)
  const [subjectId, setSubjectId] = useState(reviewer.subject_id ?? '')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const revision = useRef(reviewer.revision)

  const save = useCallback(async () => {
    if (!supabase || !editor || !title.trim() || status === 'saving') return
    setStatus('saving')
    const { data, error } = await supabase.rpc('cali_update_own_reviewer', {
      p_id: reviewer.id, p_expected_revision: revision.current, p_title: title.trim(),
      p_subject_id: subjectId || null, p_content: editor.getJSON(), p_plain_text: editor.getText(),
    }).single()
    if (error || !data) { setStatus('error'); return }
    const changed = data as Reviewer
    revision.current = changed.revision
    setStatus('saved')
    onSaved(changed)
  }, [editor, onSaved, reviewer.id, status, subjectId, title])

  useEffect(() => {
    if (status !== 'dirty') return
    const timer = window.setTimeout(() => { void save() }, 1200)
    return () => window.clearTimeout(timer)
  }, [save, status])

  useEffect(() => {
    if (!editor) return
    const markDirty = () => setStatus(current => current === 'saving' ? current : 'dirty')
    editor.on('update', markDirty)
    return () => { editor.off('update', markDirty) }
  }, [editor])

  return <section className="reviewer-edit-shell">
    <header><div><p className="workspace-overline">EDIT REVIEWER</p><input value={title} maxLength={160} aria-label="Reviewer title" onChange={event => { setTitle(event.target.value); setStatus('dirty') }} /></div><div className="reviewer-edit-actions"><span className={`reviewer-save-state reviewer-save-state--${status}`}>{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved' : status === 'error' ? 'Couldn’t save' : 'Saved'}</span><button type="button" className="study-secondary" onClick={() => { void save() }}>Save now</button><button type="button" className="button-primary" onClick={onClose}>Done</button></div></header>
    <div className="reviewer-edit-subject"><label>Subject <select value={subjectId} onChange={event => { setSubjectId(event.target.value); setStatus('dirty') }}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div>
    <Toolbar editor={editor} />
    <DocumentView content={reviewer.content} editable onEditor={setEditor} />
  </section>
}

function AiDialog({ open, subjects, recovered, onClose, onSaved }: { open: boolean; subjects: ReviewerSubject[]; recovered: AiPreview | null; onClose: () => void; onSaved: (reviewer: Reviewer) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [title, setTitle] = useState('')
  const [focus, setFocus] = useState('')
  const [detail, setDetail] = useState<ReviewerDetail>('standard')
  const [subjectId, setSubjectId] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sourceType, setSourceType] = useState<ReviewerSourceType>('text')
  const [fileName, setFileName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<AiPreview | null>(recovered)

  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close() }, [open])
  // Recovery arrives asynchronously with the private draft query.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (recovered) setPreview(recovered) }, [recovered])

  const chooseFile = async (file?: File) => {
    if (!file) return
    setError(''); setExtracting(true); setFileName(file.name)
    try {
      const extracted = await extractReviewerFile(file)
      const issue = validateSourceText(extracted.text)
      if (issue) throw new Error(issue)
      setSourceText(extracted.text); setSourceType(extracted.sourceType)
    } catch (reason) {
      setSourceText(''); setFileName(''); setError(reason instanceof Error ? reason.message : 'Could not read the file.')
    } finally { setExtracting(false) }
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragActive(false)
    void chooseFile(event.dataTransfer.files[0])
  }

  const generate = async (event: FormEvent) => {
    event.preventDefault()
    const issue = validateSourceText(sourceText)
    if (issue) { setError(issue); return }
    if (!accepted) { setError('Accept the privacy notice to continue.'); return }
    if (!supabase) return
    setBusy(true); setError('')
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Session expired. Please sign in again.')
      const requestId = crypto.randomUUID()
      const response = await fetch('/api/study/reviewer-generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ requestId, title, focus, detail, sourceText, sourceType, privacyAccepted: true }),
      })
      const result = await response.json() as { error?: string; requestId?: string; title?: string; content?: JSONContent }
      if (!response.ok || !result.requestId || !result.title || !result.content) throw new Error(result.error ?? 'Generation failed.')
      setPreview({ request_id: result.requestId, title: result.title, content: result.content })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Generation failed.') }
    finally { setBusy(false) }
  }

  const save = async () => {
    if (!supabase || !preview) return
    setBusy(true); setError('')
    const { data, error: saveError } = await supabase.rpc('cali_save_own_generated_reviewer', { p_request_id: preview.request_id, p_subject_id: subjectId || null }).single()
    if (saveError || !data) setError(saveError?.message ?? 'Could not save this reviewer.')
    else { onSaved(data as Reviewer); setPreview(null); onClose() }
    setBusy(false)
  }

  const discard = async () => {
    if (supabase && preview) await supabase.rpc('cali_discard_own_generated_reviewer', { p_request_id: preview.request_id })
    setPreview(null); onClose()
  }

  return <dialog ref={ref} className="study-dialog study-ai-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="study-dialog-shell">
      <header><div><p className="workspace-overline">AI REVIEWER</p><h2>{preview ? 'Review before saving' : 'Turn notes into a reviewer'}</h2><p>{preview ? 'This private preview expires after 24 hours unless you save it.' : 'Cali uses free AI models only. Your original file stays on this device.'}</p></div><button type="button" className="study-dialog-close" onClick={onClose} disabled={busy}><CloseIcon /></button></header>
      {preview ? <div className="study-preview"><div className="study-preview-meta"><strong>{preview.title}</strong><label>Subject <select value={subjectId} onChange={event => setSubjectId(event.target.value)}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code}</option>)}</select></label></div><DocumentView content={preview.content} />{error && <p className="study-form-error" role="alert">{error}</p>}</div> : <form id="study-ai-form" onSubmit={generate}>
        <div className="study-source-tabs"><button type="button" className={mode === 'file' ? 'is-active' : ''} onClick={() => setMode('file')}>Upload PDF or DOCX</button><button type="button" className={mode === 'text' ? 'is-active' : ''} onClick={() => { setMode('text'); setSourceType('text'); setFileName('') }}>Paste text</button></div>
        {mode === 'file' ? <label className={`study-file-drop${dragActive ? ' is-dragging' : ''}`} onDragEnter={event => { event.preventDefault(); setDragActive(true) }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragActive(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }} onDrop={handleDrop}><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><strong>{extracting ? 'Reading on your device…' : dragActive ? 'Drop it here' : fileName || 'Choose or drop a PDF or DOCX'}</strong><span>Up to 10 MB · PDF up to 100 pages · scanned files are not supported</span></label> : <label className="study-field study-field--wide"><span>Source text <small>{sourceText.length.toLocaleString()}/120,000</small></span><textarea rows={9} maxLength={120001} value={sourceText} onChange={event => { setSourceText(event.target.value); setSourceType('text') }} placeholder="Paste lecture notes, readings, or a lesson here…" /></label>}
        <div className="study-form-grid"><label className="study-field"><span>Title <small>Optional</small></span><input maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Cali can choose one" /></label><label className="study-field"><span>Detail</span><select value={detail} onChange={event => setDetail(event.target.value as ReviewerDetail)}><option value="concise">Concise</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label><label className="study-field study-field--wide"><span>Focus <small>{focus.length}/500 · Optional</small></span><textarea rows={2} maxLength={500} value={focus} onChange={event => setFocus(event.target.value)} placeholder="Example: emphasize the formulas and sample problems" /></label></div>
        <label className="study-privacy"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span><strong>Send extracted text to a free AI provider</strong>The original file never leaves this device. Its extracted text will be sent through OpenRouter to a free model, whose retention practices may vary. Do not submit sensitive or confidential material.</span></label>
        {error && <p className="study-form-error" role="alert">{error}</p>}
      </form>}
      <footer>{preview ? <><button type="button" className="study-secondary" onClick={() => { void discard() }} disabled={busy}>Discard</button><button type="button" className="button-primary" onClick={() => { void save() }} disabled={busy}>{busy ? 'Saving…' : 'Save reviewer'}</button></> : <><button type="button" className="study-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="study-ai-form" className="button-primary" disabled={busy || extracting}>{busy ? 'Generating…' : extracting ? 'Reading file…' : 'Generate preview'}</button></>}</footer>
    </div>
  </dialog>
}

export function StudyPage({ studentId }: { studentId: string }) {
  const [params, setParams] = useSearchParams()
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [subjects, setSubjects] = useState<ReviewerSubject[]>([])
  const [recovered, setRecovered] = useState<AiPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const createRef = useRef<HTMLDialogElement>(null)
  const selected = reviewers.find(reviewer => reviewer.id === params.get('reviewer')) ?? null
  const editing = params.get('edit') === '1'
  const aiOpen = params.get('new') === 'ai'

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [reviewerResult, subjectResult, draftResult] = await Promise.all([
      supabase.from('reviewers').select('*').eq('user_id', studentId).order('updated_at', { ascending: false }),
      supabase.from('schedule_subjects').select('id,subject_code,title,color_key').eq('user_id', studentId).order('subject_code'),
      supabase.from('reviewer_ai_drafts').select('request_id,title,content,expires_at').eq('user_id', studentId).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (reviewerResult.error || subjectResult.error) setNotice({ kind: 'error', text: 'Cali could not load your study space. Please try again.' })
    else { setReviewers((reviewerResult.data ?? []) as Reviewer[]); setSubjects((subjectResult.data ?? []) as ReviewerSubject[]) }
    if (draftResult.data) setRecovered(draftResult.data as AiPreview)
    setLoading(false)
  }, [studentId])

  // Load the private library when the authenticated student changes.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (params.get('new') === 'manual') createRef.current?.showModal(); else createRef.current?.close() }, [params])

  const visible = useMemo(() => reviewers.filter(reviewer => reviewerMatches(reviewer, query, subjectFilter)), [query, reviewers, subjectFilter])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next)
  }

  const createReviewer = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !newTitle.trim()) return
    setCreating(true)
    const { data, error } = await supabase.rpc('cali_create_own_reviewer', {
      p_title: newTitle.trim(), p_subject_id: newSubject || null, p_content: EMPTY_REVIEWER_DOCUMENT, p_plain_text: '',
    }).single()
    setCreating(false)
    if (error || !data) { setNotice({ kind: 'error', text: error?.message ?? 'Could not create the reviewer.' }); return }
    const created = data as Reviewer
    setReviewers(current => [created, ...current]); setNewTitle(''); setNewSubject('')
    navigate({ new: null, reviewer: created.id, edit: '1' })
  }

  const updateReviewer = (changed: Reviewer) => setReviewers(current => [changed, ...current.filter(item => item.id !== changed.id)])
  const duplicate = async (reviewer: Reviewer) => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('cali_duplicate_own_reviewer', { p_id: reviewer.id }).single()
    if (error || !data) setNotice({ kind: 'error', text: 'Could not duplicate this reviewer.' })
    else { const copy = data as Reviewer; setReviewers(current => [copy, ...current]); navigate({ reviewer: copy.id, edit: null }); setNotice({ kind: 'success', text: 'Reviewer duplicated.' }) }
  }
  const remove = async (reviewer: Reviewer) => {
    if (!supabase || !window.confirm(`Permanently delete “${reviewer.title}”? This cannot be undone.`)) return
    const { error } = await supabase.from('reviewers').delete().eq('id', reviewer.id)
    if (error) setNotice({ kind: 'error', text: 'Could not delete this reviewer.' })
    else { setReviewers(current => current.filter(item => item.id !== reviewer.id)); navigate({ reviewer: null, edit: null }); setNotice({ kind: 'success', text: 'Reviewer deleted.' }) }
  }

  return <section className="study-page">
    <header className="study-heading"><div><p className="workspace-overline">STUDY SPACE</p><h1>Study <em>smarter.</em></h1><p>Create focused reviewers from your own notes, then keep them organized with your subjects.</p></div><div className="study-heading-actions"><button type="button" className="study-secondary" onClick={() => navigate({ new: 'manual', reviewer: null, edit: null })}><span aria-hidden="true">+</span> New reviewer</button><button type="button" className="button-primary" onClick={() => navigate({ new: 'ai', reviewer: null, edit: null })}>Generate reviewer</button></div></header>
    <div className="study-tabs" role="tablist" aria-label="Study tools"><button type="button" className="is-active" role="tab" aria-selected="true">Reviewers</button><button type="button" role="tab" aria-selected="false" disabled>Flashcards <span>Coming soon</span></button><button type="button" role="tab" aria-selected="false" disabled>Quizzes <span>Coming soon</span></button></div>
    {recovered && !aiOpen && <button type="button" className="study-recovery" onClick={() => navigate({ new: 'ai', reviewer: null, edit: null })}><span><strong>Generated preview ready</strong>Your private draft is available for up to 24 hours.</span><b>Review and save →</b></button>}
    {notice && <div className={`study-notice study-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><CloseIcon /></button></div>}
    <div className={`study-workspace${selected ? ' study-workspace--selected' : ''}`}>
      <aside className="reviewer-library" aria-label="Reviewer library"><div className="reviewer-library-head"><div><p className="workspace-overline">YOUR LIBRARY</p><h2>Reviewers</h2></div><span>{reviewers.length}</span></div><div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers" aria-label="Search reviewers" /></label><select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} aria-label="Filter by subject"><option value="">All subjects</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code}</option>)}</select></div>
        <div className="reviewer-list">{loading ? <div className="reviewer-list-skeleton"><span /><span /><span /></div> : visible.length ? visible.map(reviewer => { const subject = reviewer.subject_id ? subjectMap.get(reviewer.subject_id) : null; return <button type="button" key={reviewer.id} className={selected?.id === reviewer.id ? 'is-active' : ''} onClick={() => navigate({ reviewer: reviewer.id, edit: null, new: null })}><span className="reviewer-list-top"><strong>{reviewer.title}</strong>{reviewer.origin === 'ai' && <small>AI</small>}</span><span>{subject?.subject_code ?? 'General'} · {formatReviewerDate(reviewer.updated_at)}</span><p>{reviewer.plain_text || 'Start writing your reviewer…'}</p></button> }) : <div className="reviewer-empty-list"><strong>{reviewers.length ? 'No matches' : 'Your first reviewer starts here'}</strong><p>{reviewers.length ? 'Try another search or subject.' : 'Write one yourself or generate one from your notes.'}</p>{!reviewers.length && <button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>Create reviewer</button>}</div>}</div>
      </aside>
      <main className="reviewer-reader">{selected ? editing ? <ReviewerEditor key={selected.id} reviewer={selected} subjects={subjects} onSaved={updateReviewer} onClose={() => navigate({ edit: null })} /> : <article className="reviewer-reading"><header><button type="button" className="reviewer-mobile-back" onClick={() => navigate({ reviewer: null })}>← Library</button><div><p className="workspace-overline">{selected.subject_id ? subjectMap.get(selected.subject_id)?.subject_code ?? 'REVIEWER' : 'GENERAL REVIEWER'}</p><h2>{selected.title}</h2><p>Updated {formatReviewerDate(selected.updated_at)}{selected.origin === 'ai' ? ' · Generated with AI' : ''}</p></div><div className="reviewer-reader-actions"><button type="button" className="study-secondary" onClick={() => navigate({ edit: '1' })}>Edit</button><details><summary aria-label="Reviewer actions">•••</summary><div><button type="button" onClick={() => { void duplicate(selected) }}>Duplicate</button><button type="button" className="is-danger" onClick={() => { void remove(selected) }}>Delete permanently</button></div></details></div></header><DocumentView content={selected.content} /></article> : <div className="reviewer-reader-empty"><p className="workspace-overline">REVIEWER READER</p><h2>Pick a reviewer to begin.</h2><p>Your reading view stays calm and distraction-free. Create a reviewer when you’re ready to add something new.</p><div><button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>New reviewer</button><button type="button" className="study-secondary" onClick={() => navigate({ new: 'ai' })}>Generate with AI</button></div></div>}</main>
    </div>

    <dialog ref={createRef} className="study-dialog study-create-dialog" onCancel={event => { event.preventDefault(); navigate({ new: null }) }}><form onSubmit={createReviewer} className="study-dialog-shell"><header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Start with a blank page</h2><p>Give it a clear title. You can change the subject anytime.</p></div><button type="button" className="study-dialog-close" onClick={() => navigate({ new: null })}><CloseIcon /></button></header><div className="study-form-grid"><label className="study-field study-field--wide"><span>Title <small>{newTitle.length}/160</small></span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Example: Midterm reviewer" /></label><label className="study-field study-field--wide"><span>Subject</span><select value={newSubject} onChange={event => setNewSubject(event.target.value)}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div><footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create reviewer'}</button></footer></form></dialog>
    <AiDialog open={aiOpen} subjects={subjects} recovered={recovered} onClose={() => navigate({ new: null })} onSaved={reviewer => { setRecovered(null); updateReviewer(reviewer); navigate({ new: null, reviewer: reviewer.id, edit: null }) }} />
  </section>
}
