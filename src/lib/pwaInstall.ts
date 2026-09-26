export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach(listener => listener())
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)
}

export function getInstallState() {
  return {
    canPrompt: deferredPrompt !== null,
    installed: isRunningStandalone(),
    isIos: isIosDevice(),
  }
}

export function subscribeToInstallState(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function promptToInstall() {
  const prompt = deferredPrompt
  if (!prompt) return false
  await prompt.prompt()
  const choice = await prompt.userChoice
  deferredPrompt = null
  notifyListeners()
  return choice.outcome === 'accepted'
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  deferredPrompt = event as InstallPromptEvent
  notifyListeners()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notifyListeners()
})
