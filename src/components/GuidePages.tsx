import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import './guide-pages.css'

type GuidePoint = { title: string; detail: string }
type GuideAction = { label: string; to: string }
type GuideSection = {
  id: string
  label: string
  title: string
  summary: string
  points: GuidePoint[]
  note?: string
  actions?: GuideAction[]
}

const studentSections: GuideSection[] = [
  {
    id: 'account', label: 'Start here', title: 'Your account and workspace',
    summary: 'Cali keeps your academic tools under one verified Google account and a student profile you control.',
    points: [
      { title: 'Dashboard', detail: 'See today’s classes, current tasks, and shortcuts to common actions without opening every module.' },
      { title: 'Profile', detail: 'Manage your username, program, year level, and public bio. Your Google name and email identify the signed-in account.' },
      { title: 'Settings', detail: 'Manage browser reminders, install Cali as an app, change appearance, or permanently delete your account and stored data.' },
    ],
    note: 'Your public Community profile uses only the profile information intended for Community. Private schedules, tasks, events, and study drafts are not shown there.',
    actions: [{ label: 'Open profile', to: '/profile' }, { label: 'Open settings', to: '/settings' }],
  },
  {
    id: 'schedules', label: 'Plan', title: 'Schedules',
    summary: 'Build a repeating weekly class schedule and keep each meeting connected to the right subject.',
    points: [
      { title: 'Create and edit classes', detail: 'Record the subject, day, start and end time, room, instructor, color, and an optional reminder.' },
      { title: 'Import a registration form', detail: 'Scan a supported registration form, review the extracted meetings, correct mistakes, then choose what to save.' },
      { title: 'Reliable imports', detail: 'Cali does not treat extracted text as final. You remain responsible for checking class codes, times, days, and room details before saving.' },
    ],
    actions: [{ label: 'Open schedules', to: '/schedules' }],
  },
  {
    id: 'tasks-calendar', label: 'Organize', title: 'Tasks and Calendar',
    summary: 'Use Tasks for work you need to finish and Calendar for a time-based view of academic commitments.',
    points: [
      { title: 'Task planning', detail: 'Add coursework, link it to a subject, set a due date and time, break it into steps, and move it through its status.' },
      { title: 'Focused views', detail: 'Today shows immediate work, Upcoming groups future deadlines, and Completed keeps finished items available for reference.' },
      { title: 'Calendar events', detail: 'View scheduled classes, deadlines, and personal events together. Event colors help distinguish different commitments.' },
    ],
    actions: [{ label: 'Open tasks', to: '/tasks' }, { label: 'Open calendar', to: '/calendar' }],
  },
  {
    id: 'study', label: 'Learn', title: 'Study tools',
    summary: 'Create structured reviewers, practise active recall, and check understanding without leaving your study library.',
    points: [
      { title: 'Reviewers', detail: 'Write and format notes with headings, lists, tasks, tables, highlights, alignment, and page styling. Changes are saved to your library.' },
      { title: 'AI-assisted drafts', detail: 'Generate a reviewer draft from supported source text, PDFs, or scanned note pages. Always compare important details with the original source before relying on it.' },
      { title: 'Flashcards and quizzes', detail: 'Build sets manually or from a reviewer, run recall sessions, track remembered cards, complete quizzes, and revisit recent attempts.' },
    ],
    note: 'AI-generated material is a draft, not an authority. Check definitions, formulas, names, dates, and other high-impact facts before studying or sharing.',
    actions: [{ label: 'Open Study', to: '/study' }],
  },
  {
    id: 'sharing', label: 'Control access', title: 'Reviewer visibility and access',
    summary: 'Every reviewer has a visibility level. Choose it deliberately before publishing study material.',
    points: [
      { title: 'Private', detail: 'Only you can find and read the reviewer. Returning a shared reviewer to Private ends active Community access.' },
      { title: 'Preview', detail: 'Students can discover its public metadata, but the study body remains locked. They may request full read access or permission to make one attributed private copy.' },
      { title: 'Public', detail: 'Anyone signed in to Cali can read, react to, save for quick access, and make an attributed copy. Your original remains yours.' },
    ],
    note: 'Explicitly linked contributors retain full read access to a Preview reviewer. A username written in the document does not grant access; the contributor must be linked to a Cali account.',
  },
  {
    id: 'community', label: 'Discover', title: 'Community',
    summary: 'Find useful reviewers, follow their creators, and use Community signals as context—not as a substitute for checking the material.',
    points: [
      { title: 'Search and filters', detail: 'Search by reviewer or creator, then filter by category, year level, and visibility. Sort by relevance, trending, likes, recency, or student use.' },
      { title: 'Signals and saved reviewers', detail: 'Likes show positive reactions. Used by counts distinct students who opened full content. Saving keeps an accessible reviewer in your personal quick-access list.' },
      { title: 'Requests and updates', detail: 'The Community inbox contains incoming requests, access you have granted, outgoing requests, and Community updates you may archive.' },
    ],
    actions: [{ label: 'Explore Community', to: '/community' }],
  },
  {
    id: 'safety', label: 'Use responsibly', title: 'Reports, privacy, and notifications',
    summary: 'Cali separates safety reports from automatic punishment and limits notifications to the reminders and Community activity the product supports.',
    points: [
      { title: 'Report with context', detail: 'Report a reviewer or public profile when there is a genuine Community concern. Choose the closest reason and add specific details when requested.' },
      { title: 'Admin review', detail: 'A report is private and does not automatically hide content or suspend an account. An administrator inspects the target and records a resolution.' },
      { title: 'Browser reminders', detail: 'Notifications require browser permission and a supported installed or active browser environment. A blocked permission must be changed in browser or device settings.' },
    ],
    note: 'Do not place passwords, access tokens, private personal information, or confidential class records in shared reviewers or report details.',
    actions: [{ label: 'Read Community Guidelines', to: '/community-guidelines' }],
  },
]

const adminSections: GuideSection[] = [
  {
    id: 'principles', label: 'Start here', title: 'Admin scope and operating principles',
    summary: 'The Admin Console is for Community safety, account access, and system policy. Administrative access does not make every student record public.',
    points: [
      { title: 'Use the least disruptive action', detail: 'Inspect the evidence first. Dismiss unsupported reports, hide a reviewer when the content should leave Community, and suspend an account only when access itself must be removed.' },
      { title: 'Record useful reasons', detail: 'Moderation, suspension, restoration, and policy changes create an audit trail. Write factual notes another administrator can understand later.' },
      { title: 'Separate views', detail: 'Open student view to verify the ordinary experience. Return to Admin Console for privileged review and decisions.' },
    ],
    note: 'Never include credentials, access tokens, unrelated personal information, or speculation in administrative notes.',
  },
  {
    id: 'overview', label: 'Orient', title: 'Overview',
    summary: 'Use Overview to identify work that needs attention before opening detailed modules.',
    points: [
      { title: 'Current priority', detail: 'The top status identifies whether Community reports are waiting. Open reports are allegations awaiting a decision, not confirmed violations.' },
      { title: 'Operating status', detail: 'Review active and suspended accounts, RTU and personal account counts, shared reviewers, and the current Google sign-in policy.' },
      { title: 'Accounts to watch', detail: 'Pending report counts point to unreviewed work. Confirmed violation counts reflect prior reviewer reports resolved by hiding the content.' },
    ],
    actions: [{ label: 'Open Overview', to: '/admin' }],
  },
  {
    id: 'moderation', label: 'Review', title: 'Moderation',
    summary: 'The report queue connects a student’s concern to the exact reviewer or public profile an administrator must inspect.',
    points: [
      { title: 'Review the target', detail: 'Open the report to see its reason, reporter-provided details, reporter identity, timestamp, and the associated reviewer content or public profile.' },
      { title: 'Dismiss', detail: 'Close the report when the evidence does not warrant a visibility or access change. Add a clear resolution note.' },
      { title: 'Hide reviewer', detail: 'Remove the reviewer from Community without deleting the owner’s original. Hiding confirms that reviewer report for enforcement monitoring and remains reversible.' },
    ],
    note: 'Profile reports route to the relevant user record for account review. The Community moderation browser manages shared reviewers; profiles are not treated as reviewer content.',
    actions: [{ label: 'Open Moderation', to: '/admin/moderation' }],
  },
  {
    id: 'users', label: 'Inspect', title: 'Users and account access',
    summary: 'Search the directory, inspect public identity details, review report history, and manage sign-in access.',
    points: [
      { title: 'Filters', detail: 'Narrow accounts by active, suspended, or administrator status; RTU or personal Google account; and pending, confirmed, any, or no actionable reviewer reports.' },
      { title: 'Public profile preview', detail: 'View the same public profile information available in Community, including avatar, program, year level, bio, join date, and shared reviewer count.' },
      { title: 'Suspend or restore', detail: 'Suspension immediately blocks Cali access, preserves private data, and hides eligible Community content. Restoration returns access and eligible content.' },
    ],
    note: 'Administrator accounts cannot be suspended from the user directory. Every suspension and restoration requires a recorded reason.',
    actions: [{ label: 'Open Users', to: '/admin/users' }],
  },
  {
    id: 'enforcement', label: 'Decide', title: 'Report monitoring and suspension flow',
    summary: 'Cali organizes confirmed reviewer violations into a 90-day evidence window while preserving human review for every consequential decision.',
    points: [
      { title: 'Pending report', detail: 'The report is awaiting moderation. It appears in the queue and user signals but has no effect on access or the confirmed incident count.' },
      { title: 'One and two incidents', detail: 'One distinct confirmed reviewer incident starts Monitoring. Two distinct confirmed incidents within 90 days move the case to Formal warning and notify the user.' },
      { title: 'Three or more incidents', detail: 'Three distinct confirmed reviewer incidents within 90 days open Suspension review. Cali presents the evidence, but an administrator must explicitly approve suspension.' },
    ],
    note: 'Counts are based on distinct reviewers whose reports were resolved by hiding the reviewer. Multiple reports about one reviewer do not become multiple confirmed incidents.',
  },
  {
    id: 'system', label: 'Configure', title: 'System access policy',
    summary: 'The System module controls who may sign in and provides the permanent administration trail.',
    points: [
      { title: 'RTU accounts only', detail: 'Limits ordinary access to verified @rtu.edu.ph accounts. Existing administrators remain able to administer the system.' },
      { title: 'All Google accounts', detail: 'Allows verified personal Google and Google Workspace accounts in addition to RTU accounts.' },
      { title: 'Policy impact', detail: 'Returning to RTU-only access blocks ineligible personal-account users on their next authorization check but preserves their stored data.' },
    ],
    note: 'Treat a login-policy change as a system-wide access decision. Confirm the intended audience before changing it.',
    actions: [{ label: 'Open System', to: '/admin/system' }],
  },
  {
    id: 'audit', label: 'Verify', title: 'Audit trail and daily checklist',
    summary: 'Use the audit history to understand who changed what, when, and why—and to leave the console in a reviewable state.',
    points: [
      { title: 'Audit coverage', detail: 'Suspensions, restorations, Community visibility decisions, report resolutions, and login-policy changes are recorded with actor and time.' },
      { title: 'Before acting', detail: 'Confirm the target, inspect the current content or profile, distinguish pending from confirmed reports, and read prior resolution notes.' },
      { title: 'After acting', detail: 'Verify the new state, confirm the reason is accurate, check any related enforcement case, and use the audit entry for follow-up.' },
    ],
    actions: [{ label: 'View audit history', to: '/admin/system' }],
  },
]

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
}

function ArrowUpIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 10 6-6 6 6"/><path d="M12 4v16"/></svg>
}

function GuidePage({ kind }: { kind: 'student' | 'admin' }) {
  const [query, setQuery] = useState('')
  const [showBackToTop, setShowBackToTop] = useState(false)
  const isAdmin = kind === 'admin'
  const sections = isAdmin ? adminSections : studentSections
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return sections
    return sections.filter(section => [section.label, section.title, section.summary, section.note, ...section.points.flatMap(point => [point.title, point.detail])].some(value => value?.toLocaleLowerCase().includes(needle)))
  }, [query, sections])

  useEffect(() => {
    if (isAdmin) return
    const updateVisibility = () => setShowBackToTop(window.scrollY > 420)
    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateVisibility)
  }, [isAdmin])

  function scrollGuideToTop() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return <div className={`cali-guide${isAdmin ? ' cali-guide--admin' : ''}`}>
    <header className="cali-guide-hero">
      <div className="cali-guide-heading"><div><p>{isAdmin ? 'OPERATE CALI WITH CONTEXT' : 'MAKE CALI WORK FOR YOU'}</p><h1>{isAdmin ? 'Admin Console Handbook' : 'Cali Guide'}</h1><span>{isAdmin ? 'Features, decision logic, and safe administration practices in one reference.' : 'A clear guide to every workspace module, sharing control, and important account behavior.'}</span></div><aside><strong>{sections.length}</strong><span>guide topics</span><small>Current Cali workflows</small></aside></div>
      <label className="cali-guide-search"><SearchIcon/><span className="sr-only">Search {isAdmin ? 'the admin handbook' : 'the Cali guide'}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={isAdmin ? 'Search features, reports, or policies' : 'Search modules, sharing, or account help'}/>{query && <button type="button" onClick={() => setQuery('')}>Clear</button>}</label>
    </header>

    <div className="cali-guide-layout">
      <aside className="cali-guide-index" aria-label={`${isAdmin ? 'Handbook' : 'Guide'} contents`}>
        <p>ON THIS PAGE</p>
        <nav>{sections.map((section, index) => <a key={section.id} href={`#${kind}-${section.id}`} className={visible.includes(section) ? '' : 'is-filtered'}><span>{String(index + 1).padStart(2, '0')}</span>{section.title}</a>)}</nav>
        <div><strong>{isAdmin ? 'Core safeguard' : 'Need to remember'}</strong><p>{isAdmin ? 'A report is a signal. Only reviewed and confirmed evidence should influence account enforcement.' : 'You control what you publish. Preview content stays locked unless access is granted.'}</p></div>
      </aside>

      <main className="cali-guide-content">
        {visible.length ? visible.map(section => <section id={`${kind}-${section.id}`} className="cali-guide-section" key={section.id}>
          <header><div><p>{section.label}</p><h2>{section.title}</h2><span>{section.summary}</span></div></header>
          <div className="cali-guide-points">{section.points.map(point => <article key={point.title}><h3>{point.title}</h3><p>{point.detail}</p></article>)}</div>
          {section.note && <div className="cali-guide-note"><strong>{isAdmin ? 'Operational note' : 'Important'}</strong><p>{section.note}</p></div>}
          {section.actions && <footer>{section.actions.map(action => <Link key={action.to} to={action.to} state={action.to === '/community-guidelines' ? { from: '/guide', backLabel: 'Back to Cali Guide', view: 'student' } : undefined}>{action.label}<span aria-hidden="true">→</span></Link>)}</footer>}
        </section>) : <section className="cali-guide-empty"><SearchIcon/><h2>No matching guide topics</h2><p>Try a shorter or broader search.</p><button type="button" onClick={() => setQuery('')}>Show all topics</button></section>}
      </main>
    </div>
    {!isAdmin && <button type="button" className={`cali-guide-top${showBackToTop ? ' cali-guide-top--visible' : ''}`} aria-label="Back to top" onClick={scrollGuideToTop}><ArrowUpIcon/></button>}
  </div>
}

export function StudentGuide() { return <GuidePage kind="student"/> }
export function AdminHandbook() { return <GuidePage kind="admin"/> }
