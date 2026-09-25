import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

type Option = { value: string; label: string }

type Props = {
  id: string
  label: string
  placeholder: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  searchable?: boolean
  allowCustom?: boolean
}

export function OnboardingDropdown({ id, label, placeholder, value, options, onChange, invalid = false, describedBy, searchable = false, allowCustom = false }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openAbove, setOpenAbove] = useState(false)
  const [mobileOverlay, setMobileOverlay] = useState(false)
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0 })
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex(option => option.value === value)
  const search = query.trim().toLocaleLowerCase()
  const visibleOptions = search
    ? options.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(search))
    : options
  const menuOptions = allowCustom && search && visibleOptions.length === 0
    ? [{ value: query.trim(), label: `Use “${query.trim()}”` }]
    : visibleOptions
  const visibleSelectedIndex = menuOptions.findIndex(option => option.value === value)

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus()
      else optionRefs.current[Math.max(0, visibleSelectedIndex)]?.focus()
    })
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [open, searchable, visibleSelectedIndex])

  useEffect(() => {
    if (!open || !mobileOverlay) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const visualViewport = window.visualViewport
    function updateViewport() {
      setViewport({ height: visualViewport?.height ?? window.innerHeight, top: visualViewport?.offsetTop ?? 0 })
    }
    updateViewport()
    visualViewport?.addEventListener('resize', updateViewport)
    visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    return () => {
      document.body.style.overflow = previousOverflow
      visualViewport?.removeEventListener('resize', updateViewport)
      visualViewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [open, mobileOverlay])

  function choose(option: Option) {
    onChange(option.value)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  function openMenu() {
    const bounds = triggerRef.current?.getBoundingClientRect()
    if (bounds) setOpenAbove(window.innerHeight - bounds.bottom < 320 && bounds.top > window.innerHeight - bounds.bottom)
    setMobileOverlay(searchable && window.matchMedia('(max-width: 640px)').matches)
    setQuery('')
    setOpen(true)
  }

  function handleOptionKey(event: KeyboardEvent<HTMLDivElement>) {
    const current = optionRefs.current.findIndex(option => option === document.activeElement)
    let next = current
    if (event.key === 'ArrowDown') next = (current + 1) % menuOptions.length
    else if (event.key === 'ArrowUp') next = (current - 1 + menuOptions.length) % menuOptions.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = menuOptions.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    } else if (event.key === 'Tab') {
      setOpen(false)
      return
    } else return
    event.preventDefault()
    optionRefs.current[next]?.focus()
  }

  return <div ref={rootRef} className={`onboarding-dropdown${searchable ? ' onboarding-dropdown--searchable' : ''}${open ? ' onboarding-dropdown--open' : ''}${openAbove ? ' onboarding-dropdown--above' : ''}${mobileOverlay && open ? ' onboarding-dropdown--mobile' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={triggerRef} id={id} type="button" className="field-input onboarding-dropdown-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-invalid={invalid} aria-describedby={describedBy} onClick={() => { if (open) setOpen(false); else openMenu() }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) openMenu() } }}>
      <span className={value ? '' : 'onboarding-dropdown-placeholder'}>{options[selectedIndex]?.label ?? (value || placeholder)}</span>
      <span className="onboarding-dropdown-chevron" aria-hidden="true" />
    </button>
    {open && <div className="onboarding-dropdown-panel" style={mobileOverlay ? { height: viewport.height, top: viewport.top } : undefined}>
      <div className="onboarding-dropdown-panel-header"><strong>{label}</strong><button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus() }} aria-label={`Close ${label} menu`}>Close</button></div>
      {searchable && <input ref={searchRef} className="onboarding-dropdown-search" type="search" value={query} maxLength={allowCustom ? 120 : undefined} onChange={event => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}s`} aria-label={`Search ${label.toLowerCase()}s`} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); optionRefs.current[0]?.focus() }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (visibleOptions.length === 1) choose(visibleOptions[0])
          else if (allowCustom && search && visibleOptions.length === 0) choose(menuOptions[0])
          else optionRefs.current[0]?.focus()
        }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
      }} />}
      <div id={listId} className="onboarding-dropdown-list" role="listbox" aria-label={label} onKeyDown={handleOptionKey}>
        {menuOptions.map((option, index) => <button key={option.value} ref={element => { optionRefs.current[index] = element }} type="button" className="onboarding-dropdown-option" role="option" aria-label={visibleOptions.length ? option.value : option.label} aria-selected={option.value === value} tabIndex={-1} onClick={() => choose(option)}><span className="onboarding-dropdown-option-label">{option.label}</span>{option.value === value && <span className="onboarding-dropdown-option-check" aria-hidden="true">✓</span>}</button>)}
      </div>
    </div>}
  </div>
}
