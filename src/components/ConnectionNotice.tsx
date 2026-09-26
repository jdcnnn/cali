import { useEffect, useRef, useState } from 'react'

export function ConnectionNotice() {
  const [status, setStatus] = useState<'online' | 'offline' | 'restored'>(() => navigator.onLine ? 'online' : 'offline')
  const restoreTimer = useRef<number | null>(null)

  useEffect(() => {
    function clearRestoreTimer() {
      if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current)
      restoreTimer.current = null
    }

    function handleOffline() {
      clearRestoreTimer()
      setStatus('offline')
    }

    function handleOnline() {
      clearRestoreTimer()
      setStatus(previous => previous === 'offline' ? 'restored' : 'online')
      restoreTimer.current = window.setTimeout(() => setStatus('online'), 4000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      clearRestoreTimer()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (status === 'online') return null

  return <aside className={`connection-notice connection-notice--${status}`} role={status === 'offline' ? 'alert' : 'status'} aria-live="polite">
    <span className="connection-notice-icon" aria-hidden="true">{status === 'offline' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m3 3 18 18M8.5 8.7A8.8 8.8 0 0 1 12 8c3.6 0 6.7 2.1 8.2 5M5 12.8c.3-.4.7-.8 1.1-1.1M9 16.5a4.6 4.6 0 0 1 6 0M12 20h.01" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>}</span>
    <span><strong>{status === 'offline' ? "You're offline" : 'Connection restored'}</strong><small>{status === 'offline' ? 'Cali needs internet access to load and save your workspace.' : 'Cali can connect and save changes again.'}</small></span>
  </aside>
}
