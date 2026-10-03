import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { EMPTY_REVIEWER_DOCUMENT, formatReviewerDate, reviewerMatches, type Reviewer, type ReviewerSubject } from '../lib/reviewers'
import './study.css'
import './skeleton.css'

type Notice = { kind: 'error' | 'success'; text: string } | null

function usesLightForeground(pageColor: string): boolean {
  const compact = pageColor.trim().replace(/^#/, '')
  const hex = compact.length === 3 ? compact.split('').map(character => character + character).join('') : compact
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const backgroundLuminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  const darkInkLuminance = 0.036
  const lightInkLuminance = 0.955
  const contrast = (foreground: number) => (Math.max(backgroundLuminance, foreground) + 0.05) / (Math.min(backgroundLuminance, foreground) + 0.05)
  return contrast(lightInkLuminance) > contrast(darkInkLuminance)
}

const BlockLayout = Extension.create({
  name: 'blockLayout',
  priority: 1000,
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: element => Number(element.getAttribute('data-indent') ?? 0),
          renderHTML: attributes => attributes.indent ? { 'data-indent': String(attributes.indent) } : {},
        },
        lineHeight: {
          default: null,
          parseHTML: element => element.getAttribute('data-line-height'),
          renderHTML: attributes => attributes.lineHeight ? { 'data-line-height': String(attributes.lineHeight) } : {},
        },
      },
    }]
  },
  addKeyboardShortcuts() {
    const adjustIndent = (amount: number) => {
      if (this.editor.isActive('listItem')) {
        if (amount > 0) this.editor.commands.sinkListItem('listItem')
        else this.editor.commands.liftListItem('listItem')
        return true
      }
      const blockName = this.editor.isActive('heading') ? 'heading' : this.editor.isActive('paragraph') ? 'paragraph' : null
      if (!blockName) return false
      const currentIndent = Number(this.editor.getAttributes(blockName).indent ?? 0)
      this.editor.commands.updateAttributes(blockName, { indent: Math.max(0, Math.min(4, currentIndent + amount)) })
      return true
    }
    return {
      Tab: () => adjustIndent(1),
      'Shift-Tab': () => adjustIndent(-1),
    }
  },
})

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize?.replace('px', '') || null,
          renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}px` } : {},
        },
      },
    }]
  },
})

const PageStyle = Extension.create({
  name: 'pageStyle',
  addGlobalAttributes() {
    return [{ types: ['doc'], attributes: { pageColor: { default: null } } }]
  },
})

const editorExtensions = [StarterKit.configure({ heading: { levels: [2, 3] }, italic: { HTMLAttributes: { class: 'reviewer-italic' } } }), TextStyle, Color, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), Underline, BlockLayout, FontSize, PageStyle]

function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg> }
function ShareIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg> }
function MoreIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg> }
function AlignIcon({ direction }: { direction: 'left' | 'center' | 'right' | 'justify' }) { const paths = direction === 'left' ? ['M4 6h16', 'M4 10h11', 'M4 14h16', 'M4 18h9'] : direction === 'center' ? ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M8 18h8'] : direction === 'right' ? ['M4 6h16', 'M9 10h11', 'M4 14h16', 'M11 18h9'] : ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16']; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{paths.map(path => <path key={path} d={path} />)}</svg> }
function IndentIcon({ outdent = false }: { outdent?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6h10M10 10h10M10 14h10M10 18h10" /><path d={outdent ? 'm7 9-3 3 3 3' : 'm4 9 3 3-3 3'} /></svg> }
function ListIcon({ ordered = false }: { ordered?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{ordered ? <><path d="M4 6h1v3M3.5 9H6M3.5 14c.3-.8 2.5-.9 2.5.3 0 .8-2.5 2.7-2.5 2.7H6" /></> : <><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" /></>}<path d="M9 7h11M9 12h11M9 17h11" /></svg> }
function UndoIcon({ redo = false }: { redo?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={redo ? 'm16 7 4 4-4 4' : 'm8 7-4 4 4 4'} /><path d={redo ? 'M20 11h-9a6 6 0 0 0-6 6' : 'M4 11h9a6 6 0 0 1 6 6'} /></svg> }
function TextColorIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m6 17 6-13 6 13M8 13h8" /><path d="M5 21h14" /></svg> }
function MarkerIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 4 6 6-9 9H5v-6Z" /><path d="m11 7 6 6M4 21h16" /></svg> }
function ItalicIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 5h8M6 19h8M14 5 10 19" /></svg> }
function PageColorIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6Z" /><path d="M15 3v5h5M9 16h7" /></svg> }
function LineSpacingIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M4 5v14M2 7l2-2 2 2M2 17l2 2 2-2" /></svg> }
function SelectChevronIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg> }

type CaliSelectOption = { value: string; label: string; detail?: string; triggerLabel?: string }

function CaliSelect({ value, options, onChange, ariaLabel, className = '', leading }: { value: string; options: CaliSelectOption[]; onChange: (value: string) => void; ariaLabel: string; className?: string; leading?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.find(option => option.value === value) ?? options[0]
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  const openAndFocus = (index: number) => {
    setOpen(true)
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus())
  }
  return <div ref={rootRef} className={`cali-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
    <button ref={triggerRef} type="button" className="cali-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAndFocus(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, selectedIndex - 1)) }
    }}>
      {leading && <span className="cali-select-leading">{leading}</span>}
      <span className="cali-select-value">{selected?.triggerLabel ?? selected?.label}</span>
      <SelectChevronIcon />
    </button>
    {open && <div className="cali-select-options" role="listbox" aria-label={ariaLabel}>
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
    </div>}
  </div>
}

function DocumentView({ content, editable = false, onEditor, pageColorOverride }: { content: JSONContent; editable?: boolean; onEditor?: (editor: Editor) => void; pageColorOverride?: string }) {
  const editor = useEditor({ extensions: editorExtensions, content, editable, immediatelyRender: false })
  useEffect(() => { if (editor) onEditor?.(editor) }, [editor, onEditor])
  useEffect(() => { if (editor && !editable && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content) }, [content, editable, editor])
  const pageColor = pageColorOverride ?? String(editor?.state.doc.attrs.pageColor ?? content.attrs?.pageColor ?? '')
  return <EditorContent editor={editor} className={`${editable ? 'reviewer-editor-content' : 'reviewer-document'}${pageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': pageColor || 'var(--color-cali-surface)' } as CSSProperties} />
}

function Toolbar({ editor, onPageColorChange }: { editor: Editor | null; onPageColorChange?: (pageColor: string) => void }) {
  const [toolbarOpen, setToolbarOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches)
  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 761px)')
    const syncToolbar = () => setToolbarOpen(desktopQuery.matches)
    syncToolbar()
    desktopQuery.addEventListener('change', syncToolbar)
    return () => desktopQuery.removeEventListener('change', syncToolbar)
  }, [])
  if (!editor) return <div className="reviewer-toolbar" aria-hidden="true" />
  const blockType = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'
  const blockName = blockType === 'p' ? 'paragraph' : 'heading'
  const blockAttributes = editor.getAttributes(blockName)
  const indent = Number(blockAttributes.indent ?? 0)
  const lineHeight = String(blockAttributes.lineHeight ?? '1.75')
  const fontSize = Number(editor.getAttributes('textStyle').fontSize ?? 16)
  const setFontSize = (size: number) => {
    if (!Number.isFinite(size)) return
    const nextSize = Math.max(8, Math.min(72, Math.round(size)))
    editor.chain().focus().setMark('textStyle', { fontSize: String(nextSize) }).run()
  }
  const setBlockAttribute = (attributes: Record<string, unknown>) => { editor.chain().focus().updateAttributes(blockName, attributes).run() }
  const adjustIndent = (amount: number) => {
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      if (amount > 0) editor.chain().focus().sinkListItem('listItem').run()
      else editor.chain().focus().liftListItem('listItem').run()
      return
    }
    setBlockAttribute({ indent: Math.max(0, Math.min(4, indent + amount)) })
  }
  const button = (label: string, active: boolean, action: () => void, content: ReactNode, disabled = false) => <button type="button" className={active ? 'is-active' : ''} aria-label={label} title={label} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action}>{content}</button>
  const closePalette = (target: HTMLElement) => { const palette = target.closest('details') as HTMLDetailsElement | null; if (palette) palette.open = false }
  const fontSwatches = [
    ['Cali ink', '#12384D'], ['Ocean', '#107DAC'], ['Primary blue', '#189AD3'], ['Aqua', '#1EBBD7'], ['Teal', '#23837C'], ['Mint', '#3D8F68'],
    ['Fern', '#63823F'], ['Gold', '#9A7308'], ['Orange', '#B8611E'], ['Coral', '#B85249'], ['Rose', '#A84F70'], ['Violet', '#735AA7'],
    ['Black', '#111827'], ['Charcoal', '#374151'], ['Slate', '#6B7280'], ['Gray', '#9CA3AF'], ['Red', '#DC2626'], ['Tangerine', '#EA580C'],
    ['Yellow', '#CA8A04'], ['Green', '#16A34A'], ['Cyan', '#0891B2'], ['Royal blue', '#2563EB'], ['Purple', '#7C3AED'], ['Pink', '#DB2777'],
  ]
  const markerSwatches = [
    ['Soft yellow', '#FFF0A8'], ['Lemon', '#FDE68A'], ['Soft sky', '#BDEBFA'], ['Blue', '#BFDBFE'], ['Soft aqua', '#B8F1F2'], ['Soft mint', '#BFEED8'],
    ['Green', '#BBF7D0'], ['Lime', '#D9F99D'], ['Soft coral', '#FFD0C7'], ['Peach', '#FED7AA'], ['Pink', '#FBCFE8'], ['Soft rose', '#FECDD3'],
    ['Lavender', '#DDD2FA'], ['Purple', '#E9D5FF'], ['Cool gray', '#E2E8F0'], ['Warm gray', '#E7E5E4'], ['Bright yellow', '#FDE047'], ['Bright cyan', '#67E8F9'],
    ['Bright green', '#86EFAC'], ['Bright orange', '#FDBA74'], ['Bright pink', '#F9A8D4'], ['Bright violet', '#C4B5FD'], ['Cali sky', '#71C7EC'], ['Cali aqua', '#1EBBD7'],
  ]
  const activeFontColor = String(editor.getAttributes('textStyle').color ?? '').toUpperCase()
  const activeMarkerColor = String(editor.getAttributes('highlight').color ?? '').toUpperCase()
  const activePageColor = String(editor.state.doc.attrs.pageColor ?? '').toUpperCase()
  const textStyleOptions: CaliSelectOption[] = [{ value: 'p', label: 'Normal text' }, { value: 'h2', label: 'Heading' }, { value: 'h3', label: 'Subheading' }]
  const lineSpacingOptions: CaliSelectOption[] = [
    { value: '1', label: 'Single', detail: '1.0', triggerLabel: '1.0' },
    { value: '1.15', label: 'Standard', detail: '1.15', triggerLabel: '1.15' },
    { value: '1.5', label: 'Relaxed', detail: '1.5', triggerLabel: '1.5' },
    { value: '1.75', label: 'Comfortable', detail: '1.75', triggerLabel: '1.75' },
    { value: '2', label: 'Double', detail: '2.0', triggerLabel: '2.0' },
  ]
  const pageSwatches = [
    ...markerSwatches.slice(0, 16),
    ['Cali ink', '#12384D'], ['Deep ocean', '#0B4F6C'], ['Navy', '#172B4D'], ['Teal', '#145A5A'],
    ['Forest', '#28543C'], ['Plum', '#4C315F'], ['Charcoal', '#374151'], ['Black', '#111827'],
  ]
  const setPageColor = (pageColor: string | null) => {
    editor.view.dispatch(editor.state.tr.setDocAttribute('pageColor', pageColor))
    onPageColorChange?.(pageColor ?? '')
  }
  return <details
    className="reviewer-toolbar-shell"
    open={toolbarOpen}
    onToggle={event => {
      const nextOpen = window.matchMedia('(min-width: 761px)').matches || event.currentTarget.open
      if (nextOpen !== toolbarOpen) setToolbarOpen(nextOpen)
    }}
  >
    <summary><span><strong aria-hidden="true">Aa</strong> Formatting tools</span><small><span className="is-collapsed">Tap to expand</span><span className="is-expanded">Tap to collapse</span></small></summary>
    <div className="reviewer-toolbar" aria-label="Reviewer formatting">
    <div className="reviewer-toolbar-group reviewer-toolbar-style"><CaliSelect ariaLabel="Text style" className="cali-select--toolbar cali-select--text-style" value={blockType} options={textStyleOptions} onChange={nextValue => { if (nextValue === 'h2') editor.chain().focus().setHeading({ level: 2 }).run(); else if (nextValue === 'h3') editor.chain().focus().setHeading({ level: 3 }).run(); else editor.chain().focus().setParagraph().run() }} /></div>
    <div className="reviewer-toolbar-group reviewer-font-size">
      {button('Decrease font size', false, () => setFontSize(fontSize - 1), <span aria-hidden="true">−</span>, fontSize <= 8)}
      <input key={`font-size-${fontSize}`} type="number" min="8" max="72" defaultValue={fontSize} aria-label="Font size" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setFontSize(event.currentTarget.value ? Number(event.currentTarget.value) : fontSize); event.currentTarget.blur() } }} onBlur={event => setFontSize(event.currentTarget.value ? Number(event.currentTarget.value) : fontSize)} />
      {button('Increase font size', false, () => setFontSize(fontSize + 1), <span aria-hidden="true">+</span>, fontSize >= 72)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-format">
      {button('Bold', editor.isActive('bold'), () => { editor.chain().focus().toggleBold().run() }, <strong>B</strong>)}
      {button('Italic', editor.isActive('italic'), () => { editor.chain().focus().toggleItalic().run() }, <ItalicIcon />)}
      {button('Underline', editor.isActive('underline'), () => { editor.chain().focus().toggleUnderline().run() }, <u>U</u>)}
      <details className={`reviewer-swatch-palette${activeFontColor ? ' is-active' : ''}`}><summary aria-label="Font color" title="Font color"><TextColorIcon /></summary><div className="reviewer-swatch-grid" role="group" aria-label="Font colors">{fontSwatches.map(([name, value]) => <button key={value} type="button" className={`reviewer-swatch${activeFontColor === value ? ' is-selected' : ''}`} aria-label={`${name} text`} title={name} style={{ '--swatch-color': value } as CSSProperties} onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().setColor(value).run(); closePalette(event.currentTarget) }}><span /></button>)}<button type="button" className="reviewer-swatch-none" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().unsetColor().run(); closePalette(event.currentTarget) }}>Default</button></div></details>
      <details className={`reviewer-swatch-palette${editor.isActive('highlight') ? ' is-active' : ''}`}><summary aria-label="Marker color" title="Marker color"><MarkerIcon /></summary><div className="reviewer-swatch-grid" role="group" aria-label="Marker colors">{markerSwatches.map(([name, value]) => <button key={value} type="button" className={`reviewer-swatch${activeMarkerColor === value ? ' is-selected' : ''}`} aria-label={`${name} marker`} title={name} style={{ '--swatch-color': value } as CSSProperties} onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().setHighlight({ color: value }).run(); closePalette(event.currentTarget) }}><span /></button>)}<button type="button" className="reviewer-swatch-none" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().unsetHighlight().run(); closePalette(event.currentTarget) }}>None</button></div></details>
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-alignment">
      {button('Align left', editor.isActive({ textAlign: 'left' }), () => { editor.chain().focus().setTextAlign('left').run() }, <AlignIcon direction="left" />)}
      {button('Align center', editor.isActive({ textAlign: 'center' }), () => { editor.chain().focus().setTextAlign('center').run() }, <AlignIcon direction="center" />)}
      {button('Align right', editor.isActive({ textAlign: 'right' }), () => { editor.chain().focus().setTextAlign('right').run() }, <AlignIcon direction="right" />)}
      {button('Justify', editor.isActive({ textAlign: 'justify' }), () => { editor.chain().focus().setTextAlign('justify').run() }, <AlignIcon direction="justify" />)}
      {button('Decrease indent', false, () => adjustIndent(-1), <IndentIcon outdent />, indent === 0 && !editor.isActive('listItem'))}
      {button('Increase indent', false, () => adjustIndent(1), <IndentIcon />)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-paragraph">
      <CaliSelect ariaLabel="Line spacing" className="cali-select--toolbar cali-select--line-spacing" leading={<LineSpacingIcon />} value={lineHeight} options={lineSpacingOptions} onChange={nextValue => setBlockAttribute({ lineHeight: nextValue })} />
      {button('Bulleted list', editor.isActive('bulletList'), () => { editor.chain().focus().toggleBulletList().run() }, <ListIcon />)}
      {button('Numbered list', editor.isActive('orderedList'), () => { editor.chain().focus().toggleOrderedList().run() }, <ListIcon ordered />)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-page-color">
      <details className={`reviewer-swatch-palette${activePageColor ? ' is-active' : ''}`}><summary aria-label="Reviewer page color" title="Reviewer page color"><PageColorIcon /></summary><div className="reviewer-swatch-grid" role="group" aria-label="Reviewer page colors">{pageSwatches.map(([name, value]) => <button key={value} type="button" className={`reviewer-swatch${activePageColor === value ? ' is-selected' : ''}`} aria-label={`${name} page`} title={name} style={{ '--swatch-color': value } as CSSProperties} onMouseDown={event => event.preventDefault()} onClick={event => { setPageColor(value); closePalette(event.currentTarget) }}><span /></button>)}<button type="button" className="reviewer-swatch-none" onMouseDown={event => event.preventDefault()} onClick={event => { setPageColor(null); closePalette(event.currentTarget) }}>Default page</button></div></details>
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-history">
      {button('Undo', false, () => { editor.chain().focus().undo().run() }, <UndoIcon />, !editor.can().undo())}
      {button('Redo', false, () => { editor.chain().focus().redo().run() }, <UndoIcon redo />, !editor.can().redo())}
    </div>
    </div>
  </details>
}

function ReviewerEditor({ reviewer, subjects, onSaved, onClose, onPageColorChange }: { reviewer: Reviewer; subjects: ReviewerSubject[]; onSaved: (reviewer: Reviewer) => void; onClose: () => void; onPageColorChange: (pageColor: string) => void }) {
  const [title, setTitle] = useState(reviewer.title)
  const [subjectId, setSubjectId] = useState(reviewer.subject_id ?? '')
  const [pageColor, setPageColor] = useState(String(reviewer.content.attrs?.pageColor ?? ''))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const revision = useRef(reviewer.revision)
  const changeVersion = useRef(0)
  const markDirty = useCallback(() => { changeVersion.current += 1; setStatus(current => current === 'saving' ? current : 'dirty') }, [])
  const save = useCallback(async () => {
    if (status === 'saved') return true
    if (!supabase || !editor || !title.trim() || status === 'saving') return false
    const savingVersion = changeVersion.current
    setStatus('saving')
    const { data, error } = await supabase.rpc('cali_update_own_reviewer', { p_id: reviewer.id, p_expected_revision: revision.current, p_title: title.trim(), p_subject_id: subjectId || null, p_content: editor.getJSON(), p_plain_text: editor.getText() }).single()
    if (error || !data) { setStatus('error'); return false }
    const changed = data as Reviewer
    revision.current = changed.revision
    const fullySaved = changeVersion.current === savingVersion
    setStatus(fullySaved ? 'saved' : 'dirty'); onSaved(changed); return fullySaved
  }, [editor, onSaved, reviewer.id, status, subjectId, title])
  useEffect(() => { if (status !== 'dirty') return; const timer = window.setTimeout(() => { void save() }, 1200); return () => window.clearTimeout(timer) }, [save, status])
  useEffect(() => { if (!editor) return; editor.on('update', markDirty); return () => { editor.off('update', markDirty) } }, [editor, markDirty])
  const finish = async () => { if (await save()) onClose() }
  const subjectOptions: CaliSelectOption[] = [{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` }))]
  return <section className={`reviewer-edit-shell${pageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': pageColor || 'var(--color-cali-surface)' } as CSSProperties}>
    <header>
      <div className="reviewer-edit-heading">
        <p className="workspace-overline">EDIT REVIEWER</p>
        <input value={title} maxLength={160} aria-label="Reviewer title" onChange={event => { setTitle(event.target.value); markDirty() }} />
        <span className={`reviewer-save-state reviewer-save-state--${status}`} role="status" aria-live="polite">{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Autosave pending' : status === 'error' ? 'Couldn’t save' : 'Saved'}</span>
      </div>
      <div className="reviewer-edit-actions"><button type="button" className="button-primary" disabled={status === 'saving' || !title.trim()} onClick={() => { void finish() }}>Done</button></div>
    </header>
    <div className="reviewer-edit-subject"><span className="reviewer-field-label">Subject</span><CaliSelect ariaLabel="Reviewer subject" className="cali-select--subject" value={subjectId} options={subjectOptions} onChange={nextValue => { setSubjectId(nextValue); markDirty() }} /></div>
    <Toolbar editor={editor} onPageColorChange={color => { setPageColor(color); onPageColorChange(color) }} />
    <DocumentView content={reviewer.content} editable onEditor={setEditor} pageColorOverride={pageColor} />
  </section>
}

function ReviewerDeleteDialog({ reviewer, busy, error, onCancel, onConfirm }: { reviewer: Reviewer; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="study-confirm-dialog" aria-labelledby="reviewer-delete-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div><div className="study-confirm-icon" aria-hidden="true">!</div><p className="workspace-overline">DELETE REVIEWER</p><h2 id="reviewer-delete-title">Delete “{reviewer.title}”?</h2><p>This permanently removes the reviewer and all of its content. This cannot be undone.</p>{error && <p className="study-form-error" role="alert">{error}</p>}<footer><button type="button" className="study-secondary" autoFocus onClick={onCancel} disabled={busy}>Keep reviewer</button><button type="button" className="study-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete reviewer'}</button></footer></div></dialog>
}

export function StudyPage({ studentId }: { studentId: string }) {
  const [params, setParams] = useSearchParams()
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [subjects, setSubjects] = useState<ReviewerSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Reviewer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pageColorOverride, setPageColorOverride] = useState<{ reviewerId: string; color: string } | null>(null)
  const createRef = useRef<HTMLDialogElement>(null)
  const selected = reviewers.find(reviewer => reviewer.id === params.get('reviewer')) ?? null
  const editing = params.get('edit') === '1'
  const selectedStoredPageColor = String(selected?.content.attrs?.pageColor ?? '')
  const selectedPageColor = selected && pageColorOverride?.reviewerId === selected.id ? pageColorOverride.color : selectedStoredPageColor
  const selectedUsesLightForeground = usesLightForeground(selectedPageColor)
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [reviewerResult, subjectResult] = await Promise.all([supabase.from('reviewers').select('*').eq('user_id', studentId).order('updated_at', { ascending: false }), supabase.from('schedule_subjects').select('id,subject_code,title,color_key').eq('user_id', studentId).order('subject_code')])
    if (reviewerResult.error || subjectResult.error) setNotice({ kind: 'error', text: 'Cali could not load your study space. Please try again.' })
    else { setReviewers((reviewerResult.data ?? []) as Reviewer[]); setSubjects((subjectResult.data ?? []) as ReviewerSubject[]) }
    setLoading(false)
  }, [studentId])
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (params.get('new') === 'manual') createRef.current?.showModal(); else createRef.current?.close() }, [params])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(timer) }, [notice])
  const visible = useMemo(() => reviewers.filter(reviewer => reviewerMatches(reviewer, query, subjectFilter)), [query, reviewers, subjectFilter])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const subjectOptions = useMemo<CaliSelectOption[]>(() => [{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` }))], [subjects])
  const subjectFilterOptions = useMemo<CaliSelectOption[]>(() => [{ value: '', label: 'All subjects' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title }))], [subjects])
  const navigate = (changes: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) } setParams(next) }
  const createReviewer = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !newTitle.trim()) return; setCreating(true)
    const { data, error } = await supabase.rpc('cali_create_own_reviewer', { p_title: newTitle.trim(), p_subject_id: newSubject || null, p_content: EMPTY_REVIEWER_DOCUMENT, p_plain_text: '' }).single(); setCreating(false)
    if (error || !data) { setNotice({ kind: 'error', text: error?.message ?? 'Could not create the reviewer.' }); return }
    const created = data as Reviewer; setReviewers(current => [created, ...current]); setNewTitle(''); setNewSubject(''); navigate({ new: null, reviewer: created.id, edit: '1' })
  }
  const updateReviewer = (changed: Reviewer) => setReviewers(current => [changed, ...current.filter(item => item.id !== changed.id)])
  const duplicate = async (reviewer: Reviewer) => { if (!supabase) return; const { data, error } = await supabase.rpc('cali_duplicate_own_reviewer', { p_id: reviewer.id }).single(); if (error || !data) setNotice({ kind: 'error', text: 'Could not duplicate this reviewer.' }); else { const copy = data as Reviewer; setReviewers(current => [copy, ...current]); navigate({ reviewer: copy.id, edit: null }); setNotice({ kind: 'success', text: 'Reviewer duplicated.' }) } }
  const remove = async () => {
    if (!supabase || !deleteTarget) return
    setDeleting(true); setDeleteError('')
    const { error } = await supabase.from('reviewers').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) { setDeleteError('Cali could not delete this reviewer. Please try again.'); return }
    setReviewers(current => current.filter(item => item.id !== deleteTarget.id)); setDeleteTarget(null); navigate({ reviewer: null, edit: null }); setNotice({ kind: 'success', text: 'Reviewer deleted.' })
  }
  const noticeBanner = notice && <div className={`study-notice study-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><CloseIcon /></button></div>

  if (selected) {
    const selectedSubject = selected.subject_id ? subjectMap.get(selected.subject_id) : null
    const contrastClass = selectedUsesLightForeground ? ' uses-light-foreground' : ' uses-dark-foreground'
    return <section className={`study-page study-page--reviewer${selectedPageColor ? ` has-page-color${contrastClass}` : ''}`} style={{ '--reviewer-page-color': selectedPageColor || 'var(--color-cali-surface)' } as CSSProperties}>
      <nav className="reviewer-page-nav" aria-label="Reviewer navigation">
        <button type="button" className="reviewer-back" onClick={() => navigate({ reviewer: null, edit: null })}><BackIcon /> Back to library</button>
        {!editing && <div className="reviewer-reader-actions">
          <button type="button" className="reviewer-icon-action" aria-label="Share reviewer — coming with Cali Community" title="Sharing will be available with Cali Community" disabled><ShareIcon /></button>
          <button type="button" className="reviewer-icon-action" aria-label="Edit reviewer" title="Edit reviewer" onClick={() => navigate({ edit: '1' })}><EditIcon /></button>
          <details><summary aria-label="More reviewer actions" title="More actions"><MoreIcon /></summary><div><button type="button" onClick={() => { void duplicate(selected) }}>Duplicate</button><button type="button" className="is-danger" onClick={event => { const menu = event.currentTarget.closest('details') as HTMLDetailsElement | null; if (menu) menu.open = false; setDeleteError(''); setDeleteTarget(selected) }}>Delete permanently</button></div></details>
        </div>}
      </nav>
      {noticeBanner}
      {editing ? <ReviewerEditor key={selected.id} reviewer={selected} subjects={subjects} onSaved={updateReviewer} onClose={() => navigate({ edit: null })} onPageColorChange={color => setPageColorOverride({ reviewerId: selected.id, color })} /> : <article className={`reviewer-reading${selectedPageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': selectedPageColor || 'var(--color-cali-surface)' } as CSSProperties}>
        <header>
          <div><p className="workspace-overline">{selectedSubject?.subject_code ?? 'GENERAL REVIEWER'}</p><h1>{selected.title}</h1><p>Updated {formatReviewerDate(selected.updated_at)}</p></div>
        </header>
        <DocumentView content={selected.content} />
      </article>}
      {deleteTarget && <ReviewerDeleteDialog reviewer={deleteTarget} busy={deleting} error={deleteError} onCancel={() => { if (!deleting) setDeleteTarget(null) }} onConfirm={() => { void remove() }} />}
    </section>
  }

  return <section className="study-page">
    <header className="study-heading"><div><p className="workspace-overline">STUDY SPACE</p><h1>Study <em>smarter.</em></h1><p>Write focused reviewers and keep them organized with your subjects.</p></div><div className="study-heading-actions"><button type="button" className="button-primary" onClick={() => navigate({ new: 'manual', reviewer: null, edit: null })}><span aria-hidden="true">+</span> New reviewer</button></div></header>
    <div className="study-tabs" role="tablist" aria-label="Study tools"><button type="button" className="is-active" role="tab" aria-selected="true">Reviewers</button><button type="button" role="tab" aria-selected="false" disabled>Flashcards <span>Coming soon</span></button><button type="button" role="tab" aria-selected="false" disabled>Quizzes <span>Coming soon</span></button></div>
    {noticeBanner}
    <section className="reviewer-library" aria-label="Reviewer library">
      <div className="reviewer-library-head"><div><p className="workspace-overline">YOUR LIBRARY</p><h2>Your reviewers</h2></div></div>
      <div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers" aria-label="Search reviewers" /></label><CaliSelect ariaLabel="Filter by subject" className="cali-select--filter" value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} /></div>
      <div className="reviewer-list">{loading ? <div className="reviewer-list-skeleton"><span /><span /><span /></div> : visible.length ? visible.map(reviewer => {
        const subject = reviewer.subject_id ? subjectMap.get(reviewer.subject_id) : null
        const pageColor = String(reviewer.content.attrs?.pageColor ?? '')
        const previewContrastClass = usesLightForeground(pageColor) ? ' uses-light-foreground' : ' uses-dark-foreground'
        return <button
          type="button"
          key={reviewer.id}
          className={`reviewer-preview-card${pageColor ? ` has-page-color${previewContrastClass}` : ''}`}
          style={pageColor ? { '--reviewer-preview-page-color': pageColor } as CSSProperties : undefined}
          aria-label={`Open ${reviewer.title}`}
          onClick={() => navigate({ reviewer: reviewer.id, edit: null, new: null })}
        ><span className="reviewer-preview-meta"><span>{subject?.subject_code ?? 'General'}</span><time dateTime={reviewer.updated_at}>{formatReviewerDate(reviewer.updated_at)}</time></span><strong className="reviewer-preview-title">{reviewer.title}</strong><p>{reviewer.plain_text || 'This reviewer is ready for your notes.'}</p></button>
      }) : <div className="reviewer-empty-list"><strong>{reviewers.length ? 'No matches' : 'Your first reviewer starts here'}</strong><p>{reviewers.length ? 'Try another search or subject.' : 'Create a blank reviewer and shape it around the way you study.'}</p>{!reviewers.length && <button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>Create reviewer</button>}</div>}</div>
    </section>
    <dialog ref={createRef} className="study-dialog study-create-dialog" onCancel={event => { event.preventDefault(); navigate({ new: null }) }}><form onSubmit={createReviewer} className="study-dialog-shell"><header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Start with a blank page</h2><p>Give it a clear title. You can change the subject anytime.</p></div><button type="button" className="study-dialog-close" onClick={() => navigate({ new: null })}><CloseIcon /></button></header><div className="study-form-grid"><label className="study-field study-field--wide"><span>Title <small>{newTitle.length}/160</small></span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Example: Midterm reviewer" /></label><div className="study-field study-field--wide"><span>Subject</span><CaliSelect ariaLabel="New reviewer subject" className="cali-select--form" value={newSubject} options={subjectOptions} onChange={setNewSubject} /></div></div><footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create reviewer'}</button></footer></form></dialog>
  </section>
}
