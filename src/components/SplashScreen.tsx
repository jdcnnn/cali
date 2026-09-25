import { CaliWordmark } from './CaliWordmark'

export function SplashScreen({ leaving = false }: { leaving?: boolean }) {
  return <main className={`splash-screen${leaving ? ' splash-screen--leaving' : ''}`} role="status" aria-live="polite" aria-label="Loading CALI">
    <div className="splash-content">
      <span className="splash-kicker" aria-hidden="true">Built for RTU students</span>
      <div className="splash-logo"><CaliWordmark /></div>
      <div className="splash-rule" aria-hidden="true"><span /></div>
      <p className="splash-status">Getting your space ready&hellip;</p>
    </div>
  </main>
}
