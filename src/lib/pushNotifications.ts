import { supabase } from './supabase'

export type PushStatus = 'unsupported' | 'denied' | 'disabled' | 'enabled'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, character => character.charCodeAt(0))
}

function supportsPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function announcePushStatusChange() {
  window.dispatchEvent(new Event('cali:push-status-changed'))
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supportsPush()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription() ? 'enabled' : 'disabled'
}

export async function enablePushNotifications(): Promise<void> {
  if (!supportsPush()) throw new Error('Push notifications are not supported by this browser.')
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('Notifications are not configured yet.')
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted. You can enable it in your browser settings.')

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser returned an incomplete push subscription.')
  if (!supabase) throw new Error('Cali is not connected to the database.')
  const { error } = await supabase.rpc('cali_save_own_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 1000),
  })
  if (error) {
    await subscription.unsubscribe().catch(() => false)
    throw error
  }
  announcePushStatusChange()
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPush()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  if (supabase) {
    const { error } = await supabase.rpc('cali_remove_own_push_subscription', { p_endpoint: subscription.endpoint })
    if (error) throw error
  }
  const removed = await subscription.unsubscribe()
  if (!removed) throw new Error('The browser could not disable notifications. Please try again.')
  announcePushStatusChange()
}

export async function removePushSubscriptionOnSignOut() {
  if (!supportsPush()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  if (supabase) await supabase.rpc('cali_remove_own_push_subscription', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe().catch(() => false)
  announcePushStatusChange()
}

export async function clearLocalAccountData() {
  try {
    window.localStorage.removeItem('cali-theme')
  } catch {
    // Storage may be unavailable, but that must not block account deletion.
  }

  if (!supportsPush()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await subscription.unsubscribe().catch(() => false)
  announcePushStatusChange()
}
