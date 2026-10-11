import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { getCommunityInbox, getCommunityNotificationPage, subscribeToCommunityAccessChanges, subscribeToCommunityNotifications } from '../lib/community'
import type { CommunityNotification } from '../lib/community'

type CommunityNotificationsContextValue = {
  inboxCount: number
  liveVersion: number
  refreshInboxCount: () => Promise<void>
}

const CommunityNotificationsContext = createContext<CommunityNotificationsContextValue | null>(null)

// The provider and its paired hook intentionally share this small module.
// oxlint-disable-next-line react/only-export-components
export function useCommunityNotifications() {
  const context = useContext(CommunityNotificationsContext)
  if (!context) throw new Error('useCommunityNotifications must be used inside CommunityNotificationsProvider')
  return context
}

export function CommunityNotificationsProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const [inboxCount, setInboxCount] = useState(0)
  const [liveVersion, setLiveVersion] = useState(0)
  const [notice, setNotice] = useState<CommunityNotification | null>(null)
  const userId = state.status === 'ready' ? state.user.id : null

  const refreshInboxCount = useCallback(async () => {
    if (!userId) { setInboxCount(0); return }
    try {
      const [next, notifications] = await Promise.all([getCommunityInbox(), getCommunityNotificationPage(1, 1)])
      setInboxCount(next.incoming.filter(item => item.status === 'pending').length + notifications.unreadCount)
    } catch { /* Individual screens surface their own load errors. */ }
  }, [userId])

  // This count is loaded from the external Community inbox.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshInboxCount() }, [refreshInboxCount])
  useEffect(() => {
    if (!userId) return
    return subscribeToCommunityNotifications(userId, notification => {
      setNotice(notification)
      setLiveVersion(version => version + 1)
      void refreshInboxCount()
    })
  }, [refreshInboxCount, userId])
  useEffect(() => {
    if (!userId) return
    return subscribeToCommunityAccessChanges(userId, () => {
      setLiveVersion(version => version + 1)
      void refreshInboxCount()
    })
  }, [refreshInboxCount, userId])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6500)
    return () => window.clearTimeout(timer)
  }, [notice])

  return <CommunityNotificationsContext.Provider value={{ inboxCount, liveVersion, refreshInboxCount }}>
    {children}
    {notice && <aside className="community-live-notice" role="status" aria-live="polite">
      <span className="community-live-notice-dot" aria-hidden="true" />
      <div><strong>{notice.title}</strong><p>{notice.body}</p><Link to={notice.url} onClick={() => setNotice(null)}>Open inbox</Link></div>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button>
    </aside>}
  </CommunityNotificationsContext.Provider>
}
