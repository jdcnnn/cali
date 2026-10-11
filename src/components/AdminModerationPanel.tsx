/* oxlint-disable react/set-state-in-effect -- remote moderation data is synchronized through effects. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { Link, useSearchParams } from 'react-router'
import {
  getAdminCommunityItem,
  listAdminReports,
  resolveAdminReport,
  searchAdminCommunity,
  setCommunityVisibility,
} from '../lib/admin'
import type { AdminCommunityItem, AdminReport, CommunitySearch } from '../lib/admin'
import { formatYearLevel } from '../lib/academic'
import { ProfileAvatar } from './CaliWordmark'
import './admin-moderation.css'

type ActionRequest = {
  title: string
  description: string
  confirmLabel: string
  tone?: 'default' | 'danger'
  reasonLabel?: string
  reasonPlaceholder?: string
  onConfirm: (reason: string) => Promise<void>
}

type Target = { type: 'reviewer' | 'profile'; id: string; label: string; hidden: boolean }
type Props = { requestAction: (action: ActionRequest) => void; liveVersion: number }

const getError = (cause: unknown) => cause instanceof Error ? cause.message : 'The action could not be completed.'
const reportReasonLabel = (reason: string) => ({
  impersonation: 'Impersonation or false identity',
  harassment: 'Harassment or targeted abuse',
  inappropriate: 'Inappropriate content or profile information',
  spam: 'Spam or scam activity',
  privacy: 'Privacy or personal safety concern',
  misleading: 'Misleading or inaccurate content',
  copyright: 'Copyright concern',
  other: 'Other concern',
}[reason] ?? reason.replaceAll('_', ' '))

type ReviewerPreviewBlock =
  | { kind: 'heading' | 'text' | 'list'; text: string; checked?: boolean }
  | { kind: 'table'; rows: string[][] }

function reviewerNodeText(node: JSONContent): string {
  if (node.text) return node.text
  return (node.content ?? []).map(reviewerNodeText).join(' ').replace(/\s+/g, ' ').trim()
}

function reviewerPreviewBlocks(content: JSONContent): ReviewerPreviewBlock[] {
  const blocks: ReviewerPreviewBlock[] = []
  const add = (block: Exclude<ReviewerPreviewBlock, { kind: 'table' }>) => {
    const text = block.text.replace(/\s+/g, ' ').trim()
    if (text && blocks.length < 5) blocks.push({ ...block, text })
  }
  const visit = (node: JSONContent) => {
    if (blocks.length >= 5) return
    if (node.type === 'heading') { add({ kind: 'heading', text: reviewerNodeText(node) }); return }
    if (node.type === 'paragraph') { add({ kind: 'text', text: reviewerNodeText(node) }); return }
    if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content ?? []) add({ kind: 'list', text: reviewerNodeText(item), checked: item.attrs?.checked === true })
      return
    }
    if (node.type === 'table') {
      const rows = (node.content ?? []).slice(0, 3).map(row => (row.content ?? []).slice(0, 3).map(cell => reviewerNodeText(cell)))
      if (rows.length && rows[0]?.length && blocks.length < 5) blocks.push({ kind: 'table', rows })
      return
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(content)
  return blocks
}

function Glyph({ name }: { name: 'search' | 'close' | 'eye' | 'hide' | 'restore' | 'shield' | 'book' | 'list' | 'grid' }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></>,
    hide: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6a10 10 0 0 0 3.1-.5M10.2 10.2a2.7 2.7 0 0 0 3.6 3.6"/></>,
    restore: <><path d="M4 8V4m0 0h4M4 4l4 4a7 7 0 1 1-1.5 7.7"/><path d="M12 9v3l2 1"/></>,
    shield: <><path d="M12 3 4.5 6v5.4c0 4.7 3.1 8.1 7.5 9.6 4.4-1.5 7.5-4.9 7.5-9.6V6L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r=".7" fill="currentColor" stroke="none"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function DocumentNode({ node, nodeKey }: { node: JSONContent; nodeKey: string }): ReactNode {
  const children = node.content?.map((child, index) => <DocumentNode key={`${nodeKey}-${index}`} node={child} nodeKey={`${nodeKey}-${index}`}/>)
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
  if (node.type === 'paragraph') return <p>{children?.length ? children : <br/>}</p>
  if (node.type === 'bulletList') return <ul>{children}</ul>
  if (node.type === 'orderedList') return <ol>{children}</ol>
  if (node.type === 'listItem') return <li>{children}</li>
  if (node.type === 'taskList') return <ul className="admin-preview-tasks">{children}</ul>
  if (node.type === 'taskItem') return <li className={node.attrs?.checked ? 'is-checked' : ''}><span aria-hidden="true">{node.attrs?.checked ? '✓' : ''}</span><div>{children}</div></li>
  if (node.type === 'blockquote') return <blockquote>{children}</blockquote>
  if (node.type === 'codeBlock') return <pre><code>{children}</code></pre>
  if (node.type === 'horizontalRule') return <hr/>
  if (node.type === 'hardBreak') return <br/>
  if (node.type === 'table') return <div className="admin-preview-table"><table><tbody>{children}</tbody></table></div>
  if (node.type === 'tableRow') return <tr>{children}</tr>
  if (node.type === 'tableHeader') return <th>{children}</th>
  if (node.type === 'tableCell') return <td>{children}</td>
  if (node.type === 'columns') return <div className="admin-preview-columns">{children}</div>
  if (node.type === 'column') return <div>{children}</div>
  return <>{children}</>
}

function ContentPreview({ target, item, report, loading, error, onClose, onVisibility, onResolve }: { target: Target | null; item: AdminCommunityItem | null; report: AdminReport | null; loading: boolean; error: string; onClose: () => void; onVisibility: (target: Target) => void; onResolve: (report: AdminReport, action: 'dismiss' | 'hide') => void }) {
  if (!target) return null
  return <div className="admin-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="admin-preview" role="dialog" aria-modal="true" aria-labelledby="admin-preview-title">
      <header className="admin-preview-header">
        <div><span className="admin-preview-kicker">{report ? 'REPORT REVIEW' : 'COMMUNITY PREVIEW'}</span><h2 id="admin-preview-title">{item?.type === 'reviewer' ? item.title : target.label}</h2></div>
        <button aria-label="Close content preview" onClick={onClose}><Glyph name="close"/></button>
      </header>
      {report && <aside className="admin-report-context" aria-label="Report details"><div><span>{report.targetType === 'profile' ? 'Account concern' : 'Report reason'}</span><strong>{reportReasonLabel(report.reason)}</strong>{report.details && <p>{report.details}</p>}</div><div className="admin-report-context-meta"><span>Reported by</span><strong>@{report.reporter}</strong><time dateTime={report.createdAt}>{new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.createdAt))}</time></div></aside>}
      {loading ? <div className="admin-preview-loading"><span/><span/><span/></div> : error ? <div className="admin-preview-error" role="alert">{error}</div> : item?.type === 'reviewer' && <>
          <div className="admin-preview-meta">
            <ProfileAvatar name={item.creator.fullName || item.creator.username} className="admin-preview-avatar"/>
            <div><strong>{item.creator.fullName || `@${item.creator.username}`}</strong><span>@{item.creator.username} · {item.creator.program} · {formatYearLevel(item.creator.yearLevel)}</span></div>
            <div className="admin-preview-badges"><span>{item.category}</span><span>{item.visibility}</span>{item.hidden && <span className="is-hidden">Hidden</span>}</div>
          </div>
          {item.description && <p className="admin-preview-description">{item.description}</p>}
          <div className="admin-preview-document">{item.content?.content?.map((node, index) => <DocumentNode key={index} node={node} nodeKey={String(index)}/>)}</div>
        {report ? <footer className="admin-preview-footer admin-report-review-footer"><div><strong>Review this report</strong><span>Choose an outcome after checking the content and report details.</span></div><div><button className="admin-button admin-button--quiet admin-button--small" onClick={() => onResolve(report, 'dismiss')}>Dismiss report</button><button className="admin-button admin-button--danger-quiet admin-button--small" onClick={() => onResolve(report, 'hide')}><Glyph name="hide"/>Hide reviewer</button></div></footer> : <footer className="admin-preview-footer"><span>Reviewer content is shown exactly as it appears in Community.</span><button className={`admin-button admin-button--small ${target.hidden ? 'admin-button--quiet' : 'admin-button--danger-quiet'}`} onClick={() => onVisibility(target)}><Glyph name={target.hidden ? 'restore' : 'hide'}/>{target.hidden ? 'Restore reviewer' : 'Hide reviewer'}</button></footer>}
      </>}
      {!loading && !error && item?.type === 'profile' && <>
        <div className="admin-profile-preview"><ProfileAvatar name={item.fullName || item.username} src={item.avatarUrl} className="admin-profile-preview-avatar"/><div className="admin-profile-preview-name"><h3>{item.fullName || `@${item.username}`}</h3><p>@{item.username}</p></div><div className="admin-preview-badges"><span>{item.program || 'Program not provided'}</span><span>{formatYearLevel(item.yearLevel)}</span>{item.suspended && <span className="is-hidden">Access suspended</span>}</div><section><h4>Public bio</h4><p>{item.bio || 'No public bio provided.'}</p></section><small>Joined {new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(item.joinedAt))}</small></div>
        {report && <footer className="admin-preview-footer admin-report-review-footer"><div><strong>Review this account concern</strong><span>Inspect the public profile, then review account access if the evidence warrants action.</span></div><div><button className="admin-button admin-button--quiet admin-button--small" onClick={() => onResolve(report, 'dismiss')}>Dismiss report</button><Link className="admin-button admin-button--primary admin-button--small" to={`/admin/users?focus=${encodeURIComponent(item.username)}&view=profile&report=${encodeURIComponent(report.id)}`}><Glyph name="eye"/>Review account access</Link></div></footer>}
      </>}
    </section>
  </div>
}

type ReviewerResult = CommunitySearch['reviewers'][number]

function ReviewerBrowser({ items, view, onOpen, onVisibility }: { items: ReviewerResult[]; view: 'list' | 'grid'; onOpen: (target: Target) => void; onVisibility: (target: Target) => void }) {
  const targetFor = (item: ReviewerResult): Target => ({ type: 'reviewer', id: item.id, label: item.title, hidden: item.hidden })
  if (view === 'list') return <div className="admin-reviewer-list">
    <div className="admin-reviewer-list-head" aria-hidden="true"><span>Reviewer</span><span>Owner</span><span>Access</span><span>Status</span><span>Actions</span></div>
    {items.map(item => { const itemTarget = targetFor(item); return <article key={item.id} className={item.hidden ? 'is-hidden' : ''}>
      <div className="admin-reviewer-name"><strong>{item.title}</strong></div>
      <span className="admin-reviewer-owner">@{item.username}</span>
      <span className="admin-reviewer-access">{item.visibility}</span>
      <span className={`admin-visibility ${item.hidden ? 'is-hidden' : ''}`}>{item.hidden ? 'Hidden' : 'Visible'}</span>
      <div className="admin-reviewer-actions"><button className="admin-button admin-button--quiet" onClick={() => onOpen(itemTarget)}><Glyph name="eye"/>View</button><button className={`admin-button ${item.hidden ? 'admin-button--quiet' : 'admin-button--danger-quiet'}`} onClick={() => onVisibility(itemTarget)}><Glyph name={item.hidden ? 'restore' : 'hide'}/>{item.hidden ? 'Restore' : 'Hide'}</button></div>
      {item.hidden && <p className="admin-reviewer-list-reason">Reason: {item.reason || 'Hidden by an administrator.'}</p>}
    </article> })}
  </div>

  return <div className="admin-reviewer-grid">{items.map(item => { const itemTarget = targetFor(item); const previewBlocks = reviewerPreviewBlocks(item.previewContent); return <article key={item.id} className={item.hidden ? 'is-hidden' : ''}>
    <header><small>{item.visibility}</small><span className={`admin-visibility ${item.hidden ? 'is-hidden' : ''}`}>{item.hidden ? 'Hidden' : 'Visible'}</span></header>
    <button className="admin-reviewer-card-preview" onClick={() => onOpen(itemTarget)} aria-label={`Preview ${item.title}`}><span className="admin-reviewer-preview-content" aria-hidden="true">{previewBlocks.length ? previewBlocks.map((block, index) => block.kind === 'table' ? <span key={`table-${index}`} className="admin-reviewer-preview-table" style={{ gridTemplateColumns: `repeat(${block.rows[0]?.length ?? 1}, minmax(0, 1fr))` }}>{block.rows.flatMap((row, rowIndex) => row.map((cell, cellIndex) => <span key={`${rowIndex}-${cellIndex}`} className={rowIndex === 0 ? 'is-header' : ''}>{cell || '\u00a0'}</span>))}</span> : <span key={`${block.kind}-${index}`} className={`admin-reviewer-preview-line is-${block.kind}${block.checked ? ' is-checked' : ''}`}>{block.text}</span>) : <span className="admin-reviewer-preview-empty">This reviewer is ready for notes.</span>}</span></button>
    <div className="admin-reviewer-card-copy"><h3>{item.title}</h3><p>Shared by <strong>@{item.username}</strong></p>{item.hidden && <small>{item.reason || 'Hidden by an administrator.'}</small>}</div>
    <footer><button className="admin-button admin-button--quiet" onClick={() => onOpen(itemTarget)}><Glyph name="eye"/>View</button><button className={`admin-button ${item.hidden ? 'admin-button--quiet' : 'admin-button--danger-quiet'}`} onClick={() => onVisibility(itemTarget)}><Glyph name={item.hidden ? 'restore' : 'hide'}/>{item.hidden ? 'Restore' : 'Hide'}</button></footer>
  </article> })}</div>
}

export function AdminModerationPanel({ requestAction, liveVersion }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkedReviewerId = searchParams.get('reviewer') ?? ''
  const deepLinkedReportId = searchParams.get('report') ?? ''
  const openedDeepLink = useRef('')
  const [reports, setReports] = useState<AdminReport[]>([])
  const [content, setContent] = useState<CommunitySearch>({ reviewers: [], profiles: [] })
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [reviewerView, setReviewerView] = useState<'list' | 'grid'>('list')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<Target | null>(null)
  const [preview, setPreview] = useState<AdminCommunityItem | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [activeReport, setActiveReport] = useState<AdminReport | null>(null)

  useEffect(() => { const timer = window.setTimeout(() => setSearchQuery(query), 280); return () => window.clearTimeout(timer) }, [query])
  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const [nextReports, nextContent] = await Promise.all([listAdminReports(), searchAdminCommunity(searchQuery)])
      setReports(nextReports); setContent(nextContent); setError('')
    } catch (cause) { setError(getError(cause)) } finally { if (showLoading) setLoading(false) }
  }, [searchQuery])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (liveVersion > 0) void load(false) }, [liveVersion, load])
  useEffect(() => {
    if (!target) { setPreview(null); setPreviewError(''); return }
    setPreviewLoading(true); setPreview(null); setPreviewError('')
    void getAdminCommunityItem(target.type, target.id).then(setPreview).catch(cause => setPreviewError(getError(cause))).finally(() => setPreviewLoading(false))
  }, [liveVersion, target])

  useEffect(() => {
    if (loading || !deepLinkedReviewerId) return
    const deepLinkKey = `${deepLinkedReviewerId}:${deepLinkedReportId}`
    if (openedDeepLink.current === deepLinkKey) return
    const matchingReport = deepLinkedReportId ? reports.find(report => report.id === deepLinkedReportId && report.targetType === 'reviewer') : null
    if (matchingReport) openReport(matchingReport)
    else {
      const matchingReviewer = content.reviewers.find(reviewer => reviewer.id === deepLinkedReviewerId)
      setActiveReport(null)
      setTarget({ type: 'reviewer', id: deepLinkedReviewerId, label: matchingReviewer?.title || 'Reviewer inspection', hidden: matchingReviewer?.hidden ?? false })
    }
    openedDeepLink.current = deepLinkKey
  }, [content.reviewers, deepLinkedReportId, deepLinkedReviewerId, loading, reports])

  function closePreview() {
    setTarget(null); setActiveReport(null)
    if (searchParams.has('reviewer') || searchParams.has('report')) {
      const next = new URLSearchParams(searchParams)
      next.delete('reviewer'); next.delete('report')
      setSearchParams(next, { replace: true })
    }
  }

  function resolve(report: AdminReport, action: 'dismiss' | 'hide') {
    if (action === 'hide' && report.targetType !== 'reviewer') return
    requestAction({ title: action === 'hide' ? `Hide ${report.targetLabel || 'reported content'}?` : 'Dismiss this report?', description: action === 'hide' ? 'The reviewer will be removed from Community and the report will be resolved. Its owner keeps the original content.' : report.targetType === 'profile' ? 'The report will close without changing the account’s access or public profile.' : 'The report will close without changing the reviewer’s visibility.', confirmLabel: action === 'hide' ? 'Hide and resolve' : 'Dismiss report', tone: action === 'hide' ? 'danger' : 'default', reasonLabel: 'Resolution note', reasonPlaceholder: 'Record the reason for this decision…', onConfirm: async reason => { await resolveAdminReport(report.id, action, reason); closePreview(); await load() } })
  }
  function visibility(item: Target) {
    if (item.type !== 'reviewer') return
    const nextHidden = !item.hidden
    requestAction({ title: `${nextHidden ? 'Hide' : 'Restore'} ${item.label}?`, description: nextHidden ? 'This item will disappear from Community but remain intact for its owner.' : 'This item will return to Community unless its creator is suspended.', confirmLabel: nextHidden ? 'Hide from Community' : 'Restore to Community', tone: nextHidden ? 'danger' : 'default', reasonLabel: 'Moderation reason', reasonPlaceholder: 'Explain this visibility change…', onConfirm: async reason => { await setCommunityVisibility(item.type, item.id, nextHidden, reason); closePreview(); await load() } })
  }
  const reviewerCount = content.reviewerCount ?? content.reviewers.length
  const visibleReviewerCount = content.reviewers.length
  function openReport(report: AdminReport) {
    setActiveReport(report)
    setTarget({ type: report.targetType, id: report.targetId, label: report.targetType === 'profile' ? `@${report.targetLabel?.replace(/^@/, '') || 'unknown'}` : report.targetLabel || 'Reported reviewer', hidden: false })
  }
  return <>
    <header className="admin-page-header"><div><p className="admin-eyebrow">COMMUNITY SAFETY</p><h1>Moderation</h1><p>Open shared content, review reports, and manage what appears in the Cali Community.</p></div><div className="admin-page-meta"><span className={`admin-count ${reports.length ? 'has-alert' : ''}`}>{reports.length} open report{reports.length === 1 ? '' : 's'}</span></div></header>
    {error && <div className="admin-notice" role="alert"><Glyph name="shield"/><span>{error}</span></div>}
    <section className="admin-panel">
      <header className="admin-panel-head"><div><h2>Report queue</h2><p>Reports are private and shown newest first.</p></div></header>
      {loading ? <div className="admin-skeleton" role="status"><span/><span/><span/></div> : reports.length === 0 ? <div className="admin-empty"><span><Glyph name="shield"/></span><strong>No open reports</strong><p>New Community reports will appear here for review.</p></div> : <div className="admin-report-list admin-report-queue">{reports.map(report => <article key={report.id} className={`admin-report-card${report.targetType === 'profile' ? ' is-profile-report' : ''}`}><div className="admin-report-card-copy"><div className="admin-report-card-meta"><span>{report.targetType === 'reviewer' ? 'Reviewer content' : 'Account concern'}</span><time dateTime={report.createdAt}>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(report.createdAt))}</time></div><h3>{report.targetType === 'profile' ? `@${report.targetLabel?.replace(/^@/, '') || 'unknown'}` : report.targetLabel || 'Unavailable target'}</h3><p>Reported by <strong>@{report.reporter}</strong></p><p className="admin-report-summary"><b>{reportReasonLabel(report.reason)}</b>{report.details ? ` — ${report.details}` : ''}</p></div><div className="admin-report-card-action"><button className="admin-button admin-button--primary admin-button--small" onClick={() => openReport(report)}><Glyph name="eye"/>{report.targetType === 'profile' ? 'Review account' : 'Review content'}</button></div></article>)}</div>}
    </section>
    <section className="admin-panel admin-content-review">
      <header className="admin-panel-head"><div><h2>Community reviewers</h2><p>Preview shared study content and control whether a reviewer appears in Community.</p></div><div className="admin-search"><Glyph name="search"/><input aria-label="Search Community reviewers" placeholder="Search reviewers or owners" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><Glyph name="close"/></button>}</div></header>
      <div className="admin-content-toolbar"><p className="admin-content-summary" aria-live="polite">{visibleReviewerCount < reviewerCount ? <>Showing <strong>{visibleReviewerCount}</strong> of <strong>{reviewerCount}</strong> reviewers</> : <><strong>{reviewerCount}</strong> {reviewerCount === 1 ? 'reviewer' : 'reviewers'}</>}</p><div className="admin-reviewer-view-toggle" role="group" aria-label="Reviewer layout"><button className={reviewerView === 'list' ? 'is-active' : ''} aria-pressed={reviewerView === 'list'} aria-label="List view" onClick={() => setReviewerView('list')}><Glyph name="list"/></button><button className={reviewerView === 'grid' ? 'is-active' : ''} aria-pressed={reviewerView === 'grid'} aria-label="Grid view" onClick={() => setReviewerView('grid')}><Glyph name="grid"/></button></div></div>
      {loading ? <div className="admin-skeleton" role="status"><span/><span/><span/></div> : content.reviewers.length === 0 ? <div className="admin-empty"><span><Glyph name="search"/></span><strong>No reviewers found</strong><p>{query ? 'Try a broader search.' : 'Shared reviewers will appear here for moderation.'}</p></div> : <ReviewerBrowser items={content.reviewers} view={reviewerView} onOpen={item => { setActiveReport(null); setTarget(item) }} onVisibility={visibility}/>}
    </section>
    <ContentPreview target={target} item={preview} report={activeReport} loading={previewLoading} error={previewError} onClose={closePreview} onVisibility={visibility} onResolve={resolve}/>
  </>
}
