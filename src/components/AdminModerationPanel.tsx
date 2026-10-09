/* oxlint-disable react/set-state-in-effect -- remote moderation data is synchronized through effects. */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import {
  getAdminCommunityItem,
  listAdminReports,
  resolveAdminReport,
  searchAdminCommunity,
  setCommunityVisibility,
} from '../lib/admin'
import type { AdminCommunityItem, AdminReport, CommunitySearch } from '../lib/admin'
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
type Props = { requestAction: (action: ActionRequest) => void }

const getError = (cause: unknown) => cause instanceof Error ? cause.message : 'The action could not be completed.'

function Glyph({ name }: { name: 'search' | 'close' | 'eye' | 'hide' | 'restore' | 'shield' | 'book' }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></>,
    hide: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6a10 10 0 0 0 3.1-.5M10.2 10.2a2.7 2.7 0 0 0 3.6 3.6"/></>,
    restore: <><path d="M4 8V4m0 0h4M4 4l4 4a7 7 0 1 1-1.5 7.7"/><path d="M12 9v3l2 1"/></>,
    shield: <><path d="M12 3 4.5 6v5.4c0 4.7 3.1 8.1 7.5 9.6 4.4-1.5 7.5-4.9 7.5-9.6V6L12 3Z"/><path d="m9 12 2 2 4-4"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/></>,
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

function ContentPreview({ target, item, loading, error, onClose, onVisibility }: { target: Target | null; item: AdminCommunityItem | null; loading: boolean; error: string; onClose: () => void; onVisibility: (target: Target) => void }) {
  if (!target) return null
  return <div className="admin-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="admin-preview" role="dialog" aria-modal="true" aria-labelledby="admin-preview-title">
      <header className="admin-preview-header">
        <div><span className="admin-preview-kicker">COMMUNITY PREVIEW</span><h2 id="admin-preview-title">{target.label}</h2></div>
        <button aria-label="Close content preview" onClick={onClose}><Glyph name="close"/></button>
      </header>
      {loading ? <div className="admin-preview-loading"><span/><span/><span/></div> : error ? <div className="admin-preview-error" role="alert">{error}</div> : item && <>
        {item.type === 'reviewer' ? <>
          <div className="admin-preview-meta">
            <ProfileAvatar name={item.creator.fullName || item.creator.username} className="admin-preview-avatar"/>
            <div><strong>{item.creator.fullName || `@${item.creator.username}`}</strong><span>@{item.creator.username} · {item.creator.program} · Year {item.creator.yearLevel}</span></div>
            <div className="admin-preview-badges"><span>{item.category}</span><span>{item.visibility}</span>{item.hidden && <span className="is-hidden">Hidden</span>}</div>
          </div>
          {item.description && <p className="admin-preview-description">{item.description}</p>}
          <div className="admin-preview-document">{item.content?.content?.map((node, index) => <DocumentNode key={index} node={node} nodeKey={String(index)}/>)}</div>
        </> : <div className="admin-profile-preview">
          <ProfileAvatar name={item.fullName || item.username} className="admin-profile-preview-avatar"/>
          <div className="admin-profile-preview-name"><h3>{item.fullName || `@${item.username}`}</h3><p>@{item.username}</p></div>
          <div className="admin-preview-badges"><span>{item.program}</span><span>Year {item.yearLevel}</span>{item.suspended && <span className="is-hidden">Suspended</span>}{item.hidden && <span className="is-hidden">Hidden</span>}</div>
          <section><h4>Public bio</h4><p>{item.bio || 'This profile has not added a public bio.'}</p></section>
          <small>Joined {new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' }).format(new Date(item.joinedAt))}</small>
        </div>}
        <footer className="admin-preview-footer">
          <span>Only public Community information is shown here.</span>
          <button className={`admin-moderation-control ${target.hidden ? 'is-restore' : 'is-hide'}`} onClick={() => onVisibility(target)}><Glyph name={target.hidden ? 'restore' : 'hide'}/><span><strong>{target.hidden ? 'Restore to Community' : 'Hide from Community'}</strong><small>{target.hidden ? 'Make this visible again' : 'Remove this from public view'}</small></span></button>
        </footer>
      </>}
    </section>
  </div>
}

export function AdminModerationPanel({ requestAction }: Props) {
  const [reports, setReports] = useState<AdminReport[]>([])
  const [content, setContent] = useState<CommunitySearch>({ reviewers: [], profiles: [] })
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'reviewers' | 'profiles'>('reviewers')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<Target | null>(null)
  const [preview, setPreview] = useState<AdminCommunityItem | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => { const timer = window.setTimeout(() => setSearchQuery(query), 280); return () => window.clearTimeout(timer) }, [query])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextReports, nextContent] = await Promise.all([listAdminReports(), searchAdminCommunity(searchQuery)])
      setReports(nextReports); setContent(nextContent); setError('')
    } catch (cause) { setError(getError(cause)) } finally { setLoading(false) }
  }, [searchQuery])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!target) { setPreview(null); setPreviewError(''); return }
    setPreviewLoading(true); setPreview(null); setPreviewError('')
    void getAdminCommunityItem(target.type, target.id).then(setPreview).catch(cause => setPreviewError(getError(cause))).finally(() => setPreviewLoading(false))
  }, [target])

  function resolve(report: AdminReport, action: 'dismiss' | 'hide') {
    requestAction({ title: action === 'hide' ? `Hide ${report.targetLabel || 'reported content'}?` : 'Dismiss this report?', description: action === 'hide' ? 'The item will be removed from Community and the report will be resolved. Its owner keeps the original content.' : 'The report will close without changing the item’s visibility.', confirmLabel: action === 'hide' ? 'Hide and resolve' : 'Dismiss report', tone: action === 'hide' ? 'danger' : 'default', reasonLabel: 'Resolution note', reasonPlaceholder: 'Record the reason for this decision…', onConfirm: async reason => { await resolveAdminReport(report.id, action, reason); await load() } })
  }
  function visibility(item: Target) {
    const nextHidden = !item.hidden
    requestAction({ title: `${nextHidden ? 'Hide' : 'Restore'} ${item.label}?`, description: nextHidden ? 'This item will disappear from Community but remain intact for its owner.' : 'This item will return to Community unless its creator is suspended.', confirmLabel: nextHidden ? 'Hide from Community' : 'Restore to Community', tone: nextHidden ? 'danger' : 'default', reasonLabel: 'Moderation reason', reasonPlaceholder: 'Explain this visibility change…', onConfirm: async reason => { await setCommunityVisibility(item.type, item.id, nextHidden, reason); setTarget(null); await load() } })
  }
  const items = tab === 'reviewers' ? content.reviewers : content.profiles
  return <>
    <header className="admin-page-header"><div><p className="admin-eyebrow">COMMUNITY SAFETY</p><h1>Moderation</h1><p>Open shared content, review reports, and manage what appears in the Cali Community.</p></div><div className="admin-page-meta"><span className={`admin-count ${reports.length ? 'has-alert' : ''}`}>{reports.length} open report{reports.length === 1 ? '' : 's'}</span></div></header>
    {error && <div className="admin-notice" role="alert"><Glyph name="shield"/><span>{error}</span></div>}
    <section className="admin-panel">
      <header className="admin-panel-head"><div><h2>Report queue</h2><p>Reports are private and shown newest first.</p></div></header>
      {loading ? <div className="admin-skeleton" role="status"><span/><span/><span/></div> : reports.length === 0 ? <div className="admin-empty"><span><Glyph name="shield"/></span><strong>No open reports</strong><p>New Community reports will appear here for review.</p></div> : <div className="admin-report-list">{reports.map(report => <article key={report.id}><span className="admin-report-icon"><Glyph name="shield"/></span><div><strong>{report.targetLabel || 'Unavailable target'}</strong><p><span>{report.targetType}</span> · reported by @{report.reporter}</p><small><b>{report.reason}</b>{report.details ? ` — ${report.details}` : ''}</small></div><div><button className="admin-button admin-button--quiet admin-button--small" onClick={() => resolve(report, 'dismiss')}>Dismiss</button><button className="admin-button admin-button--danger-quiet admin-button--small" onClick={() => resolve(report, 'hide')}><Glyph name="hide"/>Hide</button></div></article>)}</div>}
    </section>
    <section className="admin-panel admin-content-review">
      <header className="admin-panel-head"><div><h2>Community content</h2><p>Preview the actual shared reviewer or public profile before taking action.</p></div><div className="admin-search"><Glyph name="search"/><input aria-label="Search Community content" placeholder="Search Community" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><Glyph name="close"/></button>}</div></header>
      <div className="admin-tabs" role="tablist"><button role="tab" aria-selected={tab === 'reviewers'} onClick={() => setTab('reviewers')}>Reviewers <span>{content.reviewers.length}</span></button><button role="tab" aria-selected={tab === 'profiles'} onClick={() => setTab('profiles')}>Profiles <span>{content.profiles.length}</span></button></div>
      {loading ? <div className="admin-skeleton" role="status"><span/><span/><span/></div> : items.length === 0 ? <div className="admin-empty"><span><Glyph name="search"/></span><strong>Nothing found</strong><p>{query ? 'Try a broader search.' : `No ${tab} are available to review.`}</p></div> : <div className="admin-community-grid">{tab === 'reviewers' ? content.reviewers.map(item => {
        const itemTarget: Target = { type: 'reviewer', id: item.id, label: item.title, hidden: item.hidden }
        return <article key={item.id} className={item.hidden ? 'is-hidden' : ''}><div className="admin-community-card-head"><span><Glyph name="book"/></span><div><small>{item.visibility} reviewer</small><h3>{item.title}</h3><p>Shared by <strong>@{item.username}</strong></p></div><span className={`admin-visibility ${item.hidden ? 'is-hidden' : ''}`}>{item.hidden ? 'Hidden' : 'Visible'}</span></div>{item.hidden && <p className="admin-community-reason">{item.reason || 'Hidden by an administrator.'}</p>}<footer><button className="admin-button admin-button--quiet" onClick={() => setTarget(itemTarget)}><Glyph name="eye"/>View content</button><button className={`admin-moderation-control ${item.hidden ? 'is-restore' : 'is-hide'}`} onClick={() => visibility(itemTarget)}><Glyph name={item.hidden ? 'restore' : 'hide'}/><span><strong>{item.hidden ? 'Restore' : 'Hide'}</strong><small>{item.hidden ? 'Return to Community' : 'Remove from Community'}</small></span></button></footer></article>
      }) : content.profiles.map(item => {
        const itemTarget: Target = { type: 'profile', id: item.userId, label: `@${item.username}`, hidden: item.hidden }
        return <article key={item.userId} className={item.hidden ? 'is-hidden' : ''}><div className="admin-community-card-head"><ProfileAvatar name={item.fullName || item.username} className="admin-content-avatar"/><div><small>Public profile</small><h3>@{item.username}</h3><p>{item.fullName || 'Cali community member'}{item.suspended ? ' · Suspended account' : ''}</p></div><span className={`admin-visibility ${item.hidden ? 'is-hidden' : ''}`}>{item.hidden ? 'Hidden' : 'Visible'}</span></div><footer><button className="admin-button admin-button--quiet" onClick={() => setTarget(itemTarget)}><Glyph name="eye"/>View profile</button><button className={`admin-moderation-control ${item.hidden ? 'is-restore' : 'is-hide'}`} onClick={() => visibility(itemTarget)}><Glyph name={item.hidden ? 'restore' : 'hide'}/><span><strong>{item.hidden ? 'Restore' : 'Hide'}</strong><small>{item.hidden ? 'Return to Community' : 'Remove from Community'}</small></span></button></footer></article>
      })}</div>}
    </section>
    <ContentPreview target={target} item={preview} loading={previewLoading} error={previewError} onClose={() => setTarget(null)} onVisibility={visibility}/>
  </>
}
