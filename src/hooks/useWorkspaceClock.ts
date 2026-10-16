import { useEffect, useState } from 'react'

export function useWorkspaceClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}
