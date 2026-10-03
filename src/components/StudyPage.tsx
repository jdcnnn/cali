import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
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

const BlockLayout = Extension.create({
  name: 'blockLayout',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: element => Number(element.getAttribute('data-indent') ?? 0),
          renderHTML: attributes => attributes.indent ? { 'data-indent': String(attributes.indent) } : {},
        },
        lineHeight: {
          default: null,
          parseHTML: element => element.getAttribute('data-line-height'),
          renderHTML: attributes => attributes.lineHeight ? { 'data-line-height': String(attributes.lineHeight) } : {},
        },
      },
    }]
  },
})

const editorExtensions = [StarterKit.configure({ heading: { levels: [2, 3] } }), TextStyle, Color, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), Underline, BlockLayout]

function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg> }
function ShareIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg> }
function MoreIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg> }
function AlignIcon({ direction }: { direction: 'left' | 'center' | 'right' | 'justify' }) { const paths = direction === 'left' ? ['M4 6h16', 'M4 10h11', 'M4 14h16', 'M4 18h9'] : direction === 'center' ? ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M8 18h8'] : direction === 'right' ? ['M4 6h16', 'M9 10h11', 'M4 14h16', 'M11 18h9'] : ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16']; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{paths.map(path => <path key={path} d={path} />)}</svg> }
function IndentIcon({ outdent = false }: { outdent?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6h10M10 10h10M10 14h10M10 18h10" /><path d={outdent ? 'm7 9-3 3 3 3' : 'm4 9 3 3-3 3'} /></svg> }
function ListIcon({ ordered = false }: { ordered?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{ordered ? <><path d="M4 6h1v3M3.5 9H6M3.5 14c.3-.8 2.5-.9 2.5.3 0 .8-2.5 2.7-2.5 2.7H6" /></> : <><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" /></>}<path d="M9 7h11M9 12h11M9 17h11" /></svg> }
function UndoIcon({ redo = false }: { redo?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={redo ? 'm16 7 4 4-4 4' : 'm8 7-4 4 4 4'} /><path d={redo ? 'M20 11h-9a6 6 0 0 0-6 6' : 'M4 11h9a6 6 0 0 1 6 6'} /></svg> }
function TextColorIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m6 17 6-13 6 13M8 13h8" /><path d="M5 21h14" /></svg> }
function MarkerIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 4 6 6-9 9H5v-6Z" /><path d="m11 7 6 6M4 21h16" /></svg> }

function DocumentView({ content, editable = false, onEditor }: { content: JSONContent; editable?: boolean; onEditor?: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: editorExtensions, content, editable, immediatelyRender: false })
  useEffect(() => { if (editor) onEditor?.(editor) }, [editor, onEditor])
  useEffect(() => { if (editor && !editable && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content) }, [content, editable, editor])
  return <EditorContent editor={editor} className={editable ? 'reviewer-editor-content' : 'reviewer-document'} />
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="reviewer-toolbar" aria-hidden="true" />
  const blockType = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'
  const blockName = blockType === 'p' ? 'paragraph' : 'heading'
  const blockAttributes = editor.getAttributes(blockName)
  const indent = Number(blockAttributes.indent ?? 0)
  const lineHeight = String(blockAttributes.lineHeight ?? '1.75')
  const setBlockAttribute = (attributes: Record<string, unknown>) => { editor.chain().focus().updateAttributes(blockName, attributes).run() }
  const adjustIndent = (amount: number) => {
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      if (amount > 0) editor.chain().focus().sinkListItem('listItem').run()
      else editor.chain().focus().liftListItem('listItem').run()
      return
    }
    setBlockAttribute({ indent: Math.max(0, Math.min(4, indent + amount)) })
  }
  const button = (label: string, active: boolean, action: () => void, content: ReactNode, disabled = false) => <button type="button" className={active ? 'is-active' : ''} aria-label={label} title={label} disabled={disabled} onClick={action}>{content}</button>
  return <div className="reviewer-toolbar" aria-label="Reviewer formatting">
    <div className="reviewer-toolbar-group reviewer-toolbar-style"><select aria-label="Text style" value={blockType} onChange={event => { if (event.target.value === 'h2') editor.chain().focus().setHeading({ level: 2 }).run(); else if (event.target.value === 'h3') editor.chain().focus().setHeading({ level: 3 }).run(); else editor.chain().focus().setParagraph().run() }}><option value="p">Normal text</option><option value="h2">Heading</option><option value="h3">Subheading</option></select></div>
    <div className="reviewer-toolbar-group reviewer-toolbar-format">
      {button('Bold', editor.isActive('bold'), () => { editor.chain().focus().toggleBold().run() }, <strong>B</strong>)}
      {button('Italic', editor.isActive('italic'), () => { editor.chain().focus().toggleItalic().run() }, <em>I</em>)}
      {button('Underline', editor.isActive('underline'), () => { editor.chain().focus().toggleUnderline().run() }, <u>U</u>)}
      <label className="reviewer-color-control" title="Font color"><TextColorIcon /><input type="color" aria-label="Font color" defaultValue="#12384d" onChange={event => editor.chain().focus().setColor(event.target.value).run()} /></label>
      <label className={`reviewer-color-control${editor.isActive('highlight') ? ' is-active' : ''}`} title="Marker color"><MarkerIcon /><input type="color" aria-label="Marker color" defaultValue="#fff0a8" onChange={event => editor.chain().focus().setHighlight({ color: event.target.value }).run()} /></label>
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-alignment">
      {button('Align left', editor.isActive({ textAlign: 'left' }), () => { editor.chain().focus().setTextAlign('left').run() }, <AlignIcon direction="left" />)}
      {button('Align center', editor.isActive({ textAlign: 'center' }), () => { editor.chain().focus().setTextAlign('center').run() }, <AlignIcon direction="center" />)}
      {button('Align right', editor.isActive({ textAlign: 'right' }), () => { editor.chain().focus().setTextAlign('right').run() }, <AlignIcon direction="right" />)}
      {button('Justify', editor.isActive({ textAlign: 'justify' }), () => { editor.chain().focus().setTextAlign('justify').run() }, <AlignIcon direction="justify" />)}
      {button('Decrease indent', false, () => adjustIndent(-1), <IndentIcon outdent />, indent === 0 && !editor.isActive('listItem'))}
      {button('Increase indent', false, () => adjustIndent(1), <IndentIcon />)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-paragraph">
      <label className="reviewer-line-height" title="Line spacing"><span aria-hidden="true">↕</span><select aria-label="Line spacing" value={lineHeight} onChange={event => setBlockAttribute({ lineHeight: event.target.value })}><option value="1">1.0</option><option value="1.15">1.15</option><option value="1.5">1.5</option><option value="1.75">1.75</option><option value="2">2.0</option></select></label>
      {button('Bulleted list', editor.isActive('bulletList'), () => { editor.chain().focus().toggleBulletList().run() }, <ListIcon />)}
      {button('Numbered list', editor.isActive('orderedList'), () => { editor.chain().focus().toggleOrderedList().run() }, <ListIcon ordered />)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-history">
      {button('Undo', false, () => { editor.chain().focus().undo().run() }, <UndoIcon />, !editor.can().undo())}
      {button('Redo', false, () => { editor.chain().focus().redo().run() }, <UndoIcon redo />, !editor.can().redo())}
    </div>
  </div>
}

function ReviewerEditor({ reviewer, subjects, onSaved, onClose }: { reviewer: Reviewer; subjects: ReviewerSubject[]; onSaved: (reviewer: Reviewer) => void; onClose: () => void }) {
  const [title, setTitle] = useState(reviewer.title)
  const [subjectId, setSubjectId] = useState(reviewer.subject_id ?? '')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const revision = useRef(reviewer.revision)
  const changeVersion = useRef(0)
  const markDirty = useCallback(() => { changeVersion.current += 1; setStatus(current => current === 'saving' ? current : 'dirty') }, [])
  const save = useCallback(async () => {
    if (status === 'saved') return true
    if (!supabase || !editor || !title.trim() || status === 'saving') return false
    const savingVersion = changeVersion.current
    setStatus('saving')
    const { data, error } = await supabase.rpc('cali_update_own_reviewer', { p_id: reviewer.id, p_expected_revision: revision.current, p_title: title.trim(), p_subject_id: subjectId || null, p_content: editor.getJSON(), p_plain_text: editor.getText() }).single()
    if (error || !data) { setStatus('error'); return false }
    const changed = data as Reviewer
    revision.current = changed.revision
    const fullySaved = changeVersion.current === savingVersion
    setStatus(fullySaved ? 'saved' : 'dirty'); onSaved(changed); return fullySaved
  }, [editor, onSaved, reviewer.id, status, subjectId, title])
  useEffect(() => { if (status !== 'dirty') return; const timer = window.setTimeout(() => { void save() }, 1200); return () => window.clearTimeout(timer) }, [save, status])
  useEffect(() => { if (!editor) return; editor.on('update', markDirty); return () => { editor.off('update', markDirty) } }, [editor, markDirty])
  const finish = async () => { if (await save()) onClose() }
  return <section className="reviewer-edit-shell"><header><div><p className="workspace-overline">EDIT REVIEWER</p><input value={title} maxLength={160} aria-label="Reviewer title" onChange={event => { setTitle(event.target.value); markDirty() }} /></div><div className="reviewer-edit-actions"><span className={`reviewer-save-state reviewer-save-state--${status}`}>{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Autosave pending' : status === 'error' ? 'Couldn’t save' : 'Saved'}</span><button type="button" className="button-primary" disabled={status === 'saving' || !title.trim()} onClick={() => { void finish() }}>Done</button></div></header><div className="reviewer-edit-subject"><label>Subject <select value={subjectId} onChange={event => { setSubjectId(event.target.value); markDirty() }}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div><Toolbar editor={editor} /><DocumentView content={reviewer.content} editable onEditor={setEditor} /></section>
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
            <button type="button" className="reviewer-icon-action" aria-label="Edit reviewer" title="Edit reviewer" onClick={() => navigate({ edit: '1' })}><EditIcon /></button>
            <button type="button" className="reviewer-icon-action" aria-label="Share reviewer — coming with Cali Community" title="Sharing will be available with Cali Community" disabled><ShareIcon /></button>
            <details><summary aria-label="More reviewer actions" title="More actions"><MoreIcon /></summary><div><button type="button" onClick={() => { void duplicate(selected) }}>Duplicate</button><button type="button" className="is-danger" onClick={() => { void remove(selected) }}>Delete permanently</button></div></details>
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
      <div className="reviewer-library-head"><div><p className="workspace-overline">YOUR LIBRARY</p><h2>Your reviewers</h2></div></div>
      <div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers" aria-label="Search reviewers" /></label><select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} aria-label="Filter by subject"><option value="">All subjects</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code}</option>)}</select></div>
      <div className="reviewer-list">{loading ? <div className="reviewer-list-skeleton"><span /><span /><span /></div> : visible.length ? visible.map(reviewer => { const subject = reviewer.subject_id ? subjectMap.get(reviewer.subject_id) : null; return <button type="button" key={reviewer.id} className="reviewer-preview-card" onClick={() => navigate({ reviewer: reviewer.id, edit: null, new: null })}><span className="reviewer-list-top"><strong>{reviewer.title}</strong><span aria-hidden="true">→</span></span><span className="reviewer-preview-meta">{subject?.subject_code ?? 'General'} · {formatReviewerDate(reviewer.updated_at)}</span><p>{reviewer.plain_text || 'This reviewer is ready for your notes.'}</p><span className="reviewer-preview-open">Open reviewer</span></button> }) : <div className="reviewer-empty-list"><strong>{reviewers.length ? 'No matches' : 'Your first reviewer starts here'}</strong><p>{reviewers.length ? 'Try another search or subject.' : 'Create a blank reviewer and shape it around the way you study.'}</p>{!reviewers.length && <button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>Create reviewer</button>}</div>}</div>
    </section>
    <dialog ref={createRef} className="study-dialog study-create-dialog" onCancel={event => { event.preventDefault(); navigate({ new: null }) }}><form onSubmit={createReviewer} className="study-dialog-shell"><header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Start with a blank page</h2><p>Give it a clear title. You can change the subject anytime.</p></div><button type="button" className="study-dialog-close" onClick={() => navigate({ new: null })}><CloseIcon /></button></header><div className="study-form-grid"><label className="study-field study-field--wide"><span>Title <small>{newTitle.length}/160</small></span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Example: Midterm reviewer" /></label><label className="study-field study-field--wide"><span>Subject</span><select value={newSubject} onChange={event => setNewSubject(event.target.value)}><option value="">General</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.subject_code} — {subject.title}</option>)}</select></label></div><footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create reviewer'}</button></footer></form></dialog>
  </section>
}
