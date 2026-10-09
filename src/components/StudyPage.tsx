import { ReviewerStyleOptions } from './ReviewerStyleOptions'
import { DEFAULT_REVIEWER_PREFERENCES, type ReviewerPreferences } from '../lib/reviewerPreferences'
import { readReviewerRecovery, writeReviewerRecovery, clearReviewerRecovery, reviewerSubmissionKey } from '../lib/reviewerRecovery'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useEditorState, EditorContent, Extension, Node as TiptapNode } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { EMPTY_REVIEWER_DOCUMENT, formatReviewerDate, reviewerMatches, type Reviewer, type ReviewerSubject } from '../lib/reviewers'
import { setReviewerVisibility, type ReviewerVisibility } from '../lib/community'
import { extractPdfText, MAX_REVIEWER_SOURCE_CHARACTERS, PdfExtractionError } from '../lib/reviewerPdf'
import { MAX_NOTE_PAGES, scanNotePages } from '../lib/noteScanner'
import { StudySetsPage } from './StudySetsPage'
import { CaliSelect, type CaliSelectOption } from './CaliSelect'
import { BackArrowIcon } from './BackArrowIcon'
import { ConfirmationIcon } from './ConfirmationIcon'
import { StudyLibraryCardsSkeleton, StudyLibraryCountSkeleton, StudyLibraryFiltersSkeleton } from './StudyLibrarySkeleton'
import './study.css'
import './skeleton.css'

type Notice = { kind: 'error' | 'success'; text: string } | null
type ReviewerSaveState = 'saved' | 'dirty' | 'saving' | 'error'
type ReviewerPreviewBlock =
  | { kind: 'heading' | 'text' | 'list'; text: string; checked?: boolean }
  | { kind: 'table'; rows: string[][] }

function reviewerNodeText(node: JSONContent): string {
  if (node.text) return node.text
  return (node.content ?? []).map(reviewerNodeText).join(' ').replace(/\s+/g, ' ').trim()
}

function reviewerPreviewBlocks(content: JSONContent): ReviewerPreviewBlock[] {
  const blocks: ReviewerPreviewBlock[] = []
  const add = (block: Exclude<ReviewerPreviewBlock, { kind: 'table' }>) => {
    const text = block.text.replace(/\s+/g, ' ').trim()
    if (text && blocks.length < 5) blocks.push({ ...block, text })
  }
  const visit = (node: JSONContent) => {
    if (blocks.length >= 5) return
    if (node.type === 'heading') { add({ kind: 'heading', text: reviewerNodeText(node) }); return }
    if (node.type === 'paragraph') { add({ kind: 'text', text: reviewerNodeText(node) }); return }
    if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content ?? []) add({ kind: 'list', text: reviewerNodeText(item), checked: item.attrs?.checked === true })
      return
    }
    if (node.type === 'table') {
      const rows = (node.content ?? []).slice(0, 3).map(row => (row.content ?? []).slice(0, 3).map(cell => reviewerNodeText(cell)))
      if (rows.length && rows[0]?.length && blocks.length < 5) blocks.push({ kind: 'table', rows })
      return
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(content)
  return blocks
}

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
      if (this.editor.isActive('table')) return false
      if (this.editor.isActive('taskItem')) {
        if (amount > 0) this.editor.commands.sinkListItem('taskItem')
        else this.editor.commands.liftListItem('taskItem')
        return true
      }
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

const Columns = TiptapNode.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-reviewer-columns]' }] },
  renderHTML() { return ['div', { 'data-reviewer-columns': 'true' }, 0] },
})

const Column = TiptapNode.create({
  name: 'column',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-reviewer-column]' }] },
  renderHTML() { return ['div', { 'data-reviewer-column': 'true' }, 0] },
})

const TableRowResize = Extension.create({
  name: 'tableRowResize',
  addGlobalAttributes() {
    return [{
      types: ['tableRow'],
      attributes: {
        rowHeight: {
          default: null,
          parseHTML: element => {
            const height = Number.parseFloat(element.style.height)
            return Number.isFinite(height) ? height : null
          },
          renderHTML: attributes => attributes.rowHeight ? { style: `height: ${attributes.rowHeight}px`, 'data-row-height': String(attributes.rowHeight) } : {},
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    const boundarySize = 6
    const findRow = (view: EditorView, event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return null
      const cell = target.closest('td, th')
      const row = cell?.parentElement
      if (!cell || !row || Math.abs(event.clientY - row.getBoundingClientRect().bottom) > boundarySize) return null
      const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY - 2 })
      if (!coordinates) return null
      const resolved = view.state.doc.resolve(coordinates.pos)
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        if (resolved.node(depth).type.name === 'tableRow') return { position: resolved.before(depth), element: row }
      }
      return null
    }
    return [new Plugin({
      key: new PluginKey('reviewerTableRowResize'),
      props: {
        handleDOMEvents: {
          mousemove(view, event) {
            view.dom.classList.toggle('is-table-row-resize-ready', Boolean(findRow(view, event)))
            return false
          },
          mouseleave(view) {
            view.dom.classList.remove('is-table-row-resize-ready')
            return false
          },
          mousedown(view, event) {
            const row = findRow(view, event)
            if (!row || event.button !== 0) return false
            event.preventDefault()
            const startY = event.clientY
            const startHeight = row.element.getBoundingClientRect().height
            view.dom.classList.add('is-resizing-table-row')
            const move = (moveEvent: MouseEvent) => {
              const nextHeight = Math.max(36, Math.round(startHeight + moveEvent.clientY - startY))
              const rowNode = view.state.doc.nodeAt(row.position)
              if (!rowNode || rowNode.type.name !== 'tableRow') return
              view.dispatch(view.state.tr.setNodeMarkup(row.position, undefined, { ...rowNode.attrs, rowHeight: nextHeight }))
            }
            const finish = () => {
              view.dom.classList.remove('is-resizing-table-row', 'is-table-row-resize-ready')
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', finish)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', finish, { once: true })
            return true
          },
        },
      },
    })]
  },
})

const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, italic: { HTMLAttributes: { class: 'reviewer-italic' } } }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  BlockLayout,
  FontSize,
  PageStyle,
  Columns,
  Column,
  TableKit.configure({ table: { resizable: true } }),
  TableRowResize,
  TaskList,
  TaskItem.configure({ nested: true }),
]

function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg> }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg> }
function ShareIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg> }
function MoreIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg> }
function FocusIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></svg> }
function AlignIcon({ direction }: { direction: 'left' | 'center' | 'right' | 'justify' }) { const paths = direction === 'left' ? ['M4 6h16', 'M4 10h11', 'M4 14h16', 'M4 18h9'] : direction === 'center' ? ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M8 18h8'] : direction === 'right' ? ['M4 6h16', 'M9 10h11', 'M4 14h16', 'M11 18h9'] : ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16']; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{paths.map(path => <path key={path} d={path} />)}</svg> }
function IndentIcon({ outdent = false }: { outdent?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6h10M10 10h10M10 14h10M10 18h10" /><path d={outdent ? 'm7 9-3 3 3 3' : 'm4 9 3 3-3 3'} /></svg> }
function ListIcon({ ordered = false }: { ordered?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{ordered ? <><path d="M4 6h1v3M3.5 9H6M3.5 14c.3-.8 2.5-.9 2.5.3 0 .8-2.5 2.7-2.5 2.7H6" /></> : <><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" /></>}<path d="M9 7h11M9 12h11M9 17h11" /></svg> }
function UndoIcon({ redo = false }: { redo?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={redo ? 'm16 7 4 4-4 4' : 'm8 7-4 4 4 4'} /><path d={redo ? 'M20 11h-9a6 6 0 0 0-6 6' : 'M4 11h9a6 6 0 0 1 6 6'} /></svg> }
function TextColorIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m6 17 6-13 6 13M8 13h8" /><path d="M5 21h14" /></svg> }
function MarkerIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 4 6 6-9 9H5v-6Z" /><path d="m11 7 6 6M4 21h16" /></svg> }
function ItalicIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 5h8M6 19h8M14 5 10 19" /></svg> }
function PageColorIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 2.75h9.25l4.75 4.75v5.25M4.5 2.75v18.5h9" /><path d="M13.75 2.75V7.5h4.75" /><path d="M17.25 11.75c-1.85 2.45-3.25 4.25-3.25 5.85a3.25 3.25 0 0 0 6.5 0c0-1.6-1.4-3.4-3.25-5.85Z" fill="currentColor" stroke="none" /></svg> }
function LineSpacingIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M4 5v14M2 7l2-2 2 2M2 17l2 2 2-2" /></svg> }
function ChecklistIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="5" rx="1" /><path d="m4.5 6.5 1 1 2-2M11 6.5h10" /><rect x="3" y="15" width="5" height="5" rx="1" /><path d="M11 17.5h10" /></svg> }
function ColumnsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg> }
function TableIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M15 9v11" /></svg> }
function ClearFormattingIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 17 7-7 6 6-4 4H7Z" /><path d="m14 7 3-3 4 4-3 3M3 21h18" /></svg> }
function ProofingIcon({ disabled = false }: { disabled?: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-4 2 8 2-6 2 4h5" /><path d="M4 17c2-2 4 2 6 0s4 2 6 0 3 1 4 0" />{disabled && <path d="M4 4l16 16" />}</svg> }

function DocumentView({ content, editable = false, onEditor, pageColorOverride }: { content: JSONContent; editable?: boolean; onEditor?: (editor: Editor) => void; pageColorOverride?: string }) {
  const editor = useEditor({ extensions: editorExtensions, content, editable, immediatelyRender: false })
  useEffect(() => { if (editor) onEditor?.(editor) }, [editor, onEditor])
  useEffect(() => { if (editor && !editable && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content) }, [content, editable, editor])
  const pageColor = pageColorOverride ?? String(editor?.state.doc.attrs.pageColor ?? content.attrs?.pageColor ?? '')
  return <EditorContent editor={editor} className={`${editable ? 'reviewer-editor-content' : 'reviewer-document'}${pageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': pageColor || 'var(--color-cali-surface)' } as CSSProperties} />
}

function FontSizeInput({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const [inputValue, setInputValue] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setInputValue(String(value)) }, [value])
  const apply = (rawValue: string) => {
    const nextSize = Number(rawValue)
    if (Number.isFinite(nextSize) && nextSize >= 8 && nextSize <= 72) onChange(nextSize)
  }
  return <input
    type="number"
    min="8"
    max="72"
    inputMode="numeric"
    value={inputValue}
    aria-label="Font size in pixels"
    title="Font size"
    onFocus={event => { focused.current = true; event.currentTarget.select() }}
    onChange={event => { setInputValue(event.currentTarget.value); apply(event.currentTarget.value) }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
    onBlur={() => {
      focused.current = false
      const nextSize = Number(inputValue)
      if (Number.isFinite(nextSize) && nextSize >= 8 && nextSize <= 72) onChange(nextSize)
      else setInputValue(String(value))
    }}
  />
}

function Toolbar({ editor, onPageColorChange }: { editor: Editor | null; onPageColorChange?: (pageColor: string) => void }) {
  const [toolbarOpen, setToolbarOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches)
  const selectedFontSize = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => Number(activeEditor?.getAttributes('textStyle').fontSize ?? 16),
  })
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
  const fontSize = Number(selectedFontSize ?? 16)
  const setFontSize = (size: number) => {
    if (!Number.isFinite(size)) return
    const nextSize = Math.max(8, Math.min(72, Math.round(size)))
    editor.chain().focus().setMark('textStyle', { fontSize: String(nextSize) }).run()
  }
  const setBlockAttribute = (attributes: Record<string, unknown>) => { editor.chain().focus().updateAttributes(blockName, attributes).run() }
  const adjustIndent = (amount: number) => {
    if (editor.isActive('taskItem')) {
      if (amount > 0) editor.chain().focus().sinkListItem('taskItem').run()
      else editor.chain().focus().liftListItem('taskItem').run()
      return
    }
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      if (amount > 0) editor.chain().focus().sinkListItem('listItem').run()
      else editor.chain().focus().liftListItem('listItem').run()
      return
    }
    setBlockAttribute({ indent: Math.max(0, Math.min(4, indent + amount)) })
  }
  const insertColumns = (count: 2 | 3) => {
    editor.chain().focus().insertContent({
      type: 'columns',
      content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })),
    }).run()
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
      <FontSizeInput value={fontSize} onChange={setFontSize} />
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-format">
      {button('Bold', editor.isActive('bold'), () => { editor.chain().focus().toggleBold().run() }, <strong>B</strong>)}
      {button('Italic', editor.isActive('italic'), () => { editor.chain().focus().toggleItalic().run() }, <ItalicIcon />)}
      {button('Underline', editor.isActive('underline'), () => { editor.chain().focus().toggleUnderline().run() }, <u>U</u>)}
      <details className={`reviewer-swatch-palette${activeFontColor ? ' is-active' : ''}`}><summary aria-label="Font color" title="Font color"><TextColorIcon /></summary><div className="reviewer-swatch-grid" role="group" aria-label="Font colors">{fontSwatches.map(([name, value]) => <button key={value} type="button" className={`reviewer-swatch${activeFontColor === value ? ' is-selected' : ''}`} aria-label={`${name} text`} title={name} style={{ '--swatch-color': value } as CSSProperties} onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().setColor(value).run(); closePalette(event.currentTarget) }}><span /></button>)}<button type="button" className="reviewer-swatch-none" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().unsetColor().run(); closePalette(event.currentTarget) }}>Default</button></div></details>
      <details className={`reviewer-swatch-palette${editor.isActive('highlight') ? ' is-active' : ''}`}><summary aria-label="Marker color" title="Marker color"><MarkerIcon /></summary><div className="reviewer-swatch-grid" role="group" aria-label="Marker colors">{markerSwatches.map(([name, value]) => <button key={value} type="button" className={`reviewer-swatch${activeMarkerColor === value ? ' is-selected' : ''}`} aria-label={`${name} marker`} title={name} style={{ '--swatch-color': value } as CSSProperties} onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().setHighlight({ color: value }).run(); closePalette(event.currentTarget) }}><span /></button>)}<button type="button" className="reviewer-swatch-none" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().unsetHighlight().run(); closePalette(event.currentTarget) }}>None</button></div></details>
      {button('Clear formatting', false, () => { editor.chain().focus().unsetAllMarks().clearNodes().run() }, <ClearFormattingIcon />)}
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
      {button('Checklist', editor.isActive('taskList'), () => { editor.chain().focus().toggleTaskList().run() }, <ChecklistIcon />)}
    </div>
    <div className="reviewer-toolbar-group reviewer-toolbar-structure">
      <details className="reviewer-structure-menu reviewer-columns-menu"><summary aria-label="Insert columns" title="Insert columns"><ColumnsIcon /></summary><div className="reviewer-structure-options"><p>Columns</p><button type="button" onMouseDown={event => event.preventDefault()} onClick={event => { insertColumns(2); closePalette(event.currentTarget) }}><ColumnsIcon /><span><strong>Two columns</strong><small>Compare ideas side by side</small></span></button><button type="button" onMouseDown={event => event.preventDefault()} onClick={event => { insertColumns(3); closePalette(event.currentTarget) }}><ColumnsIcon /><span><strong>Three columns</strong><small>Organize compact study notes</small></span></button></div></details>
      <details className={`reviewer-structure-menu${editor.isActive('table') ? ' is-active' : ''}`}><summary aria-label="Insert table" title="Insert table"><TableIcon /></summary><div className="reviewer-structure-options reviewer-table-options"><p>Insert table</p><div className="reviewer-table-presets"><button type="button" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(); closePalette(event.currentTarget) }}>2 × 2</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={event => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); closePalette(event.currentTarget) }}>3 × 3</button></div></div></details>
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

function EditorContextMenu({ editor, spellcheckEnabled, onSpellcheckChange }: { editor: Editor | null; spellcheckEnabled: boolean; onSpellcheckChange: (enabled: boolean) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'table' | 'writing' } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return
    const editorElement = editor.view.dom
    const openMenu = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) { setMenu(null); return }
      event.preventDefault()
      const inTable = Boolean(target.closest('td, th'))
      if (inTable) {
        const resolved = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (resolved) editor.chain().focus().setTextSelection(resolved.pos).run()
      }
      const menuWidth = Math.min(240, window.innerWidth - 24)
      const x = Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth - 12))
      const menuHeight = Math.min(inTable ? 390 : 120, window.innerHeight - 24)
      const y = Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight - 12))
      setMenu({ x, y, kind: inTable ? 'table' : 'writing' })
    }
    editorElement.addEventListener('contextmenu', openMenu)
    return () => editorElement.removeEventListener('contextmenu', openMenu)
  }, [editor])

  useEffect(() => {
    if (!menu) return
    const closeOnPointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const close = () => setMenu(null)
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  if (!editor || !menu) return null
  const run = (action: () => void) => { action(); setMenu(null) }
  return createPortal(<div
    ref={menuRef}
    className="reviewer-table-context"
    role="menu"
    aria-label={menu.kind === 'table' ? 'Selected table cell actions' : 'Writing tools'}
    style={{ left: menu.x, top: menu.y }}
    onContextMenu={event => event.preventDefault()}
  >
    {menu.kind === 'writing' ? <>
      <span className="reviewer-table-context-label">Writing tools</span>
      <button type="button" role="menuitem" className="reviewer-proofing-menu-action" onMouseDown={event => event.preventDefault()} onClick={() => run(() => onSpellcheckChange(!spellcheckEnabled))}><ProofingIcon disabled={spellcheckEnabled} /><span><strong>{spellcheckEnabled ? 'Ignore all' : 'Show spelling marks'}</strong><small>{spellcheckEnabled ? 'Hide spelling and grammar squiggles' : 'Turn browser proofing marks back on'}</small></span></button>
    </> : <>
    <span className="reviewer-table-context-label">Selected cell</span>
    <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().addRowBefore().run() })}>Insert row above</button>
    <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().addRowAfter().run() })}>Insert row below</button>
    <button type="button" role="menuitem" className="is-danger-soft" disabled={!editor.can().deleteRow()} onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().deleteRow().run() })}>Delete row</button>
    <span className="reviewer-table-context-divider" aria-hidden="true" />
    <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().addColumnBefore().run() })}>Insert column left</button>
    <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().addColumnAfter().run() })}>Insert column right</button>
    <button type="button" role="menuitem" className="is-danger-soft" disabled={!editor.can().deleteColumn()} onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().deleteColumn().run() })}>Delete column</button>
    <span className="reviewer-table-context-divider" aria-hidden="true" />
    <button type="button" role="menuitem" className="is-danger" onMouseDown={event => event.preventDefault()} onClick={() => run(() => { editor.chain().focus().deleteTable().run() })}>Delete table</button>
    </>}
  </div>, document.body)
}

function ReviewerEditor({ reviewer, subjects, onSaved, onClose, onPageColorChange, onSaveStateChange, onSaveReady }: { reviewer: Reviewer; subjects: ReviewerSubject[]; onSaved: (reviewer: Reviewer) => void; onClose: () => void; onPageColorChange: (pageColor: string) => void; onSaveStateChange: (status: ReviewerSaveState) => void; onSaveReady: (save: (() => Promise<boolean>) | null) => void }) {
  const [title, setTitle] = useState(reviewer.title)
  const [subjectId, setSubjectId] = useState(reviewer.subject_id ?? '')
  const [pageColor, setPageColor] = useState(String(reviewer.content.attrs?.pageColor ?? ''))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [status, setStatus] = useState<ReviewerSaveState>('saved')
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return window.localStorage.getItem('cali-reviewer-spellcheck') !== 'off' } catch { return true }
  })
  const revision = useRef(reviewer.revision)
  const changeVersion = useRef(0)
  const saveInFlight = useRef<Promise<boolean> | null>(null)
  const markDirty = useCallback(() => { changeVersion.current += 1; setStatus(current => current === 'saving' ? current : 'dirty') }, [])
  const save = useCallback(async () => {
    if (saveInFlight.current) return saveInFlight.current
    if (status === 'saved') return true
    if (!supabase || !editor || !title.trim() || status === 'saving') return false
    const request = (async () => {
      const savingVersion = changeVersion.current
      setStatus('saving')
      try {
        const { data, error } = await supabase.rpc('cali_update_own_reviewer', { p_id: reviewer.id, p_expected_revision: revision.current, p_title: title.trim(), p_subject_id: subjectId || null, p_content: editor.getJSON(), p_plain_text: editor.getText() }).single()
        if (error || !data) { setStatus('error'); return false }
        const changed = data as Reviewer
        revision.current = changed.revision
        const fullySaved = changeVersion.current === savingVersion
        setStatus(fullySaved ? 'saved' : 'dirty'); onSaved(changed); return fullySaved
      } catch {
        setStatus('error')
        return false
      }
    })()
    saveInFlight.current = request
    try {
      return await request
    } finally {
      if (saveInFlight.current === request) saveInFlight.current = null
    }
  }, [editor, onSaved, reviewer.id, status, subjectId, title])
  useEffect(() => { onSaveStateChange(status) }, [onSaveStateChange, status])
  useEffect(() => { onSaveReady(save); return () => onSaveReady(null) }, [onSaveReady, save])
  useEffect(() => { if (!editor) return; editor.on('update', markDirty); return () => { editor.off('update', markDirty) } }, [editor, markDirty])
  useEffect(() => {
    if (!editor) return
    const editorElement = editor.view.dom
    editorElement.setAttribute('spellcheck', spellcheckEnabled ? 'true' : 'false')
    for (const attribute of ['data-gramm', 'data-gramm_editor', 'data-enable-grammarly']) {
      if (spellcheckEnabled) editorElement.removeAttribute(attribute)
      else editorElement.setAttribute(attribute, 'false')
    }
  }, [editor, spellcheckEnabled])
  const changeSpellcheck = (enabled: boolean) => {
    setSpellcheckEnabled(enabled)
    try { window.localStorage.setItem('cali-reviewer-spellcheck', enabled ? 'on' : 'off') } catch { /* The editor still updates when storage is unavailable. */ }
  }
  const finish = async () => { if (await save()) onClose() }
  const subjectOptions: CaliSelectOption[] = [{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` }))]
  return <section className={`reviewer-edit-shell${pageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': pageColor || 'var(--color-cali-surface)' } as CSSProperties}>
    <header>
      <div className="reviewer-edit-heading">
        <p className="workspace-overline">EDIT REVIEWER</p>
        <input value={title} maxLength={160} aria-label="Reviewer title" onChange={event => { setTitle(event.target.value); markDirty() }} />
        <div className="reviewer-save-feedback"><span className={`reviewer-save-state reviewer-save-state--${status}`} role="status" aria-live="polite">{status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : status === 'error' ? 'Couldn’t save' : 'Saved'}</span>{status === 'error' && <button type="button" className="reviewer-save-now" disabled={!title.trim()} onClick={() => { void save() }}>Save now</button>}</div>
      </div>
      <div className="reviewer-edit-actions"><button type="button" className="button-primary" disabled={status === 'saving' || !title.trim()} onClick={() => { void finish() }}>Done</button></div>
    </header>
    <div className="reviewer-edit-subject"><span className="reviewer-field-label">Subject</span><CaliSelect ariaLabel="Reviewer subject" className="cali-select--subject" value={subjectId} options={subjectOptions} onChange={nextValue => { setSubjectId(nextValue); markDirty() }} /></div>
    <Toolbar editor={editor} onPageColorChange={color => { setPageColor(color); onPageColorChange(color) }} />
    <EditorContextMenu editor={editor} spellcheckEnabled={spellcheckEnabled} onSpellcheckChange={changeSpellcheck} />
    <DocumentView content={reviewer.content} editable onEditor={setEditor} pageColorOverride={pageColor} />
  </section>
}

function ReviewerUnsavedDialog({ status, busy, error, onKeepEditing, onSaveAndLeave, onLeave }: { status: ReviewerSaveState; busy: boolean; error: string; onKeepEditing: () => void; onSaveAndLeave: () => void; onLeave: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  const detail = status === 'error'
    ? 'Cali could not save your latest changes. Try saving again, keep editing, or leave without saving.'
    : status === 'saving'
      ? 'Cali is still saving your latest changes. Wait for it to finish before leaving safely.'
      : 'Your latest changes have not been saved yet. Save them before returning to your library.'
  return <dialog ref={dialogRef} className="study-confirm-dialog study-unsaved-dialog" aria-labelledby="reviewer-unsaved-title" onCancel={event => { event.preventDefault(); if (!busy) onKeepEditing() }}><div><ConfirmationIcon kind={busy || status === 'saving' ? 'loading' : 'warning'} /><p className="workspace-overline">UNSAVED CHANGES</p><h2 id="reviewer-unsaved-title">You have unsaved changes</h2><p>{detail}</p>{error && <p className="study-form-error" role="alert">{error}</p>}<footer className="study-unsaved-actions"><button type="button" className="button-primary" onClick={onSaveAndLeave} disabled={busy || status === 'saving'}>{busy || status === 'saving' ? 'Saving…' : 'Save and leave'}</button><button type="button" className="study-secondary" autoFocus onClick={onKeepEditing} disabled={busy}>Keep editing</button><button type="button" className="study-leave-button" onClick={onLeave} disabled={busy}>Leave without saving</button></footer></div></dialog>
}

function ReviewerDeleteDialog({ reviewer, busy, error, onCancel, onConfirm }: { reviewer: Reviewer; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={dialogRef} className="study-confirm-dialog" aria-labelledby="reviewer-delete-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><div><ConfirmationIcon kind={busy ? 'loading' : 'error'} /><p className="workspace-overline">DELETE REVIEWER</p><h2 id="reviewer-delete-title">Delete “{reviewer.title}”?</h2><p>This permanently removes the reviewer and all of its content. This cannot be undone.</p>{error && <p className="study-form-error" role="alert">{error}</p>}<footer><button type="button" className="study-secondary" autoFocus onClick={onCancel} disabled={busy}>Keep reviewer</button><button type="button" className="study-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete reviewer'}</button></footer></div></dialog>
}

const communityCategoryOptions: CaliSelectOption[] = [
  { value: 'General', label: 'General' },
  { value: 'General Science', label: 'General Science' },
  { value: 'Mathematics', label: 'Mathematics' },
  { value: 'Programming', label: 'Programming' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Health Sciences', label: 'Health Sciences' },
  { value: 'Business', label: 'Business' },
  { value: 'Social Sciences', label: 'Social Sciences' },
  { value: 'Humanities', label: 'Humanities' },
  { value: 'Languages', label: 'Languages' },
]

function ReviewerShareDialog({ reviewer, subjects, onCancel, onSaved }: { reviewer: Reviewer; subjects: ReviewerSubject[]; onCancel: () => void; onSaved: (reviewer: Reviewer) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [visibility, setVisibility] = useState<ReviewerVisibility>(reviewer.visibility ?? 'private')
  const [description, setDescription] = useState(reviewer.description ?? '')
  const [category, setCategory] = useState(reviewer.category || 'General')
  const [subjectId, setSubjectId] = useState(reviewer.subject_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !category.trim()) return
    setBusy(true); setError('')
    try {
      const changed = await setReviewerVisibility(reviewer.id, visibility, description.trim(), category.trim(), subjectId || null) as Reviewer
      onSaved(changed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cali couldn’t update this reviewer’s sharing settings.')
    } finally { setBusy(false) }
  }
  const privateMode = visibility === 'private'
  const subjectOptions = [{ value: '', label: 'General', detail: 'Not linked to a subject' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` }))]
  const categoryOptions = communityCategoryOptions.some(option => option.value === category)
    ? communityCategoryOptions
    : [{ value: category, label: category, detail: 'Existing category' }, ...communityCategoryOptions]
  return <dialog ref={dialogRef} className="study-confirm-dialog reviewer-share-dialog" aria-labelledby="reviewer-share-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}><form onSubmit={save}><ConfirmationIcon kind={busy ? 'loading' : privateMode ? 'warning' : 'information'} /><p className="workspace-overline">CALI COMMUNITY</p><h2 id="reviewer-share-title">{privateMode ? `Make “${reviewer.title}” private?` : `Share “${reviewer.title}”?`}</h2><p>{privateMode ? 'Only you will be able to find and read it. Any active access will end.' : visibility === 'public' ? 'Anyone in Cali can read, vote on, and create an attributed copy.' : 'Students can discover it and read a short preview, then request full access or an editable copy.'}</p>
    <fieldset className="reviewer-visibility-options"><legend>Visibility</legend>{(['private', 'preview', 'public'] as ReviewerVisibility[]).map(option => <label key={option} className={visibility === option ? 'is-selected' : ''}><input type="radio" name="reviewer-visibility" value={option} checked={visibility === option} onChange={() => setVisibility(option)} /><span><strong>{option[0].toUpperCase() + option.slice(1)}</strong><small>{option === 'private' ? 'Visible only to you' : option === 'preview' ? 'Searchable · limited preview' : 'Fully readable · attributed copies'}</small></span></label>)}</fieldset>
    {!privateMode && <div className="reviewer-share-fields"><label><span>Subject</span><CaliSelect ariaLabel="Community subject anchor" className="cali-select--form" value={subjectId} options={subjectOptions} onChange={setSubjectId} /></label><label><span>Category</span><CaliSelect ariaLabel="Reviewer category" className="cali-select--form" value={category} options={categoryOptions} onChange={setCategory} /></label><label><span>Description <small>{description.length}/420</small></span><textarea maxLength={420} value={description} onChange={event => setDescription(event.target.value)} placeholder="Tell students what this reviewer covers." /></label></div>}
    {reviewer.parent_reviewer_id && !privateMode && <p className="reviewer-share-lineage">This will be published as a new version. The original creator and every published contributor will remain credited.</p>}
    {error && <p className="study-form-error" role="alert">{error}</p>}<footer><button type="button" className="study-secondary" autoFocus onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className={privateMode ? 'study-danger' : 'button-primary'} disabled={busy || !category.trim()}>{busy ? 'Updating…' : privateMode ? 'Make private' : visibility === 'public' ? 'Publish publicly' : 'Publish preview'}</button></footer></form></dialog>
}

type GeneratedDraft = { requestId: string; title: string; content: JSONContent; plainText: string; revision: number; expiresAt: string }
type AiGenerationQuota = { used: number; limit: number; resetsAt: string }
type AiProgress = { phase: 'pdf' | 'scan' | 'generate'; active: number; detail?: string }

const aiProgressLabels = {
  pdf: ['Opening your PDF', 'Extracting the text', 'Preparing text for review'],
  scan: ['Preparing your pages', 'Extracting the text', 'Preparing text for review'],
  generate: ['Preparing your request', 'Generating and checking your reviewer', 'Opening your editable draft'],
} as const

function AiProgressView({ progress }: { progress: AiProgress }) {
  const labels = aiProgressLabels[progress.phase]
  const finished = progress.active >= labels.length
  const isGenerating = progress.phase === 'generate'
  const phaseLabel = progress.phase === 'scan' ? 'Handwritten note scan' : progress.phase === 'pdf' ? 'PDF text extraction' : 'Reviewer generation'
  const currentLabel = finished ? (isGenerating ? 'Reviewer ready to edit' : 'Text ready to review') : labels[progress.active]
  const visibleStep = Math.min(progress.active + 1, labels.length)
  const completion = finished ? 100 : Math.round((visibleStep / labels.length) * 100)
  return <div className="ai-progress" role="status" aria-live="polite">
    <header><span>{phaseLabel}</span><strong>{finished ? 'Complete' : isGenerating ? 'In progress' : `Step ${visibleStep} of ${labels.length}`}</strong></header>
    <div className={`ai-progress-track${isGenerating && !finished ? ' is-indeterminate' : ''}`} aria-hidden="true"><span style={{ width: isGenerating && !finished ? '38%' : `${completion}%` }} /></div>
    <div className="ai-progress-copy"><h3>{currentLabel}</h3><p>{progress.detail ?? 'This may take a moment.'}</p></div>
    <ol>{labels.map((label, index) => <li key={label} className={index < progress.active ? 'is-complete' : index === progress.active ? 'is-active' : ''}><span aria-hidden="true">{index < progress.active ? 'Done' : index === progress.active ? 'Now' : `${index + 1}`}</span><strong>{label}</strong></li>)}</ol>
    <p className="ai-progress-note">{isGenerating ? 'You can close this window and recover the request later. Your original files stay on this device.' : 'Keep this window open. Your original file stays on this device.'}</p>
  </div>
}

function AiSourceTextEditor({ sourceType, value, onChange }: { sourceType: 'pdf' | 'scan'; value: string; onChange: (value: string) => void }) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0
  const label = sourceType === 'scan' ? 'Scanned text' : 'Extracted text'
  return <section className="ai-text-review" aria-label={label}>
    <header><div><strong>{label}</strong><small>{'You can edit this text.'}</small></div><span>{words.toLocaleString()} words <i aria-hidden="true">·</i> {value.length.toLocaleString()} characters</span></header>
    <textarea aria-label={label} spellCheck rows={9} maxLength={MAX_REVIEWER_SOURCE_CHARACTERS} value={value} onChange={event => onChange(event.target.value)} />
  </section>
}

function AiSourceCloseDialog({ onKeepEditing, onDiscard }: { onKeepEditing: () => void; onDiscard: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  return <dialog ref={dialogRef} className="study-confirm-dialog" aria-labelledby="ai-source-close-title" onCancel={event => { event.preventDefault(); onKeepEditing() }}><div><ConfirmationIcon kind="warning" /><p className="workspace-overline">UNSAVED SOURCE</p><h2 id="ai-source-close-title">Discard this material?</h2><p>Your selected files and extracted text will be removed.</p><footer><button type="button" className="study-secondary" autoFocus onClick={onKeepEditing}>Keep editing</button><button type="button" className="study-danger" onClick={onDiscard}>Discard and close</button></footer></div></dialog>
}

function AiDraftActionDialog({ action, title, onCancel, onConfirm }: { action: 'save' | 'discard'; title: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmed = useRef(false)
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  const saving = action === 'save'
  const confirmOnce = () => { if (confirmed.current) return; confirmed.current = true; onConfirm() }
  return <dialog ref={dialogRef} className="study-confirm-dialog" aria-labelledby="ai-draft-action-title" onCancel={event => { event.preventDefault(); onCancel() }}><div><ConfirmationIcon kind={saving ? 'confirmation' : 'warning'} /><p className="workspace-overline">{saving ? 'SAVE REVIEWER' : 'DISCARD DRAFT'}</p><h2 id="ai-draft-action-title">{saving ? `Save “${title}”?` : 'Discard this draft?'}</h2><p>{saving ? 'This will add it to your Reviewers section. You can continue editing it there after saving.' : 'This generated reviewer and your edits will be removed. This cannot be undone.'}</p><footer><button type="button" className="study-secondary" autoFocus onClick={onCancel}>{saving ? 'Cancel' : 'Keep editing'}</button><button type="button" className={saving ? 'button-primary' : 'study-danger'} onClick={confirmOnce}>{saving ? 'Save reviewer' : 'Discard draft'}</button></footer></div></dialog>
}

function AiGenerationQuotaDialog({ quota, onCancel, onConfirm }: { quota: AiGenerationQuota; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmed = useRef(false)
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  const remaining = Math.max(0, quota.limit - quota.used)
  const exhausted = remaining === 0
  const resetDate = (() => {
    const date = new Date(quota.resetsAt)
    return Number.isNaN(date.getTime()) ? 'next month' : new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }).format(date)
  })()
  const confirmOnce = () => { if (confirmed.current) return; confirmed.current = true; onConfirm() }
  const remainingLabel = exhausted
    ? 'No generations remaining'
    : `${remaining} ${remaining === 1 ? 'generation' : 'generations'} remaining`

  return <dialog ref={dialogRef} className="study-confirm-dialog ai-quota-dialog" aria-labelledby="ai-quota-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <div>
      <ConfirmationIcon kind="information" />
      <div className="ai-quota-heading">
        <p className="workspace-overline">MONTHLY USAGE</p>
        <h2 id="ai-quota-title">{exhausted ? "You've reached your limit" : 'Generate reviewer?'}</h2>
      </div>
      <div className="ai-quota-usage">
        <strong>{remainingLabel}</strong>
        <span>{quota.used} of {quota.limit} used this month</span>
      </div>
      <p className="ai-quota-reset">{exhausted ? `Available again ${resetDate}.` : `Renews ${resetDate}. Failed attempts don't count.`}</p>
      <footer>
        {exhausted
          ? <button type="button" className="button-primary" autoFocus onClick={onCancel}>Close</button>
          : <><button type="button" className="study-secondary" autoFocus onClick={onCancel}>Cancel</button><button type="button" className="button-primary" onClick={confirmOnce}>Generate reviewer</button></>}
      </footer>
    </div>
  </dialog>
}

function nextPaint() { return new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())) }
function briefPause(milliseconds = 420) { return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)) }

function AiReviewerDialog({ userId, subjects, initialDraft, onClose, onSaved }: { userId: string; subjects: ReviewerSubject[]; initialDraft: GeneratedDraft | null; onClose: () => void; onSaved: (reviewer: Reviewer) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [recovery] = useState(() => readReviewerRecovery(userId))
  const [intakeStep, setIntakeStep] = useState<0 | 1 | 2>(recovery?.requestId ? 2 : recovery?.sourceText ? 1 : 0)
  const stepHeading = useRef<HTMLHeadingElement | null>(null)
  const intakeBody = useRef<HTMLDivElement | null>(null)
  const [sourceType, setSourceType] = useState<'pdf' | 'scan'>(recovery?.sourceType ?? 'scan')
  const [sourceText, setSourceText] = useState(recovery?.sourceText ?? '')
  const [preferences, setPreferences] = useState<ReviewerPreferences>(recovery?.preferences ?? { ...DEFAULT_REVIEWER_PREFERENCES })
  const [fileName, setFileName] = useState('')
  const [notePages, setNotePages] = useState<File[]>([])
  const [scanStatus, setScanStatus] = useState('')
  const [detail, setDetail] = useState<'concise' | 'standard' | 'detailed'>(recovery?.detail ?? 'standard')
  const [busy, setBusy] = useState(false)
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
  const [showQuotaMessage, setShowQuotaMessage] = useState(false)
  const [draftAction, setDraftAction] = useState<'save' | 'discard' | null>(null)
  const [quota, setQuota] = useState<AiGenerationQuota | null>(null)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<GeneratedDraft | null>(initialDraft)
  const [draftTitle, setDraftTitle] = useState(initialDraft?.title ?? '')
  const [subjectId, setSubjectId] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draftState, setDraftState] = useState<ReviewerSaveState>('saved')
  const revision = useRef(initialDraft?.revision ?? 1)
  const saveTimer = useRef<number | null>(null)
  const titleRef = useRef(initialDraft?.title ?? '')
  const changeVersion = useRef(0)
  const persistedVersion = useRef(0)
  const saveInFlight = useRef<Promise<boolean> | null>(null)
  const [pendingSubmissionKey, setPendingSubmissionKey] = useState<string | null>(() => recovery?.requestId ? reviewerSubmissionKey(recovery) : null)
  const lastSubmission = useRef<{ key: string; requestId: string } | null>(recovery?.requestId ? { key: reviewerSubmissionKey(recovery), requestId: recovery.requestId } : null)
  const lifetime = useRef(new AbortController())
  const extractionController = useRef<AbortController | null>(null)
  const actionInFlight = useRef(false)
  const subjectOptions = useMemo<CaliSelectOption[]>(() => [{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title }))], [subjects])

  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => { controller.abort() }
  }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (draftState === 'dirty' || draftState === 'saving' || draftState === 'error') event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [draftState])
  useEffect(() => { titleRef.current = draftTitle }, [draftTitle])
  useEffect(() => {
    intakeBody.current?.scrollTo({ top: 0 })
    stepHeading.current?.focus({ preventScroll: true })
  }, [intakeStep])
  useEffect(() => { if (initialDraft) clearReviewerRecovery(userId) }, [initialDraft, userId])
  useEffect(() => {
    let cancelled = false
    if (!supabase || initialDraft) return
    void supabase.rpc('cali_reviewer_generation_quota').then(({ data }) => {
      if (cancelled || !data || typeof data !== 'object') return
      const value = data as Record<string, unknown>
      const used = Number(value.used)
      const limit = Number(value.limit)
      if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0 && typeof value.resetsAt === 'string') setQuota({ used: Math.max(0, used), limit, resetsAt: value.resetsAt })
    })
    return () => { cancelled = true }
  }, [initialDraft])

  const persistDraft = useCallback(async function persistCurrentDraft(): Promise<boolean> {
    if (!supabase || !draft || !editor || !titleRef.current.trim()) return false
    if (saveInFlight.current) {
      const priorSaved = await saveInFlight.current
      if (!priorSaved) return false
      if (persistedVersion.current < changeVersion.current) return persistCurrentDraft()
      return true
    }
    const savingVersion = changeVersion.current
    const savingTitle = titleRef.current.trim()
    const savingContent = editor.getJSON()
    const savingPlainText = editor.getText()
    setDraftState('saving')
    const operation = (async () => {
      const { data, error: saveError } = await supabase.rpc('cali_update_own_generated_reviewer', { p_request_id: draft.requestId, p_expected_revision: revision.current, p_title: savingTitle, p_content: savingContent, p_plain_text: savingPlainText }).single()
      if (saveError || !data) { setDraftState('error'); return false }
      revision.current = Number((data as { revision: number }).revision)
      persistedVersion.current = savingVersion
      setDraftState(savingVersion === changeVersion.current ? 'saved' : 'dirty')
      return true
    })()
    saveInFlight.current = operation
    let saved = false
    try { saved = await operation } catch { setDraftState('error') } finally { saveInFlight.current = null }
    if (saved && persistedVersion.current < changeVersion.current) return persistCurrentDraft()
    return saved
  }, [draft, editor])

  useEffect(() => { if (editor) editor.setEditable(!busy) }, [editor, busy])

  const scheduleAutosave = useCallback(() => {
    changeVersion.current += 1
    setDraftState('dirty')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void persistDraft() }, 1200)
  }, [persistDraft])

  useEffect(() => {
    if (!editor || !draft) return
    editor.on('update', scheduleAutosave)
    return () => { editor.off('update', scheduleAutosave); if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [draft, editor, scheduleAutosave])

  const selectPdf = async (file: File | undefined) => {
    if (!file) return
    extractionController.current = new AbortController()
    const extractionSignal = AbortSignal.any([extractionController.current.signal, lifetime.current.signal])
    setError(''); setFileName(file.name); setSourceText(''); setBusy(true); setProgress({ phase: 'pdf', active: 0, detail: file.name })
    try {
      await nextPaint()
      const text = await extractPdfText(file, (page, total) => setProgress({ phase: 'pdf', active: 1, detail: `Page ${page} of ${total}` }), extractionSignal)
      setSourceText(text); setProgress({ phase: 'pdf', active: 2, detail: 'Almost ready to review.' }); await briefPause(300); setProgress({ phase: 'pdf', active: 3, detail: 'You can check the extracted text now.' }); await briefPause(260); setIntakeStep(1)
    } catch (extractionError) {
      setSourceText(''); setError(extractionError instanceof PdfExtractionError ? extractionError.message : 'Cali could not read this PDF.')
    } finally { setProgress(null); setBusy(false) }
  }

  const addNotePages = (files: FileList | null) => {
    if (!files?.length) return
    const selectedFiles = Array.from(files)
    setError(''); setScanStatus(''); setSourceText('')
    setNotePages(current => {
      const remaining = MAX_NOTE_PAGES - current.length
      if (selectedFiles.length > remaining) setError(`You can scan up to ${MAX_NOTE_PAGES} pages at a time.`)
      return [...current, ...selectedFiles.slice(0, Math.max(0, remaining))]
    })
  }

  const moveNotePage = (index: number, direction: -1 | 1) => {
    setSourceText('')
    setNotePages(current => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next
    })
  }

  const scanNotes = async () => {
    if (!notePages.length || busy) return
    extractionController.current = new AbortController()
    const extractionSignal = AbortSignal.any([extractionController.current.signal, lifetime.current.signal])
    setBusy(true); setError(''); setSourceText(''); setScanStatus(''); setProgress({ phase: 'scan', active: 0, detail: `${notePages.length} page${notePages.length === 1 ? '' : 's'} selected` })
    try {
      await nextPaint()
      const text = await scanNotePages(notePages, status => setProgress({ phase: 'scan', active: 1, detail: status }), extractionSignal, warning => setScanStatus(warning))
      setSourceText(text); setProgress({ phase: 'scan', active: 2, detail: 'Almost ready to review.' }); await briefPause(300); setProgress({ phase: 'scan', active: 3, detail: 'You can check the extracted text now.' }); await briefPause(260); setIntakeStep(1)
      setScanStatus(current => current || 'Scan complete. Review and correct the text below.')
    } catch (scanError) { setError(scanError instanceof Error ? scanError.message : 'Cali could not scan these notes.'); setScanStatus('') }
    finally { setProgress(null); setBusy(false) }
  }

  const rememberSubmission = () => {
    const value = { sourceType, sourceText: sourceText.trim(), detail, preferences }
    const key = reviewerSubmissionKey(value)
    if (lastSubmission.current?.key !== key) lastSubmission.current = { key, requestId: crypto.randomUUID() }
    setPendingSubmissionKey(key)
    writeReviewerRecovery(userId, { ...value, requestId: lastSubmission.current.requestId, expiresAt: Date.now() + 86_400_000 })
    return lastSubmission.current.requestId
  }
  const recoverPendingDraft = async (requestId: string): Promise<GeneratedDraft | null> => {
    if (!supabase) return null
    const stopAt = Date.now() + 135_000
    while (Date.now() < stopAt && !lifetime.current.signal.aborted) {
      const { data: pending, error: statusError } = await supabase.from('reviewer_generation_requests').select('status,failure_reason').eq('id', requestId).eq('user_id', userId).abortSignal(AbortSignal.any([lifetime.current.signal, AbortSignal.timeout(8000)])).maybeSingle()
      if (statusError) throw new Error('Could not check this generation. Your request is saved on this device; reopen it and retry.')
      if (!pending) return null
      if (pending.status === 'succeeded') {
        const { data: row, error: draftError } = await supabase.from('generated_reviewer_drafts').select('request_id,title,content,plain_text,revision,expires_at').eq('request_id', requestId).abortSignal(AbortSignal.any([lifetime.current.signal, AbortSignal.timeout(8000)])).maybeSingle()
        if (draftError || !row) throw new Error('The draft could not be recovered or has expired. Reopen your study library.')
        return { requestId: row.request_id, title: row.title, content: row.content, plainText: row.plain_text, revision: row.revision, expiresAt: row.expires_at } as GeneratedDraft
      }
      if (pending.status !== 'processing') {
        lastSubmission.current = null
        setPendingSubmissionKey(null)
        if (pending.status === 'failed') throw new Error(pending.failure_reason === 'content_blocked' ? 'This material was blocked by the academic content policy. Correct the source or reviewer instructions before retrying. This attempt does not count toward your monthly limit.' : 'The previous generation did not finish. Retry to start a new request; failed attempts do not count toward your monthly limit.')
        throw new Error('This request was already saved or discarded. Reopen your study library.')
      }
      await new Promise<void>(resolve => {
        const signal = lifetime.current.signal
        const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
        const timer = window.setTimeout(finish, 2500)
        signal.addEventListener('abort', finish, { once: true })
      })
    }
    throw new Error('This generation is still pending. Close and reopen it to recover the request, or retry shortly.')
  }
  const generate = async () => {
    const cleaned = sourceText.trim()
    if (!cleaned || cleaned.length > MAX_REVIEWER_SOURCE_CHARACTERS || busy || actionInFlight.current || !supabase) return
    actionInFlight.current = true
    setBusy(true); setError(''); setProgress({ phase: 'generate', active: 0, detail: 'Checking the reviewed text.' })
    try {
      await nextPaint()
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in again to generate a reviewer.')
      const requestId = rememberSubmission()
      setProgress({ phase: 'generate', active: 1, detail: 'Cali is checking the academic content, organizing the material, and validating the result. This may take up to two minutes.' })
      const response = await fetch('/api/study/reviewer-generation', { method: 'POST', signal: AbortSignal.any([lifetime.current.signal, AbortSignal.timeout(125_000)]), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, sourceType, sourceText: cleaned, detail, preferences }) })
      const responseText = await response.text()
      let result: GeneratedDraft & { error?: string; category?: string; recoverable?: boolean }
      try {
        result = JSON.parse(responseText) as GeneratedDraft & { error?: string; category?: string }
      } catch {
        throw new Error(response.ok ? 'The reviewer was created, but the response could not be opened. Please try again to recover it.' : 'Reviewer generation is temporarily unavailable. Keep this window open and try again in a moment.')
      }
      if (!response.ok && result.category === 'active') {
        const recovered = await recoverPendingDraft(requestId)
        if (recovered) result = recovered
        else throw new Error(result.error || 'Another reviewer is being generated. Retry after it finishes.')
      } else if (!response.ok) {
        if (result.category && result.category !== 'quota' && !result.recoverable) { lastSubmission.current = null; setPendingSubmissionKey(null) }
        throw new Error(result.error || 'Reviewer generation failed.')
      }
      if (!result.requestId || !result.content || !result.title || !Number.isInteger(result.revision)) throw new Error('The draft response could not be opened. Retry to recover it.')
      lastSubmission.current = null
      setPendingSubmissionKey(null)
      setProgress({ phase: 'generate', active: 2, detail: 'The checked reviewer is ready. Opening the editor now.' }); await briefPause(360); setProgress({ phase: 'generate', active: 3, detail: 'Your editable draft is ready.' }); await briefPause(260)
      void supabase.rpc('cali_reviewer_generation_quota').then(({ data }) => { if (data) setQuota(data as AiGenerationQuota) })
      setDraft(result); setDraftTitle(result.title); revision.current = result.revision
      clearReviewerRecovery(userId)
    } catch (generationError) {
      if (lifetime.current.signal.aborted) return
      writeReviewerRecovery(userId, { sourceType, sourceText: cleaned, detail, preferences, requestId: lastSubmission.current?.requestId ?? null, expiresAt: Date.now() + 86_400_000 })
      const message = generationError instanceof TypeError
        ? 'Cali cannot reach reviewer generation right now. Keep this window open and try again in a moment.'
        : generationError instanceof Error ? generationError.message : 'Reviewer generation failed.'
      setError(message)
    } finally {
      actionInFlight.current = false
      setProgress(null); setBusy(false)
    }
  }

  const requestGeneration = (event: FormEvent) => {
    event.preventDefault()
    const cleaned = sourceText.trim()
    if (!cleaned || cleaned.length > MAX_REVIEWER_SOURCE_CHARACTERS || busy || !supabase) return
    if (intakeStep !== 2) return
    if (lastSubmission.current?.key === reviewerSubmissionKey({ sourceType, sourceText: cleaned, detail, preferences })) { void generate(); return }
    if (quota) { setShowQuotaMessage(true); return }
    void generate()
  }

  const saveReviewer = async () => {
    if (!supabase || !draft || busy || actionInFlight.current || !draftTitle.trim()) return
    actionInFlight.current = true
    setBusy(true); setError('')
    try {
      if (!await persistDraft()) {
        const { data: request } = await supabase.from('reviewer_generation_requests').select('status').eq('id', draft.requestId).maybeSingle()
        if (request?.status !== 'saved') { setError('The latest draft changes could not be saved. Reopen the draft if it changed in another window.'); return }
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      const { data, error: saveError } = await supabase.rpc('cali_save_own_generated_reviewer', { p_request_id: draft.requestId, p_subject_id: subjectId || null, p_expected_revision: revision.current }).single()
      if (saveError || !data) {
        setError(saveError?.code === 'P0001' ? 'This draft changed in another window. Reopen it to load the latest version before saving.' : 'Could not save this reviewer. Retry; saving will not create a duplicate.')
        return
      }
      onSaved(data as Reviewer)
    } catch { setError('Could not save this reviewer. Retry to recover the saved result.') }
    finally { actionInFlight.current = false; setBusy(false) }
  }

  const closeSourceDialog = () => {
    extractionController.current?.abort()
    clearReviewerRecovery(userId)
    setSourceText(''); setNotePages([]); setFileName(''); setScanStatus(''); setError('')
    setShowCloseConfirmation(false)
    onClose()
  }

  const requestSourceClose = () => {
    if (sourceText.trim() || notePages.length || fileName || preferences.additionalContent) { setShowCloseConfirmation(true); return }
    closeSourceDialog()
  }

  const discard = async () => {
    if (!draft || busy || actionInFlight.current) return
    if (!supabase) { setError('Cali could not connect to your saved draft. Please try again.'); return }
    actionInFlight.current = true
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    setBusy(true); setError('')
    try {
      if (saveInFlight.current) await saveInFlight.current
      const { error: discardError } = await supabase.rpc('cali_discard_own_generated_reviewer', { p_request_id: draft.requestId })
      if (discardError) { setError('Cali could not discard this draft. It is still saved, so you can try again.'); return }
      onClose()
    } catch {
      setError('Cali could not discard this draft. It is still saved, so you can try again.')
    } finally {
      actionInFlight.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialogRef} className={`study-dialog ai-reviewer-dialog${draft ? ' has-draft' : ''}`} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busy) { if (draft) setDraftAction('discard'); else requestSourceClose() } }}>
    {!draft ? <form onSubmit={requestGeneration} className="study-dialog-shell ai-intake-wizard">
      <header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Generate a reviewer</h2><p className="ai-dialog-intro">Turn your course material into clear study notes.</p></div><button type="button" className="study-dialog-close" aria-label="Close reviewer generator" onClick={requestSourceClose} disabled={busy}><CloseIcon /></button></header>
      <ol className="ai-intake-steps" aria-label="Reviewer preparation steps">{['Add material', 'Check text', 'Customize'].map((label, index) => <li key={label} className={index === intakeStep ? 'is-current' : index < intakeStep ? 'is-complete' : ''} aria-current={index === intakeStep ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span><strong>{label}</strong></li>)}</ol>
      {progress ? <><AiProgressView progress={progress} /><footer className="ai-input-footer"><button type="button" className="study-secondary" onClick={() => { if (progress.phase === 'generate') onClose(); else setShowCloseConfirmation(true) }}>{progress.phase === 'generate' ? 'Close and resume later' : 'Stop extraction'}</button></footer></> : <>
        <div className="ai-input-body" ref={intakeBody}>
          {intakeStep === 0 && <>
          <section className="ai-generator-section"><div className="ai-step-heading"><h3 ref={stepHeading} tabIndex={-1}>Add your material</h3><p>Choose a text-based PDF or photos of your notes.</p></div><div className="ai-source-tabs" role="tablist" aria-label="Choose your source"><button type="button" role="tab" aria-selected={sourceType === 'scan'} className={sourceType === 'scan' ? 'is-active' : ''} onClick={() => { setSourceType('scan'); setSourceText(''); setFileName(''); setError('') }}><span><strong>Note photos</strong><small>Up to 10 pages</small></span></button><button type="button" role="tab" aria-selected={sourceType === 'pdf'} className={sourceType === 'pdf' ? 'is-active' : ''} onClick={() => { setSourceType('pdf'); setSourceText(''); setScanStatus(''); setError('') }}><span><span className="ai-source-option-title"><strong>Digital PDF</strong></span><small>One text-based file</small></span></button></div>
            <div className="ai-source-card" aria-label={sourceType === 'scan' ? 'Handwritten note photos' : 'PDF document'}>
              {sourceType === 'pdf' ? <>
                <label className="ai-file-picker"><input type="file" accept="application/pdf,.pdf" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void selectPdf(file) }} /><span><strong>{fileName || 'Select a PDF file'}</strong>{!fileName && <small>Text-based PDF · up to 20 MB</small>}</span><span className="ai-file-action">{fileName ? 'Change PDF' : 'Browse'}</span></label>
                <p className="ai-source-note">Scanned or image-only PDFs cannot be read.</p>
              </> : <div className="ai-note-scanner">
                {notePages.length === 0 ? <>
                  <label className="ai-file-picker"><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { addNotePages(event.target.files); event.target.value = '' }} /><span><strong>Select page photos</strong><small>1–{MAX_NOTE_PAGES} clear images · JPG, PNG, or WebP</small></span><span className="ai-file-action">Browse</span></label>
                  <p className="ai-source-note">Use one clear, well-lit photo per page.</p>
                </> : <div className="ai-note-batch">
                  <div className="ai-note-selection-head"><div><strong>Selected pages</strong><small>{notePages.length} of {MAX_NOTE_PAGES} · Clear, well-lit scans work best</small></div><label className="ai-add-pages"><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={notePages.length >= MAX_NOTE_PAGES} onChange={event => { addNotePages(event.target.files); event.target.value = '' }} /><span>{notePages.length >= MAX_NOTE_PAGES ? 'Page limit reached' : 'Add more photos'}</span></label></div>
                  <div className="ai-note-pages" aria-label="Notebook pages in reading order">{notePages.map((page, index) => <div key={`${page.name}-${page.lastModified}-${index}`}><span><b>{index + 1}</b><span><strong>Page {index + 1}</strong><small title={page.name}>{page.name}</small></span></span><span>{index > 0 && <button type="button" onClick={() => moveNotePage(index, -1)} aria-label={`Move page ${index + 1} up`}>Up</button>}{index < notePages.length - 1 && <button type="button" onClick={() => moveNotePage(index, 1)} aria-label={`Move page ${index + 1} down`}>Down</button>}<button type="button" className="is-remove" onClick={() => { setNotePages(current => current.filter((_, pageIndex) => pageIndex !== index)); setSourceText('') }} aria-label={`Remove page ${index + 1}`}>Remove</button></span></div>)}</div>
                </div>}
              </div>}
            </div>
            <p className="ai-privacy-note">Your files stay on this device. Only reviewed text is sent for generation.</p>
          </section>

          </>}
          {intakeStep === 1 && <section className="ai-generator-section ai-check-source"><div className="ai-step-heading"><h3 ref={stepHeading} tabIndex={-1}>Check the extracted text</h3><p>Compare it with your material and correct any missing or misread words.</p></div>{scanStatus && <p className="ai-scan-status" role="status">{scanStatus}</p>}<AiSourceTextEditor sourceType={sourceType} value={sourceText} onChange={setSourceText} /><p className="ai-source-note">This is the text Cali will use to create your reviewer.</p></section>}
          {intakeStep === 2 && <section className="ai-generator-section ai-reviewer-preferences"><div className="ai-step-heading"><h3 ref={stepHeading} tabIndex={-1}>Customize your reviewer</h3><p>Choose the amount of detail, then add presentation instructions if needed.</p></div><ReviewerStyleOptions preferences={preferences} detail={detail} onPreferencesChange={setPreferences} onDetailChange={setDetail} /></section>}
          {error && <p className="study-form-error" role="alert">{error}</p>}
        </div>
        <footer className="ai-input-footer"><button type="button" className="study-secondary" onClick={() => { if (intakeStep === 0) requestSourceClose(); else { setError(''); setIntakeStep(intakeStep === 2 ? 1 : 0) } }}>{intakeStep === 0 ? 'Cancel' : 'Back'}</button><div>
          {intakeStep === 0 && <button type="button" className="button-primary" disabled={!sourceText.trim() && (sourceType !== 'scan' || !notePages.length)} onClick={() => { if (sourceText.trim()) { setError(''); setIntakeStep(1) } else void scanNotes() }}>{sourceType === 'scan' && !sourceText.trim() ? 'Extract text' : 'Review text'}</button>}
          {intakeStep === 1 && <button type="button" className="button-primary" disabled={!sourceText.trim()} onClick={() => { setError(''); setIntakeStep(2) }}>Use this text</button>}
          {intakeStep === 2 && <button type="submit" className="button-primary" disabled={!sourceText.trim()}>{pendingSubmissionKey === reviewerSubmissionKey({ sourceType, sourceText: sourceText.trim(), detail, preferences }) ? 'Recover reviewer' : 'Generate reviewer'}</button>}
        </div></footer>
      </>}
    </form> : <div className="ai-draft-shell"><header><div><p className="workspace-overline">AI-GENERATED DRAFT</p><h2>Edit before saving</h2><p>Check important details against your source. You can continue editing this reviewer after saving it from the Reviewers section.</p></div><span className={`reviewer-save-state reviewer-save-state--${draftState}`}>{draftState === 'saving' ? 'Saving…' : draftState === 'dirty' ? 'Unsaved changes' : draftState === 'error' ? 'Couldn’t autosave' : 'Draft saved'}</span></header>
      <div className="ai-draft-fields"><label className="study-field"><span>Title</span><input disabled={busy} maxLength={160} value={draftTitle} onChange={event => { setDraftTitle(event.target.value); scheduleAutosave() }} /></label><div className="study-field"><span>Subject</span><CaliSelect ariaLabel="Generated reviewer subject" className="cali-select--form" value={subjectId} options={subjectOptions} onChange={setSubjectId} /></div></div>
      <div className="ai-draft-editor"><header><strong>Reviewer content</strong><span>Click the text to make corrections</span></header><DocumentView content={draft.content} editable onEditor={setEditor} /></div>
      {error && <p className="study-form-error" role="alert">{error}</p>}<footer><button type="button" className="study-secondary" disabled={busy} onClick={async () => { if (await persistDraft()) onClose(); else setError('Could not save your changes. Retry before closing.') }}>Close and keep draft</button><button type="button" className="study-danger" onClick={() => setDraftAction('discard')} disabled={busy}>Discard</button><button type="button" className="button-primary" onClick={() => setDraftAction('save')} disabled={busy || !draftTitle.trim()}>Save reviewer</button></footer>
    </div>}
    {showCloseConfirmation && <AiSourceCloseDialog onKeepEditing={() => setShowCloseConfirmation(false)} onDiscard={closeSourceDialog} />}
    {showQuotaMessage && quota && <AiGenerationQuotaDialog quota={quota} onCancel={() => setShowQuotaMessage(false)} onConfirm={() => { setShowQuotaMessage(false); void generate() }} />}
    {draftAction && <AiDraftActionDialog action={draftAction} title={draftTitle.trim()} onCancel={() => setDraftAction(null)} onConfirm={() => { const action = draftAction; setDraftAction(null); if (action === 'save') void saveReviewer(); else void discard() }} />}
  </dialog>
}

function ReviewersStudyPage({ studentId }: { studentId: string }) {
  const [params, setParams] = useSearchParams()
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [subjects, setSubjects] = useState<ReviewerSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [showAiGenerator, setShowAiGenerator] = useState(false)
  const [resumableAiDraft, setResumableAiDraft] = useState<GeneratedDraft | null>(null)
  const [aiAvailability, setAiAvailability] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [newTitle, setNewTitle] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Reviewer | null>(null)
  const [shareTarget, setShareTarget] = useState<Reviewer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pageColorOverride, setPageColorOverride] = useState<{ reviewerId: string; color: string } | null>(null)
  const [reviewerSaveState, setReviewerSaveState] = useState<ReviewerSaveState>('saved')
  const [showUnsavedExit, setShowUnsavedExit] = useState(false)
  const [exitSaving, setExitSaving] = useState(false)
  const [exitSaveError, setExitSaveError] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const createRef = useRef<HTMLDialogElement>(null)
  const reviewerPageRef = useRef<HTMLElement>(null)
  const requestedFullscreen = useRef(false)
  const saveReviewerRef = useRef<(() => Promise<boolean>) | null>(null)
  const selected = reviewers.find(reviewer => reviewer.id === params.get('reviewer')) ?? null
  const editing = params.get('edit') === '1'
  const selectedStoredPageColor = String(selected?.content.attrs?.pageColor ?? '')
  const selectedPageColor = selected && pageColorOverride?.reviewerId === selected.id ? pageColorOverride.color : selectedStoredPageColor
  const selectedUsesLightForeground = usesLightForeground(selectedPageColor)
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [reviewerResult, subjectResult, draftResult] = await Promise.all([supabase.from('reviewers').select('*').eq('user_id', studentId).order('updated_at', { ascending: false }), supabase.from('schedule_subjects').select('id,subject_code,title,color_key').eq('user_id', studentId).order('subject_code'), supabase.from('generated_reviewer_drafts').select('request_id,title,content,plain_text,revision,expires_at').eq('user_id', studentId).gt('expires_at', new Date().toISOString()).order('updated_at', { ascending: false }).limit(1).maybeSingle()])
    if (reviewerResult.error || subjectResult.error) {
      setNotice({ kind: 'error', text: 'Cali could not load your study space. Please try again.' })
    } else {
      setReviewers((reviewerResult.data ?? []) as Reviewer[]); setSubjects((subjectResult.data ?? []) as ReviewerSubject[])
      if (draftResult.error) {
        setAiAvailability('unavailable')
        setResumableAiDraft(null)
        setNotice({ kind: 'error', text: 'Your reviewers loaded, but AI generation needs the latest database update.' })
      } else {
        setAiAvailability('ready')
        const row = draftResult.data as { request_id: string; title: string; content: JSONContent; plain_text: string; revision: number; expires_at: string } | null
        setResumableAiDraft(row ? { requestId: row.request_id, title: row.title, content: row.content, plainText: row.plain_text, revision: row.revision, expiresAt: row.expires_at } : null)
      }
    }
    setLoading(false)
  }, [studentId])
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (params.get('new') === 'manual') createRef.current?.showModal(); else createRef.current?.close() }, [params])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(timer) }, [notice])
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (requestedFullscreen.current && !document.fullscreenElement) { requestedFullscreen.current = false; setFocusMode(false) }
    }
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && focusMode && !document.fullscreenElement) setFocusMode(false) }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleEscape)
    return () => { document.removeEventListener('fullscreenchange', handleFullscreenChange); document.removeEventListener('keydown', handleEscape) }
  }, [focusMode])
  const visible = useMemo(() => reviewers.filter(reviewer => reviewerMatches(reviewer, query, subjectFilter)), [query, reviewers, subjectFilter])
  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
  const subjectOptions = useMemo<CaliSelectOption[]>(() => [{ value: '', label: 'General' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title, triggerLabel: `${subject.subject_code} — ${subject.title}` }))], [subjects])
  const subjectFilterOptions = useMemo<CaliSelectOption[]>(() => [{ value: '', label: 'All subjects' }, ...subjects.map(subject => ({ value: subject.id, label: subject.subject_code, detail: subject.title }))], [subjects])
  const navigate = (changes: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) } setParams(next) }
  const registerReviewerSave = useCallback((save: (() => Promise<boolean>) | null) => { saveReviewerRef.current = save }, [])
  const enterFocusMode = () => {
    setFocusMode(true)
    const page = reviewerPageRef.current
    if (!window.matchMedia('(min-width: 761px)').matches || !page?.requestFullscreen) return
    requestedFullscreen.current = true
    void page.requestFullscreen().catch(() => { requestedFullscreen.current = false })
  }
  const exitFocusMode = () => {
    requestedFullscreen.current = false
    setFocusMode(false)
    if (document.fullscreenElement) void document.exitFullscreen()
  }
  const requestLibraryExit = () => {
    if (editing && reviewerSaveState !== 'saved') { setExitSaveError(''); setShowUnsavedExit(true); return }
    navigate({ reviewer: null, edit: null })
  }
  const saveAndLeave = async () => {
    const save = saveReviewerRef.current
    if (!save) { setExitSaveError('The editor is not ready to save yet. Keep editing and try again.'); return }
    setExitSaving(true); setExitSaveError('')
    try {
      const saved = await save()
      if (!saved) { setExitSaveError('Your changes still could not be saved. Check your connection and try again.'); return }
      setShowUnsavedExit(false); setReviewerSaveState('saved'); navigate({ reviewer: null, edit: null })
    } catch {
      setExitSaveError('Your changes still could not be saved. Check your connection and try again.')
    } finally {
      setExitSaving(false)
    }
  }
  const leaveWithoutSaving = () => { setShowUnsavedExit(false); setReviewerSaveState('saved'); navigate({ reviewer: null, edit: null }) }
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
    return <section ref={reviewerPageRef} className={`study-page study-page--reviewer${focusMode ? ' is-focus-mode' : ''}${selectedPageColor ? ` has-page-color${contrastClass}` : ''}`} style={{ '--reviewer-page-color': selectedPageColor || 'var(--color-cali-surface)' } as CSSProperties}>
      {focusMode ? <nav className="reviewer-focus-nav" aria-label="Focus view navigation"><button type="button" className="reviewer-focus-exit" aria-label="Exit focus view" onClick={exitFocusMode}><BackArrowIcon /><span>Exit focus view</span></button></nav> : <nav className="reviewer-page-nav" aria-label="Reviewer navigation">
        <button type="button" className="cali-back-link reviewer-back" onClick={requestLibraryExit}><BackArrowIcon /><span>Back to library</span></button>
        {!editing && <div className="reviewer-reader-actions">
          <button type="button" className="study-secondary reviewer-create-action" onClick={() => navigate({ tool: 'flashcards', source: selected.id, new: '1', reviewer: null })}>Create flashcards</button>
          <button type="button" className="study-secondary reviewer-create-action" onClick={() => navigate({ tool: 'quizzes', source: selected.id, new: '1', reviewer: null })}>Create quiz</button>
          <button type="button" className="reviewer-icon-action" aria-label="Community sharing" title="Community sharing" onClick={() => setShareTarget(selected)}><ShareIcon /></button>
          <button type="button" className="reviewer-icon-action" aria-label="Open focus view" title="Focus view" onClick={enterFocusMode}><FocusIcon /></button>
          <button type="button" className="reviewer-icon-action" aria-label="Edit reviewer" title="Edit reviewer" onClick={() => navigate({ edit: '1' })}><EditIcon /></button>
          <details><summary aria-label="More reviewer actions" title="More actions"><MoreIcon /></summary><div><button type="button" onClick={() => { void duplicate(selected) }}>Duplicate</button><button type="button" className="is-danger" onClick={event => { const menu = event.currentTarget.closest('details') as HTMLDetailsElement | null; if (menu) menu.open = false; setDeleteError(''); setDeleteTarget(selected) }}>Delete permanently</button></div></details>
        </div>}
      </nav>}
      {noticeBanner}
      {editing ? <ReviewerEditor key={selected.id} reviewer={selected} subjects={subjects} onSaved={updateReviewer} onClose={() => navigate({ edit: null })} onPageColorChange={color => setPageColorOverride({ reviewerId: selected.id, color })} onSaveStateChange={setReviewerSaveState} onSaveReady={registerReviewerSave} /> : <article className={`reviewer-reading${selectedPageColor ? ' has-page-color' : ''}`} style={{ '--reviewer-page-color': selectedPageColor || 'var(--color-cali-surface)' } as CSSProperties}>
        <header>
          <div><p className="workspace-overline">{selectedSubject?.subject_code ?? 'GENERAL REVIEWER'}{selected.visibility && selected.visibility !== 'private' ? ` · ${selected.visibility.toUpperCase()}` : ''}</p><h1>{selected.title}</h1><p>Updated {formatReviewerDate(selected.updated_at)}</p></div>
        </header>
        <DocumentView content={selected.content} />
      </article>}
      {showUnsavedExit && <ReviewerUnsavedDialog status={reviewerSaveState} busy={exitSaving} error={exitSaveError} onKeepEditing={() => { if (!exitSaving) { setShowUnsavedExit(false); setExitSaveError('') } }} onSaveAndLeave={() => { void saveAndLeave() }} onLeave={leaveWithoutSaving} />}
      {deleteTarget && <ReviewerDeleteDialog reviewer={deleteTarget} busy={deleting} error={deleteError} onCancel={() => { if (!deleting) setDeleteTarget(null) }} onConfirm={() => { void remove() }} />}
      {shareTarget && <ReviewerShareDialog reviewer={shareTarget} subjects={subjects} onCancel={() => setShareTarget(null)} onSaved={changed => { updateReviewer(changed); setShareTarget(null); setNotice({ kind: 'success', text: changed.visibility === 'private' ? 'Reviewer is private.' : `Reviewer published as ${changed.visibility}.` }) }} />}
    </section>
  }

  return <section className="study-page">
    <header className="study-heading"><div><p className="workspace-overline">STUDY SPACE</p><h1>Your study <em>library</em></h1><p>Create a reviewer from scratch, or turn notebook pages and PDFs into an editable draft.</p></div><div className="study-heading-actions"><button type="button" className="study-secondary" disabled={aiAvailability !== 'ready'} title={aiAvailability === 'unavailable' ? 'This feature is being prepared. Try again shortly.' : undefined} onClick={() => setShowAiGenerator(true)}>{aiAvailability === 'checking' ? 'Getting ready…' : resumableAiDraft ? 'Continue draft' : 'Generate Reviewer'}</button><button type="button" className="button-primary" onClick={() => navigate({ new: 'manual', reviewer: null, edit: null })}><span aria-hidden="true">+</span> Start blank</button></div></header>
    <div className="study-tabs" role="tablist" aria-label="Study tools"><button type="button" className="is-active" role="tab" aria-selected="true">Reviewers</button><button type="button" role="tab" aria-selected="false" onClick={() => navigate({ tool: 'flashcards' })}>Flashcards</button><button type="button" role="tab" aria-selected="false" onClick={() => navigate({ tool: 'quizzes' })}>Quizzes</button></div>
    {noticeBanner}
    <section className="reviewer-library" aria-label="Reviewer library" aria-busy={loading}>
      <div className="reviewer-library-head"><div><p className="workspace-overline">REVIEWERS</p><h2>Your reviewers</h2></div>{loading ? <StudyLibraryCountSkeleton /> : <span className="reviewer-count">{reviewers.length} {reviewers.length === 1 ? 'reviewer' : 'reviewers'}</span>}</div>
      {loading ? <StudyLibraryFiltersSkeleton /> : <div className="reviewer-filters"><label><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reviewers" aria-label="Search reviewers" /></label><CaliSelect ariaLabel="Filter by subject" className="cali-select--filter" value={subjectFilter} options={subjectFilterOptions} onChange={setSubjectFilter} /></div>}
      {loading ? <StudyLibraryCardsSkeleton containerClassName="reviewer-list" label="Loading reviewers" /> : <div className="reviewer-list">{visible.length ? visible.map(reviewer => {
        const subject = reviewer.subject_id ? subjectMap.get(reviewer.subject_id) : null
        const pageColor = String(reviewer.content.attrs?.pageColor ?? '')
        const previewContrastClass = usesLightForeground(pageColor) ? ' uses-light-foreground' : ' uses-dark-foreground'
        const previewBlocks = reviewerPreviewBlocks(reviewer.content)
        return <button
          type="button"
          key={reviewer.id}
          className={`reviewer-preview-card${pageColor ? ` has-page-color${previewContrastClass}` : ''}`}
          style={pageColor ? { '--reviewer-preview-page-color': pageColor } as CSSProperties : undefined}
          aria-label={`Open ${reviewer.title}`}
          onClick={() => navigate({ reviewer: reviewer.id, edit: null, new: null })}
        ><span className="reviewer-preview-meta"><span>{subject?.subject_code ?? 'General'}</span><time dateTime={reviewer.updated_at}>{formatReviewerDate(reviewer.updated_at)}</time></span><strong className="reviewer-preview-title">{reviewer.title}</strong><span className="reviewer-preview-content" aria-hidden="true">{previewBlocks.length ? previewBlocks.map((block, index) => block.kind === 'table' ? <span key={`table-${index}`} className="reviewer-preview-table" style={{ '--preview-columns': block.rows[0]?.length ?? 1 } as CSSProperties}>{block.rows.flatMap((row, rowIndex) => row.map((cell, cellIndex) => <span key={`${rowIndex}-${cellIndex}`} className={rowIndex === 0 ? 'is-header' : ''}>{cell || '\u00a0'}</span>))}</span> : <span key={`${block.kind}-${index}`} className={`reviewer-preview-line reviewer-preview-line--${block.kind}${block.checked ? ' is-checked' : ''}`}>{block.text}</span>) : <span className="reviewer-preview-line reviewer-preview-line--empty">This reviewer is ready for your notes.</span>}</span></button>
      }) : <div className="reviewer-empty-list"><strong>{reviewers.length ? 'No reviewers found' : 'Create your first reviewer'}</strong><p>{reviewers.length ? 'Try a different search term or choose another subject.' : 'Start with a blank page, or create a draft from notebook photos or a PDF.'}</p>{!reviewers.length && <div className="reviewer-empty-actions"><button type="button" className="button-primary" onClick={() => navigate({ new: 'manual' })}>Start blank</button><button type="button" className="study-secondary" disabled={aiAvailability !== 'ready'} onClick={() => setShowAiGenerator(true)}>Generate Reviewer</button></div>}</div>}</div>}
    </section>
    <dialog ref={createRef} className="study-dialog study-create-dialog" onCancel={event => { event.preventDefault(); navigate({ new: null }) }}><form onSubmit={createReviewer} className="study-dialog-shell"><header><div><p className="workspace-overline">NEW REVIEWER</p><h2>Start with a blank page</h2><p>Give it a clear title. You can change the subject anytime.</p></div><button type="button" className="study-dialog-close" onClick={() => navigate({ new: null })}><CloseIcon /></button></header><div className="study-form-grid"><label className="study-field study-field--wide"><span>Title <small>{newTitle.length}/160</small></span><input autoFocus required maxLength={160} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Example: Midterm reviewer" /></label><div className="study-field study-field--wide"><span>Subject</span><CaliSelect ariaLabel="New reviewer subject" className="cali-select--form" value={newSubject} options={subjectOptions} onChange={setNewSubject} /></div></div><footer><button type="button" className="study-secondary" onClick={() => navigate({ new: null })}>Cancel</button><button type="submit" className="button-primary" disabled={creating || !newTitle.trim()}>{creating ? 'Creating…' : 'Create reviewer'}</button></footer></form></dialog>
    {showAiGenerator && <AiReviewerDialog userId={studentId} subjects={subjects} initialDraft={resumableAiDraft} onClose={() => { setShowAiGenerator(false); void load() }} onSaved={reviewer => { setReviewers(current => [reviewer, ...current]); setShowAiGenerator(false); setResumableAiDraft(null); navigate({ reviewer: reviewer.id, edit: '1', new: null }); setNotice({ kind: 'success', text: 'AI reviewer saved.' }) }} />}
  </section>
}

export function StudyPage({ studentId }: { studentId: string }) {
  const [params] = useSearchParams()
  const tool = params.get('tool')
  if (tool === 'flashcards' || tool === 'quizzes') return <StudySetsPage studentId={studentId} tool={tool} />
  return <ReviewersStudyPage studentId={studentId} />
}
