import { Link, useLocation } from 'react-router'
import { CaliWordmark } from './CaliWordmark'
import './entry.css'

export function SiteFooter() {
  const location = useLocation()

  function scrollToTop() {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }

  return <footer className="entry-footer">
    <div className="entry-container entry-footer-main">
      <div className="entry-footer-brand">
        <CaliWordmark />
        <p>A workspace for planning classes, managing coursework, creating study sets, and sharing reviewers with fellow RTU students.</p>
      </div>
      <nav className="entry-footer-links" aria-label="Footer navigation">
        <h3>Explore</h3>
        <Link to="/#features">Features</Link>
        <Link to="/#how-it-works">Get started</Link>
        <Link to="/#about">About Cali</Link>
      </nav>
      <div className="entry-footer-note">
        <h3><Link to="/team">Meet the Cali team</Link></h3>
        <p>We built Cali to help RTU students stay organized, keep up with coursework, and make time for better study habits.</p>
      </div>
    </div>
    <nav className="entry-container entry-footer-legal" aria-label="Policies">
      <Link to="/terms-and-conditions">Terms &amp; Conditions</Link>
      <Link to="/privacy-policy">Privacy Policy</Link>
      <Link to="/community-guidelines">Community Guidelines</Link>
    </nav>
    <div className="entry-container entry-footer-bottom">
      <p>Cali is an independent student workspace and is not an official RTU service.</p>
      <div><span>© {new Date().getFullYear()} Cali</span><Link to={location.pathname} onClick={scrollToTop}>Back to top</Link></div>
    </div>
  </footer>
}
