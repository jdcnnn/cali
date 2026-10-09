import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { JSONContent } from '@tiptap/react'
import { ProfileAvatar } from './CaliWordmark'
import { BackArrowIcon } from './BackArrowIcon'
import { CaliSelect, type CaliSelectOption } from './CaliSelect'
import { ConfirmationIcon } from './ConfirmationIcon'
import {
  copyCommunityReviewer,
  getCommunityAdminStatus,
  getCommunityInbox,
  getCommunityProfile,
  getCommunityReviewer,
  listCommunityReports,
  markCommunityNotificationsRead,
  moderateCommunityReport,
  recordCommunityReviewerUse,
  reportCommunityTarget,
  requestReviewerAccess,
  resolveReviewerAccess,
  revokeReviewerAccess,
  searchCommunityReviewers,
  voteCommunityReviewer,
} from '../lib/community'
import type {
  AccessType,
  CommunityInbox,
  CommunityProfile,
  CommunityReport,
  CommunityRequest,
  CommunityReviewer,
  CommunityReviewerCard,
  VoteValue,
} from '../lib/community'
import './community.css'

type Notice = { tone: 'success' | 'error'; text: string } | null
type ConfirmAction = {
  tone: 'confirmation' | 'warning' | 'information'
  kicker: string
  title: string
  detail: string
  confirmLabel: string
  destructive?: boolean
  run: () => Promise<void>
} | null

const yearLabels = ['First year', 'Second year', 'Third year', 'Fourth year', 'Fifth year']
const standardCommunityCategories = ['General', 'General Science', 'Mathematics', 'Programming', 'Engineering', 'Health Sciences', 'Business', 'Social Sciences', 'Humanities', 'Languages']

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
}

function VoteIcon({ direction }: { direction: 'up' | 'down' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g transform={direction === 'down' ? 'rotate(180 12 12)' : undefined}><path d="M7 10v12" /><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" /></g></svg>
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
}

function InboxIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="m4 13 4 1 2 3h4l2-3 4-1" /></svg>
}

function timeAgo(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function CreatorAvatar({ username, avatarUrl, className = '' }: { username: string; avatarUrl: string | null; className?: string }) {
  return avatarUrl
    ? <img className={className} src={avatarUrl} alt="" referrerPolicy="no-referrer" />
    : <ProfileAvatar name={username} className={className} />
}

function CommunityNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null
  return <div className={`community-notice community-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" onClick={onClose} aria-label="Dismiss">×</button></div>
}

function ConfirmDialog({ action, busy, error, onClose }: { action: ConfirmAction; busy: boolean; error: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!action || !dialog) return
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [action])
  if (!action) return null
  return <dialog ref={ref} className="signout-dialog community-confirm-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
    <form className="signout-dialog-content" onSubmit={event => { event.preventDefault(); void action.run() }}>
      <ConfirmationIcon kind={busy ? 'loading' : action.tone} />
      <p className="signout-dialog-kicker">{action.kicker}</p>
      <h2>{action.title}</h2>
      <p>{action.detail}</p>
      {error && <p className="signout-dialog-error" role="alert">{error}</p>}
      <div className="signout-dialog-actions"><button type="button" className="signout-cancel" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={action.destructive ? 'community-danger-action' : 'button-primary'} disabled={busy}>{busy ? 'Updating…' : action.confirmLabel}</button></div>
    </form>
  </dialog>
}

function VisibilityBadge({ visibility }: { visibility: 'public' | 'preview' }) {
  return <span className={`community-visibility community-visibility--${visibility}`}><span aria-hidden="true" />{visibility === 'public' ? 'Public' : 'Preview'}</span>
}

function VoteControl({ reviewer, compact = false, onVote }: { reviewer: CommunityReviewerCard; compact?: boolean; onVote: (value: VoteValue) => Promise<void> | void }) {
  const [pending, setPending] = useState(false)
  const react = async (event: MouseEvent<HTMLButtonElement>, value: VoteValue) => {
    event.preventDefault(); event.stopPropagation()
    if (pending || reviewer.isOwner) return
    setPending(true)
    try { await onVote(value) } finally { setPending(false) }
  }
  const disabled = reviewer.isOwner || pending
  return <div className={`community-vote-wrap${compact ? ' is-compact' : ''}`}>
    <div className={`community-vote${compact ? ' is-compact' : ''}${pending ? ' is-pending' : ''}`} role="group" aria-label={`${reviewer.upvotes} likes and ${reviewer.downvotes} dislikes`} aria-busy={pending}>
      <button type="button" disabled={disabled} title={reviewer.isOwner ? 'You cannot react to your own reviewer' : reviewer.userVote === 1 ? 'Remove like' : 'Like this reviewer'} className={reviewer.userVote === 1 ? 'is-active' : ''} aria-label={`${reviewer.userVote === 1 ? 'Remove like' : 'Like reviewer'}, ${reviewer.upvotes} likes`} aria-pressed={reviewer.userVote === 1} onClick={event => { void react(event, reviewer.userVote === 1 ? 0 : 1) }}><VoteIcon direction="up" />{!compact && <span className="community-vote-label">Like</span>}<span className="community-vote-count">{reviewer.upvotes}</span></button>
      <button type="button" disabled={disabled} title={reviewer.isOwner ? 'You cannot react to your own reviewer' : reviewer.userVote === -1 ? 'Remove dislike' : 'Dislike this reviewer'} className={reviewer.userVote === -1 ? 'is-active is-down' : ''} aria-label={`${reviewer.userVote === -1 ? 'Remove dislike' : 'Dislike reviewer'}, ${reviewer.downvotes} dislikes`} aria-pressed={reviewer.userVote === -1} onClick={event => { void react(event, reviewer.userVote === -1 ? 0 : -1) }}><VoteIcon direction="down" />{!compact && <span className="community-vote-label">Dislike</span>}<span className="community-vote-count">{reviewer.downvotes}</span></button>
    </div>
    {!compact && !reviewer.isOwner && <small className="community-vote-hint">You can leave a like if you find this helpful.</small>}
  </div>
}

function ReviewerCard({ reviewer, onVote }: { reviewer: CommunityReviewerCard; onVote: (reviewer: CommunityReviewerCard, value: VoteValue) => Promise<void> }) {
  return <article className="community-reviewer-card">
    <div className="community-card-top"><VisibilityBadge visibility={reviewer.visibility} />{reviewer.isVersion && <span className="community-version-label">Version</span>}</div>
    <Link className="community-card-link" to={`/community/reviewer/${reviewer.id}`}>
        <p className="community-card-category">
          {reviewer.subject ? (
            <>
              <span className="community-subject-code">{reviewer.subject.code}</span>
              <span className="community-subject-separator" aria-hidden="true">·</span>
              <span>{reviewer.subject.title}</span>
            </>
          ) : reviewer.category}
        </p>
      <h3>{reviewer.title}</h3>
      <p className="community-card-excerpt">{reviewer.description || reviewer.excerpt || 'Shared with the Cali Community.'}</p>
    </Link>
    <div className="community-card-footer">
      <Link className="community-creator-mini" to={`/community/profile/${reviewer.creator.username}`}><CreatorAvatar username={reviewer.creator.username} avatarUrl={reviewer.creator.avatarUrl} /><span><strong>@{reviewer.creator.username}</strong><small>{reviewer.creator.program}</small></span></Link>
      <div className="community-card-signals"><span className="community-usage" title="Usage during the last seven days">{reviewer.usage7d ? `${reviewer.usage7d} ${reviewer.usage7d === 1 ? 'use' : 'uses'} this week` : 'No recent use'}</span><VoteControl compact reviewer={reviewer} onVote={value => onVote(reviewer, value)} /></div>
    </div>
  </article>
}

function CardSkeleton({ count = 3 }: { count?: number }) {
  return <div className="community-card-grid" aria-label="Loading reviewers" role="status">{Array.from({ length: count }, (_, index) => <div className="community-card-skeleton" key={index}><span /><span /><span /><span /></div>)}</div>
}

function DocumentNode({ node, nodeKey }: { node: JSONContent; nodeKey: string }): ReactNode {
  const children = node.content?.map((child, index) => <DocumentNode key={`${nodeKey}-${index}`} node={child} nodeKey={`${nodeKey}-${index}`} />)
  if (node.type === 'text') {
    let text: ReactNode = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = <strong>{text}</strong>
      if (mark.type === 'italic') text = <em>{text}</em>
      if (mark.type === 'strike') text = <s>{text}</s>
      if (mark.type === 'code') text = <code>{text}</code>
      if (mark.type === 'highlight') text = <mark>{text}</mark>
      if (mark.type === 'link') text = <a href={String(mark.attrs?.href ?? '#')} target="_blank" rel="noreferrer">{text}</a>
    }
    return text
  }
  if (node.type === 'heading') { const Tag = node.attrs?.level === 3 ? 'h3' : 'h2'; return <Tag>{children}</Tag> }
  if (node.type === 'paragraph') return <p>{children?.length ? children : <br />}</p>
  if (node.type === 'bulletList') return <ul>{children}</ul>
  if (node.type === 'orderedList') return <ol>{children}</ol>
  if (node.type === 'listItem') return <li>{children}</li>
  if (node.type === 'taskList') return <ul className="community-task-list">{children}</ul>
  if (node.type === 'taskItem') return <li className={node.attrs?.checked ? 'is-checked' : ''}><span aria-hidden="true">{node.attrs?.checked ? '✓' : ''}</span><div>{children}</div></li>
  if (node.type === 'blockquote') return <blockquote>{children}</blockquote>
  if (node.type === 'codeBlock') return <pre><code>{children}</code></pre>
  if (node.type === 'horizontalRule') return <hr />
  if (node.type === 'hardBreak') return <br />
  if (node.type === 'table') return <div className="community-table-scroll"><table><tbody>{children}</tbody></table></div>
  if (node.type === 'tableRow') return <tr>{children}</tr>
  if (node.type === 'tableHeader') return <th>{children}</th>
  if (node.type === 'tableCell') return <td>{children}</td>
  if (node.type === 'columns') return <div className="community-document-columns">{children}</div>
  if (node.type === 'column') return <div>{children}</div>
  return <>{children}</>
}

function CommunityDocument({ content }: { content: JSONContent }) {
  return <div className="community-document">{content.content?.map((node, index) => <DocumentNode key={index} node={node} nodeKey={String(index)} />)}</div>
}

function ReportDialog({ target, onClose, onReported }: { target: { type: 'reviewer' | 'profile'; id: string; label: string } | null; onClose: () => void; onReported: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('misleading')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const dialog = ref.current
    if (!target || !dialog) return
    setReason('misleading'); setDetails(''); setError(''); dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [target])
  if (!target) return null
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reason === 'other' && details.trim().length < 10) { setError('Add a little more detail so the moderation team can review your report.'); return }
    setBusy(true); setError('')
    try { await reportCommunityTarget(target!.type, target!.id, reason, details.trim()); onReported(); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cali couldn’t send this report. Please try again.') }
    finally { setBusy(false) }
  }
  return <dialog ref={ref} className="signout-dialog community-report-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
    <form className="signout-dialog-content" onSubmit={submit}>
      <ConfirmationIcon kind={busy ? 'loading' : 'warning'} /><p className="signout-dialog-kicker">COMMUNITY SAFETY</p><h2>Report {target.label}?</h2><p>Your report stays private and goes to Cali moderators for review.</p>
      <label className="community-dialog-field"><span>Reason</span><select value={reason} onChange={event => setReason(event.target.value)} disabled={busy}><option value="misleading">Misleading or inaccurate</option><option value="spam">Spam</option><option value="inappropriate">Inappropriate content</option><option value="copyright">Copyright concern</option><option value="other">Other</option></select></label>
      <label className="community-dialog-field"><span>Details {reason === 'other' ? '(required)' : '(optional)'}</span><textarea maxLength={1000} value={details} onChange={event => setDetails(event.target.value)} placeholder="Add context that will help moderators review this report." disabled={busy} /></label>
      {error && <p className="signout-dialog-error" role="alert">{error}</p>}
      <div className="signout-dialog-actions"><button type="button" className="signout-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="community-danger-action" disabled={busy}>{busy ? 'Sending…' : 'Submit report'}</button></div>
    </form>
  </dialog>
}

function CommunityDashboard({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [sort, setSort] = useState<'relevance' | 'trending' | 'top' | 'newest' | 'most_used'>('relevance')
  const [visibility, setVisibility] = useState<'' | 'public' | 'preview'>('')
  const [yearLevel, setYearLevel] = useState('')
  const [category, setCategory] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [trending, setTrending] = useState<CommunityReviewerCard[]>([])
  const [top, setTop] = useState<CommunityReviewerCard[]>([])
  const [results, setResults] = useState<CommunityReviewerCard[]>([])
  const [loadingFeatured, setLoadingFeatured] = useState(true)
  const [loadingResults, setLoadingResults] = useState(true)
  const requestId = useRef(0)
  const showcaseRef = useRef<HTMLDivElement>(null)
  const showcaseResetTimer = useRef<number | null>(null)
  const [showcaseIndex, setShowcaseIndex] = useState(0)
  const [showcasePaused, setShowcasePaused] = useState(false)

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => {
    let active = true
    void Promise.all([searchCommunityReviewers({ sort: 'trending', limit: 6 }), searchCommunityReviewers({ sort: 'top', limit: 6 })])
      .then(([nextTrending, nextTop]) => { if (active) { setTrending(nextTrending); setTop(nextTop) } })
      .catch(() => { if (active) onNotice({ tone: 'error', text: 'Featured reviewers could not be loaded.' }) })
      .finally(() => { if (active) setLoadingFeatured(false) })
    return () => { active = false }
  }, [onNotice])
  useEffect(() => {
    const id = ++requestId.current
    setLoadingResults(true)
    void searchCommunityReviewers({ query: debouncedQuery, category, yearLevel: yearLevel ? Number(yearLevel) : null, visibility, sort, limit: 48 })
      .then(next => { if (id === requestId.current) setResults(next) })
      .catch(() => { if (id === requestId.current) onNotice({ tone: 'error', text: 'Search is unavailable right now.' }) })
      .finally(() => { if (id === requestId.current) setLoadingResults(false) })
    const next = new URLSearchParams(params); if (debouncedQuery) next.set('q', debouncedQuery); else next.delete('q'); setParams(next, { replace: true })
    // params is intentionally excluded: this effect owns the q parameter.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [debouncedQuery, category, yearLevel, visibility, sort, onNotice, setParams])

  const categories = useMemo(() => Array.from(new Set([...trending, ...top, ...results].map(item => item.category))).sort(), [results, top, trending])
  const categoryOptions = useMemo<CaliSelectOption[]>(() => [
    { value: '', label: 'All categories' },
    ...Array.from(new Set([...standardCommunityCategories, ...categories])).map(value => ({ value, label: value })),
  ], [categories])
  const activeFilterCount = [category, yearLevel, visibility, sort !== 'relevance' ? sort : ''].filter(Boolean).length
  const hasActiveSearch = Boolean(query || activeFilterCount)
  const scrollToDiscover = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const target = document.getElementById('discover')
    if (!target) return
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#discover`)
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }, [])
  const showCommunityFeature = useCallback((index: number) => {
    const track = showcaseRef.current
    if (!track) return
    const currentPosition = Math.round(track.scrollLeft / track.clientWidth)
    const targetPosition = index === 0 && currentPosition >= 2 ? 3 : index
    track.scrollTo({ left: track.clientWidth * targetPosition, behavior: 'auto' })
  }, [])
  const syncCommunityFeature = useCallback(() => {
    const track = showcaseRef.current
    if (!track?.clientWidth) return
    const position = Math.max(0, Math.min(3, Math.round(track.scrollLeft / track.clientWidth)))
    setShowcaseIndex(position % 3)
    if (showcaseResetTimer.current !== null) window.clearTimeout(showcaseResetTimer.current)
    if (position === 3) showcaseResetTimer.current = window.setTimeout(() => track.scrollTo({ left: 0, behavior: 'auto' }), 460)
  }, [])
  useEffect(() => () => { if (showcaseResetTimer.current !== null) window.clearTimeout(showcaseResetTimer.current) }, [])
  useEffect(() => {
    if (showcasePaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setTimeout(() => showCommunityFeature((showcaseIndex + 1) % 3), 5200)
    return () => window.clearTimeout(timer)
  }, [showcaseIndex, showcasePaused, showCommunityFeature])
  const updateVote = useCallback(async (reviewer: CommunityReviewerCard, value: VoteValue) => {
    const previous = reviewer.userVote
    const delta = value - previous
    const upvoteDelta = Number(value === 1) - Number(previous === 1)
    const downvoteDelta = Number(value === -1) - Number(previous === -1)
    const patch = (items: CommunityReviewerCard[]) => items.map(item => item.id === reviewer.id ? { ...item, userVote: value, netVotes: item.netVotes + delta, upvotes: item.upvotes + upvoteDelta, downvotes: item.downvotes + downvoteDelta } : item)
    setTrending(patch); setTop(patch); setResults(patch)
    try { const saved = await voteCommunityReviewer(reviewer.id, value); const reconcile = (items: CommunityReviewerCard[]) => items.map(item => item.id === reviewer.id ? { ...item, ...saved } : item); setTrending(reconcile); setTop(reconcile); setResults(reconcile) }
    catch { const rollback = (items: CommunityReviewerCard[]) => items.map(item => item.id === reviewer.id ? { ...item, userVote: previous, netVotes: item.netVotes - delta, upvotes: item.upvotes - upvoteDelta, downvotes: item.downvotes - downvoteDelta } : item); setTrending(rollback); setTop(rollback); setResults(rollback); onNotice({ tone: 'error', text: 'Your reaction could not be saved.' }) }
  }, [onNotice])

  return <div className="community-page">
    <section className="community-hero">
      <div className="community-hero-copy"><p className="workspace-overline">CALI COMMUNITY</p><h1>Study better,<br /><em>together.</em></h1><p>Find reviewers shared by fellow RTU students, learn from their work, and contribute your own.</p><div className="community-hero-actions"><a href="#discover" className="button-primary" onClick={scrollToDiscover}>Browse reviewers</a><Link to="/community?view=inbox" className="community-secondary-action"><InboxIcon />Open inbox</Link></div></div>
      <section className={`community-showcase${showcasePaused ? ' is-paused' : ''}`} aria-label="Cali Reviewer Sharing features" onMouseEnter={() => setShowcasePaused(true)} onMouseLeave={() => setShowcasePaused(false)} onFocusCapture={() => setShowcasePaused(true)} onBlurCapture={() => setShowcasePaused(false)} onPointerDown={() => setShowcasePaused(true)} onPointerUp={() => setShowcasePaused(false)}>
        <div ref={showcaseRef} className="community-showcase-track" onScroll={syncCommunityFeature} tabIndex={0}>
          <article className={`community-showcase-slide${showcaseIndex === 0 ? ' is-active' : ''}`}>
            <div><p className="community-showcase-kicker">SHARE</p><h2>You decide what others can see.</h2><p>Set each reviewer to Public, Preview, or Private.</p></div>
          </article>
          <article className={`community-showcase-slide${showcaseIndex === 1 ? ' is-active' : ''}`}>
            <div><p className="community-showcase-kicker">CONTRIBUTE</p><h2>Build together. Keep the credit.</h2><p>Every published version names its owner and contributors.</p></div>
          </article>
          <article className={`community-showcase-slide${showcaseIndex === 2 ? ' is-active' : ''}`}>
            <div><p className="community-showcase-kicker">SOURCES</p><h2>Keep every reviewer grounded.</h2><p>Sources stay connected as shared work grows and changes.</p></div>
          </article>
          <article className={`community-showcase-slide${showcaseIndex === 0 ? ' is-active' : ''}`} aria-hidden="true">
            <div><p className="community-showcase-kicker">SHARE</p><h2>You decide what others can see.</h2><p>Set each reviewer to Public, Preview, or Private.</p></div>
          </article>
        </div>
        <div className="community-showcase-dots" aria-label="Choose a Reviewer Sharing feature">{['Access controls', 'Community contributions', 'Academic sources'].map((label, index) => <button key={label} type="button" className={showcaseIndex === index ? 'is-active' : ''} aria-label={label} aria-current={showcaseIndex === index ? 'true' : undefined} onClick={() => showCommunityFeature(index)} />)}</div>
      </section>
    </section>

      <section className="community-featured" aria-labelledby="community-trending-title"><div className="community-section-heading"><div><p className="workspace-overline">ACTIVE THIS WEEK</p><h2 id="community-trending-title">Trending in Cali</h2></div><p>Popular with RTU students this week.</p></div>{loadingFeatured ? <CardSkeleton /> : trending.length ? <div className="community-card-grid">{trending.slice(0, 3).map(reviewer => <ReviewerCard key={reviewer.id} reviewer={reviewer} onVote={updateVote} />)}</div> : <div className="community-empty"><strong>Nothing is trending yet.</strong><p>Shared reviewers will appear here as students begin using them.</p></div>}</section>

    <section className={`community-top-strip${top.length ? '' : ' is-empty'}`} aria-labelledby="community-top-title">
          <header className="community-top-intro"><p className="workspace-overline">COMMUNITY FAVORITES</p><h2 id="community-top-title">Most trusted reviewers</h2><p>Ranked by student likes and recent study activity.</p></header>
          {top.length ? <div className="community-top-list">{top.slice(0, 4).map((reviewer, index) => <Link className={index === 0 ? 'is-leading' : ''} key={reviewer.id} to={`/community/reviewer/${reviewer.id}`}><span className="community-top-rank">{String(index + 1).padStart(2, '0')}</span><div><span className="community-top-context">{reviewer.subject?.code || reviewer.category}</span><strong>{reviewer.title}</strong><small>@{reviewer.creator.username} · {reviewer.upvotes > 0 ? `${reviewer.upvotes} ${reviewer.upvotes === 1 ? 'like' : 'likes'}` : 'No likes yet'}{reviewer.usage7d > 0 ? ` · ${reviewer.usage7d} ${reviewer.usage7d === 1 ? 'use' : 'uses'} this week` : ''}</small></div><ArrowIcon /></Link>)}</div> : <div className="community-top-empty"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17V9M12 17V5M17 17v-4" /><path d="M4 20h16" /></svg></span><div><strong>No favorites yet.</strong><p>The first like will start the ranking.</p></div></div>}
    </section>

    <section id="discover" className="community-discover" aria-labelledby="community-discover-title"><div className="community-section-heading"><div><p className="workspace-overline">DISCOVER</p><h2 id="community-discover-title">Find your next reviewer</h2></div><p>Search by title, creator, subject, category, or available content.</p></div>
      <div className="community-search-shell">
        <label className="community-search"><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers or content" aria-label="Search Community reviewers" /></label>
        <button type="button" className="community-mobile-filter-toggle" aria-expanded={filtersOpen} aria-controls="community-filter-panel" aria-label={`${filtersOpen ? 'Hide' : 'Show'} reviewer filters`} onClick={() => setFiltersOpen(open => !open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg><span>Filters</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}<svg className="community-filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m7 10 5 5 5-5" /></svg></button>
        <div id="community-filter-panel" className={`community-filters${filtersOpen ? ' is-open' : ''}`}><CaliSelect value={category} options={categoryOptions} onChange={setCategory} ariaLabel="Filter reviewers by category" className="community-category-select" /><select value={yearLevel} onChange={event => setYearLevel(event.target.value)} aria-label="Filter by year level"><option value="">All year levels</option>{yearLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select><select value={visibility} onChange={event => setVisibility(event.target.value as '' | 'public' | 'preview')} aria-label="Filter by visibility"><option value="">Public + Preview</option><option value="public">Public only</option><option value="preview">Preview only</option></select><select value={sort} onChange={event => setSort(event.target.value as typeof sort)} aria-label="Sort reviewers"><option value="relevance">Most relevant</option><option value="trending">Trending</option><option value="top">Most liked</option><option value="newest">Newest</option><option value="most_used">Most used</option></select><button type="button" className="community-filter-clear" disabled={!activeFilterCount} onClick={() => { setCategory(''); setYearLevel(''); setVisibility(''); setSort('relevance') }}>Clear filters</button></div>
      </div>
      <div className="community-results-head"><p className="community-result-count" aria-live="polite">{loadingResults ? 'Searching reviewers…' : <>Showing <strong>{results.length}</strong> {results.length === 1 ? 'reviewer' : 'reviewers'}</>}</p>{hasActiveSearch && <button type="button" onClick={() => { setQuery(''); setCategory(''); setYearLevel(''); setVisibility(''); setSort('relevance') }}>Clear all</button>}</div>
      {loadingResults ? <CardSkeleton count={6} /> : results.length ? <div className="community-card-grid">{results.map(reviewer => <ReviewerCard key={reviewer.id} reviewer={reviewer} onVote={updateVote} />)}</div> : <div className="community-empty"><strong>No reviewers found.</strong><p>Try a broader search or clear a filter. Locked Preview content stays private.</p></div>}
    </section>
  </div>
}

function ReviewerDetail({ reviewerId, onNotice }: { reviewerId: string; onNotice: (notice: Notice) => void }) {
  const navigate = useNavigate()
  const [reviewer, setReviewer] = useState<CommunityReviewer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmAction>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [reportTarget, setReportTarget] = useState<{ type: 'reviewer'; id: string; label: string } | null>(null)

  const load = useCallback(async () => {
    // This state belongs to an external Supabase request lifecycle.
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(true); setError('')
    try { const next = await getCommunityReviewer(reviewerId); setReviewer(next); void recordCommunityReviewerUse(reviewerId) }
    catch { setError('This reviewer may be private, removed, or unavailable to your account.') }
    finally { setLoading(false) }
  }, [reviewerId])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  async function execute(action: () => Promise<void>) {
    setConfirmBusy(true); setConfirmError('')
    try { await action(); setConfirm(null) }
    catch (cause) { setConfirmError(cause instanceof Error ? cause.message : 'Cali couldn’t complete that action. Please try again.') }
    finally { setConfirmBusy(false) }
  }
  async function vote(value: VoteValue) {
    if (!reviewer) return
    const previous = reviewer.userVote; const delta = value - previous
    const upvoteDelta = Number(value === 1) - Number(previous === 1); const downvoteDelta = Number(value === -1) - Number(previous === -1)
    setReviewer({ ...reviewer, userVote: value, netVotes: reviewer.netVotes + delta, upvotes: reviewer.upvotes + upvoteDelta, downvotes: reviewer.downvotes + downvoteDelta })
    try { const saved = await voteCommunityReviewer(reviewer.id, value); setReviewer(current => current ? { ...current, ...saved } : current) }
    catch { setReviewer(current => current ? { ...current, userVote: previous, netVotes: current.netVotes - delta, upvotes: current.upvotes - upvoteDelta, downvotes: current.downvotes - downvoteDelta } : current); onNotice({ tone: 'error', text: 'Your reaction could not be saved.' }) }
  }
  function requestAccess(type: AccessType) {
    if (!reviewer) return
    const copy = type === 'copy'
    setConfirm({ tone: 'information', kicker: 'REQUEST ACCESS', title: copy ? 'Request an editable copy?' : 'Request full read access?', detail: copy ? `@${reviewer.creator.username} will review your request. If approved, Cali will add one private, editable copy to your library with attribution intact.` : `@${reviewer.creator.username} will review your request. If approved, you can read the full reviewer while access remains active.`, confirmLabel: 'Send request', run: () => execute(async () => { await requestReviewerAccess(reviewer.id, type); onNotice({ tone: 'success', text: 'Access request sent.' }); await load() }) })
  }
  function copyReviewer() {
    if (!reviewer) return
    setConfirm({ tone: 'confirmation', kicker: 'CREATE A VERSION', title: `Add “${reviewer.title}” to your library?`, detail: 'Cali will create a private, editable version while keeping the original creator and published contributors credited.', confirmLabel: 'Create my copy', run: () => execute(async () => { const copied = await copyCommunityReviewer(reviewer.id); onNotice({ tone: 'success', text: 'Editable copy added to your Study library.' }); navigate(`/study?reviewer=${copied.id}`) }) })
  }

  if (loading) return <div className="community-reader-loading"><span className="cali-skeleton skeleton-block" /></div>
  if (error || !reviewer) return <div className="community-state-page"><p className="workspace-overline">REVIEWER UNAVAILABLE</p><h1>This reviewer isn’t available.</h1><p>{error}</p><Link className="button-primary" to="/community">Back to Community</Link></div>
  return <div className="community-reader-page">
    <nav className="community-reader-nav"><Link className="cali-back-link" to="/community"><BackArrowIcon /><span>Community</span></Link><div><button type="button" onClick={() => setReportTarget({ type: 'reviewer', id: reviewer.id, label: 'this reviewer' })}>Report</button>{reviewer.canCopy && !reviewer.isOwner && <button type="button" className="button-primary" onClick={copyReviewer}>Make a copy</button>}</div></nav>
    <header className="community-reader-hero"><div className="community-reader-meta"><VisibilityBadge visibility={reviewer.visibility} />{reviewer.isVersion && <span className="community-version-label">Published version</span>}<span>{reviewer.subject ? `${reviewer.subject.code} · ${reviewer.subject.title}` : reviewer.category}</span></div><h1>{reviewer.title}</h1><p>{reviewer.description || 'Shared with the Cali Community.'}</p>
      <div className="community-reader-byline"><Link to={`/community/profile/${reviewer.creator.username}`} className="community-creator-card"><CreatorAvatar username={reviewer.creator.username} avatarUrl={reviewer.creator.avatarUrl} /><span><small>Created by</small><strong>@{reviewer.creator.username}</strong><em>{reviewer.creator.program} · {yearLabels[reviewer.creator.yearLevel - 1]}</em></span><ArrowIcon /></Link><VoteControl reviewer={reviewer} onVote={vote} /></div>
      {reviewer.contributors.length > 0 && <div className="community-contributors"><span>With contributions from</span>{reviewer.contributors.map(person => person.userId ? <Link key={`${person.userId}-${person.username}`} to={`/community/profile/${person.username}`}><CreatorAvatar username={person.username} avatarUrl={person.avatarUrl} />@{person.username}</Link> : <span key={person.username}>@{person.username}</span>)}</div>}
    </header>
    <article className="community-reader-paper"><CommunityDocument content={reviewer.content} />{!reviewer.isFullContent && <div className="community-preview-lock"><span className="community-lock-mark" aria-hidden="true">⌁</span><p className="workspace-overline">END OF PREVIEW · {reviewer.visibleItemCount} OF {reviewer.totalItemCount} SECTIONS</p><h2>Want to keep reading?</h2><p>Ask the creator for full read access, or request an editable copy that keeps their credit.</p><div><button type="button" className="button-primary" disabled={reviewer.requestState?.status === 'pending'} onClick={() => requestAccess('read')}>{reviewer.requestState?.status === 'pending' && reviewer.requestState.type === 'read' ? 'Request pending' : 'Request read access'}</button><button type="button" className="community-secondary-action" disabled={reviewer.requestState?.status === 'pending'} onClick={() => requestAccess('copy')}>{reviewer.requestState?.status === 'pending' && reviewer.requestState.type === 'copy' ? 'Request pending' : 'Request editable copy'}</button></div></div>}</article>
    <ConfirmDialog action={confirm} busy={confirmBusy} error={confirmError} onClose={() => { if (!confirmBusy) { setConfirm(null); setConfirmError('') } }} />
    <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} onReported={() => onNotice({ tone: 'success', text: 'Report sent privately to Cali moderators.' })} />
  </div>
}

function PublicProfile({ username, onNotice }: { username: string; onNotice: (notice: Notice) => void }) {
  const [profile, setProfile] = useState<CommunityProfile | null>(null)
  const [reviewers, setReviewers] = useState<CommunityReviewerCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportTarget, setReportTarget] = useState<{ type: 'profile'; id: string; label: string } | null>(null)
  useEffect(() => {
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(true)
    void Promise.all([getCommunityProfile(username), searchCommunityReviewers({ ownerUsername: username, sort: 'newest', limit: 48 })])
      .then(([nextProfile, nextReviewers]) => { if (active) { setProfile(nextProfile); setReviewers(nextReviewers) } })
      .catch(() => { if (active) setError('This profile may be private, removed, or unavailable.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [username])
  const vote = async (reviewer: CommunityReviewerCard, value: VoteValue) => {
    const previous = reviewer.userVote; const delta = value - previous
    const upvoteDelta = Number(value === 1) - Number(previous === 1); const downvoteDelta = Number(value === -1) - Number(previous === -1)
    setReviewers(items => items.map(item => item.id === reviewer.id ? { ...item, userVote: value, netVotes: item.netVotes + delta, upvotes: item.upvotes + upvoteDelta, downvotes: item.downvotes + downvoteDelta } : item))
    try { const saved = await voteCommunityReviewer(reviewer.id, value); setReviewers(items => items.map(item => item.id === reviewer.id ? { ...item, ...saved } : item)) }
    catch { setReviewers(items => items.map(item => item.id === reviewer.id ? { ...item, userVote: previous, netVotes: item.netVotes - delta, upvotes: item.upvotes - upvoteDelta, downvotes: item.downvotes - downvoteDelta } : item)); onNotice({ tone: 'error', text: 'Your reaction could not be saved.' }) }
  }
  if (loading) return <div className="community-reader-loading"><span className="cali-skeleton skeleton-block" /></div>
  if (error || !profile) return <div className="community-state-page"><p className="workspace-overline">PROFILE UNAVAILABLE</p><h1>This profile isn’t available.</h1><p>{error}</p><Link className="button-primary" to="/community">Back to Community</Link></div>
  return <div className="community-profile-page"><nav className="community-reader-nav"><Link className="cali-back-link" to="/community"><BackArrowIcon /><span>Community</span></Link>{!profile.isOwnProfile && <button type="button" onClick={() => setReportTarget({ type: 'profile', id: profile.userId, label: `@${profile.username}` })}>Report profile</button>}</nav>
    <header className="community-profile-hero"><CreatorAvatar username={profile.username} avatarUrl={profile.avatarUrl} className="community-profile-avatar" /><div><p className="workspace-overline">STUDENT PROFILE</p><h1>@{profile.username}</h1><p>{profile.bio || 'Learning and sharing with the Cali Community.'}</p><div className="community-profile-facts"><span>{profile.program}</span><span>{yearLabels[profile.yearLevel - 1]}</span><span>Joined {new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(profile.joinedAt))}</span></div></div></header>
    <section className="community-profile-library"><div className="community-section-heading"><div><p className="workspace-overline">COMMUNITY LIBRARY</p><h2>Shared reviewers</h2></div><p>{reviewers.length} public or preview {reviewers.length === 1 ? 'reviewer' : 'reviewers'}.</p></div>{reviewers.length ? <div className="community-card-grid">{reviewers.map(item => <ReviewerCard key={item.id} reviewer={item} onVote={vote} />)}</div> : <div className="community-empty"><strong>No shared reviewers yet.</strong><p>Public and Preview reviewers from this student will appear here.</p></div>}</section>
    <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} onReported={() => onNotice({ tone: 'success', text: 'Report sent privately to Cali moderators.' })} />
  </div>
}

function RequestRow({ request, incoming, onConfirm }: { request: CommunityRequest; incoming: boolean; onConfirm: (action: ConfirmAction) => void }) {
  const action = (approve: boolean) => onConfirm({ tone: approve ? 'confirmation' : 'warning', kicker: 'ACCESS REQUEST', title: approve ? `Approve @${request.student.username}’s request?` : 'Decline this request?', detail: approve ? `${request.type === 'copy' ? 'One private, attributed copy' : 'Full read access'} will be granted for “${request.reviewer.title}”.` : `@${request.student.username} will be notified that their request for “${request.reviewer.title}” was declined.`, confirmLabel: approve ? 'Approve request' : 'Decline request', destructive: !approve, run: async () => { await resolveReviewerAccess(request.id, approve) } })
  return <article className="community-request-row"><CreatorAvatar username={request.student.username} avatarUrl={request.student.avatarUrl} /><div><div><strong>{incoming ? `@${request.student.username}` : request.reviewer.title}</strong><span className={`community-request-state is-${request.status}`}>{request.status}</span></div><p>{incoming ? <>Wants <b>{request.type === 'copy' ? 'an editable copy' : 'full read access'}</b> for “{request.reviewer.title}”</> : <>Requested {request.type === 'copy' ? 'an editable copy' : 'full read access'} from @{request.student.username}</>}</p><small>{timeAgo(request.createdAt)}</small></div>{incoming && request.status === 'pending' && <div className="community-request-actions"><button type="button" onClick={() => action(false)}>Decline</button><button type="button" className="button-primary" onClick={() => action(true)}>Approve</button></div>}{incoming && request.status === 'approved' && request.grantId && <button type="button" className="community-revoke" onClick={() => onConfirm({ tone: 'warning', kicker: 'REVOKE ACCESS', title: `End @${request.student.username}’s access?`, detail: `Their access to “${request.reviewer.title}” will end immediately. Any copies already created will remain in their library.`, confirmLabel: 'Revoke access', destructive: true, run: async () => { await revokeReviewerAccess(request.grantId!) } })}>Revoke</button>}</article>
}

function CommunityInboxView({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [inbox, setInbox] = useState<CommunityInbox | null>(null)
  const [admin, setAdmin] = useState(false)
  const [reports, setReports] = useState<CommunityReport[]>([])
  const [tab, setTab] = useState<'incoming' | 'outgoing' | 'updates' | 'moderation'>('incoming')
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<ConfirmAction>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    // This state belongs to an external Supabase request lifecycle.
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(true)
    try {
      const [nextInbox, isAdmin] = await Promise.all([getCommunityInbox(), getCommunityAdminStatus()])
      setInbox(nextInbox); setAdmin(isAdmin)
      if (isAdmin) setReports(await listCommunityReports())
      void markCommunityNotificationsRead()
    } catch { onNotice({ tone: 'error', text: 'Cali couldn’t load your Community inbox.' }) }
    finally { setLoading(false) }
  }, [onNotice])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  const confirmAction = (action: ConfirmAction) => {
    if (!action) return
    const originalRun = action.run
    setConfirm({ ...action, run: async () => { setBusy(true); setError(''); try { await originalRun(); setConfirm(null); await load(); onNotice({ tone: 'success', text: 'Access settings updated.' }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cali couldn’t complete that action. Please try again.') } finally { setBusy(false) } } })
  }
  const moderate = (report: CommunityReport, action: 'dismiss' | 'hide') => confirmAction({ tone: action === 'hide' ? 'warning' : 'information', kicker: 'MODERATION', title: action === 'hide' ? `Hide ${report.targetLabel}?` : 'Dismiss this report?', detail: action === 'hide' ? 'The reported item will be removed from Community discovery immediately. Descendant reviewer versions remain independently available.' : 'The report will close without changing the reported item.', confirmLabel: action === 'hide' ? 'Hide from Community' : 'Dismiss report', destructive: action === 'hide', run: () => moderateCommunityReport(report.id, action) })
  if (loading) return <div className="community-reader-loading"><span className="cali-skeleton skeleton-block" /></div>
  return <div className="community-inbox-page"><nav className="community-reader-nav"><Link className="cali-back-link" to="/community"><BackArrowIcon /><span>Community</span></Link></nav><header><p className="workspace-overline">ACCESS & UPDATES</p><h1>Community inbox</h1><p>Review access requests, track the ones you’ve sent, and stay updated.</p></header><div className="community-inbox-tabs" role="tablist"><button type="button" className={tab === 'incoming' ? 'is-active' : ''} onClick={() => setTab('incoming')}>Incoming <span>{inbox?.incoming.filter(item => item.status === 'pending').length ?? 0}</span></button><button type="button" className={tab === 'outgoing' ? 'is-active' : ''} onClick={() => setTab('outgoing')}>Sent</button><button type="button" className={tab === 'updates' ? 'is-active' : ''} onClick={() => setTab('updates')}>Updates <span>{inbox?.unreadCount ?? 0}</span></button>{admin && <button type="button" className={tab === 'moderation' ? 'is-active' : ''} onClick={() => setTab('moderation')}>Moderation <span>{reports.length}</span></button>}</div>
    <section className="community-inbox-panel">{tab === 'incoming' && (inbox?.incoming.length ? inbox.incoming.map(item => <RequestRow key={item.id} request={item} incoming onConfirm={confirmAction} />) : <div className="community-empty"><strong>No requests waiting.</strong><p>New requests for your Preview reviewers will appear here.</p></div>)}{tab === 'outgoing' && (inbox?.outgoing.length ? inbox.outgoing.map(item => <RequestRow key={item.id} request={item} incoming={false} onConfirm={confirmAction} />) : <div className="community-empty"><strong>No requests sent.</strong><p>Open a Preview reviewer to request read access or an editable copy.</p></div>)}{tab === 'updates' && (inbox?.notifications.length ? inbox.notifications.map(item => <Link className={`community-notification${item.readAt ? '' : ' is-unread'}`} to={item.url} key={item.id}><span /><div><strong>{item.title}</strong><p>{item.body}</p><small>{timeAgo(item.createdAt)}</small></div><ArrowIcon /></Link>) : <div className="community-empty"><strong>You’re all caught up.</strong><p>Access decisions and Community activity will appear here.</p></div>)}{tab === 'moderation' && (reports.length ? reports.map(report => <article className="community-moderation-row" key={report.id}><div><span>{report.reason}</span><strong>{report.targetLabel}</strong><p>{report.details || 'No additional context was provided.'}</p><small>Reported by @{report.reporter} · {timeAgo(report.createdAt)}</small></div><div><button type="button" onClick={() => moderate(report, 'dismiss')}>Dismiss</button><button type="button" className="community-danger-action" onClick={() => moderate(report, 'hide')}>Hide</button></div></article>) : <div className="community-empty"><strong>No reports to review.</strong><p>The moderation queue is clear.</p></div>)}</section>
    <ConfirmDialog action={confirm} busy={busy} error={error} onClose={() => { if (!busy) { setConfirm(null); setError('') } }} />
  </div>
}

export function CommunityPage() {
  const { reviewerId, username } = useParams<{ reviewerId?: string; username?: string }>()
  const [params] = useSearchParams()
  const [notice, setNotice] = useState<Notice>(null)
  const stableNotice = useCallback((next: Notice) => setNotice(next), [])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 5200); return () => window.clearTimeout(timer) }, [notice])
  let content: ReactNode
  if (reviewerId) content = <ReviewerDetail reviewerId={reviewerId} onNotice={stableNotice} />
  else if (username) content = <PublicProfile username={username} onNotice={stableNotice} />
  else if (params.get('view') === 'inbox') content = <CommunityInboxView onNotice={stableNotice} />
  else content = <CommunityDashboard onNotice={stableNotice} />
  return <><CommunityNotice notice={notice} onClose={() => setNotice(null)} />{content}</>
}
