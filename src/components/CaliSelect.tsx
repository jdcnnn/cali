import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import './cali-select.css'

export type CaliSelectOption = {
  value: string
  label: string
  detail?: string
  triggerLabel?: string
}

function SelectChevronIcon() {
  return <svg className="cali-select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
}

export function CaliSelect({ value, options, onChange, ariaLabel, className = '', leading }: {
  value: string
  options: CaliSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
  leading?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.find(option => option.value === value) ?? options[0]
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const positionMenu = useCallback((host: HTMLElement) => {
    const trigger = triggerRef.current
    if (!trigger) return
    if (host === rootRef.current) { setMenuStyle({}); return }
    const rect = trigger.getBoundingClientRect()
    const isBody = host === document.body
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
    const hostRect = isBody ? { left: 0, top: 0, bottom: viewportHeight } : host.getBoundingClientRect()
    const gutter = 8, gap = 7
    const width = Math.min(Math.max(rect.width, Math.min(220, viewportWidth - gutter * 2)), viewportWidth - gutter * 2)
    const viewportLeft = Math.min(Math.max(rect.left, gutter), viewportWidth - width - gutter)
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - gap - gutter)
    const availableAbove = Math.max(0, rect.top - gap - gutter)
    const openAbove = availableBelow < 180 && availableAbove > availableBelow
    const availableHeight = openAbove ? availableAbove : availableBelow
    setMenuStyle({
      position: isBody ? 'fixed' : 'absolute',
      zIndex: 300,
      top: openAbove ? 'auto' : rect.bottom + gap - hostRect.top,
      left: viewportLeft - hostRect.left,
      bottom: openAbove ? hostRect.bottom - rect.top + gap : 'auto',
      width,
      maxWidth: width,
      maxHeight: Math.max(72, Math.min(280, availableHeight)),
    })
  }, [])

  useEffect(() => {
    if (!open || !portalHost) return
    const update = () => positionMenu(portalHost)
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [open, portalHost, positionMenu])

  const openMenu = (focusIndex?: number) => {
    const trigger = triggerRef.current
    if (!trigger) return
    const host = trigger.closest('dialog') ?? document.body
    setPortalHost(host)
    positionMenu(host)
    setOpen(true)
    if (focusIndex !== undefined) window.requestAnimationFrame(() => optionRefs.current[focusIndex]?.focus())
  }

  return <div ref={rootRef} className={`cali-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
    <button ref={triggerRef} type="button" className="cali-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => { if (open) setOpen(false); else openMenu() }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, selectedIndex - 1)) }
    }}>
      {leading && <span className="cali-select-leading">{leading}</span>}
      <span className="cali-select-value">{selected?.triggerLabel ?? selected?.label}</span>
      <SelectChevronIcon />
    </button>
    {open && portalHost && createPortal(<div ref={listRef} className="cali-select-options cali-select-options--portal" style={menuStyle} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button
        ref={element => { optionRefs.current[index] = element }}
        key={option.value || 'default'}
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? 'is-selected' : ''}
        onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus() }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const change = event.key === 'ArrowDown' ? 1 : -1; optionRefs.current[(index + change + options.length) % options.length]?.focus() }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); optionRefs.current[event.key === 'Home' ? 0 : options.length - 1]?.focus() }
        }}
      ><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span><span className="cali-select-check" aria-hidden="true">✓</span></button>)}
    </div>, portalHost)}
  </div>
}
