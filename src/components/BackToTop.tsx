import '../styles/back-to-top.css'

export function BackToTop({ className = '', tabIndex }: { className?: string; tabIndex?: number }) {
  function scrollToTop() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? 'instant' : 'smooth' })
  }

  return <button type="button" className={`cali-back-to-top ${className}`} aria-label="Back to top" title="Back to top" tabIndex={tabIndex} onClick={scrollToTop}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
  </button>
}
