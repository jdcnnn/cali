import blueWordmark from '../assets/cali-wordmark.svg'
import whiteWordmark from '../assets/cali-wordmark-white.svg'

export function CaliWordmark({ light = false }: { light?: boolean }) {
  return <span className={`cali-wordmark${light ? ' cali-wordmark--light' : ''}`} role="img" aria-label="CALI">
    <img src={blueWordmark} alt="" aria-hidden="true" className="cali-wordmark-color h-14 w-auto sm:h-16" />
    <img src={whiteWordmark} alt="" aria-hidden="true" className="cali-wordmark-inverse h-14 w-auto sm:h-16" />
  </span>
}

export function ProfileAvatar({ name, src, className = '' }: { name: string; src?: string | null; className?: string }) {
  const nameParts = name.trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
  const initials = (nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
    : nameParts[0]?.slice(0, 1) || '?').toUpperCase()

  return <div className={`profile-avatar relative grid place-items-center overflow-hidden rounded-[28%] bg-cali-pale font-semibold uppercase text-cali-accent ${className}`} role="img" aria-label={`Avatar for ${name}`}>
    <span aria-hidden="true">{initials}</span>
    {src && <img
      className="absolute inset-0 size-full object-cover"
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={event => event.currentTarget.remove()}
    />}
  </div>
}
