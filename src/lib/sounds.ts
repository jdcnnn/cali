import { useSyncExternalStore } from 'react'

type Sound = 'save' | 'task' | 'quiz' | 'correct' | 'incorrect' | 'flip'
type SoundOptions = { streak?: number }
const storageKey = 'cali-sound-effects'
const listeners = new Set<() => void>()
let enabled = true
try { enabled = typeof window === 'undefined' || window.localStorage.getItem(storageKey) !== 'off' } catch { /* Default on when device storage is unavailable. */ }
let context: AudioContext | null = null
let lastPlayed = -Infinity
let lastSound: Sound | null = null
const active = new Set<OscillatorNode>()
const patterns: Record<Sound, { notes: number[]; spacing: number; length: number; volume: number }> = {
  save: { notes: [659.25, 783.99], spacing: .065, length: .18, volume: .065 },
  task: { notes: [523.25, 659.25, 783.99, 1046.5], spacing: .06, length: .23, volume: .08 },
  quiz: { notes: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1046.5], spacing: .075, length: .28, volume: .075 },
  correct: { notes: [783.99, 1046.5], spacing: .075, length: .22, volume: .085 },
  incorrect: { notes: [349.23, 329.63], spacing: .085, length: .18, volume: .06 },
  flip: { notes: [587.33, 783.99], spacing: .035, length: .09, volume: .035 },
}

function stopSounds() {
  for (const oscillator of active) { try { oscillator.stop() } catch { /* Already stopped. */ } }
  active.clear()
}
export function setSoundsEnabled(value: boolean) {
  enabled = value
  try { window.localStorage.setItem(storageKey, value ? 'on' : 'off') } catch { /* Keep the session preference. */ }
  if (!value) stopSounds()
  for (const listener of listeners) listener()
}
export function useSoundsEnabled() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => enabled, () => false)
}
export async function unlockSounds() {
  if (!enabled || typeof window === 'undefined') return false
  try {
    const AudioConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioConstructor) return false
    if (!context || context.state === 'closed') context = new AudioConstructor({ latencyHint: 'interactive' })
    if (context.state !== 'running') {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([context.resume(), new Promise<void>(resolve => { timeout = setTimeout(resolve, 1000) })])
      } finally { clearTimeout(timeout) }
    }
    return context.state === 'running'
  } catch { return false }
}
// Play only for intentional interactions or confirmed saves, never background updates.
export async function playSound(sound: Sound, options: SoundOptions = {}) {
  if (!enabled || document.hidden) return false
  // An already-running context can schedule feedback synchronously in the click
  // handler, without yielding to a promise or the next React render.
  if (context?.state !== 'running' && !await unlockSounds()) return false
  if (!enabled || document.hidden || !context) return false
  const now = performance.now()
  if (sound === lastSound && now - lastPlayed < 80) return true
  lastPlayed = now
  lastSound = sound
  try {
    const pattern = patterns[sound]
    const streak = Math.max(0, Math.min(6, options.streak ?? 0))
    const pitch = sound === 'correct' ? 2 ** (Math.min(3, Math.max(0, streak - 2)) / 12) : 1
    const notes = sound === 'correct' && streak >= 4 ? [...pattern.notes, 1567.98] : pattern.notes
    const onset = context.currentTime
    // A brief pitch lift and a quiet upper harmonic give each chime a rounded,
    // tactile attack. Both layers decay quickly so feedback stays comfortable.
    notes.forEach((note, index) => [1, 2].forEach((harmonic) => {
      const frequency = note * pitch * harmonic
      const oscillator = context!.createOscillator()
      const envelope = context!.createGain()
      const start = onset + index * pattern.spacing
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      oscillator.frequency.setValueAtTime(frequency * (harmonic === 1 ? .94 : 1), start)
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + .035)
      envelope.gain.setValueAtTime(0, start)
      envelope.gain.linearRampToValueAtTime(pattern.volume * (harmonic === 1 ? 1 : .12), start + .003)
      envelope.gain.exponentialRampToValueAtTime(.0001, start + pattern.length * (harmonic === 1 ? 1 : .65))
      oscillator.connect(envelope)
      envelope.connect(context!.destination)
      active.add(oscillator)
      oscillator.onended = () => { active.delete(oscillator); oscillator.disconnect(); envelope.disconnect() }
      oscillator.start(start)
      oscillator.stop(start + pattern.length + .02)
    }))
    return true
  } catch { return false }
}
export function initializeSounds() {
  const unlock = () => { void unlockSounds() }
  const sync = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return
    enabled = event.key === null || event.newValue !== 'off'
    if (!enabled) stopSounds()
    for (const listener of listeners) listener()
  }
  window.addEventListener('pointerdown', unlock, { passive: true, capture: true })
  window.addEventListener('keydown', unlock, true)
  window.addEventListener('click', unlock, true)
  window.addEventListener('storage', sync)
  return () => {
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
    window.removeEventListener('click', unlock, true)
    window.removeEventListener('storage', sync)
  }
}
