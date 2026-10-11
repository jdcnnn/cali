import { Link, useLocation } from 'react-router'
import { CaliWordmark } from './CaliWordmark'
import { useAuth } from '../auth/AuthContext'
import './entry.css'
import { useLoginMode } from '../auth/LoginModeContext'

export function SiteFooter() {
  const location = useLocation()
  const { state } = useAuth()
  const { allowPersonalGoogleLogin } = useLoginMode()
  const currentPolicyState = (location.state ?? {}) as { from?: string; backLabel?: string; view?: 'student' | 'admin'; previousState?: unknown }
  const currentPath = `${location.pathname}${location.search}${location.hash}`
  const studentPaths = ['/dashboard', '/schedules', '/tasks', '/calendar', '/study', '/community', '/profile', '/guide', '/settings']
  const originPathname = currentPolicyState.from?.split(/[?#]/, 1)[0]
  const isStudentContext = currentPolicyState.view === 'student' || Boolean(originPathname && studentPaths.some(path => originPathname === path || originPathname.startsWith(`${path}/`)))
  const activeView = isStudentContext ? 'student' as const : state.status === 'ready' && state.isAdmin ? 'admin' as const : 'student' as const
  const workspacePath = state.status === 'ready' ? (state.isAdmin && !isStudentContext ? '/admin' : '/dashboard') : state.status === 'needsOnboarding' ? '/onboarding' : null
  const originBackLabel = location.pathname === '/team'
    ? 'Back to Team'
    : location.pathname === '/' || location.pathname === '/login'
      ? 'Back to Cali'
      : 'Go back'
  const policyReturnState = ['/terms-and-conditions', '/privacy-policy', '/community-guidelines'].includes(location.pathname) && currentPolicyState.from
    ? currentPolicyState
    : { from: currentPath, backLabel: originBackLabel, view: activeView, previousState: location.state }

  function scrollToTop() {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }

  return <footer className="entry-footer">
    <div className="entry-container entry-footer-main">
      <div className="entry-footer-brand">
        <CaliWordmark />
        <p>A workspace for planning classes, managing coursework, creating study sets, and sharing reviewers. {allowPersonalGoogleLogin ? 'Verified Google accounts are welcome.' : 'Access currently requires a verified RTU Google account.'}</p>
      </div>
      <nav className="entry-footer-links" aria-label="Footer navigation">
        <h3>Explore</h3>
        <Link to="/#features" state={{ view: activeView }}>Features</Link>
        <Link to={workspacePath ?? '/#how-it-works'}>{workspacePath ? state.status === 'ready' ? 'Dashboard' : 'Continue setup' : 'Get started'}</Link>
        <Link to="/#about" state={{ view: activeView }}>About Cali</Link>
      </nav>
      <div className="entry-footer-note">
        <h3><Link to="/team" state={{ from: currentPath, backLabel: originBackLabel, view: activeView, previousState: location.state }}>Meet the Cali team</Link></h3>
        <p>We built Cali to help RTU students stay organized, keep up with coursework, and make time for better study habits.</p>
      </div>
    </div>
    <nav className="entry-container entry-footer-legal" aria-label="Policies">
      <Link to="/terms-and-conditions" state={policyReturnState}>Terms &amp; Conditions</Link>
      <Link to="/privacy-policy" state={policyReturnState}>Privacy Policy</Link>
      <Link to="/community-guidelines" state={policyReturnState}>Community Guidelines</Link>
    </nav>
    <div className="entry-container entry-footer-bottom">
      <p>Cali is an independent student workspace and is not an official RTU service.</p>
      <div><span>© {new Date().getFullYear()} Cali</span><Link to={location.pathname} onClick={scrollToTop}>Back to top</Link></div>
    </div>
  </footer>
}
