export type ConfirmationIconKind = 'confirmation' | 'warning' | 'loading' | 'success' | 'error' | 'information' | 'restart' | 'signout'

export function ConfirmationIcon({ kind }: { kind: ConfirmationIconKind }) {
  const tone = kind === 'error' ? 'error' : kind
  return <span className={`confirmation-icon confirmation-icon--${tone}`} aria-hidden="true">
    {kind === 'confirmation' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg>}
    {(kind === 'warning' || kind === 'error') && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7.5v6" /><path d="M12 17h.01" /></svg>}
    {kind === 'loading' && <svg className="confirmation-icon-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66" /></svg>}
    {kind === 'success' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg>}
    {kind === 'information' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 10.5V17" /><path d="M12 7h.01" /></svg>}
    {kind === 'restart' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5v5.5H9" /><path d="M4 10.5A8.5 8.5 0 1 1 5.8 17" /></svg>}
    {kind === 'signout' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" /></svg>}
  </span>
}
