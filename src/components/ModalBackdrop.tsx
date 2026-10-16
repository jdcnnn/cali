import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ModalBackdrop({ children, className, labelledBy, describedBy, alert = false, busy = false, onClose }: { children: ReactNode; className: string; labelledBy: string; describedBy?: string; alert?: boolean; busy?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<dialog ref={ref} className={`${className} cali-modal-backdrop`} role={alert ? 'alertdialog' : 'dialog'} aria-labelledby={labelledBy} aria-describedby={describedBy}
    style={{ border: 0, margin: 0, maxWidth: 'none', maxHeight: 'none', width: '100vw', height: '100dvh', color: 'inherit' }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>{children}</dialog>, document.body)
}
