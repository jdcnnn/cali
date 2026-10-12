import { useState } from 'react'
import { Link } from 'react-router'
import { playSound, setSoundsEnabled, useSoundsEnabled } from '../lib/sounds'
import '../styles/sound-settings.css'

export function SoundSettingsNote() {
  const enabled = useSoundsEnabled()
  return enabled ? <p className="workspace-sound-note">Sound effects are on. You can turn them off in <Link to="/settings">Settings</Link>.</p> : null
}

export function SoundSettings() {
  const enabled = useSoundsEnabled()
  const [error, setError] = useState('')
  async function preview() {
    setError('')
    if (!await playSound('save')) setError('Audio could not start. Try again and check that this tab and your device are not muted.')
  }
  async function toggle() {
    const next = !enabled
    setSoundsEnabled(next)
    setError('')
    if (next) await preview()
  }
  return <section className="workspace-sound-card" aria-labelledby="sound-settings-title">
    <div className="workspace-install-copy"><h2 id="sound-settings-title">Sound effects</h2>
      <p>Soft sounds for tasks, quizzes, flashcards, and manual saves. On by default; turn them off anytime.</p>
      {enabled && error && <p className="workspace-install-error" role="alert">{error}</p>}
    </div>
    <div className="workspace-sound-actions">
    <button type="button" role="switch" aria-checked={enabled} aria-labelledby="sound-settings-title"
      className={`workspace-sound-switch${enabled ? ' is-on' : ''}`} onClick={() => { void toggle() }}><span aria-hidden="true" /></button>
    </div>
  </section>
}
