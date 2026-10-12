import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const oscillators: { frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
let created = 0
let blocked = false
let initialState = 'running'
let now = 1000
let storage: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  oscillators.length = 0
  created = 0; blocked = false; now = 1000; initialState = 'running'
  storage = new Map()
  const browser = new EventTarget()
  Object.assign(browser, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('performance', { now: () => now })
  vi.stubGlobal('AudioContext', class {
    state = initialState
    currentTime = 0
    destination = {}
    constructor() { if (blocked) throw new Error('Audio unavailable'); created++ }
    resume = vi.fn(async () => { this.state = 'running' })
    createOscillator() {
      const node = { frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, type: '', connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
      oscillators.push(node)
      return node
    }
    createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() } }
  })
  Object.assign(window, { AudioContext: globalThis.AudioContext })
})
afterEach(() => vi.unstubAllGlobals())

describe('optional sound effects', () => {
  it('plays by default without creating audio until an interaction', async () => {
    const sound = await import('./sounds')
    expect(created).toBe(0)
    await expect(sound.playSound('task')).resolves.toBe(true)
    expect(oscillators).toHaveLength(8)
  })
  it('preserves a saved off preference without creating audio', async () => {
    storage.set('cali-sound-effects', 'off')
    const sound = await import('./sounds')
    await sound.unlockSounds()
    await sound.playSound('task')
    expect(created).toBe(0)
    expect(oscillators).toHaveLength(0)
  })
  it('remembers opt-in, limits overlapping sounds, and stops immediately on opt-out', async () => {
    const sound = await import('./sounds')
    sound.setSoundsEnabled(true)
    expect(storage.get('cali-sound-effects')).toBe('on')
    await sound.unlockSounds()
    await sound.playSound('task')
    await sound.playSound('task')
    expect(oscillators).toHaveLength(8)
    now += 400
    await sound.playSound('save')
    expect(oscillators).toHaveLength(12)
    sound.setSoundsEnabled(false)
    expect(oscillators.every(node => node.stop.mock.calls.length === 2)).toBe(true)
    now += 400
    await sound.playSound('quiz')
    expect(oscillators).toHaveLength(12)
  })
  it('does not break actions when browser audio is unavailable', async () => {
    const sound = await import('./sounds')
    sound.setSoundsEnabled(true)
    blocked = true
    await expect(sound.unlockSounds()).resolves.toBe(false)
    await expect(sound.playSound('save')).resolves.toBe(false)
  })
  it('unlocks on interaction and follows sound settings changed in another tab', async () => {
    storage.set('cali-sound-effects', 'on')
    const sound = await import('./sounds')
    const dispose = sound.initializeSounds()
    window.dispatchEvent(new Event('pointerdown'))
    await sound.playSound('quiz')
    expect(oscillators).toHaveLength(12)
    const event = new Event('storage')
    Object.assign(event, { key: 'cali-sound-effects', newValue: 'off' })
    window.dispatchEvent(event)
    now += 400
    await sound.playSound('task')
    expect(oscillators).toHaveLength(12)
    dispose()
  })
  it('creates and resumes suspended audio at playback instead of dropping the sound', async () => {
    initialState = 'suspended'
    const sound = await import('./sounds')
    sound.setSoundsEnabled(true)
    await expect(sound.playSound('save')).resolves.toBe(true)
    expect(created).toBe(1)
    expect(oscillators).toHaveLength(4)
  })
  it('uses distinct rising and falling tones for Practice answer feedback', async () => {
    const sound = await import('./sounds')
    sound.setSoundsEnabled(true)
    await sound.playSound('correct')
    expect(oscillators[2].frequency.value).toBeGreaterThan(oscillators[0].frequency.value)
    now += 400
    await sound.playSound('incorrect')
    expect(oscillators[6].frequency.value).toBeLessThan(oscillators[4].frequency.value)
  })
  it('adds a bounded musical lift for a correct-answer streak', async () => {
    const sound = await import('./sounds')
    sound.setSoundsEnabled(true)
    await sound.playSound('correct', { streak: 1 })
    const initialPitch = oscillators[0].frequency.value
    now += 400
    await sound.playSound('correct', { streak: 4 })
    expect(oscillators[4].frequency.value).toBeGreaterThan(initialPitch)
    expect(oscillators[4].frequency.value).toBeLessThan(initialPitch * 1.2)
    expect(oscillators).toHaveLength(10)
  })
  it('plays a brief rising cue for revealing a flashcard and respects opt-out', async () => {
    const sound = await import('./sounds')
    sound.setSoundsEnabled(false)
    await sound.playSound('flip')
    expect(oscillators).toHaveLength(0)
    sound.setSoundsEnabled(true)
    await expect(sound.playSound('flip')).resolves.toBe(true)
    expect(oscillators).toHaveLength(4)
    expect(oscillators[2].frequency.value).toBeGreaterThan(oscillators[0].frequency.value)
    expect(oscillators[0].stop.mock.calls[0][0]).toBeLessThan(.15)
    sound.setSoundsEnabled(false)
    now += 400
    await sound.playSound('flip')
    expect(oscillators).toHaveLength(4)
  })
  it('restores the on default when another tab removes the preference', async () => {
    storage.set('cali-sound-effects', 'off')
    const sound = await import('./sounds')
    const dispose = sound.initializeSounds()
    const event = new Event('storage')
    Object.assign(event, { key: 'cali-sound-effects', newValue: null })
    window.dispatchEvent(event)
    await expect(sound.playSound('flip')).resolves.toBe(true)
    dispose()
  })
  it('schedules warm feedback synchronously with no added onset delay', async () => {
    const sound = await import('./sounds')
    await sound.unlockSounds()
    const playback = sound.playSound('correct')
    expect(oscillators).toHaveLength(4)
    expect(oscillators[0].start).toHaveBeenCalledWith(0)
    await playback
  })
  it('does not drop rapid reveal-to-rating feedback or distinct answer cues', async () => {
    const sound = await import('./sounds')
    await sound.playSound('flip')
    now += 40
    await sound.playSound('correct')
    expect(oscillators).toHaveLength(8)
    now += 40
    await sound.playSound('incorrect')
    expect(oscillators).toHaveLength(12)
    now += 100
    await sound.playSound('incorrect')
    expect(oscillators).toHaveLength(16)
  })
})
