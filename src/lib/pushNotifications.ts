import { clearReviewerRecovery } from './reviewerRecovery'
import { supabase } from './supabase'

export type PushStatus = 'unsupported' | 'denied' | 'disabled' | 'enabled'

let enablingNotifications: Promise<void> | null = null
let cachedPushStatus: PushStatus | null = null

function rememberPushStatus(status: PushStatus) {
  cachedPushStatus = status
  return status
}

export function getCachedPushStatus() {
  return cachedPushStatus
}

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

function isPushServiceRegistrationError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /registration failed|push service error|push subscription failed|push service unavailable/i.test(message)
}

export async function readyPushRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Notifications could not start. Reload Cali and try again.')), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

async function subscribeToPush(registration: ServiceWorkerRegistration, applicationServerKey: Uint8Array<ArrayBuffer>) {
  try {
    return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  } catch (firstError) {
    if (!isPushServiceRegistrationError(firstError)) throw firstError
    // An installed Chromium PWA can retain a temporarily stale Push channel.
    // Refresh its worker and retry once before surfacing recovery guidance.
    await registration.update().catch(() => undefined)
    await new Promise(resolve => window.setTimeout(resolve, 500))
    try {
      return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    } catch (retryError) {
      console.error('Push service registration failed after retry.', retryError)
      throw new Error('This browser could not reconnect to its push service. Fully close and reopen Cali, then try another network. See the setup guide below if it continues.')
    }
  }
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supportsPush()) return rememberPushStatus('unsupported')
  if (Notification.permission === 'denied') return rememberPushStatus('denied')
  const registration = await readyPushRegistration()
  return rememberPushStatus(await registration.pushManager.getSubscription() ? 'enabled' : 'disabled')
}

async function enablePushNotificationsOnce(): Promise<void> {
  if (!supportsPush()) throw new Error('Push notifications are not supported by this browser.')
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('Notifications are not configured yet.')
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted. You can enable it in your browser settings.')

  const registration = await readyPushRegistration()
  const subscription = await registration.pushManager.getSubscription()
    ?? await subscribeToPush(registration, urlBase64ToUint8Array(publicKey))
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
    rememberPushStatus('disabled')
    throw error
  }
  rememberPushStatus('enabled')
  announcePushStatusChange()
}

export function enablePushNotifications(): Promise<void> {
  if (enablingNotifications) return enablingNotifications
  enablingNotifications = enablePushNotificationsOnce().finally(() => { enablingNotifications = null })
  return enablingNotifications
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPush()) { rememberPushStatus('unsupported'); return }
  const registration = await readyPushRegistration()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) { rememberPushStatus('disabled'); return }
  if (supabase) {
    const { error } = await supabase.rpc('cali_remove_own_push_subscription', { p_endpoint: subscription.endpoint })
    if (error) throw error
  }
  const removed = await subscription.unsubscribe()
  if (!removed) throw new Error('The browser could not disable notifications. Please try again.')
  rememberPushStatus('disabled')
  announcePushStatusChange()
}

export async function removePushSubscriptionOnSignOut() {
  if (!supportsPush()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  if (supabase) await supabase.rpc('cali_remove_own_push_subscription', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe().catch(() => false)
  rememberPushStatus('disabled')
  announcePushStatusChange()
}

export async function clearLocalAccountData() {
  clearReviewerRecovery()
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
  rememberPushStatus('disabled')
  announcePushStatusChange()
}
