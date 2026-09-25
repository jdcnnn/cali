type StatusIconName = 'calendar' | 'sun' | 'tasks' | 'check'

export function StatusIcon({ name }: { name: StatusIconName }) {
  const paths = {
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M7.5 3v4m9-4v4M3.5 10h17M8 14h3m-3 3h7" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="m8 10 1.5 1.5L12 9m2 1h3m-9 6 1.5 1.5L12 15m2 1h3" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.3 2.3 4.7-4.7" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
