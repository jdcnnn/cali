import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
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
import { EMPTY_REVIEWER_DOCUMENT, formatReviewerDate, reviewerMatches, type Reviewer, type ReviewerSubject } from '../lib/reviewers'
import './study.css'
import './skeleton.css'

type Notice = { kind: 'error' | 'success'; text: string } | null

const editorExtensions = [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }), TextStyle, Color, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), Underline]

function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg> }
function ShareIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg> }

function DocumentView({ content, editable = false, onEditor }: { content: JSONContent; editable?: boolean; onEditor?: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: editorExtensions, content, editable, immediatelyRender: false })
  useEffect(() => { if (editor) onEditor?.(editor) }, [editor, onEditor])
  useEffect(() => { if (editor && !editable && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content) }, [content, editable, editor])
  return <EditorContent editor={editor} className={editable ? 'reviewer-editor-content' : 'reviewer-document'} />
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="reviewer-toolbar" aria-hidden="true" />
  const link = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link URL', current ?? 'https://')
    if (href === null) return
    if (!href.trim()) editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }
  const button = (label: string, active: boolean, action: () => void) => <button type="button" className={active ? 'is-active' : ''} aria-label={label} title={label} onClick={action}>{label}</button>
  return <div className="reviewer-toolbar" aria-label="Reviewer formatting">
    <select aria-label="Text style" value={editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'} onChange={event => { if (event.target.value === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run(); else if (event.target.value === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run(); else editor.chain().focus().setParagraph().run() }}><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>
    {button('B', editor.isActive('bold'), () => { editor.chain().focus().toggleBold().run() })}{button('I', editor.isActive('italic'), () => { editor.chain().focus().toggleItalic().run() })}{button('U', editor.isActive('underline'), () => { editor.chain().focus().toggleUnderline().run() })}{button('S', editor.isActive('strike'), () => { editor.chain().focus().toggleStrike().run() })}
    {button('Highlight', editor.isActive('highlight'), () => { editor.chain().focus().toggleHighlight({ color: '#fff0a8' }).run() })}<input type="color" aria-label="Text color" title="Text color" value="#12384d" onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
    {button('Bullets', editor.isActive('bulletList'), () => { editor.chain().focus().toggleBulletList().run() })}{button('Numbers', editor.isActive('orderedList'), () => { editor.chain().focus().toggleOrderedList().run() })}{button('Quote', editor.isActive('blockquote'), () => { editor.chain().focus().toggleBlockquote().run() })}{button('Code', editor.isActive('codeBlock'), () => { editor.chain().focus().toggleCodeBlock().run() })}{button('Link', editor.isActive('link'), link)}
    {button('Left', editor.isActive({ textAlign: 'left' }), () => { editor.chain().focus().setTextAlign('left').run() })}{button('Center', editor.isActive({ textAlign: 'center' }), () => { editor.chain().focus().setTextAlign('center').run() })}{button('Divider', false, () => { editor.chain().focus().setHorizontalRule().run() })}{button('Undo', false, () => { editor.chain().focus().undo().run() })}{button('Redo', false, () => { editor.chain().focus().redo().run() })}
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
    const { data, error } = await supabase.rpc('cali_update_own_reviewer', { p_id: reviewer.id, p_expected_revision: revision.current, p_title: title.trim(), p_subject_id: subjectId || null, p_content: editor.getJSON(), p_plain_text: editor.getText() }).single()
    if (error || !data) { setStatus('error'); return }
    const changed = data as Reviewer
    revision.current = changed.revision
    setStatus('saved'); onSaved(changed)
  }, [editor, onSaved, reviewer.id, status, subjectId, title])
  useEffect(() => { if (status !== 'dirty') return; const timer = window.setTimeout(() => { void save() }, 1200); return () => window.clearTimeout(timer) }, [save, status])
  useEffect(() => { if (!editor) return; const markDirty = () => setStatus(current => current === 'saving' ? current : 'dirty'); editor.on('update', markDirty); return () => { editor.off('update', markDirty) } }, [editor])
  return <section className="reviewer-edit-shell"><header><div><p className="workspace-overline">EDIT REVIEWER</p><input value={title} maxLength={160} aria-label="Reviewer title" onChange={event => { setTitle(event.target.value); setStatus('dirty') }} /></div><div className="reviewer-edit-actions"><span className={`reviewer-save-state reviewer-save-state--${status}`}>{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved' : status === 'error' ? 'Couldn’t save' : 'Saved'}</span><button type="button" className="study-secondary" onClick={() => { void save() }}>Save now</button><button type="button" className="button-primary" onClick={onClose}>Done</button></div></header><div className="reviewer-edit-subject"><label>Subject <select value={subjectId} onChange={event => { setSubjectId(event.target.value); setStatus('dirty') }}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div><Toolbar editor={editor} /><DocumentView content={reviewer.content} editable onEditor={setEditor} /></section>
}

export function StudyPage({ studentId }: { studentId: string }) {
  const [params, setParams] = useSearchParams()
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [subjects, setSubjects] = useState<ReviewerSubject[]>([])
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
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [reviewerResult, subjectResult] = await Promise.all([supabase.from('reviewers').select('*').eq('user_id', studentId).order('updated_at', { ascending: false }), supabase.from('schedule_subjects').select('id,subject_code,title,color_key').eq('user_id', studentId).order('subject_code')])
    if (reviewerResult.error || subjectResult.error) setNotice({ kind: 'error', text: 'Cali could not load your study space. Please try again.' })
    else { setReviewers((reviewerResult.data ?? []) as Reviewer[]); setSubjects((subjectResult.data ?? []) as ReviewerSubject[]) }
    setLoading(false)
  }, [studentId])
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (params.get('new') === 'manual') createRef.current?.showModal(); else createRef.current?.close() }, [params])
  const visible = useMemo(() => reviewers.filter(reviewer => reviewerMatches(reviewer, query, subjectFilter)), [query, reviewers, subjectFilter])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const navigate = (changes: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) } setParams(next) }
  const createReviewer = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !newTitle.trim()) return; setCreating(true)
    const { data, error } = await supabase.rpc('cali_create_own_reviewer', { p_title: newTitle.trim(), p_subject_id: newSubject || null, p_content: EMPTY_REVIEWER_DOCUMENT, p_plain_text: '' }).single(); setCreating(false)
    if (error || !data) { setNotice({ kind: 'error', text: error?.message ?? 'Could not create the reviewer.' }); return }
    const created = data as Reviewer; setReviewers(current => [created, ...current]); setNewTitle(''); setNewSubject(''); navigate({ new: null, reviewer: created.id, edit: '1' })
  }
  const updateReviewer = (changed: Reviewer) => setReviewers(current => [changed, ...current.filter(item => item.id !== changed.id)])
  const duplicate = async (reviewer: Reviewer) => { if (!supabase) return; const { data, error } = await supabase.rpc('cali_duplicate_own_reviewer', { p_id: reviewer.id }).single(); if (error || !data) setNotice({ kind: 'error', text: 'Could not duplicate this reviewer.' }); else { const copy = data as Reviewer; setReviewers(current => [copy, ...current]); navigate({ reviewer: copy.id, edit: null }); setNotice({ kind: 'success', text: 'Reviewer duplicated.' }) } }
  const remove = async (reviewer: Reviewer) => { if (!supabase || !window.confirm(`Permanently delete “${reviewer.title}”? This cannot be undone.`)) return; const { error } = await supabase.from('reviewers').delete().eq('id', reviewer.id); if (error) setNotice({ kind: 'error', text: 'Could not delete this reviewer.' }); else { setReviewers(current => current.filter(item => item.id !== reviewer.id)); navigate({ reviewer: null, edit: null }); setNotice({ kind: 'success', text: 'Reviewer deleted.' }) } }
  const shareReviewer = async (reviewer: Reviewer) => {
    const shareText = `${reviewer.title}\n\n${reviewer.plain_text || 'A reviewer created in Cali.'}`
    try {
      if (navigator.share) {
        await navigator.share({ title: reviewer.title, text: shareText })
        setNotice({ kind: 'success', text: 'Reviewer shared.' })
      } else {
        await navigator.clipboard.writeText(shareText)
        setNotice({ kind: 'success', text: 'Reviewer copied to your clipboard.' })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice({ kind: 'error', text: 'Could not share this reviewer. Please try again.' })
    }
  }
  const noticeBanner = notice && <div className={`study-notice study-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><CloseIcon /></button></div>

  if (selected) {
    const selectedSubject = selected.subject_id ? subjectMap.get(selected.subject_id) : null
    return <section className="study-page study-page--reviewer">
      <nav className="reviewer-page-nav" aria-label="Reviewer navigation">
        <button type="button" className="reviewer-back" onClick={() => navigate({ reviewer: null, edit: null })}><BackIcon /> Back to library</button>
      </nav>
      {noticeBanner}
      {editing ? <ReviewerEditor key={selected.id} reviewer={selected} subjects={subjects} onSaved={updateReviewer} onClose={() => navigate({ edit: null })} /> : <article className="reviewer-reading">
        <header>
          <div><p className="workspace-overline">{selectedSubject?.subject_code ?? 'GENERAL REVIEWER'}</p><h1>{selected.title}</h1><p>Updated {formatReviewerDate(selected.updated_at)}</p></div>
          <div className="reviewer-reader-actions">
            <button type="button" className="study-secondary" onClick={() => navigate({ edit: '1' })}><EditIcon /> Edit</button>
            <button type="button" className="study-secondary" onClick={() => { void shareReviewer(selected) }}><ShareIcon /> Share</button>
            <details><summary aria-label="More reviewer actions">•••</summary><div><button type="button" onClick={() => { void duplicate(selected) }}>Duplicate</button><button type="button" className="is-danger" onClick={() => { void remove(selected) }}>Delete permanently</button></div></details>
          </div>
        </header>
        <DocumentView content={selected.content} />
      </article>}
    </section>
  }

  return <section className="study-page">
    <header className="study-heading"><div><p className="workspace-overline">STUDY SPACE</p><h1>Study <em>smarter.</em></h1><p>Write focused reviewers and keep them organized with your subjects.</p></div><div className="study-heading-actions"><button type="button" className="button-primary" onClick={() => navigate({ new: 'manual', reviewer: null, edit: null })}><span aria-hidden="true">+</span> New reviewer</button></div></header>
    <div className="study-tabs" role="tablist" aria-label="Study tools"><button type="button" className="is-active" role="tab" aria-selected="true">Reviewers</button><button type="button" role="tab" aria-selected="false" disabled>Flashcards <span>Coming soon</span></button><button type="button" role="tab" aria-selected="false" disabled>Quizzes <span>Coming soon</span></button></div>
    {noticeBanner}
    <section className="reviewer-library" aria-label="Reviewer library">
      <div className="reviewer-library-head"><div><p className="workspace-overline">YOUR LIBRARY</p><h2>Your reviewers</h2></div><span>{reviewers.length}</span></div>
      <div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers" aria-label="Search reviewers" /></label><select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} aria-label="Filter by subject"><option value="">All subjects</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code}</option>)}</select></div>
      <div className="reviewer-list">{loading ? <div className="reviewer-list-skeleton"><span /><span /><span /></div> : visible.length ? visible.map(reviewer => { const subject = reviewer.subject_id ? subjectMap.get(reviewer.subject_id) : null; return <button type="button" key={reviewer.id} className="reviewer-preview-card" onClick={() => navigate({ reviewer: reviewer.id, edit: null, new: null })}><span className="reviewer-list-top"><strong>{reviewer.title}</strong><span aria-hidden="true">→</span></span><span className="reviewer-preview-meta">{subject?.subject_code ?? 'General'} · {formatReviewerDate(reviewer.updated_at)}</span><p>{reviewer.plain_text || 'This reviewer is ready for your notes.'}</p><span className="reviewer-preview-open">Open reviewer</span></button> }) : <div className="reviewer-empty-list"><strong>{reviewers.length ? 'No matches' : 'Your first reviewer starts here'}</strong><p>{reviewers.length ? 'Try another search or subject.' : 'Create a blank reviewer and shape it around the way you study.'}</p>{!reviewers.length && <button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>Create reviewer</button>}</div>}</div>
    </section>
    <dialog ref={createRef} className="study-dialog study-create-dialog" onCancel={event => { event.preventDefault(); navigate({ new: null }) }}><form onSubmit={createReviewer} className="study-dialog-shell"><header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Start with a blank page</h2><p>Give it a clear title. You can change the subject anytime.</p></div><button type="button" className="study-dialog-close" onClick={() => navigate({ new: null })}><CloseIcon /></button></header><div className="study-form-grid"><label className="study-field study-field--wide"><span>Title <small>{newTitle.length}/160</small></span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Example: Midterm reviewer" /></label><label className="study-field study-field--wide"><span>Subject</span><select value={newSubject} onChange={event => setNewSubject(event.target.value)}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div><footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create reviewer'}</button></footer></form></dialog>
  </section>
}
