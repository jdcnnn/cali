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

  let detail = 'Install Cali for quick access from your home screen, dock, or taskbar.'
  if (installState.installed) detail = 'Cali is installed on this device.'
  else if (installState.isIos) detail = 'Install Cali from Safari to open it from your Home Screen.'
  else if (!installState.canPrompt) detail = 'Use your browser menu to install Cali on this device when installation is available.'

  return <>
    <section className="workspace-install-card" aria-labelledby="install-cali-title">
      <div className="workspace-install-copy"><div className="workspace-install-heading"><div className="workspace-install-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg></div><div><p className="workspace-overline">APP INSTALLATION</p><h2 id="install-cali-title">{installState.installed ? 'Cali is installed' : 'Install Cali'}</h2></div></div><p>{detail}</p>{error && <p className="workspace-install-error" role="alert">{error}</p>}</div>
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
