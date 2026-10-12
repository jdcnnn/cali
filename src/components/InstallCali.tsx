import { useEffect, useRef, useState } from 'react'
import { getInstallState, promptToInstall, subscribeToInstallState } from '../lib/pwaInstall'

export function InstallCali() {
  const [installState, setInstallState] = useState(getInstallState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => subscribeToInstallState(() => setInstallState(getInstallState())), [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!instructionsOpen || !dialog) return
    dialog.showModal()
    closeRef.current?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [instructionsOpen])

  async function install() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await promptToInstall()
      setInstallState(getInstallState())
    } catch {
      setError('Cali could not open the installation prompt. Try installing it from your browser menu.')
    } finally {
      setBusy(false)
    }
  }

  let detail = 'Open Cali faster from your device.'
  if (installState.installed) detail = 'Cali is installed on this device.'
  else if (installState.isIos) detail = 'Add Cali from Safari to your Home Screen.'
  else if (!installState.canPrompt) detail = 'Install from your browser menu when available.'

  return <>
    <section className="workspace-install-card" aria-labelledby="install-cali-title">
      <div className="workspace-install-copy"><h2 id="install-cali-title">{installState.installed ? 'Cali is installed' : 'Install Cali'}</h2><p>{detail}</p>{error && <p className="workspace-install-error" role="alert">{error}</p>}</div>
      {!installState.installed && installState.canPrompt && <button type="button" className="button-primary workspace-install-action" onClick={() => { void install() }} disabled={busy}>{busy ? 'Opening...' : 'Install Cali'}</button>}
      {!installState.installed && installState.isIos && <button ref={triggerRef} type="button" className="button-primary workspace-install-action" onClick={() => setInstructionsOpen(true)}>How to install</button>}
    </section>
    <dialog ref={dialogRef} className="signout-dialog workspace-install-dialog" aria-labelledby="install-instructions-title" onCancel={() => setInstructionsOpen(false)} onClose={() => { setInstructionsOpen(false); triggerRef.current?.focus() }}>
      <div className="signout-dialog-content">
        <p className="workspace-overline">IPHONE &amp; IPAD</p>
        <h2 id="install-instructions-title">Add Cali to your Home Screen</h2>
        <ol><li>Open Cali in Safari.</li><li>Tap the Share button.</li><li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li></ol>
        <button ref={closeRef} type="button" className="button-primary workspace-install-dialog-close" onClick={() => setInstructionsOpen(false)}>Got it</button>
      </div>
    </dialog>
  </>
}
