import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import {
  applySessionRatings, buildFlashcardSession, buildQuizSnapshot, EMPTY_RICH_TEXT, nextQuizQuestionIndex, quizSnapshotMatchesQuestions, richTextFromText, scoreQuiz, SKIPPED_QUIZ_ANSWER,
  validFlashcard, validQuizQuestion, type Flashcard, type FlashcardRating,
  type FlashcardSession, type FlashcardSet, type FlashcardStudyOptions, type Quiz, type QuizAttempt, type QuizChoice, type QuizQuestion,
} from '../lib/studySets'
import type { ReviewerSubject } from '../lib/reviewers'
import { CaliSelect, type CaliSelectOption } from './CaliSelect'
import { BackArrowIcon } from './BackArrowIcon'
import { ConfirmationIcon, type ConfirmationIconKind } from './ConfirmationIcon'
import { StudyLibraryCardsSkeleton, StudyLibraryFiltersSkeleton } from './StudyLibrarySkeleton'

type Tool = 'flashcards' | 'quizzes'
type ReferenceNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: ReferenceNode[] }
type SourceReviewer = { id: string; title: string; subject_id: string | null; plain_text?: string; content?: ReferenceNode }
type SetSummary = { id: string; subject_id: string | null; source_reviewer_title: string | null; title: string; revision: number; count: number; draftCount: number; mastered: number; updated_at: string }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const newId = () => crypto.randomUUID()
const isFlashcardTool = (value: Tool): boolean => value === 'flashcards'
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function sameFlashcardContent(left: FlashcardSet, right: FlashcardSet): boolean {
  return left.title === right.title && left.subject_id === right.subject_id && left.source_reviewer_id === right.source_reviewer_id && sameJson(left.cards, right.cards)
}

function sameQuizContent(left: Quiz, right: Quiz): boolean {
  return left.title === right.title && left.subject_id === right.subject_id && left.source_reviewer_id === right.source_reviewer_id && sameJson(left.questions, right.questions)
}

function saveErrorMessage(error: { message?: string } | null, item: 'flashcard set' | 'quiz'): string {
  if (error?.message?.includes('changed in another tab')) return `This ${item} changed elsewhere. Refresh the page before editing it again.`
  if (error?.message?.includes('verified RTU Google account') || error?.message?.includes('eligible')) return 'Your session is no longer authorized. Sign in again, then retry.'
  return `Cali could not save this ${item}. Check your connection and try again.`
}

const formatDate = (value: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
const subjectSelectOptions = (subjects: ReviewerSubject[]): CaliSelectOption[] => [
  { value: '', label: 'General' },
  ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` })),
]
const questionTypeOptions: CaliSelectOption[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True or false' },
]

function SwapIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l-3-3M18 17H6l3 3" /></svg> }
function ChevronIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg> }
function MoreIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg> }
function MoveIcon({ direction }: { direction: 'up' | 'down' }) { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'up' ? 'm5.5 11.5 4.5-4 4.5 4' : 'm5.5 8.5 4.5 4 4.5-4'} /></svg> }
function DuplicateIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="6" y="6" width="9" height="9" rx="2" /><path d="M12 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1" /></svg> }

function renderReferenceNodes(nodes: ReferenceNode[] = []): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type ?? 'node'}-${index}`
    const children = renderReferenceNodes(node.content)
    if (node.type === 'text') return <span key={key}>{node.text}</span>
    if (node.type === 'hardBreak') return <br key={key} />
    if (node.type === 'heading') return <h4 key={key}>{children}</h4>
    if (node.type === 'paragraph') return <p key={key}>{children}</p>
    if (node.type === 'bulletList') return <ul key={key}>{children}</ul>
    if (node.type === 'orderedList') return <ol key={key}>{children}</ol>
    if (node.type === 'listItem' || node.type === 'taskItem') return <li key={key}>{children}</li>
    if (node.type === 'taskList') return <ul key={key} className="is-task-list">{children}</ul>
    if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>
    if (node.type === 'horizontalRule') return <hr key={key} />
    if (node.type === 'codeBlock') return <pre key={key}>{children}</pre>
    if (node.type === 'table') return <div key={key} className="set-source-table"><table><tbody>{children}</tbody></table></div>
    if (node.type === 'tableRow') return <tr key={key}>{children}</tr>
    if (node.type === 'tableHeader') return <th key={key}>{children}</th>
    if (node.type === 'tableCell') return <td key={key}>{children}</td>
    return <div key={key}>{children}</div>
  })
}

function SaveStatus({ status }: { status: SaveState }) {
  const label = status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : status === 'error' ? 'Save failed' : 'All changes saved'
  const shortLabel = status === 'saving' ? 'Saving' : status === 'dirty' ? 'Unsaved' : status === 'error' ? 'Failed' : 'Saved'
  return <span className={`set-save-state is-${status}`} role="status" aria-live="polite"><i aria-hidden="true" /><span className="set-save-label-long">{label}</span><span className="set-save-label-short">{shortLabel}</span></span>
}

function ConfirmDialog({ eyebrow = 'CONFIRM ACTION', title, body, confirmLabel, danger = false, kind, onConfirm, onCancel }: { eyebrow?: string; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; kind?: ConfirmationIconKind; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const confirmed = useRef(false)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  const confirmOnce = () => { if (confirmed.current) return; confirmed.current = true; onConfirm() }
  return <dialog ref={ref} className="study-confirm-dialog" aria-labelledby="study-set-confirm-title" onCancel={event => { event.preventDefault(); onCancel() }}><div><ConfirmationIcon kind={kind ?? (danger ? 'error' : 'confirmation')} /><p className="workspace-overline">{eyebrow}</p><h2 id="study-set-confirm-title">{title}</h2>{typeof body === 'string' ? <p>{body}</p> : <div className="study-confirm-content">{body}</div>}<footer><button type="button" className="study-secondary" autoFocus onClick={onCancel}>Cancel</button><button type="button" className={danger ? 'study-danger' : 'button-primary'} onClick={confirmOnce}>{confirmLabel}</button></footer></div></dialog>
}

function FlashcardSetupDialog({ learningCount, busy, error, onStart, onCancel }: { learningCount: number; busy: boolean; error: string; onStart: (options: FlashcardStudyOptions) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<FlashcardStudyOptions['mode']>('sequential')
  const [learningOnly, setLearningOnly] = useState(false)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="study-confirm-dialog flashcard-setup-dialog" aria-labelledby="flashcard-setup-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div>
    <p className="workspace-overline">CALI STUDY SESSION</p><h2 id="flashcard-setup-title">Set up your session</h2><p>Choose how Cali should arrange this round.</p>
    <fieldset><legend>Card order</legend><div className="flashcard-setup-options"><label><input type="radio" name="flashcard-order" checked={mode === 'sequential'} onChange={() => setMode('sequential')} /><span><strong>In order</strong><small>Follow the deck as written</small></span></label><label><input type="radio" name="flashcard-order" checked={mode === 'shuffle'} onChange={() => setMode('shuffle')} /><span><strong>Shuffle</strong><small>Mix the card order</small></span></label></div></fieldset>
    <label className={`flashcard-learning-toggle${learningCount ? '' : ' is-disabled'}`}><input type="checkbox" checked={learningOnly} disabled={!learningCount} onChange={event => setLearningOnly(event.target.checked)} /><span><strong>Still learning only</strong><small>{learningCount ? `${learningCount} ${learningCount === 1 ? 'card needs' : 'cards need'} more practice` : 'Every ready card is mastered'}</small></span></label>
    {error && <p className="study-form-error" role="alert">{error}</p>}
    <footer><button type="button" className="study-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="button-primary" onClick={() => onStart({ mode, learningOnly })} disabled={busy}>{busy ? 'Starting' : 'Start session'}</button></footer>
  </div></dialog>
}

function ToolTabs({ tool, navigate }: { tool: Tool; navigate: (changes: Record<string, string | null>) => void }) {
  return <div className="study-tabs" role="tablist" aria-label="Study tools">
    <button type="button" role="tab" aria-selected="false" onClick={() => navigate({ tool: null, set: null, quiz: null, edit: null, new: null })}>Reviewers</button>
    <button type="button" role="tab" aria-selected={tool === 'flashcards'} className={tool === 'flashcards' ? 'is-active' : ''} onClick={() => navigate({ tool: 'flashcards', set: null, quiz: null, edit: null, new: null })}>Flashcards</button>
    <button type="button" role="tab" aria-selected={tool === 'quizzes'} className={tool === 'quizzes' ? 'is-active' : ''} onClick={() => navigate({ tool: 'quizzes', set: null, quiz: null, edit: null, new: null })}>Quizzes</button>
  </div>
}

function SourcePanel({ sourceId, reviewers, onSourceChange }: { sourceId: string | null; reviewers: SourceReviewer[]; onSourceChange: (sourceId: string) => void }) {
  const [source, setSource] = useState<SourceReviewer | null>(null)
  const [choosing, setChoosing] = useState(false)
  useEffect(() => {
    if (!supabase || !sourceId) return
    let active = true
    void supabase.from('reviewers').select('id,title,subject_id,plain_text,content').eq('id', sourceId).maybeSingle().then(({ data }) => { if (active) setSource(data as SourceReviewer | null) })
    return () => { active = false }
  }, [sourceId])
  const activeSource = source?.id === sourceId ? source : null
  const alternatives = reviewers.filter(reviewer => reviewer.id !== sourceId)
  return <aside className="set-source-panel">
    <details open>
      <summary><div className="set-source-heading"><p className="workspace-overline">REFERENCE REVIEWER</p><h3>{sourceId ? activeSource?.title ?? 'Loading reviewer…' : 'No reviewer selected'}</h3></div><ChevronIcon /></summary>
      <div className="set-source-body">{sourceId && <><p>Use these notes as your reference while writing each item.</p><div className="set-source-document">{activeSource?.content ? renderReferenceNodes(activeSource.content.content) : <p>{activeSource?.plain_text || 'This reviewer does not contain any text yet.'}</p>}</div></>}{choosing ? <div className="set-source-picker" role="listbox" aria-label="Choose another reference reviewer">{alternatives.map(reviewer => <button key={reviewer.id} type="button" role="option" aria-selected="false" onClick={() => { setChoosing(false); onSourceChange(reviewer.id) }}><strong>{reviewer.title}</strong></button>)}<button type="button" className="set-source-picker-cancel" onClick={() => setChoosing(false)}>Cancel</button></div> : <button type="button" className="study-secondary set-source-change" disabled={!alternatives.length} onClick={() => setChoosing(true)}>Use other reviewers</button>}</div>
    </details>
  </aside>
}

function FlashcardEditor({ initial, subjects, reviewers, onSaved, onBack }: { initial: FlashcardSet; subjects: ReviewerSubject[]; reviewers: SourceReviewer[]; onSaved: (set: FlashcardSet) => void; onBack: () => void }) {
  const [record, setRecord] = useState(initial)
  const [title, setTitle] = useState(initial.title)
  const [subjectId, setSubjectId] = useState(initial.subject_id ?? '')
  const [sourceReviewerId, setSourceReviewerId] = useState(initial.source_reviewer_id ?? '')
  const [cards, setCards] = useState(initial.cards)
  const [status, setStatus] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<{ card: Flashcard; index: number } | null>(null)
  const [removedCard, setRemovedCard] = useState<{ card: Flashcard; index: number } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [swappingCardId, setSwappingCardId] = useState<string | null>(null)
  const saveInFlight = useRef<Promise<boolean> | null>(null)
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  const autosaveTimer = useRef<number | null>(null)
  const savedFingerprint = useRef(JSON.stringify({ title: initial.title.trim(), subjectId: initial.subject_id ?? '', sourceReviewerId: initial.source_reviewer_id ?? '', cards: initial.cards }))
  const editVersion = useRef(0)
  const readyCount = cards.filter(validFlashcard).length
  const scheduleAutosave = () => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current)
    autosaveTimer.current = window.setTimeout(() => { autosaveTimer.current = null; void saveRef.current() }, 1200)
  }
  const markDirty = () => { editVersion.current += 1; setSaveError(''); setStatus('dirty'); scheduleAutosave() }
  const changeCard = (id: string, changes: Partial<Flashcard>) => { setCards(current => current.map(card => card.id === id ? { ...card, ...changes } : card)); markDirty() }
  const save = useCallback(async () => {
    if (!supabase || !title.trim()) return false
    if (saveInFlight.current) return saveInFlight.current
    const fingerprint = JSON.stringify({ title: title.trim(), subjectId, sourceReviewerId, cards })
    if (fingerprint === savedFingerprint.current) { setStatus('saved'); return true }
    const request = (async () => {
      const savingVersion = editVersion.current
      setSaveError(''); setStatus('saving')
      try {
        let { data, error } = await supabase.rpc('cali_update_own_flashcard_set', { p_id: record.id, p_expected_revision: record.revision, p_title: title.trim(), p_subject_id: subjectId || null, p_source_reviewer_id: sourceReviewerId || null, p_cards: cards }).single()
        if (error?.message.includes('changed in another tab')) {
          const latestResult = await supabase.from('flashcard_sets').select('*').eq('id', record.id).maybeSingle()
          const latest = latestResult.data as FlashcardSet | null
          if (!latestResult.error && latest && sameFlashcardContent(record, latest)) {
            const retry = await supabase.rpc('cali_update_own_flashcard_set', { p_id: record.id, p_expected_revision: latest.revision, p_title: title.trim(), p_subject_id: subjectId || null, p_source_reviewer_id: sourceReviewerId || null, p_cards: cards }).single()
            data = retry.data; error = retry.error
          }
        }
        if (error || !data) { setSaveError(saveErrorMessage(error, 'flashcard set')); setStatus('error'); return false }
        const saved = data as FlashcardSet
        const hasNewerEdits = editVersion.current !== savingVersion
        savedFingerprint.current = fingerprint
        setRecord(saved); onSaved(saved); setStatus(hasNewerEdits ? 'dirty' : 'saved')
        if (hasNewerEdits) scheduleAutosave()
        return true
      } catch {
        setSaveError(saveErrorMessage(null, 'flashcard set')); setStatus('error'); return false
      }
    })().finally(() => { saveInFlight.current = null })
    saveInFlight.current = request
    return request
  }, [cards, onSaved, record, sourceReviewerId, subjectId, title])
  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => () => { if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current) }, [])
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { if (status !== 'saved') event.preventDefault() }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [status])
  const addCard = () => { setCards(current => [...current, { id: newId(), front: EMPTY_RICH_TEXT, back: EMPTY_RICH_TEXT, frontText: '', backText: '' }]); markDirty() }
  const moveCard = (index: number, direction: -1 | 1) => {
    const destination = index + direction
    if (destination < 0 || destination >= cards.length) return
    setCards(current => { const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]]; return next })
    markDirty()
  }
  const duplicateCard = (card: Flashcard, index: number) => {
    const copy = { ...card, id: newId() }
    setCards(current => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)])
    markDirty()
  }
  const swapCard = (card: Flashcard) => {
    if (swappingCardId) return
    setSwappingCardId(card.id)
    changeCard(card.id, { front: card.back, back: card.front, frontText: card.backText, backText: card.frontText })
    window.setTimeout(() => setSwappingCardId(current => current === card.id ? null : current), 360)
  }
  return <section className="set-detail-page">
    <nav className="reviewer-page-nav set-editor-nav"><button type="button" className="cali-back-link" onClick={async () => { if (status === 'dirty' || status === 'error' || status === 'saving') { const version = editVersion.current; if (await save()) { if (editVersion.current === version || await saveRef.current()) onBack(); else setConfirmDiscard(true) } else setConfirmDiscard(true); return } onBack() }}><BackArrowIcon /><span className="set-back-label-long">Back to flashcards</span><span className="set-back-label-short">Flashcards</span></button><div className="set-editor-actions"><SaveStatus status={status} /><button type="button" className="button-primary" disabled={status === 'saved' || status === 'saving' || !title.trim()} onClick={() => void save()}><span className="set-save-button-long">{status === 'error' ? 'Retry save' : 'Save changes'}</span><span className="set-save-button-short">{status === 'error' ? 'Retry' : 'Save'}</span></button></div></nav>
    {saveError && <p className="study-form-error set-editor-error" role="alert">{saveError}</p>}
    <div className="set-builder-layout">
      <SourcePanel sourceId={sourceReviewerId || null} reviewers={reviewers} onSourceChange={nextSourceId => { setSourceReviewerId(nextSourceId); markDirty() }} />
      <main className="set-builder">
        <header className="set-builder-header flashcard-builder-header"><div className="set-builder-heading flashcard-builder-heading"><p className="workspace-overline">FLASHCARD SET</p></div><label className="set-title-field"><span>Set title</span><input className="set-title-input" value={title} maxLength={160} aria-label="Flashcard set title" onChange={event => { setTitle(event.target.value); markDirty() }} /></label><div className="set-subject-field"><span>Subject</span><CaliSelect value={subjectId} options={subjectSelectOptions(subjects)} ariaLabel="Flashcard subject" className="cali-select--subject cali-select--set-field" onChange={nextValue => { setSubjectId(nextValue); markDirty() }} /></div><div className="set-deck-status flashcard-deck-status"><div><span>Deck progress</span><strong>{readyCount} of {cards.length} ready</strong></div><div className="set-deck-meter" aria-label={`${readyCount} of ${cards.length} cards ready`}><span style={{ width: `${cards.length ? (readyCount / cards.length) * 100 : 0}%` }} /></div></div></header>
        {removedCard && <div className="set-removal-notice" role="status"><span>Card {removedCard.index + 1} removed.</span><button type="button" onClick={() => { const removed = removedCard; setCards(current => [...current.slice(0, removed.index), removed.card, ...current.slice(removed.index)]); setRemovedCard(null); markDirty() }}>Undo</button></div>}
        {cards.length ? <><div className="set-item-list">{cards.map((card, index) => <article key={card.id} className={`set-item-card flashcard-compose-card${validFlashcard(card) ? '' : ' is-draft'}${swappingCardId === card.id ? ' is-swapping' : ''}`}>
          <div className="set-item-head"><div className="set-item-identity"><span className="set-item-number">{index + 1}</span><div><strong>Flashcard</strong><small>Front and back pair</small></div></div><div className="set-item-actions flashcard-item-actions"><span className="set-item-readiness">{validFlashcard(card) ? 'Ready' : 'Draft'}</span><div className="flashcard-order-actions" aria-label={`Actions for card ${index + 1}`}><button type="button" disabled={index === 0} onClick={() => moveCard(index, -1)} aria-label={`Move card ${index + 1} up`} title="Move up"><MoveIcon direction="up" /></button><button type="button" disabled={index === cards.length - 1} onClick={() => moveCard(index, 1)} aria-label={`Move card ${index + 1} down`} title="Move down"><MoveIcon direction="down" /></button><button type="button" onClick={() => duplicateCard(card, index)} aria-label={`Duplicate card ${index + 1}`} title="Duplicate"><DuplicateIcon /></button></div><button type="button" className="set-remove-item" onClick={() => setRemoveTarget({ card, index })}>Remove</button></div></div>
          <div className="flashcard-compose"><label className="flashcard-side is-front"><span><b>Front</b><small>Question or term</small></span><textarea autoFocus={index === cards.length - 1 && !card.frontText} value={card.frontText} maxLength={10000} placeholder="Example: What is photosynthesis?" onChange={event => changeCard(card.id, { front: richTextFromText(event.target.value), frontText: event.target.value })} /></label><button type="button" className="flashcard-swap-control" disabled={swappingCardId !== null} aria-label={`Swap the front and back of card ${index + 1}`} title="Swap front and back" onClick={() => swapCard(card)}><span><SwapIcon /></span></button><label className="flashcard-side is-back"><span><b>Back</b><small>Answer or definition</small></span><textarea value={card.backText} maxLength={10000} placeholder="Example: The process plants use to convert light into chemical energy." onChange={event => changeCard(card.id, { back: richTextFromText(event.target.value), backText: event.target.value })} /></label></div>
        </article>)}</div><button type="button" className="study-secondary set-add-item" onClick={addCard}>+ Add another card</button></> : <div className="set-empty-builder"><h2>Create your first flashcard</h2><p>Put a question or term on the front, then its answer or definition on the back.</p><button type="button" className="button-primary" onClick={addCard}>+ Create first card</button></div>}
      </main>
    </div>
    {removeTarget && <ConfirmDialog title={`Remove card ${removeTarget.index + 1}?`} body="This card will be removed from the editor. Save the set to make the removal permanent." confirmLabel="Remove card" danger onCancel={() => setRemoveTarget(null)} onConfirm={() => { const target = removeTarget; setCards(current => current.filter((_, index) => index !== target.index)); setRemovedCard(target); setRemoveTarget(null); markDirty() }} />}
    {confirmDiscard && <ConfirmDialog title="Discard unsaved changes?" body="Your changes to this flashcard set have not been saved and will be lost." confirmLabel="Discard changes" danger onCancel={() => setConfirmDiscard(false)} onConfirm={onBack} />}
  </section>
}

function FlashcardStudy({ initial, onChange, onBack }: { initial: FlashcardSet; onChange: (set: FlashcardSet) => void; onBack: () => void }) {
  const [record, setRecord] = useState(initial)
  const [revealed, setRevealed] = useState(false)
  const [completion, setCompletion] = useState<{ total: number; confident: number; mode: FlashcardStudyOptions['mode'] } | null>(null)
  const [studyError, setStudyError] = useState('')
  const [confirmRestart, setConfirmRestart] = useState(false)
  const ratingInFlight = useRef(false)
  const [savingRating, setSavingRating] = useState(false)
  const cards = record.cards.filter(validFlashcard)
  const session = record.active_session
  const current = session ? cards.find(card => card.id === session.cardIds[session.index]) : null
  const persist = async (expected: FlashcardSession | null, active: FlashcardSession | null, progress = record.progress) => {
    if (!supabase) return null
    const { data, error } = await supabase.rpc('cali_save_own_flashcard_study', {
      p_id: record.id,
      p_expected_session_id: expected?.id ?? null,
      p_expected_index: expected?.index ?? null,
      p_active_session: active,
      p_progress: progress,
    }).single()
    if (error || !data) {
      setStudyError(error?.message.includes('changed in another tab')
        ? 'This session changed in another tab. Return to the set to load the latest session.'
        : 'Cali could not save this response. Check your connection, then try again.')
      return null
    }
    const saved = data as FlashcardSet
    setRecord(saved); onChange(saved)
    return saved
  }
  const startSession = async (options: FlashcardStudyOptions) => {
    if (ratingInFlight.current) return
    const fresh = buildFlashcardSession(record.cards, record.progress, options, newId(), new Date().toISOString())
    if (!fresh) { setStudyError(options.learningOnly ? 'Every ready card is already mastered.' : 'This set has no ready cards yet.'); return }
    ratingInFlight.current = true; setSavingRating(true); setStudyError('')
    try {
      const saved = await persist(session, fresh)
      if (saved) { setCompletion(null); setRevealed(false) }
    } finally {
      ratingInFlight.current = false; setSavingRating(false)
    }
  }
  const rate = async (rating: FlashcardRating) => {
    if (!session || !current || ratingInFlight.current) return
    ratingInFlight.current = true; setSavingRating(true); setStudyError('')
    try {
      const ratings = { ...session.ratings, [current.id]: rating }
      if (session.index + 1 < session.cardIds.length) {
        const next = { ...session, ratings, index: session.index + 1 }
        if (await persist(session, next)) setRevealed(false)
        return
      }
      const progress = applySessionRatings(record.progress, ratings, new Date().toISOString())
      if (await persist(session, null, progress)) {
        setCompletion({ total: session.cardIds.length, confident: Object.values(ratings).filter(value => value === 'good').length, mode: session.mode })
        setRevealed(false)
      }
    } finally {
      ratingInFlight.current = false; setSavingRating(false)
    }
  }
  if (!cards.length) return <section className="set-study-shell"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Back to set</span></button><div className="set-study-start"><p className="workspace-overline">CALI FLASHCARDS</p><h1>No ready cards yet</h1><p>Add a front and back to at least one card before studying.</p></div></section>
  if (completion) {
    const learning = Math.max(0, completion.total - completion.confident)
    const remainingLearning = cards.filter(card => !record.progress[card.id]?.mastered).length
    const recallRate = Math.round((completion.confident / Math.max(1, completion.total)) * 100)
    return <section className="set-study-shell flashcard-results-page"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Back to set</span></button><article className="flashcard-complete"><svg className="flashcard-celebration" viewBox="0 0 80 80" aria-hidden="true"><circle className="flashcard-celebration-disc" cx="40" cy="40" r="27" /><path className="flashcard-celebration-check" d="M27 41 36 50 53 30" /></svg><header><div><p className="workspace-overline">CALI SESSION SUMMARY</p><h1>Session complete</h1><p>{record.title}</p></div></header><div className="flashcard-result-callout"><div><strong>{recallRate}% recalled</strong><span>You remembered {completion.confident} of {completion.total} {completion.total === 1 ? 'card' : 'cards'} this round.</span></div><div className="flashcard-result-meter" aria-label={`${recallRate}% recalled`}><span style={{ width: `${recallRate}%` }} /></div></div><div className="flashcard-complete-stats"><div><strong>{completion.confident}</strong><span>Remembered</span></div><div><strong>{learning}</strong><span>Still learning</span></div></div>{studyError && <p className="study-form-error" role="alert">{studyError}</p>}<footer className="flashcard-result-actions">{remainingLearning > 0 && <button type="button" className="button-primary" disabled={savingRating} onClick={() => void startSession({ mode: completion.mode, learningOnly: true })}>Review still learning</button>}<button type="button" className={remainingLearning > 0 ? 'study-secondary' : 'button-primary'} disabled={savingRating} onClick={() => void startSession({ mode: completion.mode, learningOnly: false })}>Study all again</button><button type="button" className="flashcard-result-back" onClick={onBack}>Back to set</button></footer></article></section>
  }
  if (!session || !current) return <section className="set-study-shell"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Back to set</span></button><div className="set-study-start"><p className="workspace-overline">CALI FLASHCARDS</p><h1>This session is no longer available</h1><p>The deck may have changed. Return to the set to start a fresh session.</p><button type="button" className="button-primary" onClick={onBack}>Return to set</button></div></section>
  return <section className="set-study-shell flashcard-session"><nav className="set-session-nav"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Back to set</span></button><button type="button" className="study-secondary flashcard-restart-button" disabled={savingRating} onClick={() => setConfirmRestart(true)}>Restart</button></nav><header className="flashcard-session-head"><div><p className="workspace-overline">CALI FLASHCARD SESSION</p><h1>{record.title}</h1></div><div><strong>{session.cardIds.length - session.index}</strong><span>remaining</span></div></header><div className="set-progress"><span style={{ width: `${(session.index / session.cardIds.length) * 100}%` }} /></div><div className="flashcard-session-meta"><span>Card {session.index + 1} of {session.cardIds.length}</span><p>{revealed ? 'How well did you recall it?' : 'Recall the answer before revealing it.'}</p></div>{studyError && <p className="study-form-error" role="alert">{studyError}</p>}<div className={`flashcard-stage${revealed ? ' is-revealed' : ''}`}>{!revealed ? <button type="button" className="flashcard-study-card" aria-label="Tap to show answer" onClick={() => setRevealed(true)}><div className="set-plain-text">{current.frontText}</div><small className="flashcard-reveal-label"><span>Tap To Show Answer</span></small></button> : <article className="flashcard-study-card"><span className="flashcard-side-label">Answer</span><p className="flashcard-study-prompt">{current.frontText}</p><div className="set-plain-text">{current.backText}</div></article>}{revealed && <div className="flashcard-ratings" aria-label="Rate your recall" aria-busy={savingRating}><button type="button" disabled={savingRating} onClick={() => void rate('hard')}><strong>Still learning</strong><small>Needs another pass</small></button><button type="button" disabled={savingRating} onClick={() => void rate('good')}><strong>Remembered</strong><small>Count this recall</small></button></div>}</div>{confirmRestart && <ConfirmDialog eyebrow="RESTART SESSION" title="Restart this flashcard session?" body="Your current place and responses in this session will be replaced. Mastery from completed sessions will remain." confirmLabel="Restart session" kind="restart" onCancel={() => setConfirmRestart(false)} onConfirm={() => { setConfirmRestart(false); void startSession({ mode: session.mode, learningOnly: session.learningOnly }) }} />}</section>
}

function FlashcardOverview({ flashcardSet, onChange, onStudy }: { flashcardSet: FlashcardSet; onChange: (set: FlashcardSet) => void; onStudy: () => void }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const cards = flashcardSet.cards.filter(validFlashcard)
  const mastered = cards.filter(card => flashcardSet.progress[card.id]?.mastered).length
  const learning = cards.length - mastered
  const progress = cards.length ? (mastered / cards.length) * 100 : 0
  const start = async (options: FlashcardStudyOptions) => {
    if (!supabase || setupBusy) return
    const session = buildFlashcardSession(flashcardSet.cards, flashcardSet.progress, options, newId(), new Date().toISOString())
    if (!session) { setSetupError(options.learningOnly ? 'Every ready card is already mastered.' : 'Complete at least one card before starting.'); return }
    setSetupBusy(true); setSetupError('')
    const expected = flashcardSet.active_session
    const { data, error } = await supabase.rpc('cali_save_own_flashcard_study', { p_id: flashcardSet.id, p_expected_session_id: expected?.id ?? null, p_expected_index: expected?.index ?? null, p_active_session: session, p_progress: flashcardSet.progress }).single()
    setSetupBusy(false)
    if (error || !data) { setSetupError(error?.message.includes('changed in another tab') ? 'This session changed in another tab. Reload the set and try again.' : 'Cali could not start the session. Check your connection and try again.'); return }
    onChange(data as FlashcardSet); setSetupOpen(false); onStudy()
  }
  return <article className="set-overview flashcard-overview">
    <header className="flashcard-overview-head">
      <div><p className="workspace-overline">FLASHCARD SET</p><h1>{flashcardSet.title}</h1><p className="flashcard-set-count">This set has {cards.length} {cards.length === 1 ? 'card' : 'cards'}</p></div>
    </header>
    <div className="flashcard-overview-body">
      <section className="flashcard-overview-summary">
        <div className="flashcard-overview-progress"><div><span>Mastery</span><strong>{mastered} of {cards.length} mastered</strong></div><div className="flashcard-overview-meter" aria-label={`${mastered} of ${cards.length} cards mastered`}><span style={{ width: `${progress}%` }} /></div></div>
        <div className="flashcard-overview-counts"><div><strong>{mastered}</strong><span>Mastered</span></div><div><strong>{learning}</strong><span>Learning</span></div></div>
        <div className="flashcard-overview-actions">{flashcardSet.active_session ? <><button type="button" className="button-primary" onClick={onStudy}>Resume session</button><button type="button" className="study-secondary" onClick={() => setConfirmReplace(true)}>Start new session</button></> : <button type="button" className="button-primary" disabled={!cards.length} onClick={() => { setSetupError(''); setSetupOpen(true) }}>Start studying</button>}</div>
      </section>
      <section className="flashcard-deck-preview">
        <header><p className="workspace-overline">CARDS IN THIS SET</p></header>
        <div>{cards.slice(0, 4).map((card, index) => { const cardProgress = flashcardSet.progress[card.id]; return <div key={card.id} className="flashcard-preview-row"><span>{index + 1}</span><strong>{card.frontText}</strong><small className={cardProgress?.mastered ? 'is-mastered' : ''}>{cardProgress?.mastered ? 'Mastered' : cardProgress?.goodStreak === 1 ? '1 of 2 recalls' : 'Learning'}</small></div> })}{cards.length > 4 && <p className="flashcard-preview-more">+{cards.length - 4} more {cards.length - 4 === 1 ? 'card' : 'cards'}</p>}{cards.length === 0 && <p className="flashcard-preview-empty">No ready cards</p>}</div>
      </section>
    </div>
    {confirmReplace && <ConfirmDialog eyebrow="NEW SESSION" title="Replace the current session?" body="Your current place and responses in this session will be replaced. Mastery from completed sessions will remain." confirmLabel="Set up new session" kind="restart" onCancel={() => setConfirmReplace(false)} onConfirm={() => { setConfirmReplace(false); setSetupError(''); setSetupOpen(true) }} />}
    {setupOpen && <FlashcardSetupDialog learningCount={learning} busy={setupBusy} error={setupError} onCancel={() => { if (!setupBusy) setSetupOpen(false) }} onStart={options => void start(options)} />}
  </article>
}

function newChoice(text = ''): QuizChoice { return { id: newId(), text } }
function newQuestion(text = ''): QuizQuestion { return { id: newId(), type: 'multiple_choice', prompt: richTextFromText(text), promptText: text, choices: [newChoice(), newChoice()], correctChoiceId: '', explanation: EMPTY_RICH_TEXT, explanationText: '' } }
function quizQuestionIssues(question: QuizQuestion): string[] {
  const issues: string[] = []
  if (!question.promptText.trim()) issues.push('Add the question text')
  if (question.type === 'multiple_choice') {
    const completedChoices = question.choices.filter(choice => choice.text.trim())
    if (completedChoices.length < 2) issues.push(`Complete ${2 - completedChoices.length} more ${completedChoices.length === 1 ? 'choice' : 'choices'}`)
    if (!completedChoices.some(choice => choice.id === question.correctChoiceId)) issues.push('Select a completed correct answer')
  } else if (!question.choices.some(choice => choice.id === question.correctChoiceId)) issues.push('Select the correct answer')
  return issues
}

function QuizEditor({ initial, subjects, reviewers, onSaved, onBack }: { initial: Quiz; subjects: ReviewerSubject[]; reviewers: SourceReviewer[]; onSaved: (quiz: Quiz) => void; onBack: () => void }) {
  const [record, setRecord] = useState(initial), [title, setTitle] = useState(initial.title), [subjectId, setSubjectId] = useState(initial.subject_id ?? ''), [sourceReviewerId, setSourceReviewerId] = useState(initial.source_reviewer_id ?? ''), [questions, setQuestions] = useState(initial.questions), [status, setStatus] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<QuizQuestion | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmIncompleteSave, setConfirmIncompleteSave] = useState(false)
  const editVersion = useRef(0), saveInFlight = useRef<Promise<boolean> | null>(null)
  const markDirty = () => { editVersion.current += 1; setSaveError(''); setStatus('dirty') }
  const change = (id: string, values: Partial<QuizQuestion>) => { setQuestions(current => current.map(item => item.id === id ? { ...item, ...values } : item)); markDirty() }
  const save = useCallback(async () => {
    if (!supabase || !title.trim()) return false
    if (saveInFlight.current) return saveInFlight.current
    const request = (async () => {
      const savingVersion = editVersion.current
      setSaveError(''); setStatus('saving')
      try {
        let { data, error } = await supabase.rpc('cali_update_own_quiz', { p_id: record.id, p_expected_revision: record.revision, p_title: title.trim(), p_subject_id: subjectId || null, p_source_reviewer_id: sourceReviewerId || null, p_questions: questions }).single()
        if (error?.message.includes('changed in another tab')) {
          const latestResult = await supabase.from('quizzes').select('*').eq('id', record.id).maybeSingle()
          const latest = latestResult.data as Quiz | null
          if (!latestResult.error && latest && sameQuizContent(record, latest)) {
            const retry = await supabase.rpc('cali_update_own_quiz', { p_id: record.id, p_expected_revision: latest.revision, p_title: title.trim(), p_subject_id: subjectId || null, p_source_reviewer_id: sourceReviewerId || null, p_questions: questions }).single()
            data = retry.data; error = retry.error
          }
        }
        if (error || !data) { setSaveError(saveErrorMessage(error, 'quiz')); setStatus('error'); return false }
        const saved = data as Quiz
        setRecord(saved); onSaved(saved); setStatus(editVersion.current === savingVersion ? 'saved' : 'dirty'); return true
      } catch {
        setSaveError(saveErrorMessage(null, 'quiz')); setStatus('error'); return false
      }
    })().finally(() => { saveInFlight.current = null })
    saveInFlight.current = request
    return request
  }, [onSaved, questions, record, sourceReviewerId, subjectId, title])
  const addQuestion = () => { setQuestions(current => [...current, newQuestion()]); markDirty() }
  const applyQuestionType = (questionId: string, type: QuizQuestion['type']) => change(questionId, type === 'true_false' ? { type, choices: [newChoice('True'), newChoice('False')], correctChoiceId: '' } : { type, choices: [newChoice(), newChoice()], correctChoiceId: '' })
  const draftCount = questions.filter(question => !validQuizQuestion(question)).length
  const readyCount = questions.length - draftCount
  const incompleteQuestions = questions.map((question, index) => ({ index, issues: quizQuestionIssues(question) })).filter(item => item.issues.length)
  return <section className="set-detail-page">
    <nav className="reviewer-page-nav set-editor-nav"><button type="button" className="cali-back-link" onClick={async () => { if (status === 'dirty' || status === 'error') { setConfirmDiscard(true); return } if (status === 'saving') { if (await save()) onBack(); return } onBack() }}><BackArrowIcon /><span className="set-back-label-long">Back to quizzes</span><span className="set-back-label-short">Quizzes</span></button><div className="set-editor-actions"><SaveStatus status={status} /><button type="button" className="button-primary" disabled={status === 'saved' || status === 'saving' || !title.trim()} onClick={() => { if (draftCount) setConfirmIncompleteSave(true); else void save() }}><span className="set-save-button-long">Save changes</span><span className="set-save-button-short">Save</span></button></div></nav>
    {saveError && <p className="study-form-error set-editor-error" role="alert">{saveError}</p>}
    {!saveError && draftCount > 0 && <p className="quiz-draft-notice set-editor-error" role="status"><strong>{draftCount} {draftCount === 1 ? 'question is' : 'questions are'} still a draft.</strong> Complete the question and choices, then select the correct answer.</p>}
    <div className="set-builder-layout">
      <SourcePanel sourceId={sourceReviewerId || null} reviewers={reviewers} onSourceChange={nextSourceId => { setSourceReviewerId(nextSourceId); markDirty() }} />
      <main className="set-builder">
        <header className="set-builder-header"><div className="set-builder-heading"><div><p className="workspace-overline">QUIZ BUILDER</p><p>Add questions, choices, and the correct answer for each item.</p></div></div><label className="set-title-field"><span>Quiz title</span><input className="set-title-input" value={title} maxLength={160} aria-label="Quiz title" onChange={event => { setTitle(event.target.value); markDirty() }} /></label><div className="set-subject-field"><span>Subject</span><CaliSelect value={subjectId} options={subjectSelectOptions(subjects)} ariaLabel="Quiz subject" className="cali-select--subject cali-select--set-field" onChange={nextValue => { setSubjectId(nextValue); markDirty() }} /></div><div className="set-deck-status quiz-readiness-status"><div><span>Quiz build progress</span><strong>{readyCount} of {questions.length} ready</strong></div><div className="set-deck-meter" aria-label={`${readyCount} of ${questions.length} questions ready`}><span style={{ width: `${questions.length ? (readyCount / questions.length) * 100 : 0}%` }} /></div></div></header>
        {questions.length ? <><div className="set-item-list">{questions.map((question, index) => <article key={question.id} className={`set-item-card quiz-compose-card${validQuizQuestion(question) ? '' : ' is-draft'}`}>
          <div className="set-item-head"><strong>Question {index + 1}</strong><span>{validQuizQuestion(question) ? 'Ready' : 'Draft'}</span><button type="button" onClick={() => setRemoveTarget(question)}>Remove</button></div>
          <div className="quiz-compose-grid">
            <div className="quiz-type-field"><span>Type</span><CaliSelect value={question.type} options={questionTypeOptions} ariaLabel={`Question ${index + 1} type`} className="cali-select--question-type" onChange={nextValue => { const type = nextValue as QuizQuestion['type']; if (type !== question.type) applyQuestionType(question.id, type) }} /></div>
            <label className="quiz-question-field"><span>Question</span><textarea autoFocus={index === questions.length - 1 && !question.promptText} value={question.promptText} maxLength={20000} placeholder="Write a clear question" onChange={event => change(question.id, { prompt: richTextFromText(event.target.value), promptText: event.target.value })} /></label>
          </div>
          <fieldset className="quiz-choice-editor"><legend>Choices</legend><p>Choose the correct answer. This is required before the question can appear in the quiz.</p>{question.choices.map((choice, choiceIndex) => <label key={choice.id} className={question.correctChoiceId === choice.id ? 'is-correct-choice' : ''}><input type="radio" name={`correct-${question.id}`} aria-label={`Mark choice ${choiceIndex + 1} as the correct answer`} checked={question.correctChoiceId === choice.id} onChange={() => change(question.id, { correctChoiceId: choice.id })} />{question.type === 'true_false' ? <span className="quiz-choice-label">{choice.text}</span> : <input value={choice.text} maxLength={500} aria-label={`Choice ${choiceIndex + 1}`} placeholder={`Choice ${choiceIndex + 1}`} onChange={event => change(question.id, { choices: question.choices.map(item => item.id === choice.id ? { ...item, text: event.target.value } : item) })} />}{question.type === 'multiple_choice' && question.choices.length > 2 && <button type="button" aria-label={`Remove choice ${choiceIndex + 1}`} onClick={() => change(question.id, { choices: question.choices.filter(item => item.id !== choice.id), correctChoiceId: question.correctChoiceId === choice.id ? '' : question.correctChoiceId })}>×</button>}</label>)}<div className={`quiz-correct-state${question.correctChoiceId ? ' is-selected' : ' is-missing'}`}><small>{question.correctChoiceId ? 'Correct answer selected' : 'Select a correct answer'}</small>{question.correctChoiceId && <button type="button" onClick={() => change(question.id, { correctChoiceId: '' })}>Remove selection</button>}</div>{question.type === 'multiple_choice' && question.choices.length < 6 && <button type="button" className="study-secondary" onClick={() => change(question.id, { choices: [...question.choices, newChoice()] })}>+ Add choice</button>}</fieldset>
          <label className="quiz-explanation-field"><span>Explanation <small>Optional — shown after submission</small></span><textarea value={question.explanationText} maxLength={20000} placeholder="Explain why the answer is correct" onChange={event => change(question.id, { explanation: richTextFromText(event.target.value), explanationText: event.target.value })} /></label>
        </article>)}</div><button type="button" className="study-secondary set-add-item" onClick={addQuestion}>+ Add another question</button></> : <div className="set-empty-builder"><h2>Create your first question</h2><p>Write a clear question, add the choices, then select the correct answer.</p><button type="button" className="button-primary" onClick={addQuestion}>+ Create first question</button></div>}
      </main>
    </div>
    {removeTarget && <ConfirmDialog title={`Remove question ${questions.findIndex(question => question.id === removeTarget.id) + 1}?`} body="This question and its choices will be removed from the editor. Save the quiz to make the removal permanent." confirmLabel="Remove question" danger onCancel={() => setRemoveTarget(null)} onConfirm={() => { setQuestions(current => current.filter(question => question.id !== removeTarget.id)); setRemoveTarget(null); markDirty() }} />}
    {confirmDiscard && <ConfirmDialog title="Discard unsaved changes?" body="Your changes to this quiz have not been saved and will be lost." confirmLabel="Discard changes" danger onCancel={() => setConfirmDiscard(false)} onConfirm={onBack} />}
    {confirmIncompleteSave && <ConfirmDialog eyebrow="INCOMPLETE QUIZ" title="Save with draft questions?" kind="warning" body={<><p>Draft questions will stay in the editor but will not appear in the quiz.</p><ul className="quiz-incomplete-list">{incompleteQuestions.map(item => <li key={item.index}><strong>Question {item.index + 1}</strong><span>{item.issues.join(' · ')}</span></li>)}</ul></>} confirmLabel="Save as draft" onCancel={() => setConfirmIncompleteSave(false)} onConfirm={() => { setConfirmIncompleteSave(false); void save() }} />}
  </section>
}

function QuizRunner({ quiz, attempt: initialAttempt, onAttempt, onBack }: { quiz: Quiz; attempt: QuizAttempt; onAttempt: (attempt: QuizAttempt) => void; onBack: () => void }) {
  const [attempt, setAttempt] = useState(initialAttempt)
  const [saveError, setSaveError] = useState('')
  const attemptRef = useRef(initialAttempt), saveQueue = useRef<Promise<void>>(Promise.resolve())
  const questions = attempt.snapshot.questions, question = questions[attempt.current_index]
  const answered = questions.filter(item => attempt.answers[item.id] && attempt.answers[item.id] !== SKIPPED_QUIZ_ANSWER).length
  const save = (values: Partial<QuizAttempt>) => {
    if (!supabase) return
    setSaveError('')
    const next = { ...attemptRef.current, ...values }; attemptRef.current = next; setAttempt(next); onAttempt(next)
    saveQueue.current = saveQueue.current.then(async () => {
      if (!supabase) return
      const { error } = await supabase.from('quiz_attempts').update(values).eq('id', next.id)
      if (error) throw error
    }).catch(() => setSaveError('Your answer could not be saved. Check your connection before continuing.'))
  }
  const complete = () => { const completedAt = new Date().toISOString(); save({ status: 'completed', score: scoreQuiz(attempt.snapshot, attempt.answers), total: questions.length, completed_at: completedAt }) }

  if (attempt.status === 'completed') {
    const score = attempt.score ?? 0, total = Math.max(1, attempt.total ?? questions.length)
    const skippedTotal = questions.filter(item => !attempt.answers[item.id] || attempt.answers[item.id] === SKIPPED_QUIZ_ANSWER).length
    const incorrectTotal = Math.max(0, total - score - skippedTotal)
    return <section className="set-study-shell quiz-session-shell quiz-results-page">
      <nav className="quiz-session-nav"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Back to quiz</span></button><span>{quiz.title}</span></nav>
      <header className="quiz-result"><div><p className="workspace-overline">ATTEMPT COMPLETE</p><h1>Quiz complete</h1><p>{quiz.title}</p></div></header>
      <div className="quiz-result-summary"><div className="is-correct"><strong>{score}</strong><span>Correct</span></div><div className="is-incorrect"><strong>{incorrectTotal}</strong><span>Incorrect</span></div><div><strong>{total}</strong><span>Total questions</span></div></div>
      <section className="quiz-review"><header><div><p className="workspace-overline">ANSWER BREAKDOWN</p><h2>Results by question</h2></div></header>{questions.map((item, index) => {
        const selected = attempt.answers[item.id], correct = selected === item.correctChoiceId, correctChoice = item.choices.find(choice => choice.id === item.correctChoiceId)
        const selectedChoice = item.choices.find(choice => choice.id === selected)
        const skipped = !selected || selected === SKIPPED_QUIZ_ANSWER
        return <article key={item.id} className={correct ? 'is-correct' : 'is-wrong'}><div className="quiz-review-head"><span>{index + 1}</span><div><strong>{item.promptText}</strong><small>{skipped ? 'Skipped' : correct ? 'Correct' : 'Incorrect'}</small></div></div><div className="quiz-review-responses">{!correct && <div className="quiz-review-answer is-student-answer"><span>Your answer</span><strong>{selectedChoice?.text ?? 'Skipped'}</strong></div>}<div className="quiz-review-answer"><span>Correct answer</span><strong>{correctChoice?.text}</strong></div></div>{item.explanationText && <div className="quiz-explanation"><strong>Explanation</strong><p>{item.explanationText}</p></div>}</article>
      })}</section>
    </section>
  }

  if (!question) return <section className="set-study-shell"><p className="study-form-error">This attempt has no available questions.</p><button type="button" className="study-secondary" onClick={onBack}>Back to quiz</button></section>
  const selectedChoiceId = attempt.answers[question.id]
  const selectedChoice = question.choices.find(choice => choice.id === selectedChoiceId)
  const correctChoice = question.choices.find(choice => choice.id === question.correctChoiceId)
  const isSkipped = selectedChoiceId === SKIPPED_QUIZ_ANSWER
  const isAnswered = Boolean(selectedChoiceId) && !isSkipped
  const isCorrect = selectedChoiceId === question.correctChoiceId
  const progress = (answered / questions.length) * 100
  const nextIndex = isAnswered ? nextQuizQuestionIndex(questions, attempt.answers, attempt.current_index) : null
  const moveForward = () => { if (nextIndex === null) complete(); else save({ current_index: nextIndex }) }
  const skipQuestion = () => {
    const answers = { ...attempt.answers, [question.id]: SKIPPED_QUIZ_ANSWER }
    const next = nextQuizQuestionIndex(questions, answers, attempt.current_index)
    save({ answers, current_index: next ?? attempt.current_index })
  }
  return <section className="set-study-shell quiz-session-shell">
    <nav className="quiz-session-nav"><button type="button" className="cali-back-link" onClick={onBack}><BackArrowIcon /><span>Save and leave</span></button><span>{quiz.title}</span><small>{answered}/{questions.length} answered</small></nav>
    <div className="quiz-session-progress" aria-label={`${answered} of ${questions.length} questions answered`}><span style={{ width: `${progress}%` }} /></div>
    <article key={question.id} className={`quiz-runner${isAnswered ? ' has-feedback' : ''}`}>
      <header className="quiz-question-head"><div><span>Question {attempt.current_index + 1}</span><small>{isSkipped ? 'Skipped earlier' : question.type === 'true_false' ? 'True or false' : 'Multiple choice'}</small></div><strong>{String(attempt.current_index + 1).padStart(2, '0')}<i>/</i>{String(questions.length).padStart(2, '0')}</strong></header>
      <h1 className="quiz-runner-question">{question.promptText}</h1>
      <div className="quiz-runner-choices" role="radiogroup" aria-label="Answer choices">{question.choices.map((choice, index) => {
        const selected = choice.id === selectedChoiceId, correct = isAnswered && choice.id === question.correctChoiceId, incorrect = isAnswered && selected && !correct
        return <button key={choice.id} type="button" role="radio" aria-checked={selected} disabled={isAnswered} className={`${selected ? 'is-selected' : ''}${correct ? ' is-correct' : ''}${incorrect ? ' is-incorrect' : ''}`} onClick={() => save({ answers: { ...attempt.answers, [question.id]: choice.id } })}><span>{String.fromCharCode(65 + index)}</span><strong>{choice.text}</strong></button>
      })}</div>
      {isAnswered && <section className={`quiz-answer-feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`} aria-live="polite"><div><span>{isCorrect ? 'Correct' : 'Incorrect'}</span><h2>Correct answer: {correctChoice?.text}</h2>{!isCorrect && <p>You chose {selectedChoice?.text}.</p>}{question.explanationText && <p>{question.explanationText}</p>}</div></section>}
      {saveError && <p className="study-form-error" role="alert">{saveError}</p>}
      <footer className="quiz-runner-actions"><button type="button" className="study-secondary" disabled={attempt.current_index === 0} onClick={() => save({ current_index: attempt.current_index - 1 })}>Previous</button><div>{!isAnswered && !isSkipped && <button type="button" className="study-secondary quiz-skip-action" onClick={skipQuestion}>Skip item</button>}{isAnswered && <button type="button" className="button-primary" onClick={moveForward}>{nextIndex === null ? 'Finish quiz' : attempt.answers[questions[nextIndex].id] === SKIPPED_QUIZ_ANSWER ? 'Review skipped item' : 'Next question'}</button>}</div></footer>
    </article>
  </section>
}

export function StudySetsPage({ studentId, tool }: { studentId: string; tool: Tool }) {
  const [params, setParams] = useSearchParams(), [subjects, setSubjects] = useState<ReviewerSubject[]>([]), [reviewers, setReviewers] = useState<SourceReviewer[]>([]), [summaries, setSummaries] = useState<SetSummary[]>([]), [loading, setLoading] = useState(true), [query, setQuery] = useState(''), [subjectFilter, setSubjectFilter] = useState(''), [detail, setDetail] = useState<FlashcardSet | Quiz | null>(null), [attempts, setAttempts] = useState<QuizAttempt[]>([]), [activeAttempt, setActiveAttempt] = useState<QuizAttempt | null>(null), [creating, setCreating] = useState(false), [newTitle, setNewTitle] = useState(''), [newSubject, setNewSubject] = useState(''), [newSource, setNewSource] = useState(params.get('source') ?? '')
  const [confirmAction, setConfirmAction] = useState<'delete' | 'restart-attempt' | null>(null)
  const [quizOptions, setQuizOptions] = useState({ shuffleQuestions: false, shuffleChoices: false })
  const table = tool === 'flashcards' ? 'flashcard_sets' : 'quizzes', idParam = tool === 'flashcards' ? 'set' : 'quiz', selectedId = params.get(idParam), editing = params.get('edit') === '1', studying = params.get('study') === '1'
  const navigate = (changes: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) } setParams(next) }
  const loadLibrary = useCallback(async () => {
    if (!supabase) return; setLoading(true)
    const countField = tool === 'flashcards' ? 'card_count' : 'question_count'
    const setFields = tool === 'flashcards'
      ? `id,subject_id,source_reviewer_title,title,revision,${countField},cards,progress,updated_at`
      : `id,subject_id,source_reviewer_title,title,revision,${countField},questions,updated_at`
    const [setResult, subjectResult, reviewerResult] = await Promise.all([
      supabase.from(table).select(setFields).eq('user_id', studentId).order('updated_at', { ascending: false }),
      supabase.from('schedule_subjects').select('id,subject_code,title,color_key').eq('user_id', studentId).order('subject_code'),
      supabase.from('reviewers').select('id,title,subject_id').eq('user_id', studentId).order('updated_at', { ascending: false }),
    ])
    setSummaries((setResult.data ?? []).map(raw => {
      const row = raw as unknown as Record<string, unknown>
      const total = Number(row[countField] ?? 0)
      const ready = tool === 'quizzes' && Array.isArray(row.questions)
        ? (row.questions as QuizQuestion[]).filter(validQuizQuestion).length
        : Array.isArray(row.cards) ? (row.cards as Flashcard[]).filter(validFlashcard).length : total
      const progress = (row.progress ?? {}) as FlashcardSet['progress']
      const mastered = tool === 'flashcards' && Array.isArray(row.cards) ? (row.cards as Flashcard[]).filter(card => validFlashcard(card) && progress[card.id]?.mastered).length : 0
      return { id: String(row.id), subject_id: row.subject_id as string | null, source_reviewer_title: row.source_reviewer_title as string | null, title: String(row.title), revision: Number(row.revision), count: ready, draftCount: total - ready, mastered, updated_at: String(row.updated_at) }
    }))
    setSubjects((subjectResult.data ?? []) as ReviewerSubject[]); setReviewers((reviewerResult.data ?? []) as SourceReviewer[]); setLoading(false)
  }, [studentId, table, tool])
  // Loading remote library state is the synchronization performed by this effect.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadLibrary() }, [loadLibrary])
  useEffect(() => {
    const client = supabase
    // Clear stale detail state when navigation no longer identifies a set.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!client || !selectedId) { setDetail(null); setAttempts([]); setActiveAttempt(null); return }
    let active = true
    const run = async () => {
      const detailRequest = client.from(table).select('*').eq('id', selectedId).maybeSingle()
      if (tool === 'quizzes') {
        const [setResult, attemptResult] = await Promise.all([detailRequest, client.from('quiz_attempts').select('*').eq('quiz_id', selectedId).order('started_at', { ascending: false })])
        if (active) { setDetail(setResult.data as Quiz | null); const rows = (attemptResult.data ?? []) as QuizAttempt[]; setAttempts(rows.filter(item => item.status === 'completed')); setActiveAttempt(rows.find(item => item.status === 'active') ?? null) }
      } else { const result = await detailRequest; if (active) setDetail(result.data as FlashcardSet | null) }
    }
    void run(); return () => { active = false }
  }, [selectedId, table, tool])
  // Prefill only empty creation fields when the selected source reviewer changes.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { const source = reviewers.find(item => item.id === newSource); if (source) { setNewTitle(current => current || `${source.title} ${tool === 'flashcards' ? 'flashcards' : 'quiz'}`); setNewSubject(current => current || source.subject_id || '') } }, [newSource, reviewers, tool])
  const createSet = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !newTitle.trim()) return; setCreating(true); const source = reviewers.find(item => item.id === newSource)
    const payload = { user_id: studentId, title: newTitle.trim(), subject_id: newSubject || null, source_reviewer_id: source?.id ?? null, source_reviewer_title: source?.title ?? null }
    const { data, error } = await supabase.from(table).insert(payload).select().single(); setCreating(false)
    if (!error && data) { setNewTitle(''); setNewSubject(''); setNewSource(''); navigate({ new: null, source: null, [idParam]: String(data.id), edit: '1' }); void loadLibrary() }
  }
  const remove = async () => { if (!supabase || !selectedId) return; const { error } = await supabase.from(table).delete().eq('id', selectedId); if (!error) { setConfirmAction(null); navigate({ [idParam]: null, edit: null, study: null }); void loadLibrary() } }
  const acceptSavedSet = (saved: FlashcardSet | Quiz) => {
    setDetail(saved)
    setSummaries(current => current.map(item => item.id !== saved.id ? item : {
      ...item,
      subject_id: saved.subject_id,
      source_reviewer_title: saved.source_reviewer_title,
      title: saved.title,
      revision: saved.revision,
      count: tool === 'flashcards' ? (saved as FlashcardSet).cards.filter(validFlashcard).length : (saved as Quiz).questions.filter(validQuizQuestion).length,
      draftCount: tool === 'flashcards' ? (saved as FlashcardSet).cards.filter(card => !validFlashcard(card)).length : (saved as Quiz).questions.filter(question => !validQuizQuestion(question)).length,
      mastered: tool === 'flashcards' ? (saved as FlashcardSet).cards.filter(card => validFlashcard(card) && (saved as FlashcardSet).progress[card.id]?.mastered).length : 0,
      updated_at: saved.updated_at,
    }))
  }
  const visible = summaries.filter(item => (!subjectFilter || item.subject_id === subjectFilter) && item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const subjectFilterOptions: CaliSelectOption[] = [{ value: '', label: 'All subjects' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title }))]
  const reviewerOptions: CaliSelectOption[] = [{ value: '', label: 'Blank', detail: 'Start without a reviewer' }, ...reviewers.map(reviewer => ({ value: reviewer.id, label: reviewer.title }))]

  if (detail && tool === 'flashcards' && editing) return <FlashcardEditor initial={detail as FlashcardSet} subjects={subjects} reviewers={reviewers} onSaved={acceptSavedSet} onBack={() => navigate({ edit: null })} />
  if (detail && tool === 'flashcards' && studying) return <FlashcardStudy initial={detail as FlashcardSet} onChange={acceptSavedSet} onBack={() => navigate({ study: null })} />
  if (detail && tool === 'quizzes' && editing) return <QuizEditor initial={detail as Quiz} subjects={subjects} reviewers={reviewers} onSaved={acceptSavedSet} onBack={() => navigate({ edit: null })} />
  const activeAttemptMatchesQuiz = detail && tool === 'quizzes' && activeAttempt?.status === 'active'
    ? quizSnapshotMatchesQuestions(activeAttempt.snapshot, (detail as Quiz).questions)
    : false
  if (detail && tool === 'quizzes' && studying && activeAttempt && (activeAttempt.status === 'completed' || activeAttemptMatchesQuiz)) return <QuizRunner quiz={detail as Quiz} attempt={activeAttempt} onAttempt={changed => { setActiveAttempt(changed); if (changed.status === 'completed') setAttempts(current => current.some(item => item.id === changed.id) ? current : [changed, ...current]) }} onBack={() => navigate({ study: null })} />
  if (detail) {
    const ready = tool === 'flashcards' ? (detail as FlashcardSet).cards.filter(validFlashcard).length : (detail as Quiz).questions.filter(validQuizQuestion).length
    const drafts = tool === 'quizzes' ? (detail as Quiz).questions.length - ready : 0
    const completed = attempts.filter(item => item.status === 'completed'), latest = completed[0], best = completed.reduce<QuizAttempt | null>((winner, item) => !winner || (item.score ?? 0) / Math.max(1, item.total ?? 1) > (winner.score ?? 0) / Math.max(1, winner.total ?? 1) ? item : winner, null)
    const startQuiz = async (restart = false) => {
      if (!supabase || tool !== 'quizzes') return
      if (activeAttemptMatchesQuiz && !restart) { navigate({ study: '1' }); return }
      if (activeAttempt?.status === 'active') {
        const { error } = await supabase.from('quiz_attempts').update({ status: 'abandoned' }).eq('id', activeAttempt.id)
        if (error) return
      }
      const snapshot = buildQuizSnapshot((detail as Quiz).questions, quizOptions.shuffleQuestions, quizOptions.shuffleChoices), id = newId()
      const { data } = await supabase.from('quiz_attempts').insert({ id, quiz_id: detail.id, user_id: studentId, snapshot, answers: {} }).select().single()
      if (data) { setActiveAttempt(data as QuizAttempt); navigate({ study: '1' }) }
    }
    if (isFlashcardTool(tool)) return <section className="set-detail-page"><nav className="reviewer-page-nav flashcard-detail-nav"><button type="button" className="cali-back-link" onClick={() => navigate({ [idParam]: null })}><BackArrowIcon /><span>Back to flashcards</span></button><details className="set-detail-menu"><summary aria-label="More flashcard set actions" title="More actions"><MoreIcon /></summary><div><button type="button" onClick={event => { const menu = event.currentTarget.closest('details') as HTMLDetailsElement | null; if (menu) menu.open = false; navigate({ edit: '1' }) }}>Edit</button><button type="button" className="is-danger" onClick={event => { const menu = event.currentTarget.closest('details') as HTMLDetailsElement | null; if (menu) menu.open = false; setConfirmAction('delete') }}>Delete</button></div></details></nav><FlashcardOverview flashcardSet={detail as FlashcardSet} onChange={acceptSavedSet} onStudy={() => navigate({ study: '1' })} />{confirmAction === 'delete' && <ConfirmDialog title={`Delete “${detail.title}”?`} body="This permanently removes the flashcard set and its progress. This cannot be undone." confirmLabel="Delete set" danger onCancel={() => setConfirmAction(null)} onConfirm={() => void remove()} />}</section>
    return <section className="set-detail-page">
      <nav className="reviewer-page-nav"><button type="button" className="cali-back-link" onClick={() => navigate({ [idParam]: null })}><BackArrowIcon /><span>Back to {tool}</span></button><div><button type="button" className="study-secondary" onClick={() => navigate({ edit: '1' })}>Edit</button><button type="button" className="study-danger" onClick={() => setConfirmAction('delete')}>Delete</button></div></nav>
      <article className="quiz-overview">
        <header className="quiz-overview-hero"><div><p className="workspace-overline">QUIZ</p><h1>{detail.title}</h1>{detail.source_reviewer_title && <p>Based on {detail.source_reviewer_title}</p>}</div><div className="quiz-question-total"><strong>{ready}</strong><span>{ready === 1 ? 'ready question' : 'ready questions'}</span></div></header>
        <div className="quiz-overview-body">
          <section className="quiz-launch-panel"><div><span className="quiz-launch-eyebrow">{activeAttemptMatchesQuiz ? 'ATTEMPT IN PROGRESS' : 'NEW ATTEMPT'}</span><h2>{activeAttemptMatchesQuiz ? 'Resume quiz' : 'Start quiz'}</h2><p>The correct answer is shown after each response. Explanations appear when they are included in the question.</p></div>
            {drafts > 0 && <div className="quiz-draft-notice" role="status"><strong>{drafts} {drafts === 1 ? 'question is' : 'questions are'} still a draft.</strong><span>Select a correct answer in Edit to include {drafts === 1 ? 'it' : 'them'}.</span></div>}
            {!activeAttemptMatchesQuiz && <div className="quiz-start-options"><span>Order</span><label><input type="checkbox" checked={quizOptions.shuffleQuestions} onChange={event => setQuizOptions(value => ({ ...value, shuffleQuestions: event.target.checked }))} /> Shuffle questions</label><label><input type="checkbox" checked={quizOptions.shuffleChoices} onChange={event => setQuizOptions(value => ({ ...value, shuffleChoices: event.target.checked }))} /> Shuffle choices</label></div>}
            <div className="set-primary-actions"><button type="button" className="button-primary quiz-start-button" disabled={!ready} onClick={() => void startQuiz()}><span>{activeAttemptMatchesQuiz ? 'Resume attempt' : 'Start quiz'}</span><strong aria-hidden="true">→</strong></button>{activeAttemptMatchesQuiz && <button type="button" className="study-secondary" onClick={() => setConfirmAction('restart-attempt')}>Restart</button>}</div>
          </section>
          <aside className="quiz-performance-panel"><header><h2>Attempt summary</h2></header><div className="quiz-performance-grid"><div><span>Attempts</span><strong>{completed.length}</strong><small>Completed</small></div><div><span>Latest score</span><strong>{latest ? `${latest.score}/${latest.total}` : '—'}</strong><small>{latest ? 'Correct answers' : 'No attempts'}</small></div><div><span>Best score</span><strong>{best ? `${best.score}/${best.total}` : '—'}</strong><small>{best ? 'Correct answers' : 'No attempts'}</small></div></div>
            {completed.length > 0 ? <section className="attempt-history"><header><h2>Recent attempts</h2><span>{completed.length} total</span></header>{completed.slice(0, 3).map(item => <button type="button" key={item.id} onClick={() => { setActiveAttempt(item); navigate({ study: '1' }) }}><span>{formatDate(item.completed_at ?? item.started_at)}</span><span>{item.score} of {item.total} correct</span></button>)}</section> : <p className="quiz-no-attempts">No completed attempts.</p>}
          </aside>
        </div>
      </article>
      {confirmAction === 'delete' && <ConfirmDialog title={`Delete “${detail.title}”?`} body="This permanently removes the quiz and all attempt history. This cannot be undone." confirmLabel="Delete quiz" danger onCancel={() => setConfirmAction(null)} onConfirm={() => void remove()} />}
      {confirmAction === 'restart-attempt' && <ConfirmDialog eyebrow="NEW ATTEMPT" title="Start a new quiz attempt?" body="Begin again from the first question. Answers from the unfinished attempt will be removed." confirmLabel="Start new attempt" kind="restart" onCancel={() => setConfirmAction(null)} onConfirm={() => { setConfirmAction(null); void startQuiz(true) }} />}
    </section>
  }
  return <section className={`study-page${tool === 'quizzes' ? ' study-page--quizzes' : ''}`}>
    <header className="study-heading"><div><p className="workspace-overline">STUDY SPACE</p><h1>{tool === 'flashcards' ? <>Practice active <em>recall.</em></> : <>Check your <em>understanding.</em></>}</h1><p>{tool === 'flashcards' ? 'Build focused card sets and track what you have mastered.' : 'Create quizzes, answer each question, and review completed attempts.'}</p></div><div className="study-heading-actions"><button type="button" className="button-primary" onClick={() => navigate({ new: '1' })}><span>+</span> New {tool === 'flashcards' ? 'flashcard set' : 'quiz'}</button></div></header>
    <ToolTabs tool={tool} navigate={navigate} />
    <section className={`reviewer-library${tool === 'quizzes' ? ' quiz-library' : ''}`} aria-busy={loading}>
      <div className="reviewer-library-head"><div><p className="workspace-overline">YOUR LIBRARY</p><h2>{tool === 'flashcards' ? 'Flashcard sets' : 'Quizzes'}</h2></div>{tool === 'quizzes' && <p>The correct answer is shown after each question.</p>}</div>
      {loading ? <StudyLibraryFiltersSkeleton /> : <div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tool}`} aria-label={`Search ${tool}`} /></label><CaliSelect value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} ariaLabel="Filter by subject" className="cali-select--filter" /></div>}
      {loading ? <StudyLibraryCardsSkeleton containerClassName="study-set-grid" label={`Loading ${tool}`} /> : <div className="study-set-grid">{visible.length ? visible.map(item => {
        const subject = subjects.find(value => value.id === item.subject_id)
        if (tool === 'quizzes') return <button key={item.id} type="button" className="study-set-card quiz-set-card" onClick={() => navigate({ [idParam]: item.id })}><span className="study-set-preview-meta"><span>{subject?.subject_code ?? 'General'}</span><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></span><strong className="study-set-preview-title">{item.title}</strong><span className="study-set-preview-content"><span className="quiz-set-card-footer"><span><b>{item.count}</b> ready</span>{item.draftCount > 0 && <span className="has-drafts"><b>{item.draftCount}</b> {item.draftCount === 1 ? 'draft' : 'drafts'}</span>}</span></span></button>
        const mastery = item.count ? (item.mastered / item.count) * 100 : 0
        return <button key={item.id} type="button" className="study-set-card flashcard-set-card" onClick={() => navigate({ [idParam]: item.id })}><span className="study-set-preview-meta"><span>{subject?.subject_code ?? 'General'}</span><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></span><strong className="study-set-preview-title">{item.title}</strong><span className="study-set-preview-content"><span className="flashcard-library-summary"><small>{item.count} {item.count === 1 ? 'card' : 'cards'}</small><small>{item.mastered} mastered</small></span><span className="flashcard-library-meter" aria-hidden="true"><span style={{ width: `${mastery}%` }} /></span></span></button>
      }) : <div className="reviewer-empty-list"><strong>Your first {tool === 'flashcards' ? 'flashcard set' : 'quiz'} starts here</strong><p>Create one from scratch or derive it from an existing reviewer.</p><button type="button" className="button-primary" onClick={() => navigate({ new: '1' })}>Create {tool === 'flashcards' ? 'set' : 'quiz'}</button></div>}</div>}
    </section>
    {params.get('new') && <div className="study-modal-backdrop"><form className="study-set-create" onSubmit={createSet}>
      <header><p className="workspace-overline">NEW {tool === 'flashcards' ? 'FLASHCARD SET' : 'QUIZ'}</p><h2>Choose a starting point</h2></header>
      <label><span>Title</span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} /></label>
      <div className="study-set-create-field"><span>Source reviewer <small>Optional</small></span><CaliSelect value={newSource} options={reviewerOptions} onChange={setNewSource} ariaLabel="Source reviewer" className="cali-select--form" /></div>
      <div className="study-set-create-field"><span>Subject</span><CaliSelect value={newSubject} options={subjectSelectOptions(subjects)} onChange={setNewSubject} ariaLabel="Subject" className="cali-select--form" /></div>
      <footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null, source: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create'}</button></footer>
    </form></div>}
  </section>
}
