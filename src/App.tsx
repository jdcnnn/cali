import { Component, Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ErrorInfo, FormEvent, ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/AuthContext'
import type { Student } from './auth/AuthContext'
import { LoginModeProvider, useLoginMode } from './auth/LoginModeContext'
import { CaliWordmark, ProfileAvatar } from './components/CaliWordmark'
import { LandingPage } from './components/LandingPage'
import { OnboardingDropdown } from './components/OnboardingDropdown'
import { SplashScreen } from './components/SplashScreen'
import { TeamPage } from './components/TeamPage'
import { PolicyPage } from './components/PolicyPage'
import { SchedulesPage } from './components/SchedulesPage'
import { DashboardSchedules } from './components/DashboardSchedules'
import { DashboardTasks } from './components/DashboardTasks'
import { TasksPage } from './components/TasksPage'
import { CalendarPage } from './components/CalendarPage'
import { InstallCali } from './components/InstallCali'
import { ConnectionNotice } from './components/ConnectionNotice'
import { CommunityNotificationsProvider } from './components/CommunityNotificationsProvider'
import { ConfirmationIcon } from './components/ConfirmationIcon'
import './components/skeleton.css'
import { ThemePicker } from './theme/ThemePicker'
import { disablePushNotifications, enablePushNotifications, getPushStatus } from './lib/pushNotifications'
import type { PushStatus } from './lib/pushNotifications'

const StudyPage = lazy(() => import('./components/StudyPage').then(module => ({ default: module.StudyPage })))
const CommunityPage = lazy(() => import('./components/CommunityPage').then(module => ({ default: module.CommunityPage })))
const AdminPage = lazy(() => import('./components/AdminDashboard').then(module => ({ default: module.AdminDashboard })))

const programs = [
  'Bachelor of Science in Architecture',
  'Bachelor of Physical Education',
  'Bachelor of Technical-Vocational Teacher Education major in Animation',
  'Bachelor of Technical-Vocational Teacher Education major in Computer System Servicing',
  'Bachelor of Technical-Vocational Teacher Education major in Visual Graphics Design',
  'Bachelor of Technical-Vocational Teacher Education major in Electronics Technology',
  'Bachelor of Technical-Vocational Teacher Education major in Welding and Fabrication Technology',
  'Bachelor of Technical-Vocational Teacher Education major in Garment, Fashion and Design',
  'Bachelor of Secondary Education major in English',
  'Bachelor of Secondary Education major in Filipino',
  'Bachelor of Secondary Education major in Mathematics',
  'Bachelor of Secondary Education major in Sciences',
  'Bachelor of Secondary Education major in Social Studies',
  'Bachelor of Science in Industrial Engineering',
  'Bachelor of Science in Instrumentation and Control Engineering',
  'Bachelor of Science in Mechanical Engineering',
  'Bachelor of Science in Mechatronics Engineering',
  'Bachelor of Science in Civil Engineering',
  'Bachelor of Science in Electrical Engineering',
  'Bachelor of Science in Electronics Engineering',
  'Bachelor of Science in Computer Engineering',
  'Bachelor of Arts in Political Science',
  'Bachelor of Science in Astronomy',
  'Bachelor of Science in Biology',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
  'Bachelor of Science in Accountancy',
  'Bachelor of Science in Entrepreneurship',
  'Bachelor of Science in Office Administration',
  'Bachelor of Science in Business Administration major in Financial Management',
  'Bachelor of Science in Business Administration major in Human Resource Management',
  'Bachelor of Science in Business Administration major in Marketing Management',
  'Bachelor of Science in Business Administration major in Operations Management',
  'Bachelor of Science in Information Technology',
]

function shortProgramName(program: string) {
  return program
    .replace(/^Bachelor of Technical-Vocational Teacher Education/, 'BTVTEd')
    .replace(/^Bachelor of Secondary Education/, 'BSEd')
    .replace(/^Bachelor of Physical Education/, 'BPEd')
    .replace(/^Bachelor of Science in/, 'BS')
    .replace(/^Bachelor of Arts in/, 'BA')
}

const programOptions = programs.map(program => ({ value: program, label: shortProgramName(program) }))
const yearOptions = [
  { value: '1', label: '1st Year' },
  { value: '2', label: '2nd Year' },
  { value: '3', label: '3rd Year' },
  { value: '4', label: '4th Year' },
  { value: '5', label: '5th Year' },
]

function Brand({ light = false }: { light?: boolean }) {
  return <CaliWordmark light={light} />
}

function scrollWorkspaceToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
}

function LoadingScreen() {
  return <main className="splash-screen"><div className="session-loading" role="status" aria-live="polite"><Brand /><p>Opening your workspace...</p></div></main>
}

type StatusKind = 'error' | 'offline' | 'access' | 'not-found'

function StatusArtwork({ kind }: { kind: StatusKind }) {
  const paths = {
    error: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
    offline: <><path d="m3 3 18 18M8.5 8.7A8.8 8.8 0 0 1 12 8c3.6 0 6.7 2.1 8.2 5M5 12.8c.3-.4.7-.8 1.1-1.1M9 16.5a4.6 4.6 0 0 1 6 0M12 20h.01" /></>,
    access: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    'not-found': <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M8.5 8.5l4 4m0-4-4 4" /></>,
  }
  return <span className={`status-artwork status-artwork--${kind}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg></span>
}

function StatusScreen({ title, detail, action, onAction, busy = false, kind = 'error', label = 'Something went wrong' }: { title: string; detail: string; action: string; onAction: () => void; busy?: boolean; kind?: StatusKind; label?: string }) {
  return <main className="status-page">
    <section className="status-card" aria-labelledby="status-title">
      <div className="status-card-brand"><Brand /></div>
      <StatusArtwork kind={kind} />
      <p className="status-label">{label}</p>
      <h1 id="status-title">{title}</h1>
      <p className="status-detail">{detail}</p>
      <button className="button-primary status-action" onClick={onAction} disabled={busy}>{busy ? 'Please wait...' : action}</button>
      <p className="status-support">If this keeps happening, close Cali and try again in a moment.</p>
    </section>
  </main>
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cali encountered an unexpected application error.', error, info)
  }

  render() {
    if (this.state.failed) return <StatusScreen title="Something went wrong" detail="Cali ran into an unexpected problem while opening this page. Reload the app to try again." action="Reload Cali" onAction={() => window.location.reload()} />
    return this.props.children
  }
}

function AuthError() {
  const { state, reload } = useAuth()
  const offline = !navigator.onLine
  useEffect(() => {
    if (!offline) return
    const retry = () => { void reload() }
    window.addEventListener('online', retry, { once: true })
    return () => window.removeEventListener('online', retry)
  }, [offline, reload])
  return <StatusScreen kind={offline ? 'offline' : 'error'} label={offline ? 'Connection unavailable' : 'Unable to load'} title={offline ? "You're offline" : "We couldn't open Cali"} detail={offline ? 'Reconnect to the internet and Cali will try to open your workspace again.' : state.message ?? 'Please check your connection and try again.'} action="Try again" onAction={() => { void reload() }} />
}

function AccessDeniedPage() {
  const { state, signOut } = useAuth()
  const { allowPersonalGoogleLogin } = useLoginMode()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'signedOut') return <Navigate to="/login" replace />
  if (state.status === 'ready') return <Navigate to={state.isAdmin ? '/admin' : '/dashboard'} replace />
  if (state.status === 'needsOnboarding') return <Navigate to="/onboarding" replace />
  if (state.status === 'error') return <AuthError />
  const detail = state.status === 'ineligible' && state.reason === 'suspended'
    ? `This account is suspended.${state.message ? ` Reason: ${state.message}` : ''}`
    : allowPersonalGoogleLogin ? 'Cali requires a verified Google account. Choose a verified account and try again.' : 'Cali currently requires a verified @rtu.edu.ph Google account. Choose your institutional account and try again.'
  return <StatusScreen kind="access" label="Access unavailable" title="This account can't access Cali" detail={error || detail} action="Use another account" busy={busy} onAction={() => { setBusy(true); void signOut().catch(() => { setError('Could not sign out. Please try again.'); setBusy(false) }) }} />
}

function CallbackPage() {
  const { state } = useAuth()
  const location = useLocation()
  const error = new URLSearchParams(location.search).get('error_description')
  if (error) return <StatusScreen title="Google sign-in didn't finish" detail={error} action="Back to sign in" onAction={() => { window.location.replace('/login') }} />
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'ready') return <Navigate to={state.isAdmin ? '/admin' : '/dashboard'} replace />
  if (state.status === 'needsOnboarding') return <Navigate to="/onboarding" replace />
  if (state.status === 'ineligible') return <Navigate to="/access-denied" replace />
  if (state.status === 'error') return <AuthError />
  return <Navigate to="/login" replace />
}

function NotFoundPage() {
  const { state } = useAuth()
  const destination = state.status === 'ready' ? '/dashboard' : state.status === 'needsOnboarding' ? '/onboarding' : '/'
  const action = state.status === 'ready' ? 'Open dashboard' : state.status === 'needsOnboarding' ? 'Continue setup' : 'Back to home'
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Page not found | Cali'
    return () => { document.title = previousTitle }
  }, [])
  return <main className="status-page"><section className="status-card" aria-labelledby="not-found-title"><div className="status-card-brand"><Brand /></div><StatusArtwork kind="not-found" /><p className="status-label">404 / Page not found</p><h1 id="not-found-title">That page isn't here.</h1><p className="status-detail">The address may be incorrect, or the page may have moved.</p><Link className="button-primary status-action" to={destination}>{action}</Link><p className="status-support">Your Cali account and saved work are unaffected.</p></section></main>
}

function GoogleProfile({ email, name, avatar }: { email: string; name: string | null; avatar: string | null }) {
  return <section className="google-profile" aria-label="Connected Google account">
    {avatar ? <img src={avatar} alt="" className="google-profile-avatar" referrerPolicy="no-referrer" /> : <ProfileAvatar name={name || email} className="google-profile-avatar" />}
    <dl>
      <div><dt>Email</dt><dd>{email}</dd></div>
      <div><dt>Full name</dt><dd>{name || 'Not provided by Google'}</dd></div>
    </dl>
  </section>
}

function SignOutControl() {
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    dialog.showModal()
    cancelRef.current?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [open])

  async function confirmSignOut() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await signOut()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out. Please try again.')
      setBusy(false)
    }
  }

  return <>
    <button ref={triggerRef} type="button" className="header-link" onClick={() => { setError(''); setOpen(true) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" /></svg>Sign out</button>
    <dialog ref={dialogRef} className="signout-dialog signout-confirm-dialog" aria-labelledby="signout-title" aria-describedby="signout-description" onCancel={(event) => { if (busy) event.preventDefault() }} onClose={() => { setOpen(false); triggerRef.current?.focus() }}>
      <div className="signout-dialog-content">
        <ConfirmationIcon kind={busy ? 'loading' : 'signout'} />
        <h2 id="signout-title">Sign out of Cali?</h2>
        <p id="signout-description">You can sign in again with an eligible verified Google account.</p>
        {error && <p className="form-error signout-dialog-error" role="alert">{error}</p>}
        <div className="signout-dialog-actions">
          <button ref={cancelRef} type="button" className="signout-cancel" onClick={() => setOpen(false)} disabled={busy}>Stay signed in</button>
          <button type="button" className="button-primary signout-confirm" onClick={() => { void confirmSignOut() }} disabled={busy}>{busy ? 'Signing out...' : 'Sign out'}</button>
        </div>
      </div>
    </dialog>
  </>
}

type OnboardingField = 'username' | 'program' | 'yearLevel'

function OnboardingPage() {
  const { state, completeOnboarding } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [programChoice, setProgramChoice] = useState('')
  const [yearLevel, setYearLevel] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, string>>>({})
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'signedOut') return <Navigate to="/login" replace />
  if (state.status === 'ineligible') return <Navigate to="/access-denied" replace />
  if (state.status === 'ready') return <Navigate to="/dashboard" replace />
  if (state.status === 'error') return <AuthError />

  const googleIdentity = state.user.identities?.find((identity) => identity.provider === 'google')?.identity_data
  const name = typeof googleIdentity?.full_name === 'string' ? googleIdentity.full_name : typeof googleIdentity?.name === 'string' ? googleIdentity.name : null
  const avatar = typeof googleIdentity?.avatar_url === 'string' ? googleIdentity.avatar_url : typeof googleIdentity?.picture === 'string' ? googleIdentity.picture : null

  function clearFieldError(field: OnboardingField) {
    setFieldErrors(previous => ({ ...previous, [field]: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setSubmitError('')
    const normalizedUsername = username.trim().toLowerCase()
    const program = programChoice.trim()
    const year = Number(yearLevel)
    const errors: Partial<Record<OnboardingField, string>> = {}
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) errors.username = 'Use 3-30 lowercase letters, numbers, or underscores.'
    if (!Number.isInteger(year) || year < 1 || year > 5) errors.yearLevel = 'Choose a year level from 1 to 5.'
    if (!program) errors.program = 'Choose or enter your program.'
    else if (program.length > 120) errors.program = 'Use a program name up to 120 characters.'
    setFieldErrors(errors)
    const firstInvalid = Object.keys(errors)[0] as OnboardingField | undefined
    if (firstInvalid) {
      const id = { username: 'username', program: 'program', yearLevel: 'year-level' }[firstInvalid]
      document.getElementById(id)?.focus()
      return
    }
    setBusy(true)
    try {
      await completeOnboarding(normalizedUsername, program, year)
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      const code = typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : ''
      if (code === '23505') {
        setFieldErrors({ username: 'That username is already taken. Choose another one.' })
        document.getElementById('username')?.focus()
      } else {
        setSubmitError(cause instanceof Error ? cause.message : 'We could not save your profile. Please try again.')
      }
      setBusy(false)
    }
  }

  return <main className="onboarding-page">
    <header className="site-header page-wrap"><Brand /><div className="site-header-actions"><SignOutControl /></div></header>
    <div className="onboarding-layout page-wrap">
      <section className="onboarding-intro" aria-labelledby="onboarding-title">
        <div className="onboarding-intro-copy">
          <p className="eyebrow"><span className="eyebrow-mark" /> GET STARTED</p>
          <h1 id="onboarding-title">Set up your <em>Cali profile.</em></h1>
          <p>Check your Google account, then add the details you’ll use in Cali.</p>
        </div>
        <GoogleProfile email={state.user.email ?? ''} name={name} avatar={avatar} />
      </section>
      <form onSubmit={submit} className="onboarding-form" noValidate>
        <div className="form-section-head"><h2>Your details</h2><span>All fields required</span></div>
        <div className="onboarding-fields">
          <div className="onboarding-field"><label htmlFor="username" className="field-label">Username</label><input id="username" name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[a-z0-9_]{3,30}" className="field-input" value={username} onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); clearFieldError('username') }} aria-describedby={fieldErrors.username ? 'username-error username-help' : 'username-help'} aria-invalid={Boolean(fieldErrors.username)} /><ul id="username-help" className="username-requirements"><li>3–30 characters</li><li>Lowercase letters, numbers, underscores</li><li>Unique username</li></ul>{fieldErrors.username && <p id="username-error" className="field-error" role="alert">{fieldErrors.username}</p>}</div>
          <div className="onboarding-field"><label htmlFor="year-level" className="field-label">Year level</label><OnboardingDropdown id="year-level" label="Year level" placeholder="Select year level" value={yearLevel} options={yearOptions} onChange={(value) => { setYearLevel(value); clearFieldError('yearLevel') }} invalid={Boolean(fieldErrors.yearLevel)} describedBy={fieldErrors.yearLevel ? 'year-level-error' : undefined} />{fieldErrors.yearLevel && <p id="year-level-error" className="field-error" role="alert">{fieldErrors.yearLevel}</p>}</div>
          <div className="onboarding-field onboarding-field--program"><label htmlFor="program" className="field-label">Program</label><OnboardingDropdown id="program" label="Program" placeholder="Browse or search programs" value={programChoice} options={programOptions} searchable allowCustom onChange={(value) => { setProgramChoice(value); clearFieldError('program') }} invalid={Boolean(fieldErrors.program)} describedBy={fieldErrors.program ? 'program-error program-help' : 'program-help'} /><p id="program-help" className="field-help">Not on the list? Type your full program name, then choose “Use”.</p>{fieldErrors.program && <p id="program-error" className="field-error" role="alert">{fieldErrors.program}</p>}</div>
        </div>
        {submitError && <p className="form-error mt-6" role="alert">{submitError}</p>}
        <div className="onboarding-form-actions"><button type="submit" className="button-primary onboarding-submit" disabled={busy}>{busy ? 'Saving your profile...' : 'Open my workspace'}</button></div>
      </form>
    </div>
  </main>
}

type WorkspaceSection = 'dashboard' | 'schedules' | 'tasks' | 'calendar' | 'study' | 'community' | 'profile' | 'settings'

const workspaceLinks: { section: WorkspaceSection; label: string; path: string }[] = [
  { section: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { section: 'schedules', label: 'Schedules', path: '/schedules' },
  { section: 'tasks', label: 'Tasks', path: '/tasks' },
  { section: 'calendar', label: 'Calendar', path: '/calendar' },
  { section: 'study', label: 'Study', path: '/study' },
  { section: 'community', label: 'Community', path: '/community' },
  { section: 'profile', label: 'Profile', path: '/profile' },
]

const moduleDetails = {
  schedules: {
    description: 'Keep your classes together in one weekly view.',
    features: [
      { title: 'Weekly classes', detail: 'Organize subjects and meeting times in a repeating weekly schedule.' },
      { title: 'Registration form import', detail: 'Review and correct extracted class details before saving them.' },
      { title: 'Class reminders', detail: 'Choose when to receive notifications before class.' },
    ],
  },
  tasks: {
    description: 'Keep track of coursework and deadlines in one place.',
    features: [
      { title: 'Coursework tasks', detail: 'Record assignments and other work you need to finish.' },
      { title: 'Due dates and status', detail: 'See what is due and mark work as complete.' },
      { title: 'Class links', detail: 'Connect a task to a class when it belongs to one.' },
    ],
  },
  study: {
    description: 'Build a study space around the material you choose to work with.',
    features: [
      { title: 'Reviewers', detail: 'Create and edit structured notes from your own material.' },
      { title: 'Flashcards', detail: 'Turn study content into sets for recall practice.' },
      { title: 'Quizzes', detail: 'Practice with questions based on your study content.' },
    ],
  },
  community: {
    description: 'A place for RTU students to share and discover study reviewers.',
    features: [
      { title: 'Discover reviewers', detail: 'Find reviewers shared by other students.' },
      { title: 'Share your work', detail: 'Publish reviewers you choose to contribute.' },
    ],
  },
} as const

type ModuleSection = keyof typeof moduleDetails

function WorkspaceIcon({ section }: { section: WorkspaceSection }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
    schedules: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 10 1.5 1.5L12 9m2 1h3m-9 6 1.5 1.5L12 15m2 1h3" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M7 2v4m10-4v4M3 9h18M8 13h2m4 0h2m-8 4h2m4 0h2" /></>,
    study: <><path d="M12 6c-2-1.5-5-2-9-1v14c4-1 7-.5 9 1.5 2-2 5-2.5 9-1.5V5c-4-1-7-.5-9 1Z" /><path d="M12 6v14" /></>,
    community: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3Z" /><path d="M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[section]}</svg>
}

function AdminConsoleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.4c0 4.7 3.1 8.1 7.5 9.6 4.4-1.5 7.5-4.9 7.5-9.6V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
}

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function ProfileScreen({ student, email }: { student: Student; email: string }) {
  const { updateProfileDetails } = useAuth()
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(student.username)
  const [programChoice, setProgramChoice] = useState(student.program)
  const [yearLevel, setYearLevel] = useState(String(student.year_level))
  const [bio, setBio] = useState(student.bio ?? '')
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; program?: string; yearLevel?: string; bio?: string }>({})
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const year = yearOptions[student.year_level - 1]?.label ?? `Year ${student.year_level}`

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 4000)
    return () => window.clearTimeout(timer)
  }, [saved])

  function startEditing() {
    setUsername(student.username)
    setProgramChoice(student.program)
    setYearLevel(String(student.year_level))
    setBio(student.bio ?? '')
    setFieldErrors({})
    setSaveError('')
    setSaved(false)
    setEditing(true)
  }

  async function saveProfileDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const normalizedUsername = username.trim().toLowerCase()
    const program = programChoice.trim()
    const yearValue = Number(yearLevel)
    const errors: { username?: string; program?: string; yearLevel?: string; bio?: string } = {}
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) errors.username = 'Use 3–30 lowercase letters, numbers, or underscores.'
    if (!program) errors.program = 'Choose or enter your program.'
    else if (program.length > 120) errors.program = 'Use a program name up to 120 characters.'
    if (!Number.isInteger(yearValue) || yearValue < 1 || yearValue > 5) errors.yearLevel = 'Choose a year level from 1 to 5.'
    if (bio.trim().length > 280) errors.bio = 'Keep your public bio to 280 characters.'
    setFieldErrors(errors)
    if (errors.username || errors.program || errors.yearLevel || errors.bio) {
      document.getElementById(errors.username ? 'profile-username' : errors.program ? 'profile-program' : errors.yearLevel ? 'profile-year-level' : 'profile-bio')?.focus()
      return
    }
    setBusy(true)
    setSaveError('')
    try {
      await updateProfileDetails(normalizedUsername, program, yearValue, bio)
      setEditing(false)
      setSaved(true)
    } catch (cause) {
      const code = typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : ''
      if (code === '23505') {
        setFieldErrors(previous => ({ ...previous, username: 'That username is already taken. Choose another one.' }))
        document.getElementById('profile-username')?.focus()
      } else {
        setSaveError(cause instanceof Error ? cause.message : 'Could not save your profile details. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return <div className="workspace-profile-page">
    <header className="workspace-profile-heading"><h1>Profile</h1><p>Your account and academic information.</p></header>
    <section className="workspace-profile-identity" aria-label="Username">
      {student.avatar_url ? <img src={student.avatar_url} alt="" referrerPolicy="no-referrer" /> : <ProfileAvatar name={student.username} className="workspace-profile-avatar" />}
      <div><p>USERNAME</p><h2>{student.username}</h2><Link className="workspace-public-profile-link" to={`/community/profile/${student.username}`}>View public profile</Link></div>
    </section>
    <div className="workspace-profile-details">
        <section className="workspace-profile-section" aria-labelledby="profile-account-title"><h2 id="profile-account-title">Account</h2><dl><div><dt>Full name</dt><dd>{student.full_name || 'Not provided by Google'}</dd></div><div><dt>Google email</dt><dd>{email}</dd></div></dl></section>
        <section className="workspace-profile-section" aria-labelledby="profile-academic-title">
          <div className="workspace-profile-section-head"><h2 id="profile-academic-title">Profile details</h2>{!editing && <button type="button" className="workspace-profile-edit" onClick={startEditing}>Edit</button>}</div>
          {editing ? <form className="workspace-profile-form" onSubmit={saveProfileDetails} noValidate>
            <div><label className="field-label" htmlFor="profile-username">Username</label><input id="profile-username" name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[a-z0-9_]{3,30}" className="field-input" value={username} onChange={event => { setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setFieldErrors(previous => ({ ...previous, username: undefined })) }} aria-describedby={fieldErrors.username ? 'profile-username-error profile-username-help' : 'profile-username-help'} aria-invalid={Boolean(fieldErrors.username)} /><p id="profile-username-help" className="field-help">Use 3–30 lowercase letters, numbers, or underscores.</p>{fieldErrors.username && <p id="profile-username-error" className="field-error" role="alert">{fieldErrors.username}</p>}</div>
            <div><label className="field-label" htmlFor="profile-program">Program</label><OnboardingDropdown id="profile-program" label="Program" placeholder="Browse or search programs" value={programChoice} options={programOptions} searchable allowCustom onChange={value => { setProgramChoice(value); setFieldErrors(previous => ({ ...previous, program: undefined })) }} invalid={Boolean(fieldErrors.program)} describedBy={fieldErrors.program ? 'profile-program-error profile-program-help' : 'profile-program-help'} /><p id="profile-program-help" className="field-help">Not on the list? Type your full program name, then choose “Use”.</p>{fieldErrors.program && <p id="profile-program-error" className="field-error" role="alert">{fieldErrors.program}</p>}</div>
            <div><label className="field-label" htmlFor="profile-year-level">Year level</label><OnboardingDropdown id="profile-year-level" label="Year level" placeholder="Select year level" value={yearLevel} options={yearOptions} onChange={value => { setYearLevel(value); setFieldErrors(previous => ({ ...previous, yearLevel: undefined })) }} invalid={Boolean(fieldErrors.yearLevel)} describedBy={fieldErrors.yearLevel ? 'profile-year-error' : undefined} />{fieldErrors.yearLevel && <p id="profile-year-error" className="field-error" role="alert">{fieldErrors.yearLevel}</p>}</div>
            <div className="workspace-profile-form-wide"><label className="field-label" htmlFor="profile-bio">Public bio <small>{bio.length}/280</small></label><textarea id="profile-bio" maxLength={280} value={bio} onChange={event => { setBio(event.target.value); setFieldErrors(previous => ({ ...previous, bio: undefined })) }} placeholder="Share what you study or the kinds of reviewers you create." aria-invalid={Boolean(fieldErrors.bio)} />{fieldErrors.bio && <p className="field-error" role="alert">{fieldErrors.bio}</p>}<p className="field-help">Shown on your Cali Community profile.</p></div>
            {saveError && <p className="workspace-profile-save-error" role="alert">{saveError}</p>}
            <div className="workspace-profile-form-actions"><button type="button" className="workspace-profile-cancel" onClick={() => { setEditing(false); setSaveError('') }} disabled={busy}>Cancel</button><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button></div>
          </form> : <><dl><div><dt>Username</dt><dd>{student.username}</dd></div><div><dt>Program</dt><dd>{student.program}</dd></div><div><dt>Year level</dt><dd>{year}</dd></div><div><dt>Public bio</dt><dd>{student.bio || 'Add a short introduction for your Community profile.'}</dd></div></dl>{saved && <p className="workspace-profile-saved" role="status">Profile details saved.</p>}</>}
        </section>
    </div>
    <Link to="/settings" className="workspace-settings-entry">
      <span className="workspace-settings-entry-icon"><WorkspaceIcon section="settings" /></span>
      <span className="workspace-settings-entry-copy"><strong>Cali Settings</strong><small>Manage reminders, app installation, and account controls.</small></span>
      <svg className="workspace-settings-entry-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </Link>
  </div>
}

function SettingsScreen() {
  const { deleteAccount } = useAuth()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!deleteOpen || !dialog) return
    dialog.showModal()
    deleteCancelRef.current?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [deleteOpen])

  async function confirmDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (deleting || deleteConfirmation !== 'DELETE') return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteAccount()
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete your account. Please try again.')
      setDeleting(false)
    }
  }

  return <div className="workspace-settings-page">
    <Link to="/profile" className="cali-back-link workspace-settings-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg><span>Back to Profile</span></Link>
    <header className="workspace-settings-page-heading"><p className="workspace-overline">CALI SETTINGS</p><h1>Settings</h1><p>Manage reminders, app installation, and account controls.</p></header>
    <div className="workspace-settings-stack">
      <NotificationSettings />
      <InstallCali />
      <section className="workspace-danger-zone" aria-labelledby="danger-zone-title"><div><p className="workspace-danger-label">DANGER ZONE</p><h2 id="danger-zone-title">Delete account</h2><p>Permanently delete your account and all profile, schedule, task, event, reminder, and notification data stored in Cali.</p></div><button ref={deleteTriggerRef} type="button" className="workspace-delete-trigger" onClick={() => { setDeleteConfirmation(''); setDeleteError(''); setDeleteOpen(true) }}>Delete account</button></section>
    </div>
    <dialog ref={deleteDialogRef} className="signout-dialog workspace-delete-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description" onCancel={event => { if (deleting) event.preventDefault() }} onClose={() => { setDeleteOpen(false); deleteTriggerRef.current?.focus() }}>
      <form className="signout-dialog-content" onSubmit={confirmDeleteAccount}>
        <ConfirmationIcon kind={deleting ? 'loading' : 'error'} /><p className="workspace-danger-label">DELETE ACCOUNT</p><h2 id="delete-account-title">Delete your Cali account?</h2><p id="delete-account-description">This permanently deletes your sign-in account, profile, schedules, tasks, events, reminders, and notification subscriptions stored in Cali. You cannot undo this action.</p>
        <label className="field-label" htmlFor="delete-account-confirmation">Type <strong>DELETE</strong> to confirm</label><input id="delete-account-confirmation" className="field-input" type="text" autoComplete="off" spellCheck={false} value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={deleting} />
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="signout-dialog-actions"><button ref={deleteCancelRef} type="button" className="signout-cancel" onClick={() => setDeleteOpen(false)} disabled={deleting}>Keep account</button><button type="submit" className="workspace-delete-confirm" disabled={deleting || deleteConfirmation !== 'DELETE'}>{deleting ? 'Deleting...' : 'Delete account'}</button></div>
      </form>
    </dialog>
  </div>
}

function NotificationSettings() {
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    let active = true
    void getPushStatus().then(async next => {
      if (next === 'enabled') await enablePushNotifications()
      if (active) {
        setStatus(next)
        if (next === 'denied') setGuideOpen(true)
      }
    }).catch(() => { if (active) setStatus('unsupported') })
    return () => { active = false }
  }, [])

  async function toggle() {
    if (busy || status === 'unsupported' || status === 'denied') return
    setBusy(true)
    setError('')
    try {
      if (status === 'enabled') await disablePushNotifications()
      else await enablePushNotifications()
      setStatus(await getPushStatus())
    } catch (cause) {
      const next = await getPushStatus().catch(() => 'unsupported' as const)
      setStatus(next)
      setGuideOpen(true)
      if (next !== 'denied') setError(cause instanceof Error ? cause.message : 'Could not update notification settings.')
    } finally { setBusy(false) }
  }

  const enabled = status === 'enabled'
  const description = status === 'unsupported'
    ? 'This browser does not support Web Push notifications.'
    : status === 'denied'
      ? 'Notifications are unavailable in private browsing or are blocked in your browser or device settings.'
      : enabled
        ? 'This device receives reminders selected on your classes, tasks, and events.'
        : 'Enable reminders on this device. Each schedule item keeps its own lead time.'

  return <section className="workspace-notification-card" aria-labelledby="notification-settings-title">
    <div className="workspace-notification-main"><div className="workspace-install-copy"><p className="workspace-overline">REMINDERS</p><h2 id="notification-settings-title">Push notifications</h2><p>{description}</p>{error && <p className="workspace-install-error" role="alert">{error}</p>}</div><button type="button" className={enabled ? 'workspace-notification-disable' : 'button-primary workspace-install-action'} onClick={() => { void toggle() }} disabled={busy || status === 'loading' || status === 'unsupported' || status === 'denied'}>{busy ? 'Updating...' : enabled ? 'Disable notifications' : status === 'denied' ? 'Notifications blocked' : 'Enable notifications'}</button></div>
    <details className="workspace-notification-guide" open={guideOpen} onToggle={event => setGuideOpen(event.currentTarget.open)}>
      <summary>Notification setup and banners</summary>
      <div className="workspace-notification-guide-body">
        <p className="workspace-notification-guide-intro">Complete the Cali setup first, then check your device only if reminders are not appearing as banners.</p>
        <div className="workspace-notification-steps" aria-label="Notification setup steps">
          <section><span aria-hidden="true">1</span><div><strong>Enable this device</strong><p>Select Enable notifications above, then allow Cali when your browser asks for permission.</p></div></section>
          <section><span aria-hidden="true">2</span><div><strong>Add a reminder</strong><p>Choose a reminder on a class, task, or event. Tasks and events need a specific time.</p></div></section>
          <section><span aria-hidden="true">3</span><div><strong>Stay reachable</strong><p>Keep the device online. Reminders may arrive with Cali closed, but delivery still depends on the browser and device.</p></div></section>
        </div>
        <div className="workspace-notification-platforms">
          <section><strong>Android</strong><ol><li>Open Settings, then Notifications and App notifications.</li><li>Select your browser or the installed Cali app and allow notifications.</li><li>If available, enable Pop on screen, Floating notifications, or the equivalent banner option.</li></ol></section>
          <section><strong>Windows</strong><ol><li>Open Settings, then System and Notifications.</li><li>Select your browser or Cali under notification senders.</li><li>Allow notifications and turn on notification banners.</li></ol></section>
          <section><strong>macOS</strong><ol><li>Open System Settings, then Notifications.</li><li>Select your browser or Cali and allow notifications.</li><li>Choose Banners or Alerts as the notification style.</li></ol></section>
        </div>
        <section className="workspace-notification-troubleshooting"><strong>If a reminder does not appear</strong><ul><li>Open Cali's site information or permissions and confirm Notifications is set to Allow.</li><li>Check that Focus or Do Not Disturb is not hiding banners.</li><li>Confirm the class, task, or event still has a future reminder time.</li><li>Use a regular browsing window; private browsing does not receive notifications.</li><li>Reopen Cali and try Enable notifications again. If registration still fails, try another network.</li></ul></section>
        <p className="workspace-notification-guide-note">Menu names vary by device and operating-system version. Cali schedules the reminder, while your browser and device control permission, background delivery, and banner presentation.</p>
      </div>
    </details>
  </section>
}

function ModuleScreen({ section }: { section: ModuleSection }) {
  const details = moduleDetails[section]
  const label = workspaceLinks.find(link => link.section === section)?.label
  return <div className="workspace-module-page">
    <header className="workspace-module-hero"><div className="workspace-module-hero-icon"><WorkspaceIcon section={section} /></div><div><div className="workspace-module-meta"><span className="workspace-overline">CALI WORKSPACE</span></div><h1>{label}</h1><p>{details.description}</p></div></header>
    <section className="workspace-module-preview" aria-labelledby="module-preview-title"><div className="workspace-section-heading"><div><p className="workspace-overline">WHAT'S PLANNED</p><h2 id="module-preview-title">Inside {label}</h2></div><p>These tools are being built and are not available yet.</p></div><div className="workspace-capability-list">{details.features.map((feature, index) => <div className="workspace-capability" key={feature.title}><span className="workspace-capability-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{feature.title}</h3><p>{feature.detail}</p></div><span className="workspace-capability-state">Planned</span></div>)}</div></section>
    <NavLink to="/dashboard" className="cali-back-link workspace-return-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg><span>Back to dashboard</span></NavLink>
  </div>
}

function WorkspaceContent({ student, email, section }: { student: Student; email: string; section: WorkspaceSection }) {
  const { state } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    scrollWorkspaceToTop()
  }, [section])

  useEffect(() => {
    const updateTime = () => setNow(new Date())
    let timer: number
    const scheduleTick = () => {
      timer = window.setTimeout(() => { updateTime(); scheduleTick() }, 60_000 - Date.now() % 60_000 + 50)
    }
    scheduleTick()
    document.addEventListener('visibilitychange', updateTime)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', updateTime) }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus() }
      if (event.key === 'Tab') {
        const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const closeOnDesktop = () => { if (window.innerWidth > 900) setMenuOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnDesktop)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', closeOnEscape); window.removeEventListener('resize', closeOnDesktop) }
  }, [menuOpen])

  return <main className="dashboard-page workspace-shell">
    {menuOpen && <button type="button" className="workspace-backdrop" aria-label="Close navigation" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus() }} />}
    <aside ref={sidebarRef} id="workspace-sidebar" className={`workspace-sidebar${menuOpen ? ' workspace-sidebar--open' : ''}`} aria-label="Workspace navigation">
      <div className="workspace-sidebar-head"><NavLink to="/dashboard" aria-label="Cali dashboard" onClick={() => { setMenuOpen(false); scrollWorkspaceToTop() }}><Brand /></NavLink><button ref={closeButtonRef} type="button" className="workspace-menu-close" aria-label="Close menu" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus() }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg></button></div>
      <nav className="workspace-nav" aria-label="Main workspace"><p className="workspace-nav-caption">WORKSPACE</p>
        {workspaceLinks.map(link => <NavLink key={link.section} to={link.path} end className={({ isActive }) => `workspace-nav-link${isActive || (section === 'settings' && link.section === 'profile') ? ' workspace-nav-link--active' : ''}`} onClick={() => setMenuOpen(false)}><WorkspaceIcon section={link.section} /><span>{link.label}</span>{(link.section === section || (section === 'settings' && link.section === 'profile')) && <span className="workspace-nav-marker" aria-hidden="true" />}</NavLink>)}
      </nav>
      <div className="workspace-sidebar-bottom">
        {state.status === 'ready' && state.isAdmin && <NavLink className="workspace-admin-switch" to="/admin" onClick={() => setMenuOpen(false)}>
          <span className="workspace-admin-switch-icon"><AdminConsoleIcon /></span>
          <span className="workspace-admin-switch-copy"><small>ADMIN CONSOLE</small><strong>Switch to Admin</strong></span>
          <svg className="workspace-admin-switch-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </NavLink>}
        <div className="workspace-sidebar-actions"><ThemePicker /><SignOutControl /></div>
      </div>
    </aside>
    <div className="workspace-content" inert={menuOpen} aria-hidden={menuOpen}>
      <header className="workspace-mobile-header"><button ref={menuButtonRef} type="button" className="workspace-menu-button" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={() => setMenuOpen(true)}><span /><span /><span /></button><NavLink to="/dashboard" aria-label="Cali dashboard" onClick={scrollWorkspaceToTop}><Brand /></NavLink></header>
      {section === 'dashboard' ? <>
        <section className="workspace-welcome" aria-labelledby="workspace-title"><div className="workspace-welcome-main"><p className="workspace-overline">YOUR DASHBOARD</p><h1 id="workspace-title">{greetingForHour(now.getHours())}, <em>{student.username}.</em></h1><p>Your classes, tasks, and study space in one place.</p></div><div className="workspace-date"><span>TODAY</span><strong>{new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</strong><small>{now.getFullYear()}</small></div></section>
        <div className="workspace-overview-grid">
          <DashboardSchedules studentId={student.user_id} now={now} />
          <div className="dashboard-side-panel">
            <DashboardTasks studentId={student.user_id} now={now} />
            <section className="dashboard-quick-actions" aria-labelledby="dashboard-quick-actions-title"><h2 id="dashboard-quick-actions-title">Quick actions</h2><div className="dashboard-quick-actions-list">
              {([
                { to: '/schedules', section: 'schedules', label: 'Add a class meeting' },
                { to: '/profile', section: 'profile', label: 'Edit academic details' },
                { to: '/study', section: 'study', label: 'Open study tools' },
              ] as const).map(action => <NavLink key={action.to} to={action.to} className="dashboard-action-card"><span className="dashboard-action-icon"><WorkspaceIcon section={action.section} /></span><span className="dashboard-action-label">{action.label}</span><svg className="dashboard-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></NavLink>)}
            </div></section>
          </div>
        </div>
      </> : section === 'profile' ? <ProfileScreen student={student} email={email} /> : section === 'settings' ? <SettingsScreen /> : section === 'schedules' ? <SchedulesPage studentId={student.user_id} now={now} /> : section === 'tasks' ? <TasksPage studentId={student.user_id} /> : section === 'calendar' ? <CalendarPage studentId={student.user_id} now={now} /> : section === 'study' ? <Suspense fallback={<div className="workspace-module-loading" role="status" aria-label="Loading Study"><span className="cali-skeleton skeleton-block" aria-hidden="true" /></div>}><StudyPage studentId={student.user_id} /></Suspense> : section === 'community' ? <Suspense fallback={<div className="workspace-module-loading" role="status" aria-label="Loading Community"><span className="cali-skeleton skeleton-block" aria-hidden="true" /></div>}><CommunityPage /></Suspense> : <ModuleScreen section={section} />}
    </div>
  </main>
}

function WorkspacePage({ section }: { section: WorkspaceSection }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'signedOut') return <Navigate to="/login" replace />
  if (state.status === 'ineligible') return <Navigate to="/access-denied" replace />
  if (state.status === 'needsOnboarding') return <Navigate to="/onboarding" replace />
  if (state.status === 'error') return <AuthError />
  return <WorkspaceContent student={state.student} email={state.user.email ?? ''} section={section} />
}

function HomeRedirect() {
  const { state } = useAuth()
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'ready') return <Navigate to={state.isAdmin ? '/admin' : '/dashboard'} replace />
  if (state.status === 'needsOnboarding') return <Navigate to="/onboarding" replace />
  if (state.status === 'ineligible') return <Navigate to="/access-denied" replace />
  if (state.status === 'error') return <AuthError />
  return <LandingPage />
}

function AppRoutes() {
  const [splashPhase, setSplashPhase] = useState<'showing' | 'leaving' | 'done'>(() => {
    const knownPaths = ['/', '/login', '/team', '/terms-and-conditions', '/privacy-policy', '/community-guidelines', '/auth/callback', '/access-denied', '/onboarding', '/dashboard', '/schedules', '/tasks', '/calendar', '/study', '/community', '/profile', '/settings', '/admin', '/admin/moderation', '/admin/users', '/admin/system']
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'done'
    if (!knownPaths.includes(window.location.pathname)) return 'done'
    if (['/terms-and-conditions', '/privacy-policy', '/community-guidelines'].includes(window.location.pathname)) return 'done'
    if (window.location.pathname === '/auth/callback' || new URLSearchParams(window.location.search).has('code')) return 'done'
    return 'showing'
  })
  useEffect(() => {
    if (splashPhase !== 'showing') return
    const timer = window.setTimeout(() => setSplashPhase('leaving'), 1600)
    return () => window.clearTimeout(timer)
  }, [splashPhase])
  useEffect(() => {
    if (splashPhase !== 'leaving') return
    const timer = window.setTimeout(() => setSplashPhase('done'), 420)
    return () => window.clearTimeout(timer)
  }, [splashPhase])
  return <><div inert={splashPhase !== 'done'} aria-hidden={splashPhase !== 'done'}><Routes>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/login" element={<HomeRedirect />} />
    <Route path="/team" element={<TeamPage />} />
    <Route path="/terms-and-conditions" element={<PolicyPage kind="terms" />} />
    <Route path="/privacy-policy" element={<PolicyPage kind="privacy" />} />
    <Route path="/community-guidelines" element={<PolicyPage kind="community" />} />
    <Route path="/auth/callback" element={<CallbackPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/dashboard" element={<WorkspacePage section="dashboard" />} />
    <Route path="/schedules" element={<WorkspacePage section="schedules" />} />
    <Route path="/tasks" element={<WorkspacePage section="tasks" />} />
    <Route path="/calendar" element={<WorkspacePage section="calendar" />} />
    <Route path="/study" element={<WorkspacePage section="study" />} />
    <Route path="/community" element={<WorkspacePage section="community" />} />
    <Route path="/community/reviewer/:reviewerId" element={<WorkspacePage section="community" />} />
    <Route path="/community/profile/:username" element={<WorkspacePage section="community" />} />
    <Route path="/profile" element={<WorkspacePage section="profile" />} />
    <Route path="/settings" element={<WorkspacePage section="settings" />} />
    <Route path="/admin/:section?" element={<Suspense fallback={<LoadingScreen />}><AdminPage /></Suspense>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></div><ConnectionNotice />{splashPhase !== 'done' && <SplashScreen leaving={splashPhase === 'leaving'} />}</>
}

export default function App() {
  return <BrowserRouter><AppErrorBoundary><LoginModeProvider><AuthProvider><CommunityNotificationsProvider><AppRoutes /></CommunityNotificationsProvider></AuthProvider></LoginModeProvider></AppErrorBoundary></BrowserRouter>
}
