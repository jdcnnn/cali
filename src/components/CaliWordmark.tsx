import blueWordmark from '../assets/cali-wordmark.svg'
import whiteWordmark from '../assets/cali-wordmark-white.svg'

export function CaliWordmark({ light = false }: { light?: boolean }) {
  return <span className={`cali-wordmark${light ? ' cali-wordmark--light' : ''}`} role="img" aria-label="CALI">
    <img src={blueWordmark} alt="" aria-hidden="true" className="cali-wordmark-color h-14 w-auto sm:h-16" />
    <img src={whiteWordmark} alt="" aria-hidden="true" className="cali-wordmark-inverse h-14 w-auto sm:h-16" />
  </span>
}

export function ProfileAvatar({ name, className = '' }: { name: string; className?: string }) {
  return <div className={`grid place-items-center rounded-full bg-cali-pale text-cali-accent ${className}`} role="img" aria-label={`Avatar for ${name}`}>
    <svg viewBox="0 0 32 32" className="size-7" fill="none" aria-hidden="true"><circle cx="16" cy="11" r="5" fill="currentColor" /><path d="M5 28c0-6 5-10 11-10s11 4 11 10" fill="currentColor" /></svg>
  </div>
}
