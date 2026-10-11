export type ConfirmationIconKind = 'confirmation' | 'warning' | 'loading' | 'success' | 'error' | 'information' | 'restart' | 'signout'

export function ConfirmationIcon({ kind }: { kind: ConfirmationIconKind }) {
  return <span className={`confirmation-icon confirmation-icon--${kind}`} aria-hidden="true">
    {kind === 'confirmation' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.4 2.4 5-5" /></svg>}
    {kind === 'warning' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 4.6 3.1 17a2 2 0 0 0 1.7 3h14.4a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4.5" /><path d="M12 17h.01" /></svg>}
    {kind === 'loading' && <svg className="confirmation-icon-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66" /></svg>}
    {kind === 'success' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.4 2.4 5-5" /></svg>}
    {kind === 'error' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7l5-5Z" /><path d="m9 9 6 6M15 9l-6 6" /></svg>}
    {kind === 'information' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5V16" /><path d="M12 7.5h.01" /></svg>}
    {kind === 'restart' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5v5.5H9" /><path d="M4 10.5A8.5 8.5 0 1 1 5.8 17" /></svg>}
    {kind === 'signout' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" /></svg>}
  </span>
}
