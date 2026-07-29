// @refresh reset
import {
  Add,
  AlarmClock,
  ChevronDown,
  Copy,
  Bookmark,
  Check,
  Code,
  ExternalDrive,
  File,
  Globe,
  GridCirclePlus,
  Image,
  Link,
  Minus,
  Refresh,
  RowHorizontal,
  RowVertical,
  Search,
  Send,
  TextBold,
  TextItalic,
  TextUnderline,
  TextX,
  TextalignCenter,
  TextalignJustifycenter,
  TextalignLeft,
  TextalignRight,
  Trash,
  Upload,
  Video,
} from 'reicon-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  createEditor,
  Editor,
  Element as SlateElement,
  Node,
  Path,
  Range,
  Text as SlateText,
  Transforms,
  type BaseEditor,
  type BaseRange,
  type Descendant,
} from 'slate'
import { HistoryEditor, withHistory } from 'slate-history'
import {
  Editable,
  ReactEditor,
  Slate,
  useFocused,
  useSelected,
  useSlateStatic,
  withReact,
  type RenderElementProps,
  type RenderLeafProps,
} from 'slate-react'
import { createPortal } from 'react-dom'
import FloatingSelect from './FloatingSelect'
import { htmlToMarkdown } from './htmlToMarkdown'
import { translate as t, useI18n } from './i18n'
import {
  blockLabel,
  createBlockForCommand,
  createElementId,
  createLink,
  createParagraph,
  createReminder,
  ensureTaskBlockIds,
  isElement,
  isTextBlock,
  isVoidBlock,
  normalizeColumnWidths,
  parseMarkdown,
  serializeMarkdown,
  slashCommands,
  splitDocumentFile,
  type BookmarkElement,
  type ButtonElement,
  type CalloutElement,
  type CalloutTone,
  type ColumnElement,
  type ColumnsElement,
  type EquationElement,
  type ImageElement,
  type LinkElement,
  type MediaElement,
  type NoteElement,
  type NoteText,
  type RawElement,
  type ReminderElement,
  type SlashCommand,
  type SlashCommandGroup,
  type SlashCommandId,
  type TableCellElement,
  type TableElement,
  type TableRowElement,
  type TaskElement,
  type TextAlignment,
} from './markdownBlocks'
import { loadSettings } from './settings'

const EquationPreview = lazy(() => import('./EquationPreview'))

type NoteEditor = BaseEditor & ReactEditor & HistoryEditor
type DocumentSaveState = 'saved' | 'saving' | 'conflict' | 'error'
type DocumentConflict = { content: string | null; revision: string | null }
type DocumentSaveSnapshot = {
  content: string
  revision: number
  tags: string[]
  title: string
}
type StoreAssetFile = (file: globalThis.File) => Promise<string>
type ResolveAssetURL = (url: string) => Promise<string>
type OpenStoredAsset = (url: string, name: string) => void
export type PublishParagraphPayload = {
  id: string
  markdown: string
  preview: string
}
export type DocumentTaskSnapshot = {
  id: string
  title: string
  checked: boolean
  due: string
}

const collectDocumentTasks = (nodes: readonly Descendant[]) => {
  const tasks: DocumentTaskSnapshot[] = []
  const visit = (node: Descendant) => {
    if (!SlateElement.isElement(node)) return
    if (node.type === 'task') {
      tasks.push({
        id: node.id,
        title: node.title,
        checked: node.checked,
        due: node.due,
      })
    }
    node.children.forEach((child) => {
      if (SlateElement.isElement(child)) visit(child)
    })
  }
  nodes.forEach(visit)
  return tasks
}

const useRuntimeSettings = () => {
  const [settings, setSettings] = useState(loadSettings)
  useEffect(() => {
    const refresh = () => setSettings(loadSettings())
    window.addEventListener('note-down:settings-changed', refresh)
    return () => window.removeEventListener('note-down:settings-changed', refresh)
  }, [])
  return settings
}

const emitSaveState = (state: DocumentSaveState) => {
  window.dispatchEvent(new CustomEvent('note-down:save-state', { detail: state }))
}

const frontMatterTags = (frontMatter: string) => {
  const lines = frontMatter.split('\n').slice(1, -1)
  const index = lines.findIndex((line) => /^tags?\s*:/i.test(line))
  if (index < 0) return []
  const inline = lines[index].replace(/^tags?\s*:/i, '').trim()
  const values = inline
    ? inline.replace(/^\[|\]$/g, '').split(',')
    : lines.slice(index + 1).map((line) => line.match(/^\s+-\s+(.+)$/)?.[1]).filter(Boolean)
  return [...new Set(
    values
      .map((value) => String(value).trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
  )]
}

const updateFrontMatterTags = (frontMatter: string, tags: string[]) => {
  const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  if (!frontMatter && normalizedTags.length === 0) return ''
  const source = frontMatter ? frontMatter.split('\n').slice(1, -1) : []
  const lines: string[] = []
  for (let index = 0; index < source.length; index += 1) {
    if (!/^tags?\s*:/i.test(source[index])) {
      lines.push(source[index])
      continue
    }
    while (index + 1 < source.length && /^\s+-\s+/.test(source[index + 1])) index += 1
  }
  if (normalizedTags.length > 0) {
    lines.push(`tags: [${normalizedTags.map((tag) => JSON.stringify(tag)).join(', ')}]`)
  }
  if (lines.length === 0) return ''
  return ['---', ...lines, '---'].join('\n')
}

const normalizeUrl = (value: string) => {
  const url = value.trim()
  if (!url || /^(https?:|mailto:|data:|file:)/i.test(url)) return url
  return `https://${url}`
}

const openExternal = (url: string) => {
  const target = normalizeUrl(url)
  if (!target) return
  if (window.noteDown?.openExternal) {
    void window.noteDown.openExternal(target)
    return
  }
  window.open(target, '_blank', 'noopener,noreferrer')
}

function EditableTitle({
  value,
  editorId,
  spellCheck,
  onChange,
}: {
  value: string
  editorId: string
  spellCheck: boolean
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const isComposingRef = useRef(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || document.activeElement === element || element.textContent === value) return
    element.textContent = value
  }, [value])

  const insertText = (text: string) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  return (
    <h1
      className={`document-title-editor${value ? ' non-empty' : ''}`}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={spellCheck}
      role="textbox"
      aria-label={t('标题')}
      data-placeholder={t('请输入标题')}
      onInput={(event) => onChange(event.currentTarget.textContent ?? '')}
      onCompositionStart={() => {
        isComposingRef.current = true
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false
        onChange(event.currentTarget.textContent ?? '')
      }}
      onPaste={(event) => {
        event.preventDefault()
        insertText(event.clipboardData.getData('text/plain').replace(/\n+/g, ' '))
        onChange(event.currentTarget.textContent ?? '')
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key === 'Process' || isComposingRef.current) {
          return
        }
        if (event.key !== 'Enter') return
        event.preventDefault()
        document.getElementById(editorId)?.focus()
      }}
    />
  )
}

const isVoidType = (element: NoteElement) =>
  [
    'divider',
    'equation',
    'image',
    'media',
    'bookmark',
    'task',
    'button',
    'reminder',
    'raw',
  ].includes(element.type)

const createTableCell = (header: boolean, text = ''): TableCellElement => ({
  id: createElementId(),
  type: 'table-cell',
  header,
  children: [createParagraph(text)],
})

const createTableRow = (width: number, header: boolean): TableRowElement => ({
  id: createElementId(),
  type: 'table-row',
  children: Array.from({ length: width }, () => createTableCell(header)),
})

const insertTableData = (editor: NoteEditor, text: string) => {
  if (!editor.selection || (!text.includes('\t') && !text.includes('\n'))) return false
  const cellEntry = Editor.above(editor, {
    match: (node) => SlateElement.isElement(node) && node.type === 'table-cell',
    mode: 'lowest',
  }) as [TableCellElement, number[]] | undefined
  const tableEntry = Editor.above(editor, {
    match: (node) => SlateElement.isElement(node) && node.type === 'table',
    mode: 'lowest',
  }) as [TableElement, number[]] | undefined
  if (!cellEntry || !tableEntry) return false

  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const values = lines.map((line) => line.split('\t'))
  if (values.length === 0) return false

  const nextTable = structuredClone(tableEntry[0])
  const tablePath = tableEntry[1]
  const rowIndex = cellEntry[1][tablePath.length]
  const columnIndex = cellEntry[1][tablePath.length + 1]
  const valueWidth = Math.max(...values.map((row) => row.length))
  const width = Math.max(nextTable.children[0]?.children.length ?? 1, columnIndex + valueWidth)

  while (nextTable.children.length < rowIndex + values.length) {
    nextTable.children.push(createTableRow(width, nextTable.children.length === 0))
  }
  nextTable.children.forEach((row, index) => {
    while (row.children.length < width) row.children.push(createTableCell(index === 0))
  })
  values.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      nextTable.children[rowIndex + rowOffset].children[columnIndex + columnOffset].children = [
        createParagraph(value),
      ]
    })
  })

  const targetPath = [
    ...tablePath,
    rowIndex + values.length - 1,
    columnIndex + values.at(-1)!.length - 1,
  ]
  HistoryEditor.withNewBatch(editor, () => {
    Editor.withoutNormalizing(editor, () => {
      Transforms.removeNodes(editor, { at: tablePath })
      Transforms.insertNodes(editor, nextTable, { at: tablePath })
      Transforms.select(editor, Editor.end(editor, targetPath))
    })
  })
  queueMicrotask(() => ReactEditor.focus(editor))
  return true
}

const composingEditors = new WeakSet<NoteEditor>()

const replaceClipboardElement = (source: Element, tagName: string) => {
  const replacement = document.createElement(tagName)
  for (const attribute of source.attributes) {
    replacement.setAttribute(attribute.name, attribute.value)
  }
  replacement.append(...source.childNodes)
  source.replaceWith(replacement)
  return replacement
}

const selectedHTML = () => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''

  const container = document.createElement('div')
  container.append(selection.getRangeAt(0).cloneContents())
  container.querySelectorAll(
    '.docx-block-gutter, .docx-nested-block-gutter, '
    + '.docx-inline-toolbar, .docx-command-menu, .docx-block-action-menu',
  ).forEach((element) => element.remove())
  container.querySelectorAll<HTMLElement>('.docx-inline-underline')
    .forEach((element) => {
      element.style.textDecoration = 'underline'
    })
  container.querySelectorAll<HTMLElement>('.docx-heading').forEach((element) => {
    const level = Math.max(1, Math.min(6, Number(element.dataset.level) || 1))
    replaceClipboardElement(element, `h${level}`)
  })
  container.querySelectorAll<HTMLElement>('.docx-text-line').forEach((element) => {
    replaceClipboardElement(element, 'p')
  })
  container.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name === 'class'
        || attribute.name === 'contenteditable'
        || attribute.name === 'spellcheck'
        || attribute.name.startsWith('data-slate-')
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return container.innerHTML
}

const copyRichText = (event: ReactClipboardEvent<HTMLDivElement>) => {
  const html = selectedHTML()
  if (html) event.clipboardData.setData('text/html', html)
}

const isStructuredClipboardText = (text: string) =>
  text.includes('\n') ||
  /^(#{1,9}\s|[-*>]\s|\d+\.\s|```|\$\$|!\[|\||:::)/.test(text.trimStart())

function withNoteDown(editor: NoteEditor) {
  const { insertBreak, insertData, insertText, isInline, isVoid, normalizeNode } = editor

  editor.isInline = (element) =>
    SlateElement.isElement(element) && ['link', 'reminder'].includes(element.type)
      ? true
      : isInline(element)

  editor.isVoid = (element) =>
    SlateElement.isElement(element) && isVoidType(element) ? true : isVoid(element)

  editor.insertBreak = () => {
    insertBreak()
    const entry = Editor.above(editor, {
      match: (node) => SlateElement.isElement(node) && Editor.isBlock(editor, node),
      mode: 'lowest',
    })
    if (entry) Transforms.setNodes(editor, { id: createElementId() }, { at: entry[1] })
  }

  editor.insertData = (data) => {
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n')
    if (insertTableData(editor, text)) return
    const html = data.getData('text/html')
    if (html) {
      const markdown = htmlToMarkdown(html)
      if (markdown) {
        Transforms.insertFragment(editor, parseMarkdown(markdown))
        return
      }
    }
    if (!isStructuredClipboardText(text)) {
      insertData(data)
      return
    }
    Transforms.insertFragment(editor, parseMarkdown(text))
  }

  editor.insertText = (text) => {
    const isComposing = composingEditors.has(editor)
    if (
      !isComposing &&
      (text === '`' || text === '｀') &&
      applyInlineCodeShortcut(editor, text)
    ) {
      return
    }
    if (
      !isComposing &&
      (text === ' ' || text === '\u3000') &&
      applySpaceShortcut(editor)
    ) {
      return
    }
    insertText(text)
    if (isComposing) return

    const lastCharacter = Array.from(text).at(-1)
    if (lastCharacter === '`' || lastCharacter === '｀') {
      applyInsertedInlineCodeShortcut(editor, lastCharacter)
    } else if (lastCharacter === ' ' || lastCharacter === '\u3000') {
      applySpaceShortcut(editor, true)
    }
  }

  editor.normalizeNode = (entry) => {
    const [node, path] = entry
    if (Editor.isEditor(node)) {
      const last = node.children.at(-1)
      if (!last) {
        Transforms.insertNodes(editor, createParagraph(), { at: [node.children.length] })
        return
      }
      if (isElement(last) && ['heading', 'table', 'columns', 'callout'].includes(last.type)) {
        Transforms.insertNodes(editor, createParagraph(), { at: [node.children.length] })
        return
      }
    }
    if (
      SlateElement.isElement(node) &&
      ['callout', 'column'].includes(node.type) &&
      node.children.length === 0
    ) {
      Transforms.insertNodes(editor, createParagraph(), { at: [...path, 0] })
      return
    }
    normalizeNode(entry)
  }

  return editor
}

const createStableEditor = () => withNoteDown(withHistory(withReact(createEditor())))

type CommandMenuState = {
  mode: 'slash' | 'manual'
  blockPath: number[]
  appliedCommandId?: SlashCommandId
  range?: BaseRange
  query: string
  left: number
  top: number
}

type InlineToolbarState = {
  range: BaseRange
  left: number
  top: number
  color?: string
  backgroundColor?: string
  canLink: boolean
  marks: Partial<Record<'bold' | 'italic' | 'underline' | 'strike' | 'code', boolean>>
}

type BlockActionMenuState = {
  path: number[]
  left: number
  top: number
  canPublish: boolean
}

type EditorColorOption = {
  id: string
  label: string
  value?: string
}

const textColorOptions: EditorColorOption[] = [
  { id: 'default', label: '默认' },
  { id: 'gray', label: '灰色', value: '#8F959E' },
  { id: 'red', label: '红色', value: '#D83931' },
  { id: 'orange', label: '橙色', value: '#DE7802' },
  { id: 'yellow', label: '黄色', value: '#DC9B04' },
  { id: 'green', label: '绿色', value: '#2EA121' },
  { id: 'blue', label: '蓝色', value: '#245BDB' },
  { id: 'purple', label: '紫色', value: '#6425D0' },
]

const textBackgroundColorOptions: EditorColorOption[] = [
  { id: 'default', label: '默认' },
  { id: 'gray-slight', label: '浅灰色', value: '#F2F3F5' },
  { id: 'red-light', label: '浅红色', value: '#FBBFBC' },
  { id: 'orange-light', label: '浅橙色', value: 'rgba(254, 212, 164, 0.8)' },
  { id: 'yellow-light', label: '浅黄色', value: 'rgba(255, 246, 122, 0.8)' },
  { id: 'green-light', label: '浅绿色', value: 'rgba(183, 237, 177, 0.8)' },
  { id: 'blue-light', label: '浅蓝色', value: 'rgba(186, 206, 253, 0.7)' },
  { id: 'purple-light', label: '浅紫色', value: 'rgba(205, 178, 250, 0.7)' },
  { id: 'gray-light', label: '灰色', value: 'rgba(222, 224, 227, 0.8)' },
  { id: 'gray-dark', label: '深灰色', value: '#BBBFC4' },
  { id: 'red-dark', label: '深红色', value: '#F76964' },
  { id: 'orange-dark', label: '深橙色', value: '#FFA53D' },
  { id: 'yellow-dark', label: '深黄色', value: '#FFE928' },
  { id: 'green-dark', label: '深绿色', value: '#62D256' },
  { id: 'blue-dark', label: '深蓝色', value: 'rgba(78, 131, 253, 0.55)' },
  { id: 'purple-dark', label: '深紫色', value: 'rgba(147, 90, 246, 0.55)' },
]

const isSameEditorColor = (current?: string, option?: string) =>
  current?.replaceAll(' ', '').toLocaleLowerCase() ===
  option?.replaceAll(' ', '').toLocaleLowerCase()

const commandGroupLabels: Record<SlashCommandGroup, string> = {
  text: '文本与结构',
  media: '媒体',
  business: '对象',
}

type CommandIconTone = 'neutral' | 'blue' | 'green' | 'orange' | 'purple' | 'cyan' | 'pink'

const commandIconTones: Record<SlashCommandId, CommandIconTone> = {
  paragraph: 'neutral',
  heading1: 'blue',
  heading2: 'blue',
  heading3: 'blue',
  heading4: 'blue',
  heading5: 'blue',
  heading6: 'blue',
  heading7: 'blue',
  heading8: 'blue',
  heading9: 'blue',
  bullet: 'blue',
  numbered: 'blue',
  todo: 'green',
  quote: 'neutral',
  callout: 'orange',
  code: 'purple',
  divider: 'neutral',
  table: 'cyan',
  columns: 'blue',
  equation: 'purple',
  link: 'blue',
  image: 'green',
  media: 'pink',
  bookmark: 'orange',
  task: 'green',
  reminder: 'orange',
  button: 'blue',
}

const commandMenuPageSize = 8
const commandMenuWidth = 320
const commandMenuMaxHeight = 360
const floatingInset = 12

const commandIdForElement = (element: NoteElement): SlashCommandId | undefined => {
  if (element.type === 'heading') return `heading${element.level}` as SlashCommandId
  if (slashCommands.some((command) => command.id === element.type)) {
    return element.type as SlashCommandId
  }
  return undefined
}

const getCommandMenuPosition = (rect: DOMRect) => {
  const width = Math.min(commandMenuWidth, window.innerWidth - floatingInset * 2)
  const height = Math.min(commandMenuMaxHeight, window.innerHeight - floatingInset * 2)
  const roomBelow = window.innerHeight - rect.bottom - floatingInset
  const roomAbove = rect.top - floatingInset
  const opensBelow = roomBelow >= Math.min(220, height) || roomBelow >= roomAbove
  const preferredTop = opensBelow ? rect.bottom + 7 : rect.top - height - 7

  return {
    left: Math.max(
      floatingInset,
      Math.min(window.innerWidth - width - floatingInset, rect.left),
    ),
    top: Math.max(
      floatingInset,
      Math.min(window.innerHeight - height - floatingInset, preferredTop),
    ),
  }
}

const tableCellCommands = new Set<SlashCommandId>([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'heading7',
  'heading8',
  'heading9',
  'bullet',
  'numbered',
  'todo',
  'quote',
  'code',
  'link',
  'reminder',
])

const commandAllowedAtPath = (
  editor: NoteEditor,
  path: number[],
  commandId: SlashCommandId,
) => {
  const ancestorTypes = new Set<NoteElement['type']>()
  for (let depth = 1; depth < path.length; depth += 1) {
    try {
      const ancestor = Node.get(editor, path.slice(0, depth))
      if (isElement(ancestor)) ancestorTypes.add(ancestor.type)
    } catch {
      return true
    }
  }

  if (ancestorTypes.has('table-cell')) return tableCellCommands.has(commandId)
  if (ancestorTypes.has('column') && commandId === 'columns') return false
  if (ancestorTypes.has('callout') && ['callout', 'columns'].includes(commandId)) return false
  return true
}

function CommandMenu({
  state,
  commands,
  activeIndex,
  onActiveIndexChange,
  onChoose,
}: {
  state: CommandMenuState
  commands: SlashCommand[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onChoose: (command: SlashCommand) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const pointerSelectionRef = useRef(false)
  const pointerPositionRef = useRef({ x: Number.NaN, y: Number.NaN })
  const groups = (['text', 'media', 'business'] as SlashCommandGroup[])
    .map((group) => ({
      group,
      commands: commands.filter((command) => command.group === group),
    }))
    .filter((item) => item.commands.length > 0)

  useEffect(() => {
    if (pointerSelectionRef.current) {
      pointerSelectionRef.current = false
      return
    }
    const menu = menuRef.current
    const activeItem = menu?.querySelector<HTMLElement>('.is-active')
    if (!menu || !activeItem) return

    const inset = 4
    const menuRect = menu.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    if (itemRect.top < menuRect.top + inset) {
      menu.scrollTop -= menuRect.top + inset - itemRect.top
    } else if (itemRect.bottom > menuRect.bottom - inset) {
      menu.scrollTop += itemRect.bottom - menuRect.bottom + inset
    }
  }, [activeIndex])

  return (
    <div
      className="docx-command-menu"
      role="menu"
      aria-label={t('插入或转换')}
      style={{ left: state.left, top: state.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={menuRef} className="docx-command-menu-scroll">
        {groups.map(({ group, commands: groupCommands }) => (
          <section key={group}>
            <span>{t(commandGroupLabels[group])}</span>
            {groupCommands.map((command) => {
              const index = commands.indexOf(command)
              const CommandIcon = command.icon
              const isActive = index === activeIndex
              const isApplied = command.id === state.appliedCommandId
              return (
                <button
                  className={[
                    isActive && 'is-active',
                    isApplied && 'is-applied',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  role="menuitem"
                  aria-current={isApplied ? 'true' : undefined}
                  key={command.id}
                  onPointerMove={(event) => {
                    const previous = pointerPositionRef.current
                    if (previous.x === event.clientX && previous.y === event.clientY) return
                    pointerPositionRef.current = { x: event.clientX, y: event.clientY }
                    if (index === activeIndex) return
                    pointerSelectionRef.current = true
                    onActiveIndexChange(index)
                  }}
                  onClick={() => onChoose(command)}
                >
                  <span className={`docx-command-icon is-${commandIconTones[command.id]}`}>
                    <CommandIcon size={17} strokeWidth={1.8} />
                  </span>
                  <strong>{t(command.label)}</strong>
                  <kbd>{t(command.hint)}</kbd>
                </button>
              )
            })}
          </section>
        ))}
        {commands.length === 0 && <small>{t('找不到相关组件')}</small>}
      </div>
    </div>
  )
}

function InlineToolbar({
  state,
  onMark,
  onLink,
  onPublish,
  onAlign,
  onColor,
}: {
  state: InlineToolbarState
  onMark: (
    mark: keyof Pick<NoteText, 'bold' | 'italic' | 'underline' | 'strike' | 'code'>,
  ) => void
  onLink: () => void
  onPublish?: () => void
  onAlign: (alignment: TextAlignment) => void
  onColor: (mark: 'color' | 'backgroundColor', value?: string) => void
}) {
  const [panel, setPanel] = useState<'align' | 'colors' | null>(null)
  const popoverOpensAbove = state.top > window.innerHeight - 190
  const actions = [
    { label: '粗体', icon: TextBold, mark: 'bold', action: () => onMark('bold') },
    { label: '斜体', icon: TextItalic, mark: 'italic', action: () => onMark('italic') },
    {
      label: '下划线',
      icon: TextUnderline,
      mark: 'underline',
      action: () => onMark('underline'),
    },
    { label: '删除线', icon: TextX, mark: 'strike', action: () => onMark('strike') },
    { label: '行内代码', icon: Code, mark: 'code', action: () => onMark('code') },
    { label: '链接', icon: Link, action: onLink, disabled: !state.canLink },
    ...(onPublish ? [{ label: '发布所选内容', icon: Send, action: onPublish }] : []),
  ] as const
  const alignments = [
    { value: 'left', label: '左对齐', icon: TextalignLeft },
    { value: 'center', label: '居中对齐', icon: TextalignCenter },
    { value: 'right', label: '右对齐', icon: TextalignRight },
    { value: 'justify', label: '两端对齐', icon: TextalignJustifycenter },
  ] as const
  return (
    <div
      className={`docx-inline-toolbar${popoverOpensAbove ? ' has-upward-popover' : ''}`}
      role="toolbar"
      aria-label={t('文字格式')}
      style={{ left: state.left, top: state.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map((action) => {
        const ActionIcon = action.icon
        const disabled = 'disabled' in action && action.disabled
        return (
          <button
            type="button"
            aria-label={t(action.label)}
            title={disabled ? t('链接仅支持单个段落') : t(action.label)}
            disabled={disabled}
            aria-pressed={'mark' in action ? Boolean(state.marks[action.mark]) : undefined}
            key={action.label}
            onClick={action.action}
          >
            <ActionIcon size={16} strokeWidth={2} />
          </button>
        )
      })}
      <span className="docx-inline-toolbar-divider" aria-hidden />
      <span className="docx-format-control">
        <button
          type="button"
          aria-label={t('对齐方式')}
          title={t('对齐方式')}
          aria-expanded={panel === 'align'}
          onClick={() => setPanel((current) => current === 'align' ? null : 'align')}
        >
          <TextalignLeft size={16} strokeWidth={2} />
        </button>
        {panel === 'align' && (
          <span
            className="docx-format-popover is-align"
            role="menu"
            aria-label={t('对齐方式')}
          >
            {alignments.map((alignment) => {
              const AlignmentIcon = alignment.icon
              return (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={t(alignment.label)}
                  title={t(alignment.label)}
                  key={alignment.value}
                  onClick={() => onAlign(alignment.value)}
                >
                  <AlignmentIcon size={16} strokeWidth={2} />
                </button>
              )
            })}
          </span>
        )}
      </span>
      <span className="docx-format-control">
        <button
          className="docx-color-menu-action"
          type="button"
          aria-label={t('文字颜色与背景色')}
          title={t('文字颜色与背景色')}
          aria-expanded={panel === 'colors'}
          style={
            {
              '--format-toolbar-color': state.color ?? 'var(--text)',
              '--format-toolbar-background': state.backgroundColor ?? 'transparent',
            } as CSSProperties
          }
          onClick={() => setPanel((current) => current === 'colors' ? null : 'colors')}
        >
          <span className="docx-color-menu-glyph" aria-hidden>A</span>
          <ChevronDown size={11} strokeWidth={2.2} aria-hidden />
        </button>
        {panel === 'colors' && (
          <span
            className="docx-format-popover is-color-menu"
            role="menu"
            aria-label={t('文字颜色与背景色')}
          >
            <span className="docx-color-menu-label">{t('字体颜色')}</span>
            <span className="docx-color-menu-grid">
              {textColorOptions.map((color) => (
                <button
                  className={[
                    'docx-color-swatch is-text',
                    isSameEditorColor(state.color, color.value) ||
                    (!state.color && color.id === 'default')
                      ? 'is-active'
                      : '',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  role="menuitem"
                  aria-label={color.value ? `${color.label}文字` : '默认文字颜色'}
                  title={color.value ? `${color.label}文字` : '默认文字颜色'}
                  key={color.id}
                  style={{ '--format-swatch': color.value ?? 'var(--text)' } as CSSProperties}
                  onClick={() => onColor('color', color.value)}
                >
                  <span aria-hidden>A</span>
                </button>
              ))}
            </span>
            <span className="docx-color-menu-label">{t('背景颜色')}</span>
            <span className="docx-color-menu-grid">
              {textBackgroundColorOptions.map((color) => (
                <button
                  className={[
                    'docx-color-swatch is-background',
                    color.value ? '' : 'is-reset',
                    isSameEditorColor(state.backgroundColor, color.value) ||
                    (!state.backgroundColor && !color.value)
                      ? 'is-active'
                      : '',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  role="menuitem"
                  aria-label={color.value ? `${color.label}背景` : '清除背景颜色'}
                  title={color.value ? `${color.label}背景` : '清除背景颜色'}
                  key={color.id}
                  style={{ '--format-swatch': color.value ?? 'var(--surface)' } as CSSProperties}
                  onClick={() => onColor('backgroundColor', color.value)}
                >
                  <span aria-hidden />
                </button>
              ))}
            </span>
          </span>
        )}
      </span>
    </div>
  )
}

function BlockActionMenu({
  state,
  onPublish,
  onDuplicate,
  onDelete,
}: {
  state: BlockActionMenuState
  onPublish?: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="docx-block-action-menu"
      role="toolbar"
      aria-label={t('块操作')}
      style={{ left: state.left, top: state.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {state.canPublish && onPublish && (
        <button
          type="button"
          aria-label={t('发布此段')}
          title={t('发布此段')}
          onClick={onPublish}
        >
          <Send size={14} strokeWidth={1.8} />
        </button>
      )}
      <button
        type="button"
        aria-label={t('创建副本')}
        title={t('创建副本')}
        onClick={onDuplicate}
      >
        <Copy size={14} />
      </button>
      <button type="button" aria-label={t('删除')} title={t('删除')} onClick={onDelete}>
        <Trash size={14} />
      </button>
    </div>
  )
}

const emojiGroups = [
  { label: '最近', values: ['💡', '❤️', '✅', '📌', '⚠️', '🚀', '🎯', '✨'] },
  {
    label: '表情符号',
    values: ['😀', '😄', '😊', '🙂', '😉', '😍', '🤔', '😮', '😢', '😤', '🥳', '🤯'],
  },
  {
    label: '动物',
    values: ['🐶', '🐱', '🐭', '🐼', '🦊', '🐻', '🐯', '🦁', '🐸', '🐵', '🦄', '🐝'],
  },
  {
    label: '食物',
    values: ['🍎', '🍊', '🍋', '🍉', '🍇', '🍓', '🥑', '🍞', '🍜', '🍣', '☕️', '🍰'],
  },
  {
    label: '活动',
    values: ['⚽️', '🏀', '🎾', '🏓', '🎨', '🎬', '🎸', '🎮', '🏆', '🎲', '🧩', '🎁'],
  },
  {
    label: '地点',
    values: ['🏠', '🏢', '🏫', '🏕️', '🏖️', '🗻', '✈️', '🚗', '🚲', '🚇', '🌍', '🗺️'],
  },
  {
    label: '物件',
    values: ['💻', '📱', '⌚️', '📷', '📚', '📝', '✏️', '🔍', '🔒', '🔑', '🧭', '⏰'],
  },
  {
    label: '符号',
    values: ['✅', '❌', '⚠️', '❓', '❗️', '➕', '➖', '➡️', '⬆️', '💬', '♻️', '🔔'],
  },
]

const calloutToneOptions: Array<{
  label: string
  value: CalloutTone
  color: string
}> = [
  { label: '默认', value: 'default', color: '#FFFFFF' },
  { label: '浅灰色', value: 'gray-light', color: '#EFF0F1' },
  { label: '红色', value: 'red', color: '#FDE2E2' },
  { label: '橙色', value: 'orange', color: '#FEEAD2' },
  { label: '黄色', value: 'yellow', color: '#FFFFCC' },
  { label: '绿色', value: 'green', color: '#D9F5D6' },
  { label: '蓝色', value: 'blue', color: '#E1EAFF' },
  { label: '紫色', value: 'purple', color: '#ECE2FE' },
  { label: '灰色', value: 'gray', color: '#DEE0E3' },
  { label: '深灰色', value: 'gray-dark', color: '#BBBFC4' },
  { label: '深红色', value: 'red-dark', color: '#FBBFBC' },
  { label: '深橙色', value: 'orange-dark', color: '#FED4A4' },
  { label: '深黄色', value: 'yellow-dark', color: '#FFFCA3' },
  { label: '深绿色', value: 'green-dark', color: '#B7EDB1' },
  { label: '深蓝色', value: 'blue-dark', color: '#BACEFD' },
  { label: '深紫色', value: 'purple-dark', color: '#CDB2FA' },
]

function EmojiPicker({
  value,
  tone,
  position,
  onChange,
  onToneChange,
  onClose,
}: {
  value: string
  tone: CalloutTone
  position: { left: number; top: number; width: number; maxHeight: number }
  onChange: (value: string) => void
  onToneChange: (tone: CalloutTone) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filteredGroups = emojiGroups
    .map((group) => ({
      ...group,
      values: query.trim()
        ? group.values.filter((emoji) => emoji.includes(query.trim()) || group.label.includes(query.trim()))
        : group.values,
    }))
    .filter((group) => group.values.length > 0)

  useEffect(() => {
    const close = () => onClose()
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [onClose])

  return (
    <div
      className="docx-emoji-picker"
      contentEditable={false}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="docx-emoji-search">
        <Search size={15} strokeWidth={1.8} aria-hidden />
        <input
          autoFocus
          value={query}
          placeholder={t('搜索表情')}
          aria-label={t('搜索表情')}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="docx-callout-tone-panel" aria-label="高亮块背景颜色">
        <span>{t('背景颜色')}</span>
        <div className="docx-callout-tones">
          {calloutToneOptions.map((item) => (
            <button
              className={[
                tone === item.value ? 'is-active' : '',
                item.value === 'default' ? 'is-reset' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              aria-label={`${item.label}高亮块`}
              title={item.label}
              key={item.value}
              style={{ '--format-swatch': item.color } as CSSProperties}
              onClick={() => onToneChange(item.value)}
            >
              <span aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <div className="docx-emoji-scroll">
        {filteredGroups.map((group) => (
          <section key={group.label}>
            <span>{group.label}</span>
            <div>
              {group.values.map((emoji, index) => (
                <button
                  className={emoji === value ? 'is-active' : ''}
                  type="button"
                  aria-label={emoji}
                  key={`${group.label}-${emoji}-${index}`}
                  onClick={() => {
                    onChange(emoji)
                    onClose()
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

const nodeSummary = (element: NoteElement) => {
  if (element.type === 'image') return element.caption || '图片'
  if (element.type === 'media') return element.name || '视频或文件'
  if (element.type === 'bookmark') return element.title || element.url || '网页卡片'
  if (element.type === 'task') return element.title || '任务'
  if (element.type === 'button') return element.label || '按钮'
  if (element.type === 'equation') return element.formula || '公式'
  if (element.type === 'raw') return element.source.split('\n', 1)[0] || '原始 Markdown'
  return Node.string(element).trim() || blockLabel(element)
}

const scrollEditorDuringDrag = (target: HTMLElement, clientY: number) => {
  const scroller = target.closest<HTMLElement>('.page-scroll')
  if (!scroller) return
  const bounds = scroller.getBoundingClientRect()
  const edge = 72
  const topDistance = clientY - bounds.top
  const bottomDistance = bounds.bottom - clientY
  if (topDistance < edge) scroller.scrollTop -= Math.ceil((edge - topDistance) / 3)
  else if (bottomDistance < edge) scroller.scrollTop += Math.ceil((edge - bottomDistance) / 3)
}

const codeLanguages = [
  ['', 'Plain text'],
  ['typescript', 'TypeScript'],
  ['javascript', 'JavaScript'],
  ['tsx', 'TSX'],
  ['json', 'JSON'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['go', 'Go'],
  ['python', 'Python'],
  ['bash', 'Shell'],
  ['sql', 'SQL'],
] as const

type BlockShellProps = {
  attributes: RenderElementProps['attributes']
  element: NoteElement
  children: ReactNode
  body: ReactNode
  className?: string
  selected: boolean
  focused: boolean
  onOpenMenu: (path: number[], rect: DOMRect) => void
  onOpenActions: (path: number[], rect: DOMRect) => void
  draggingPath: number[] | null
  onDraggingPathChange: (path: number[] | null) => void
  onMove: (source: number[], target: number[], edge: 'before' | 'after') => void
}

function BlockShell({
  attributes,
  element,
  body,
  className = '',
  selected,
  focused,
  onOpenMenu,
  onOpenActions,
  draggingPath,
  onDraggingPathChange,
  onMove,
}: BlockShellProps) {
  const editor = useSlateStatic()
  const path = ReactEditor.findPath(editor, element)
  const isTopLevel = path.length === 1
  const parent = isTopLevel ? null : Node.parent(editor, path)
  const isCalloutChild = isElement(parent) && parent.type === 'callout'
  const isDragging = draggingPath ? Path.equals(draggingPath, path) : false
  const canDrop = draggingPath
    ? !isDragging && Path.equals(Path.parent(draggingPath), Path.parent(path))
    : false
  const [dropEdge, setDropEdge] = useState<'before' | 'after' | null>(null)

  if (!isTopLevel && !isCalloutChild) {
    return (
      <div
        {...attributes}
        className={`docx-nested-block type-${element.type} ${className}`}
        data-block-id={element.id}
      >
        {body}
      </div>
    )
  }

  const gutter = (
    <div
      className={isTopLevel ? 'docx-block-gutter' : 'docx-nested-block-gutter'}
      contentEditable={false}
    >
      <button
        type="button"
        aria-label={t('在 {type} 附近插入组件', { type: t(blockLabel(element)) })}
        title={t('插入或转换')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          ReactEditor.focus(editor)
          try {
            Transforms.select(editor, Editor.end(editor, path))
          } catch {
            Transforms.select(editor, path)
          }
          onOpenMenu(path, event.currentTarget.getBoundingClientRect())
        }}
      >
        <Add size={14} />
      </button>
      <button
        className="docx-block-drag"
        type="button"
        draggable
        aria-label={t('拖动 {type}', { type: t(blockLabel(element)) })}
        title={t('拖动排序或更多')}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', path.join('.'))
          onDraggingPathChange([...path])
        }}
        onDragEnd={() => {
          onDraggingPathChange(null)
          setDropEdge(null)
        }}
        onClick={(event) => onOpenActions(path, event.currentTarget.getBoundingClientRect())}
      >
        <span aria-hidden />
      </button>
    </div>
  )

  return (
    <div
      {...attributes}
      className={[
        isTopLevel ? 'docx-block' : 'docx-nested-block docx-callout-child',
        `type-${element.type}`,
        className,
        selected && focused && 'is-active',
        isDragging && 'is-dragging',
        dropEdge && `is-drop-${dropEdge}`,
      ]
        .filter(Boolean)
        .join(' ')}
      data-block-id={element.id}
      data-block-type={element.type}
      data-minimap-anchor={isTopLevel ? element.id : undefined}
      data-minimap-label={isTopLevel ? nodeSummary(element).slice(0, 52) : undefined}
      onDragOver={(event) => {
        if (!isTopLevel) event.stopPropagation()
        if (draggingPath) scrollEditorDuringDrag(event.currentTarget, event.clientY)
        if (!canDrop) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setDropEdge(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(event) => {
        if (!isTopLevel) event.stopPropagation()
        event.preventDefault()
        if (draggingPath && dropEdge && canDrop) onMove(draggingPath, path, dropEdge)
        setDropEdge(null)
        onDraggingPathChange(null)
      }}
    >
      {gutter}
      {isTopLevel ? <div className="docx-block-content">{body}</div> : body}
    </div>
  )
}

function VoidChildren({ children }: { children: ReactNode }) {
  return <span className="docx-void-caret">{children}</span>
}

const updateElement = (editor: NoteEditor, element: NoteElement, patch: Partial<NoteElement>) => {
  Transforms.setNodes(editor, patch, { at: ReactEditor.findPath(editor, element) })
}

function CalloutBlock({ element, children }: { element: CalloutElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPosition, setPickerPosition] = useState({
    left: 12,
    top: 12,
    width: 318,
    maxHeight: 360,
  })

  useEffect(() => {
    if (!pickerOpen) return
    const closeOnScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.docx-emoji-scroll')) return
      setPickerOpen(false)
    }
    const closeOnResize = () => setPickerOpen(false)
    document.addEventListener('wheel', closeOnScroll, true)
    window.addEventListener('resize', closeOnResize)
    return () => {
      document.removeEventListener('wheel', closeOnScroll, true)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [pickerOpen])

  const togglePicker = (trigger: HTMLElement) => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    const callout = trigger.closest<HTMLElement>('.docx-callout')
    let rect = (callout ?? trigger).getBoundingClientRect()
    const width = Math.min(332, window.innerWidth - 24)
    if (window.innerHeight - rect.bottom < 172 && callout) {
      callout.scrollIntoView({ block: 'start' })
      rect = callout.getBoundingClientRect()
    }
    const top = rect.bottom + 7
    const maxHeight = Math.min(360, Math.max(160, window.innerHeight - top - 12))
    setPickerPosition({
      left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)),
      top,
      width,
      maxHeight,
    })
    setPickerOpen(true)
  }

  return (
    <div className={`docx-callout is-${element.tone}`}>
      <div className="docx-callout-emoji" contentEditable={false}>
        <button
          type="button"
          aria-label="选择高亮块图标"
          aria-expanded={pickerOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            togglePicker(event.currentTarget)
          }}
        >
          <span className="docx-callout-emoji-glyph" aria-hidden="true">
            {element.emoji}
          </span>
        </button>
        {pickerOpen && (
          createPortal(
            <EmojiPicker
              value={element.emoji}
              tone={element.tone}
              position={pickerPosition}
              onChange={(emoji) => updateElement(editor, element, { emoji })}
              onToneChange={(tone) => updateElement(editor, element, { tone })}
              onClose={() => setPickerOpen(false)}
            />,
            document.body,
          )
        )}
      </div>
      <div className="docx-callout-children">{children}</div>
    </div>
  )
}

const makeCell = (header = false): TableCellElement => ({
  id: createElementId(),
  type: 'table-cell',
  header,
  children: [createParagraph()],
})

const makeRow = (width: number, header = false): TableRowElement => ({
  id: createElementId(),
  type: 'table-row',
  children: Array.from({ length: width }, () => makeCell(header)),
})

function TableBlock({ element, children }: { element: TableElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const path = ReactEditor.findPath(editor, element)
  const width = element.children[0]?.children.length ?? 2
  return (
    <div className="docx-table-wrap">
      <table>
        <tbody>{children}</tbody>
      </table>
      <div className="docx-table-actions" contentEditable={false}>
        <button
          type="button"
          aria-label="增加一行"
          title="增加一行"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            Transforms.insertNodes(editor, makeRow(width), {
              at: [...path, element.children.length],
            })
          }}
        >
          <GridCirclePlus size={15} />
        </button>
        <button
          type="button"
          aria-label="增加一列"
          title="增加一列"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            Editor.withoutNormalizing(editor, () => {
              element.children.forEach((row, rowIndex) => {
                Transforms.insertNodes(editor, makeCell(rowIndex === 0), {
                  at: [...path, rowIndex, row.children.length],
                })
              })
            })
          }}
        >
          <Add size={15} />
        </button>
      </div>
    </div>
  )
}

function ColumnsBlock({ element, children }: { element: ColumnsElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const path = ReactEditor.findPath(editor, element)
  const containerRef = useRef<HTMLDivElement>(null)
  const [draftWidths, setDraftWidths] = useState(() =>
    normalizeColumnWidths(element.children.length, element.widths),
  )
  const draftWidthsRef = useRef(draftWidths)
  const resizingRef = useRef(false)

  useEffect(() => {
    draftWidthsRef.current = draftWidths
  }, [draftWidths])

  useEffect(() => {
    if (!resizingRef.current) {
      setDraftWidths(normalizeColumnWidths(element.children.length, element.widths))
    }
  }, [element.children.length, element.widths])

  const resizeColumn = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const container = containerRef.current
    if (!container) return
    event.preventDefault()
    event.stopPropagation()
    const rect = container.getBoundingClientRect()
    const startX = event.clientX
    const startWidths = draftWidthsRef.current
    const combinedWidth = startWidths[index] + startWidths[index + 1]
    const minimumWidth = 14
    resizingRef.current = true

    const handleMove = (pointerEvent: PointerEvent) => {
      const delta = ((pointerEvent.clientX - startX) / rect.width) * 100
      const leftWidth = Math.max(
        minimumWidth,
        Math.min(combinedWidth - minimumWidth, startWidths[index] + delta),
      )
      const nextWidths = [...startWidths]
      nextWidths[index] = leftWidth
      nextWidths[index + 1] = combinedWidth - leftWidth
      setDraftWidths(nextWidths)
      draftWidthsRef.current = nextWidths
    }

    const handleEnd = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleEnd)
      resizingRef.current = false
      updateElement(editor, element, {
        widths: normalizeColumnWidths(element.children.length, draftWidthsRef.current),
      })
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleEnd)
  }

  const addColumn = () => {
    if (element.children.length >= 4) return
    const column: ColumnElement = {
      id: createElementId(),
      type: 'column',
      children: [createParagraph()],
    }
    const widths = normalizeColumnWidths(element.children.length + 1)
    Editor.withoutNormalizing(editor, () => {
      Transforms.insertNodes(editor, column, { at: [...path, element.children.length] })
      Transforms.setNodes(editor, { widths }, { at: path })
    })
  }

  const removeColumn = () => {
    if (element.children.length <= 2) return
    const nextCount = element.children.length - 1
    const widths = normalizeColumnWidths(nextCount, draftWidthsRef.current.slice(0, -1))
    const nextColumns = structuredClone(element)
    const removed = nextColumns.children.pop()!
    const previous = nextColumns.children.at(-1)!
    const isEmptyColumn = (column: ColumnElement) =>
      column.children.length === 1 &&
      column.children[0].type === 'paragraph' &&
      Node.string(column.children[0]) === ''

    if (!isEmptyColumn(removed)) {
      previous.children = isEmptyColumn(previous)
        ? removed.children
        : [...previous.children, ...removed.children]
    }
    nextColumns.widths = widths
    HistoryEditor.withNewBatch(editor, () => {
      Editor.withoutNormalizing(editor, () => {
        Transforms.removeNodes(editor, { at: path })
        Transforms.insertNodes(editor, nextColumns, { at: path })
      })
    })
    const targetPath = [...path, nextCount - 1, previous.children.length - 1]
    focusElementStart(editor, targetPath, Node.get(editor, targetPath) as NoteElement)
  }

  return (
    <div className="docx-columns-wrap">
      <div
        ref={containerRef}
        className="docx-columns"
        style={{
          gridTemplateColumns: draftWidths.map((width) => `minmax(0, ${width}fr)`).join(' '),
        }}
      >
        {children}
        {draftWidths.slice(0, -1).map((_width, index) => {
          const offset = draftWidths.slice(0, index + 1).reduce((sum, width) => sum + width, 0)
          return (
            <button
              className="docx-column-resizer"
              type="button"
              aria-label={`调整第 ${index + 1} 栏宽度`}
              title="拖动调整栏宽"
              contentEditable={false}
              key={index}
              style={{ left: `${offset}%` }}
              onPointerDown={(event) => resizeColumn(index, event)}
            >
              <span />
            </button>
          )
        })}
      </div>
      <div className="docx-columns-actions" contentEditable={false}>
        <button
          className="docx-columns-add"
          type="button"
          aria-label="减少一栏"
          title="减少一栏"
          disabled={element.children.length <= 2}
          onMouseDown={(event) => event.preventDefault()}
          onClick={removeColumn}
        >
          <Minus size={14} />
        </button>
        <button
          className="docx-columns-add"
          type="button"
          aria-label="增加一栏"
          title="增加一栏"
          disabled={element.children.length >= 4}
          onMouseDown={(event) => event.preventDefault()}
          onClick={addColumn}
        >
          <Add size={14} />
        </button>
      </div>
    </div>
  )
}

const focusBlockAfterElement = (editor: NoteEditor, element: NoteElement) => {
  const path = ReactEditor.findPath(editor, element)
  const nextPath = Path.next(path)
  let nextElement: NoteElement
  try {
    nextElement = Node.get(editor, nextPath) as NoteElement
  } catch {
    nextElement = createParagraph()
    Transforms.insertNodes(editor, nextElement, { at: nextPath })
  }
  focusElementStart(editor, nextPath, nextElement)
}

const exitInlineControlOnEnter = (
  editor: NoteEditor,
  element: NoteElement,
  event: KeyboardEvent<HTMLInputElement>,
) => {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return false
  const point = Editor.after(editor, ReactEditor.findPath(editor, element))
  if (!point) return false
  event.preventDefault()
  event.stopPropagation()
  Transforms.select(editor, point)
  ReactEditor.focus(editor)
  return true
}

const exitSingleLineControlOnEnter = (
  editor: NoteEditor,
  element: NoteElement,
  event: KeyboardEvent<HTMLElement>,
) => {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    !(event.target instanceof HTMLInputElement) ||
    event.target.type === 'file'
  ) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  focusBlockAfterElement(editor, element)
}

function EquationBlock({ element, children }: { element: EquationElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const selected = useSelected()
  return (
    <div className={`docx-equation${selected ? ' is-selected' : ''}`} contentEditable={false}>
      <Suspense fallback={<div className="docx-equation-preview" aria-hidden="true" />}>
        <EquationPreview formula={element.formula} />
      </Suspense>
      <input
        value={element.formula}
        aria-label="LaTeX 公式"
        placeholder="输入 LaTeX"
        spellCheck={false}
        onChange={(event) => updateElement(editor, element, { formula: event.currentTarget.value })}
        onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
      />
      <VoidChildren>{children}</VoidChildren>
    </div>
  )
}

function RawBlock({ element, children }: { element: RawElement; children: ReactNode }) {
  const editor = useSlateStatic()
  return (
    <div className="docx-raw-block" contentEditable={false}>
      <textarea
        value={element.source}
        aria-label="原始 Markdown"
        spellCheck={false}
        rows={Math.max(2, element.source.split('\n').length)}
        onChange={(event) => updateElement(editor, element, { source: event.currentTarget.value })}
      />
      <VoidChildren>{children}</VoidChildren>
    </div>
  )
}

const readLocalFile = (file: globalThis.File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const useAssetSource = (url: string, resolveAssetURL: ResolveAssetURL) => {
  const [state, setState] = useState<{ source: string; failed: boolean }>({
    source: '',
    failed: false,
  })
  useEffect(() => {
    let active = true
    if (!url) {
      setState({ source: '', failed: false })
      return () => {
        active = false
      }
    }
    setState({ source: '', failed: false })
    void resolveAssetURL(url).then(
      (source) => {
        if (active) setState({ source, failed: !source })
      },
      () => {
        if (active) setState({ source: '', failed: true })
      },
    )
    return () => {
      active = false
    }
  }, [resolveAssetURL, url])
  return [state, setState] as const
}

function MissingAsset({ onChoose }: { onChoose: () => void }) {
  return (
    <button className="docx-asset-missing" type="button" onClick={onChoose}>
      <File size={20} />
      <span>附件不可用</span>
      <small>重新选择文件</small>
    </button>
  )
}

function ImageBlock({
  element,
  children,
  storeAssetFile,
  resolveAssetURL,
}: {
  element: ImageElement
  children: ReactNode
  storeAssetFile: StoreAssetFile
  resolveAssetURL: ResolveAssetURL
}) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const fileRef = useRef<HTMLInputElement>(null)
  const [asset, setAsset] = useAssetSource(element.url, resolveAssetURL)
  const chooseFile = () => fileRef.current?.click()
  return (
    <figure
      className={`docx-asset docx-image${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      {element.url && asset.source && !asset.failed ? (
        <img
          src={asset.source}
          alt={element.caption}
          onError={() => setAsset((current) => ({ ...current, failed: true }))}
        />
      ) : asset.failed ? (
        <MissingAsset onChoose={chooseFile} />
      ) : (
        <button className="docx-asset-empty" type="button" onClick={chooseFile}>
          <Image size={22} />
          <span>上传图片或粘贴地址</span>
        </button>
      )}
      <div className="docx-asset-controls">
        <input
          value={element.url}
          aria-label="图片地址"
          placeholder="https://…"
          spellCheck={false}
          onChange={(event) => updateElement(editor, element, { url: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
        />
        <button type="button" aria-label="选择图片" title="选择图片" onClick={chooseFile}>
          <Upload size={15} />
        </button>
        {element.url && (
          <button
            type="button"
            aria-label="移除图片"
            title="移除图片"
            onClick={() => updateElement(editor, element, { url: '' })}
          >
            <Trash size={14} />
          </button>
        )}
      </div>
      <input
        className="docx-asset-caption"
        value={element.caption}
        aria-label="图片说明"
        placeholder="添加说明"
        onChange={(event) => updateElement(editor, element, { caption: event.currentTarget.value })}
        onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
      />
      <input
        ref={fileRef}
        className="docx-hidden-file"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const input = event.currentTarget
          const file = input.files?.[0]
          if (!file) return
          void storeAssetFile(file)
            .then((url) =>
              updateElement(editor, element, { url, caption: element.caption || file.name }),
            )
            .catch(() => setAsset({ source: '', failed: true }))
            .finally(() => {
              input.value = ''
            })
        }}
      />
      <VoidChildren>{children}</VoidChildren>
    </figure>
  )
}

function MediaBlock({
  element,
  children,
  storeAssetFile,
  resolveAssetURL,
  openStoredAsset,
}: {
  element: MediaElement
  children: ReactNode
  storeAssetFile: StoreAssetFile
  resolveAssetURL: ResolveAssetURL
  openStoredAsset: OpenStoredAsset
}) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const fileRef = useRef<HTMLInputElement>(null)
  const [asset, setAsset] = useAssetSource(element.url, resolveAssetURL)
  const chooseFile = () => fileRef.current?.click()
  return (
    <figure
      className={`docx-asset docx-media${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      {element.url && element.mediaKind === 'video' && asset.source && !asset.failed ? (
        <video
          src={asset.source}
          controls
          preload="metadata"
          onError={() => setAsset((current) => ({ ...current, failed: true }))}
        />
      ) : element.url && element.mediaKind === 'file' && !asset.failed ? (
        <button
          className="docx-file-card"
          type="button"
          disabled={!asset.source}
          onClick={() => openStoredAsset(element.url, element.name)}
        >
          <File size={22} />
          <span>{element.name || '打开文件'}</span>
          <ExternalDrive size={15} />
        </button>
      ) : asset.failed ? (
        <MissingAsset onChoose={chooseFile} />
      ) : (
        <button className="docx-asset-empty" type="button" onClick={chooseFile}>
          <Video size={22} />
          <span>上传视频或文件</span>
        </button>
      )}
      <div className="docx-asset-controls">
        <FloatingSelect
          value={element.mediaKind}
          label="媒体类型"
          minMenuWidth={112}
          options={[
            { value: 'video', label: '视频' },
            { value: 'file', label: '文件' },
          ]}
          onChange={(value) =>
            updateElement(editor, element, {
              mediaKind: value as MediaElement['mediaKind'],
            })
          }
        />
        <input
          value={element.url}
          aria-label="视频或文件地址"
          placeholder="https://…"
          spellCheck={false}
          onChange={(event) => updateElement(editor, element, { url: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
        />
        <button type="button" aria-label="选择文件" title="选择文件" onClick={chooseFile}>
          <Upload size={15} />
        </button>
        {element.url && (
          <button
            type="button"
            aria-label="移除视频或文件"
            title="移除视频或文件"
            onClick={() => updateElement(editor, element, { url: '', name: '' })}
          >
            <Trash size={14} />
          </button>
        )}
      </div>
      <input
        className="docx-asset-caption"
        value={element.name}
        aria-label="文件名称"
        placeholder="文件名称"
        onChange={(event) => updateElement(editor, element, { name: event.currentTarget.value })}
        onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
      />
      <input
        ref={fileRef}
        className="docx-hidden-file"
        type="file"
        onChange={(event) => {
          const input = event.currentTarget
          const file = input.files?.[0]
          if (!file) return
          void storeAssetFile(file)
            .then((url) =>
              updateElement(editor, element, {
                url,
                name: file.name,
                mediaKind: file.type.startsWith('video/') ? 'video' : 'file',
              }),
            )
            .catch(() => setAsset({ source: '', failed: true }))
            .finally(() => {
              input.value = ''
            })
        }}
      />
      <VoidChildren>{children}</VoidChildren>
    </figure>
  )
}

const getHostname = (url: string) => {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function BookmarkBlock({ element, children }: { element: BookmarkElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const host = getHostname(element.url)
  const [preview, setPreview] = useState({ icon: '', image: '', siteName: '' })
  const [metadataState, setMetadataState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const requestedURLRef = useRef('')

  const loadMetadata = useCallback(
    async (force = false) => {
      const requestURL = normalizeUrl(element.url)
      if (!host || !window.noteDown?.fetchLinkMetadata) return
      if (!force && requestedURLRef.current === requestURL) return
      requestedURLRef.current = requestURL
      setMetadataState('loading')
      const path = ReactEditor.findPath(editor, element)
      try {
        const metadata = await window.noteDown.fetchLinkMetadata(requestURL)
        if (requestedURLRef.current !== requestURL) return
        setPreview({ icon: metadata.icon, image: metadata.image, siteName: metadata.siteName })
        setMetadataState('ready')
        const current = Node.get(editor, path) as BookmarkElement
        if (normalizeUrl(current.url) !== requestURL) return
        const patch: Partial<BookmarkElement> = {}
        if (!current.title || current.title === getHostname(current.url)) {
          patch.title = metadata.title || metadata.siteName || host
        }
        if (!current.description) patch.description = metadata.description
        if (Object.keys(patch).length > 0) updateElement(editor, current, patch)
      } catch {
        if (requestedURLRef.current === requestURL) setMetadataState('error')
      }
    },
    [editor, element, host],
  )

  useEffect(() => {
    if (!host) {
      requestedURLRef.current = ''
      setPreview({ icon: '', image: '', siteName: '' })
      setMetadataState('idle')
      return
    }
    const timeout = window.setTimeout(() => void loadMetadata(), 650)
    return () => window.clearTimeout(timeout)
  }, [host, loadMetadata])

  return (
    <div
      className={`docx-bookmark is-${metadataState}${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      <button
        className="docx-bookmark-main"
        type="button"
        disabled={!element.url}
        onClick={() => openExternal(element.url)}
      >
        <span className="docx-bookmark-logo">
          {preview.icon ? <img src={preview.icon} alt="" /> : <Globe size={17} />}
        </span>
        <span>
          <strong>{element.title || host || '网页卡片'}</strong>
          <small>{element.description || preview.siteName || host || '粘贴网址生成预览'}</small>
        </span>
        {preview.image ? (
          <img className="docx-bookmark-preview" src={preview.image} alt="" />
        ) : (
          <ExternalDrive size={15} />
        )}
      </button>
      <div className="docx-bookmark-fields">
        <input
          value={element.title}
          aria-label="网页卡片标题"
          placeholder="标题"
          onChange={(event) => updateElement(editor, element, { title: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
        />
        <input
          value={element.url}
          aria-label="网页地址"
          placeholder="https://…"
          spellCheck={false}
          onChange={(event) => updateElement(editor, element, { url: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
          onBlur={() => {
            if (!element.title && host) updateElement(editor, element, { title: host })
            void loadMetadata()
          }}
        />
        <button
          className={metadataState === 'loading' ? 'is-loading' : ''}
          type="button"
          aria-label="刷新网页预览"
          title="刷新网页预览"
          disabled={!host || !window.noteDown?.fetchLinkMetadata}
          onClick={() => void loadMetadata(true)}
        >
          <Refresh size={14} />
        </button>
      </div>
      <VoidChildren>{children}</VoidChildren>
    </div>
  )
}

const siblingElement = (
  editor: NoteEditor,
  path: number[],
  direction: -1 | 1,
): [NoteElement, number[]] | null => {
  const parentPath = Path.parent(path)
  const parent = Node.get(editor, parentPath)
  if (!Editor.isEditor(parent) && !SlateElement.isElement(parent)) return null
  const targetIndex = path.at(-1)! + direction
  if (targetIndex < 0 || targetIndex >= parent.children.length) return null
  const targetPath = [...parentPath, targetIndex]
  const target = Node.get(editor, targetPath)
  return isElement(target) ? [target, targetPath] : null
}

const selectionIsAtVerticalEdge = (
  editor: NoteEditor,
  path: number[],
  direction: -1 | 1,
) => {
  if (!editor.selection) return false
  try {
    const caretRect = ReactEditor.toDOMRange(editor, editor.selection).getBoundingClientRect()
    const blockRects = Array.from(
      ReactEditor.toDOMRange(editor, Editor.range(editor, path)).getClientRects(),
    ).filter((rect) => rect.height > 0)
    if (caretRect.height > 0 && blockRects.length > 0) {
      const edge = direction < 0
        ? Math.min(...blockRects.map((rect) => rect.top))
        : Math.max(...blockRects.map((rect) => rect.bottom))
      return direction < 0 ? caretRect.top <= edge + 1 : caretRect.bottom >= edge - 1
    }
  } catch {
    // DOM 选区尚未同步时退回模型边界，避免误抢多行文本内部的上下键。
  }
  return direction < 0
    ? Editor.isStart(editor, editor.selection.anchor, path)
    : Editor.isEnd(editor, editor.selection.anchor, path)
}

function TaskBlock({ element, children }: { element: TaskElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const [title, setTitle] = useState(element.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    if (!isComposingRef.current) setTitle(element.title)
  }, [element.title])

  useLayoutEffect(() => {
    const input = titleRef.current
    if (input) {
      input.style.height = '0'
      input.style.height = `${input.scrollHeight}px`
    }
    const selection = pendingSelectionRef.current
    pendingSelectionRef.current = null
    if (!input || !selection || document.activeElement !== input) return
    input.setSelectionRange(selection.start, selection.end)
  }, [element.title, title])

  const changeTitle = (value: string) => {
    setTitle(value)
    if (isComposingRef.current) return
    const input = titleRef.current
    if (input && input.selectionStart !== null && input.selectionEnd !== null) {
      pendingSelectionRef.current = {
        start: input.selectionStart,
        end: input.selectionEnd,
      }
    }
    updateElement(editor, element, { title: value })
  }

  const insertFollowingTask = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.nativeEvent.isComposing
      || isComposingRef.current
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const value = event.currentTarget.value
    const start = event.currentTarget.selectionStart ?? value.length
    const end = event.currentTarget.selectionEnd ?? start
    const currentTitle = value.slice(0, start)
    const nextTask = createBlockForCommand('task', value.slice(end)) as TaskElement
    const path = ReactEditor.findPath(editor, element)
    const nextPath = Path.next(path)
    HistoryEditor.withNewBatch(editor, () => {
      setTitle(currentTitle)
      pendingSelectionRef.current = null
      updateElement(editor, element, { title: currentTitle })
      Transforms.insertNodes(editor, nextTask, { at: nextPath })
    })
    focusElementStart(editor, nextPath, nextTask)
  }

  const removeEmptyTask = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Backspace'
      || event.nativeEvent.isComposing
      || isComposingRef.current
      || event.currentTarget.value
      || event.currentTarget.selectionStart !== 0
      || event.currentTarget.selectionEnd !== 0
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const path = ReactEditor.findPath(editor, element)
    const parentPath = Path.parent(path)
    const previousPath = path.at(-1)! > 0 ? Path.previous(path) : null
    Transforms.removeNodes(editor, { at: path })
    const parent = Node.get(editor, parentPath)
    if (!Editor.isEditor(parent) && !SlateElement.isElement(parent)) return
    if (parent.children.length === 0) {
      const paragraph = createParagraph()
      const paragraphPath = [...parentPath, 0]
      Transforms.insertNodes(editor, paragraph, { at: paragraphPath })
      focusElementStart(editor, paragraphPath, paragraph)
      return
    }
    const targetPath = previousPath ?? [...parentPath, 0]
    const target = Node.get(editor, targetPath) as NoteElement
    focusElementEnd(editor, targetPath, target)
  }

  const moveBetweenBlocks = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !['ArrowUp', 'ArrowDown'].includes(event.key)
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || event.nativeEvent.isComposing
      || isComposingRef.current
    ) {
      return false
    }
    const input = event.currentTarget
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? start
    if (start !== end) return false

    const style = window.getComputedStyle(input)
    const contentHeight = input.scrollHeight
      - Number.parseFloat(style.paddingTop)
      - Number.parseFloat(style.paddingBottom)
    const singleVisualLine = contentHeight <= Number.parseFloat(style.lineHeight) + 1
    const atOuterBoundary = event.key === 'ArrowUp'
      ? start === 0
      : end === input.value.length
    if (!singleVisualLine && !atOuterBoundary) return false

    const path = ReactEditor.findPath(editor, element)
    const direction = event.key === 'ArrowUp' ? -1 : 1
    const sibling = siblingElement(editor, path, direction)
    if (!sibling) return false
    const [target, targetPath] = sibling

    event.preventDefault()
    event.stopPropagation()
    if (target.type !== 'task') {
      if (direction < 0) focusElementEnd(editor, targetPath, target)
      else focusElementStart(editor, targetPath, target)
      return true
    }

    const offset = Math.min(start, target.title.length)
    Transforms.select(editor, targetPath)
    queueMicrotask(() => {
      const control = document.querySelector<HTMLTextAreaElement>(
        `[data-block-id="${target.id}"] textarea[aria-label="任务标题"]`,
      )
      control?.focus()
      control?.setSelectionRange(offset, offset)
    })
    return true
  }

  return (
    <div
      className={`docx-task-card${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      <button
        className={`docx-task-toggle${element.checked ? ' is-checked' : ''}`}
        type="button"
        aria-label={element.checked ? '恢复任务' : '完成任务'}
        aria-pressed={element.checked}
        onClick={() => updateElement(editor, element, { checked: !element.checked })}
      >
        {element.checked && <Check size={12} />}
      </button>
      <div className="docx-task-content">
        <textarea
          ref={titleRef}
          className="docx-task-title"
          value={title}
          rows={1}
          aria-label="任务标题"
          placeholder="任务标题"
          onChange={(event) => changeTitle(event.currentTarget.value)}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false
            changeTitle(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (moveBetweenBlocks(event)) return
            insertFollowingTask(event)
            removeEmptyTask(event)
          }}
        />
        <div className="docx-task-flow">
          <span className="docx-task-title-mirror" aria-hidden>
            {title || '任务标题'}
          </span>
          <DateTimeInput
            className="is-task"
            value={element.due === '-' ? '' : element.due}
            label="截止时间"
            onChange={(due) => updateElement(editor, element, { due: due || '-' })}
            onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
          />
        </div>
      </div>
      <VoidChildren>{children}</VoidChildren>
    </div>
  )
}

function ButtonBlock({ element, children }: { element: ButtonElement; children: ReactNode }) {
  const editor = useSlateStatic()
  const selected = useSelected()
  return (
    <div
      className={`docx-button-block${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      <button className="docx-link-button" type="button" onClick={() => openExternal(element.url)}>
        <span>{element.label || '打开链接'}</span>
        <ExternalDrive size={14} />
      </button>
      <div className="docx-button-fields">
        <input
          value={element.label}
          aria-label="按钮文字"
          placeholder="按钮文字"
          onChange={(event) => updateElement(editor, element, { label: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
        />
        <input
          value={element.url}
          aria-label="按钮链接"
          placeholder="https://…"
          spellCheck={false}
          onChange={(event) => updateElement(editor, element, { url: event.currentTarget.value })}
          onKeyDown={(event) => exitSingleLineControlOnEnter(editor, element, event)}
        />
      </div>
      <VoidChildren>{children}</VoidChildren>
    </div>
  )
}

function LinkInline({ attributes, element, children }: RenderElementProps & { element: LinkElement }) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const focused = useFocused()
  const [editing, setEditing] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const anchorRef = useRef<HTMLAnchorElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const visible = selected && (focused || editing)
  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 280
    const height = 38
    const gap = 7
    const below = window.innerHeight - rect.bottom - 8
    const opensAbove = below < height + gap && rect.top > below
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)),
      top: Math.max(8, opensAbove ? rect.top - height - gap : rect.bottom + gap),
    })
  }, [])

  useLayoutEffect(() => {
    if (visible) updatePosition()
  }, [updatePosition, visible])

  useEffect(() => {
    if (!visible) return
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [updatePosition, visible])

  const closeWhenFocusLeaves = () => {
    window.setTimeout(() => {
      if (!popoverRef.current?.contains(document.activeElement)) setEditing(false)
    }, 0)
  }
  return (
    <span {...attributes} className="docx-link-inline" data-inline-id={element.id}>
      <a
        ref={anchorRef}
        href={normalizeUrl(element.url)}
        onMouseDown={() => setEditing(true)}
        onClick={(event) => {
          event.preventDefault()
          if (event.metaKey) openExternal(element.url)
        }}
      >
        {children}
      </a>
      {visible && createPortal(
        <span
          ref={popoverRef}
          className="docx-inline-editor"
          contentEditable={false}
          style={position}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Link size={13} />
          <input
            value={element.url}
            aria-label="链接地址"
            placeholder="https://…"
            onFocus={() => setEditing(true)}
            onBlur={closeWhenFocusLeaves}
            onChange={(event) => updateElement(editor, element, { url: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (exitInlineControlOnEnter(editor, element, event)) setEditing(false)
            }}
          />
          <button type="button" aria-label="打开链接" onClick={() => openExternal(element.url)}>
            <ExternalDrive size={13} />
          </button>
          <button
            type="button"
            aria-label="移除链接"
            title="移除链接"
            onClick={() =>
              Transforms.unwrapNodes(editor, { at: ReactEditor.findPath(editor, element) })
            }
          >
            <Trash size={13} />
          </button>
        </span>,
        document.body,
      )}
    </span>
  )
}

const formatReminder = (value: string) => {
  if (!value) return '选择日期'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const toLocalInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T')
}

function DateTimeInput({
  value,
  label,
  className = '',
  onChange,
  onKeyDown,
}: {
  value: string
  label: string
  className?: string
  onChange: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  const displayValue = value.replace('T', ' ')

  return (
    <span
      className={`docx-date-time-input ${className}`.trim()}
      contentEditable={false}
    >
      <AlarmClock size={14} strokeWidth={1.9} aria-hidden />
      <input
        type="text"
        value={displayValue}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD HH:mm"
        aria-label={label}
        title={label}
        onChange={(event) => onChange(event.currentTarget.value.replace(/\s+/, 'T'))}
        onKeyDown={onKeyDown}
      />
    </span>
  )
}

function ReminderInline({
  attributes,
  element,
  children,
}: RenderElementProps & { element: ReminderElement }) {
  const editor = useSlateStatic()
  return (
    <span
      {...attributes}
      className="docx-reminder-inline"
      contentEditable={false}
      data-inline-id={element.id}
    >
      <DateTimeInput
        className="is-inline"
        value={element.date}
        label="提醒时间"
        onChange={(date) => updateElement(editor, element, { date, label: formatReminder(date) })}
        onKeyDown={(event) => exitInlineControlOnEnter(editor, element, event)}
      />
      <VoidChildren>{children}</VoidChildren>
    </span>
  )
}

function TableCellBlock({
  attributes,
  element,
  children,
}: RenderElementProps & { element: TableCellElement }) {
  const editor = useSlateStatic()
  const path = ReactEditor.findPath(editor, element)
  const tablePath = path.slice(0, -2)
  const rowIndex = path.at(-2) ?? 0
  const columnIndex = path.at(-1) ?? 0
  const table = Node.get(editor, tablePath) as TableElement
  const rowCount = table.children.length
  const columnCount = table.children[0]?.children.length ?? 1
  const Cell = element.header ? 'th' : 'td'

  const addRow = () => {
    Transforms.insertNodes(editor, makeRow(columnCount), {
      at: [...tablePath, rowIndex + 1],
    })
  }

  const addColumn = () => {
    Editor.withoutNormalizing(editor, () => {
      table.children.forEach((_row, currentRow) => {
        Transforms.insertNodes(editor, makeCell(currentRow === 0), {
          at: [...tablePath, currentRow, columnIndex + 1],
        })
      })
    })
  }

  const removeRow = () => {
    if (rowCount <= 1) return
    Editor.withoutNormalizing(editor, () => {
      Transforms.removeNodes(editor, { at: [...tablePath, rowIndex] })
      if (rowIndex === 0) {
        const nextHeader = Node.get(editor, [...tablePath, 0]) as TableRowElement
        nextHeader.children.forEach((_cell, index) => {
          Transforms.setNodes(editor, { header: true }, { at: [...tablePath, 0, index] })
        })
      }
    })
  }

  const removeColumn = () => {
    if (columnCount <= 1) return
    Editor.withoutNormalizing(editor, () => {
      table.children.forEach((_row, currentRow) => {
        Transforms.removeNodes(editor, { at: [...tablePath, currentRow, columnIndex] })
      })
    })
  }

  return (
    <Cell {...attributes}>
      <div className="docx-table-cell-content">{children}</div>
      <div className="docx-table-cell-actions" contentEditable={false}>
        <button
          type="button"
          aria-label="在下方增加行"
          title="在下方增加行"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addRow}
        >
          <RowHorizontal size={13} />
          <Add size={9} />
        </button>
        <button
          type="button"
          aria-label="在右侧增加列"
          title="在右侧增加列"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addColumn}
        >
          <RowVertical size={13} />
          <Add size={9} />
        </button>
        <button
          type="button"
          aria-label="删除当前行"
          title="删除当前行"
          disabled={rowCount <= 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={removeRow}
        >
          <RowHorizontal size={13} />
          <Minus size={9} />
        </button>
        <button
          type="button"
          aria-label="删除当前列"
          title="删除当前列"
          disabled={columnCount <= 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={removeColumn}
        >
          <RowVertical size={13} />
          <Minus size={9} />
        </button>
      </div>
    </Cell>
  )
}

type NoteElementRendererProps = RenderElementProps & {
  element: NoteElement
  storeAssetFile: StoreAssetFile
  resolveAssetURL: ResolveAssetURL
  openStoredAsset: OpenStoredAsset
  onOpenMenu: (path: number[], rect: DOMRect) => void
  onOpenActions: (path: number[], rect: DOMRect) => void
  draggingPath: number[] | null
  onDraggingPathChange: (path: number[] | null) => void
  onMove: (source: number[], target: number[], edge: 'before' | 'after') => void
}

function NoteElementRenderer({
  attributes,
  children,
  element,
  storeAssetFile,
  resolveAssetURL,
  openStoredAsset,
  onOpenMenu,
  onOpenActions,
  draggingPath,
  onDraggingPathChange,
  onMove,
}: NoteElementRendererProps) {
  const editor = useSlateStatic()
  const selected = useSelected()
  const focused = useFocused()

  if (element.type === 'link') {
    return <LinkInline attributes={attributes} element={element} children={children} />
  }
  if (element.type === 'reminder') {
    return <ReminderInline attributes={attributes} element={element} children={children} />
  }
  if (element.type === 'table-row') return <tr {...attributes}>{children}</tr>
  if (element.type === 'table-cell') {
    return <TableCellBlock attributes={attributes} element={element} children={children} />
  }
  if (element.type === 'column') {
    return (
      <div {...attributes} className="docx-column">
        {children}
      </div>
    )
  }

  let body: ReactNode
  let className = ''
  const alignmentStyle = 'align' in element && element.align
    ? { textAlign: element.align } as CSSProperties
    : undefined
  if (element.type === 'paragraph') {
    body = <div className="docx-text-line" style={alignmentStyle}>{children}</div>
  }
  else if (element.type === 'heading') {
    body = (
      <div
        className="docx-heading"
        role="heading"
        aria-level={element.level}
        data-level={element.level}
        style={alignmentStyle}
      >
        {children}
      </div>
    )
    className = `heading-level-${element.level}`
  } else if (element.type === 'bullet' || element.type === 'numbered') {
    const path = ReactEditor.findPath(editor, element)
    let marker = '•'
    if (element.type === 'numbered' && path.length === 1) {
      let number = 1
      for (let cursor = path[0] - 1; cursor >= 0; cursor -= 1) {
        const sibling = editor.children[cursor]
        if (!isElement(sibling) || sibling.type !== 'numbered') break
        if (sibling.indent < element.indent) break
        if (sibling.indent === element.indent) number += 1
      }
      marker = `${number}.`
    }
    body = (
      <div
        className={`docx-list-line is-${element.type}`}
        style={{ '--docx-indent': element.indent } as CSSProperties}
      >
        <span contentEditable={false}>{marker}</span>
        <div style={alignmentStyle}>{children}</div>
      </div>
    )
  } else if (element.type === 'todo') {
    body = (
      <div
        className={`docx-todo-line${element.checked ? ' is-checked' : ''}`}
        style={{ '--docx-indent': element.indent } as CSSProperties}
      >
        <button
          type="button"
          contentEditable={false}
          aria-label={element.checked ? '恢复待办' : '完成待办'}
          aria-pressed={element.checked}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => updateElement(editor, element, { checked: !element.checked })}
        >
          {element.checked && <Check size={12} />}
        </button>
        <div style={alignmentStyle}>{children}</div>
      </div>
    )
  } else if (element.type === 'quote') {
    body = <blockquote style={alignmentStyle}>{children}</blockquote>
  }
  else if (element.type === 'code') {
    body = (
      <div className="docx-code-block">
        <FloatingSelect
          label="代码语言"
          value={element.language}
          minMenuWidth={126}
          options={[
            ...codeLanguages.map(([value, label]) => ({ value, label })),
            ...(element.language && !codeLanguages.some(([value]) => value === element.language)
              ? [{ value: element.language, label: element.language }]
              : []),
          ]}
          onChange={(value) =>
            updateElement(editor, element, { language: value })
          }
        />
        <pre><code>{children}</code></pre>
      </div>
    )
  } else if (element.type === 'callout') body = <CalloutBlock element={element}>{children}</CalloutBlock>
  else if (element.type === 'divider') {
    body = <div className="docx-divider" contentEditable={false}><hr /><VoidChildren>{children}</VoidChildren></div>
  } else if (element.type === 'table') body = <TableBlock element={element}>{children}</TableBlock>
  else if (element.type === 'columns') body = <ColumnsBlock element={element}>{children}</ColumnsBlock>
  else if (element.type === 'equation') body = <EquationBlock element={element}>{children}</EquationBlock>
  else if (element.type === 'raw') body = <RawBlock element={element}>{children}</RawBlock>
  else if (element.type === 'image') {
    body = (
      <ImageBlock
        element={element}
        storeAssetFile={storeAssetFile}
        resolveAssetURL={resolveAssetURL}
      >
        {children}
      </ImageBlock>
    )
  }
  else if (element.type === 'media') {
    body = (
      <MediaBlock
        element={element}
        storeAssetFile={storeAssetFile}
        resolveAssetURL={resolveAssetURL}
        openStoredAsset={openStoredAsset}
      >
        {children}
      </MediaBlock>
    )
  }
  else if (element.type === 'bookmark') body = <BookmarkBlock element={element}>{children}</BookmarkBlock>
  else if (element.type === 'task') body = <TaskBlock element={element}>{children}</TaskBlock>
  else if (element.type === 'button') body = <ButtonBlock element={element}>{children}</ButtonBlock>
  else body = <div>{children}</div>

  return (
    <BlockShell
      attributes={attributes}
      element={element}
      selected={selected}
      focused={focused}
      className={className}
      onOpenMenu={onOpenMenu}
      onOpenActions={onOpenActions}
      draggingPath={draggingPath}
      onDraggingPathChange={onDraggingPathChange}
      onMove={onMove}
      body={body}
    >
      {children}
    </BlockShell>
  )
}

function NoteLeaf({ attributes, children, leaf }: RenderLeafProps) {
  let content = children
  if (leaf.bold) content = <strong>{content}</strong>
  if (leaf.italic) content = <em>{content}</em>
  if (leaf.underline) content = <span className="docx-inline-underline">{content}</span>
  if (leaf.strike) content = <del>{content}</del>
  if (leaf.code) content = <code className="docx-inline-code">{content}</code>
  const style = {
    color: leaf.color,
    backgroundColor: leaf.backgroundColor,
  }
  return (
    <span
      {...attributes}
      className={leaf.backgroundColor ? 'docx-text-highlight' : ''}
      style={style}
    >
      {content}
    </span>
  )
}

const getEditableBlockEntry = (editor: NoteEditor) =>
  Editor.above(editor, {
    match: (node) => SlateElement.isElement(node) && isTextBlock(node),
    mode: 'lowest',
  }) as [NoteElement, number[]] | undefined

const selectionIsWithinSingleTextBlock = (editor: NoteEditor, range: BaseRange) => {
  const findBlock = (point: BaseRange['anchor']) =>
    Editor.above(editor, {
      at: point,
      match: (node) => SlateElement.isElement(node) && isTextBlock(node),
      mode: 'lowest',
    }) as [NoteElement, number[]] | undefined
  const anchor = findBlock(range.anchor)
  const focus = findBlock(range.focus)
  return Boolean(anchor && focus && Path.equals(anchor[1], focus[1]))
}

const applyInlineCodeShortcut = (editor: NoteEditor, marker: '`' | '｀') => {
  if (!editor.selection || !Range.isCollapsed(editor.selection) || Editor.marks(editor)?.code) {
    return false
  }
  const entry = getEditableBlockEntry(editor)
  if (!entry || entry[0].type === 'code') return false

  const blockStart = Editor.start(editor, entry[1])
  const beforeCursor = Editor.string(editor, {
    anchor: blockStart,
    focus: editor.selection.anchor,
  })
  const markerIndex = beforeCursor.lastIndexOf(marker)
  const value = markerIndex >= 0 ? beforeCursor.slice(markerIndex + marker.length) : ''
  if (!value || value.includes('\n')) return false

  const start = Editor.before(editor, editor.selection.anchor, {
    distance: Array.from(`${marker}${value}`).length,
    unit: 'character',
  })
  if (!start) return false
  const markerEnd = Editor.after(editor, start, { distance: 1, unit: 'character' })
  if (!markerEnd) return false

  HistoryEditor.withNewBatch(editor, () => {
    Transforms.delete(editor, { at: { anchor: start, focus: markerEnd } })
    const end = Editor.after(editor, start, {
      distance: Array.from(value).length,
      unit: 'character',
    })
    if (!end) return
    const codeRange = { anchor: start, focus: end }
    Transforms.setNodes<NoteText>(
      editor,
      { code: true },
      { at: codeRange, match: SlateText.isText, split: true },
    )
    Transforms.select(editor, codeRange)
    Transforms.collapse(editor, { edge: 'end' })
    Editor.removeMark(editor, 'code')
  })
  return true
}

const applyInsertedInlineCodeShortcut = (editor: NoteEditor, marker: '`' | '｀') => {
  if (!editor.selection || !Range.isCollapsed(editor.selection) || Editor.marks(editor)?.code) {
    return false
  }
  const entry = getEditableBlockEntry(editor)
  if (!entry || entry[0].type === 'code') return false

  const blockStart = Editor.start(editor, entry[1])
  const cursor = editor.selection.anchor
  const beforeCursor = Editor.string(editor, { anchor: blockStart, focus: cursor })
  if (!beforeCursor.endsWith(marker)) return false
  const openingIndex = beforeCursor.slice(0, -marker.length).lastIndexOf(marker)
  const value = openingIndex >= 0
    ? beforeCursor.slice(openingIndex + marker.length, -marker.length)
    : ''
  if (!value || value.includes('\n')) return false

  const tokenLength = Array.from(`${marker}${value}${marker}`).length
  const start = Editor.before(editor, cursor, { distance: tokenLength, unit: 'character' })
  const closingStart = Editor.before(editor, cursor, { distance: 1, unit: 'character' })
  if (!start || !closingStart) return false
  const openingEnd = Editor.after(editor, start, { distance: 1, unit: 'character' })
  if (!openingEnd) return false

  HistoryEditor.withNewBatch(editor, () => {
    Transforms.delete(editor, { at: { anchor: closingStart, focus: cursor } })
    Transforms.delete(editor, { at: { anchor: start, focus: openingEnd } })
    const end = Editor.after(editor, start, {
      distance: Array.from(value).length,
      unit: 'character',
    })
    if (!end) return
    const codeRange = { anchor: start, focus: end }
    Transforms.setNodes<NoteText>(
      editor,
      { code: true },
      { at: codeRange, match: SlateText.isText, split: true },
    )
    Transforms.select(editor, codeRange)
    Transforms.collapse(editor, { edge: 'end' })
    Editor.removeMark(editor, 'code')
  })
  return true
}

const applySpaceShortcut = (editor: NoteEditor, includesTrailingSpace = false) => {
  if (!editor.selection || !Range.isCollapsed(editor.selection)) return false
  const entry = getEditableBlockEntry(editor)
  if (!entry || entry[0].type === 'code') return false
  const [element, path] = entry
  if (!Editor.isEnd(editor, editor.selection.anchor, path)) return false

  const currentText = Node.string(element)
  const hasTrailingSpace = /[ \u3000]$/.test(currentText)
  if (includesTrailingSpace && !hasTrailingSpace) return false
  const text = includesTrailingSpace ? currentText.slice(0, -1) : currentText
  const heading = text.match(/^(#{1,9})$/)
  const shortcuts: Record<string, SlashCommandId> = {
    '-': 'bullet',
    '*': 'bullet',
    '1.': 'numbered',
    '[]': 'todo',
    '[ ]': 'todo',
    '>': 'quote',
    '```': 'code',
    '---': 'divider',
  }
  const commandId = heading
    ? (`heading${heading[1].length}` as SlashCommandId)
    : shortcuts[text]
  if (!commandId) return false

  const inCallout = Boolean(Editor.above(editor, {
    at: path,
    match: (node) => SlateElement.isElement(node) && node.type === 'callout',
    mode: 'lowest',
  }))
  if (inCallout && ['code', 'divider'].includes(commandId)) return false

  HistoryEditor.withNewBatch(editor, () => {
    Editor.withoutNormalizing(editor, () => {
      Transforms.removeNodes(editor, { at: path })
      const replacement = createBlockForCommand(commandId)
      if (commandId === 'divider') {
        const paragraph = createParagraph()
        Transforms.insertNodes(editor, [replacement, paragraph], { at: path })
        focusElementStart(editor, Path.next(path), paragraph)
        return
      }
      Transforms.insertNodes(editor, replacement, { at: path })
      focusElementStart(editor, path, replacement)
    })
  })
  return true
}

const applyPendingMarkdownShortcut = (editor: NoteEditor) => {
  if (composingEditors.has(editor)) return false
  if (applyInsertedInlineCodeShortcut(editor, '`')) return true
  if (applyInsertedInlineCodeShortcut(editor, '｀')) return true
  return applySpaceShortcut(editor, true)
}

const getSlashMenuState = (editor: NoteEditor): CommandMenuState | null => {
  if (!editor.selection || !Range.isCollapsed(editor.selection)) return null
  const entry = getEditableBlockEntry(editor)
  if (!entry || entry[0].type === 'code') return null
  const start = Editor.start(editor, entry[1])
  const range = { anchor: start, focus: editor.selection.anchor }
  const text = Editor.string(editor, range)
  const match = text.match(/^(?:\/|、)([^\s/、]*)$/)
  if (!match) return null
  try {
    const nativeSelection = window.getSelection()
    const rect = nativeSelection?.rangeCount
      ? nativeSelection.getRangeAt(0).getBoundingClientRect()
      : ReactEditor.toDOMRange(editor, range).getBoundingClientRect()
    return {
      mode: 'slash',
      blockPath: entry[1],
      range,
      query: match[1],
      ...getCommandMenuPosition(rect),
    }
  } catch {
    return null
  }
}

const focusElementStart = (editor: NoteEditor, path: number[], element: NoteElement) => {
  const selectTarget = () => {
    if (isVoidBlock(element)) Transforms.select(editor, path)
    else Transforms.select(editor, Editor.start(editor, path))
  }

  // 结构命令后的下一次键盘输入可能早于浏览器完成 DOM 重绘，模型选区必须立即就位。
  try {
    selectTarget()
  } catch {
    // DOM 重绘后的第二次同步仍会恢复焦点。
  }
  queueMicrotask(() => {
    try {
      selectTarget()
      ReactEditor.focus(editor)
    } catch {
      // React 提交完成后由动画帧再次同步浏览器选区。
    }
  })
  window.requestAnimationFrame(() => {
    try {
      selectTarget()
      ReactEditor.focus(editor)
      const focusTargets: Partial<Record<NoteElement['type'], string>> = {
        equation: 'input[aria-label="LaTeX 公式"]',
        image: '.docx-asset-empty',
        media: '.docx-asset-empty',
        bookmark: 'input[aria-label="网页地址"]',
        task: 'textarea[aria-label="任务标题"]',
        button: 'input[aria-label="按钮文字"]',
        raw: 'textarea[aria-label="原始 Markdown"]',
      }
      const selector = focusTargets[element.type]
      const control = selector
        ? document.querySelector<HTMLElement>(`[data-block-id="${element.id}"] ${selector}`)
        : null
      control?.focus()
      if (control instanceof HTMLTextAreaElement) {
        control.setSelectionRange(0, 0)
      }
      if (
        control instanceof HTMLInputElement &&
        ['text', 'url', 'search'].includes(control.type)
      ) {
        control.select()
      }
    } catch {
      ReactEditor.focus(editor)
    }
  })
}

const focusElementEnd = (editor: NoteEditor, path: number[], element: NoteElement) => {
  const selectTarget = () => {
    if (isVoidBlock(element)) Transforms.select(editor, path)
    else Transforms.select(editor, Editor.end(editor, path))
  }

  selectTarget()
  queueMicrotask(() => {
    selectTarget()
    ReactEditor.focus(editor)
  })
  window.requestAnimationFrame(() => {
    if (element.type !== 'task') {
      ReactEditor.focus(editor)
      return
    }
    const control = document.querySelector<HTMLTextAreaElement>(
      `[data-block-id="${element.id}"] textarea[aria-label="任务标题"]`,
    )
    control?.focus()
    control?.setSelectionRange(control.value.length, control.value.length)
  })
}

const insertParagraphAfterHeading = (editor: NoteEditor, path: number[]) => {
  if (!editor.selection) return
  const nextPath = Path.next(path)
  if (Editor.isEnd(editor, editor.selection.anchor, path) && Editor.hasPath(editor, nextPath)) {
    const next = Node.get(editor, nextPath)
    if (isElement(next) && next.type === 'paragraph' && Node.string(next) === '') {
      focusElementStart(editor, nextPath, next)
      return
    }
  }

  editor.insertBreak()
  const nextEntry = getEditableBlockEntry(editor)
  if (!nextEntry) return
  Transforms.setNodes(
    editor,
    { type: 'paragraph', id: createElementId() },
    { at: nextEntry[1] },
  )
}

const selectVoidBlock = (editor: NoteEditor, path: number[]) => {
  Transforms.select(editor, path)
  queueMicrotask(() => ReactEditor.focus(editor))
}

const focusInlineControl = (editor: NoteEditor, id: string, ariaLabel: string) => {
  const entry = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (node) => SlateElement.isElement(node) && node.id === id,
    }),
  )[0]
  if (!entry) return
  Transforms.select(editor, Editor.range(editor, entry[1]))
  ReactEditor.focus(editor)
  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(
      `[data-inline-id="${id}"] input[aria-label="${ariaLabel}"]`,
    )
    input?.focus()
    if (input && ['text', 'url', 'search'].includes(input.type)) input.select()
  })
}

const insertInlineLink = (
  editor: NoteEditor,
  text = '链接',
  url = 'https://',
  editAfterInsert = true,
) => {
  const link = createLink('', url)
  if (editor.selection && !Range.isCollapsed(editor.selection)) {
    if (!selectionIsWithinSingleTextBlock(editor, editor.selection)) return false
    Transforms.wrapNodes(editor, link, {
      at: editor.selection,
      split: true,
    })
    Transforms.collapse(editor, { edge: 'end' })
    if (editAfterInsert) focusInlineControl(editor, link.id, '链接地址')
    return true
  }
  link.children = [{ text }]
  Transforms.insertNodes(editor, link)
  Transforms.insertText(editor, ' ')
  if (editAfterInsert) focusInlineControl(editor, link.id, '链接地址')
  return true
}

const isWebURL = (value: string) => {
  const source = value.trim()
  const hasProtocol = /^https?:\/\//i.test(source)
  const looksLikeHost = /^(localhost(?::\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-z\d-]+\.)+[a-z]{2,})([/:?#]|$)/i
    .test(source)
  if (!hasProtocol && !looksLikeHost) return false
  try {
    const target = new URL(normalizeUrl(source))
    const validProtocol = ['http:', 'https:'].includes(target.protocol)
    return validProtocol && Boolean(target.hostname)
  } catch {
    return false
  }
}

const insertAssetFiles = async (
  editor: NoteEditor,
  files: globalThis.File[],
  storeAssetFile: StoreAssetFile,
) => {
  if (files.length === 0) return
  const blockEntry = Editor.above(editor, {
    match: (node) => SlateElement.isElement(node) && Editor.isBlock(editor, node),
    mode: 'lowest',
  }) as [NoteElement, number[]] | undefined
  const fallbackPath = [Math.max(0, editor.children.length - 1)]
  const pathRef = Editor.pathRef(editor, blockEntry?.[1] ?? fallbackPath)

  const blocks = await Promise.all(
    files.map(async (file) => {
      const url = await storeAssetFile(file)
      if (file.type.startsWith('image/')) {
        return {
          ...(createBlockForCommand('image') as ImageElement),
          url,
          caption: file.name,
        }
      }
      return {
        ...(createBlockForCommand('media') as MediaElement),
        url,
        name: file.name,
        mediaKind: file.type.startsWith('video/') ? 'video' as const : 'file' as const,
      }
    }),
  )

  const blockPath = pathRef.unref()
  if (!blockPath) return
  const current = Node.get(editor, blockPath) as NoteElement
  const replaceCurrent = isTextBlock(current) && Node.string(current) === ''
  const insertPath = replaceCurrent ? blockPath : Path.next(blockPath)
  Editor.withoutNormalizing(editor, () => {
    if (replaceCurrent) Transforms.removeNodes(editor, { at: blockPath })
    Transforms.insertNodes(editor, blocks, { at: insertPath })
    const lastPath = [...insertPath.slice(0, -1), insertPath.at(-1)! + blocks.length - 1]
    const nextPath = Path.next(lastPath)
    try {
      Node.get(editor, nextPath)
    } catch {
      Transforms.insertNodes(editor, createParagraph(), { at: nextPath })
    }
    focusElementStart(editor, lastPath, blocks.at(-1)!)
  })
}

const insertInlineReminder = (editor: NoteEditor) => {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30, 0, 0)
  const value = toLocalInputValue(date)
  const reminder = createReminder(formatReminder(value), value)
  Transforms.insertNodes(editor, reminder)
  Transforms.insertText(editor, ' ')
  focusInlineControl(editor, reminder.id, '提醒时间')
}

const insertCommand = (editor: NoteEditor, menu: CommandMenuState, id: SlashCommandId) => {
  if (!commandAllowedAtPath(editor, menu.blockPath, id)) return
  Editor.withoutNormalizing(editor, () => {
    if (menu.range) {
      Transforms.select(editor, menu.range)
      Transforms.delete(editor)
    }

    if (id === 'link') {
      insertInlineLink(editor)
      return
    }
    if (id === 'reminder') {
      insertInlineReminder(editor)
      return
    }

    let blockPath = menu.blockPath
    let current: NoteElement
    try {
      current = Node.get(editor, blockPath) as NoteElement
    } catch {
      blockPath = [editor.children.length - 1]
      current = Node.get(editor, blockPath) as NoteElement
    }

    const text = isTextBlock(current) ? Node.string(current) : ''
    const simpleTarget =
      id === 'paragraph' ||
      id.startsWith('heading') ||
      ['bullet', 'numbered', 'todo', 'quote', 'code', 'callout'].includes(id)
    const slashTextTarget =
      simpleTarget ||
      [
        'equation',
        'image',
        'media',
        'bookmark',
        'task',
        'button',
      ].includes(id)
    const replaceCurrent =
      Node.string(current).trim() === ''
      || (menu.mode === 'manual' && simpleTarget)
      || (menu.mode === 'slash' && slashTextTarget)
    const replacement = createBlockForCommand(id, replaceCurrent ? text : '')
    let targetPath = blockPath

    if (replaceCurrent) {
      Transforms.removeNodes(editor, { at: blockPath })
      Transforms.insertNodes(editor, replacement, { at: blockPath })
    } else {
      targetPath = Path.next(blockPath)
      Transforms.insertNodes(editor, replacement, { at: targetPath })
    }

    if (isVoidBlock(replacement)) {
      const parent = Node.parent(editor, targetPath)
      if (targetPath[targetPath.length - 1] === parent.children.length - 1) {
        Transforms.insertNodes(editor, createParagraph(), { at: Path.next(targetPath) })
      }
    }
    focusElementStart(editor, targetPath, replacement)
  })
}

const isMacShortcut = (event: KeyboardEvent, key: string) =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key

const cloneElementWithNewIds = (element: NoteElement) => {
  const clone = structuredClone(element)
  const refreshIds = (node: NoteElement | NoteText) => {
    if ('text' in node) return
    node.id = createElementId()
    node.children.forEach((child) => refreshIds(child as NoteElement | NoteText))
  }
  refreshIds(clone)
  return clone
}

function SlateDocumentEditor({
  editorId,
  publishSourceId,
  initialMarkdown,
  ariaLabel,
  onValueChange,
  onTasksChange,
  storeAssetFile,
  resolveAssetURL,
  openStoredAsset,
  spellCheck,
  pasteMode,
  onPublishParagraph,
}: {
  editorId: string
  publishSourceId: string
  initialMarkdown: string
  ariaLabel: string
  onValueChange: (value: Descendant[]) => void
  onTasksChange?: (tasks: DocumentTaskSnapshot[]) => void
  storeAssetFile: StoreAssetFile
  resolveAssetURL: ResolveAssetURL
  openStoredAsset: OpenStoredAsset
  spellCheck: boolean
  pasteMode: 'markdown' | 'plain'
  onPublishParagraph?: (paragraph: PublishParagraphPayload) => void
}) {
  const editor = useMemo(() => createStableEditor(), [])
  const [initialValue] = useState(() => parseMarkdown(initialMarkdown))
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [inlineToolbar, setInlineToolbar] = useState<InlineToolbarState | null>(null)
  const [blockActions, setBlockActions] = useState<BlockActionMenuState | null>(null)
  const [draggingPath, setDraggingPath] = useState<number[] | null>(null)
  const isComposingRef = useRef(false)
  const compositionChangedRef = useRef(false)
  const compositionFlushFrameRef = useRef<number | null>(null)
  const dismissedInlineRangeRef = useRef<BaseRange | null>(null)
  const onTasksChangeRef = useRef(onTasksChange)
  onTasksChangeRef.current = onTasksChange

  const enabledCommands = slashCommands

  useEffect(() => {
    onTasksChangeRef.current?.(collectDocumentTasks(initialValue))
  }, [initialValue])

  const visibleCommands = useMemo(() => {
    const contextualCommands = menu
      ? enabledCommands.filter((command) =>
          commandAllowedAtPath(editor, menu.blockPath, command.id),
        )
      : enabledCommands
    const query = menu?.query.trim().toLocaleLowerCase() ?? ''
    if (!query) return contextualCommands
    const rank = (command: SlashCommand) => {
      if (
        command.label.toLocaleLowerCase().startsWith(query)
        || t(command.label).toLocaleLowerCase().startsWith(query)
      ) return 0
      if (
        command.hint.toLocaleLowerCase().startsWith(query)
        || t(command.hint).toLocaleLowerCase().startsWith(query)
      ) return 1
      return 2
    }
    return contextualCommands
      .filter((command) =>
        `${command.label} ${t(command.label)} ${command.hint} ${t(command.hint)} ${command.keywords}`
          .toLocaleLowerCase()
          .includes(query),
      )
      .sort((left, right) => rank(left) - rank(right))
  }, [editor, enabledCommands, menu])

  useEffect(() => {
    const index = menu?.appliedCommandId
      ? visibleCommands.findIndex((command) => command.id === menu.appliedCommandId)
      : -1
    setActiveCommandIndex(Math.max(0, index))
  }, [
    menu?.appliedCommandId,
    menu?.query,
    menu?.mode,
    menu?.blockPath.join('.'),
    visibleCommands,
  ])

  useEffect(() => () => {
    if (compositionFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFlushFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!menu && !inlineToolbar && !blockActions) return
    const closeMenu = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('.docx-command-menu') ||
          target.closest('.docx-inline-toolbar') ||
          target.closest('.docx-block-action-menu') ||
          target.closest('.docx-block-gutter') ||
          target.closest('.docx-nested-block-gutter'))
      ) {
        return
      }
      setMenu(null)
      if (inlineToolbar) dismissedInlineRangeRef.current = inlineToolbar.range
      setInlineToolbar(null)
      setBlockActions(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [blockActions, inlineToolbar, menu])

  useEffect(() => {
    if (!menu && !inlineToolbar && !blockActions) return
    const closeDetachedOverlays = (event: Event) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('.docx-command-menu-scroll')
      ) {
        return
      }
      setMenu(null)
      if (inlineToolbar) dismissedInlineRangeRef.current = inlineToolbar.range
      setInlineToolbar(null)
      setBlockActions(null)
    }
    document.addEventListener('scroll', closeDetachedOverlays, true)
    return () => document.removeEventListener('scroll', closeDetachedOverlays, true)
  }, [blockActions, inlineToolbar, menu])

  const openManualMenu = useCallback((path: number[], rect: DOMRect) => {
    setInlineToolbar(null)
    setBlockActions(null)
    const element = Node.get(editor, path) as NoteElement
    setMenu({
      mode: 'manual',
      blockPath: path,
      appliedCommandId: commandIdForElement(element),
      query: '',
      ...getCommandMenuPosition(rect),
    })
  }, [editor])

  const openBlockActions = useCallback((path: number[], rect: DOMRect) => {
    setMenu(null)
    setInlineToolbar(null)
    const element = Node.get(editor, path) as NoteElement
    const canPublish = Boolean(
      onPublishParagraph &&
      isTextBlock(element) &&
      Node.string(element).trim(),
    )
    const menuWidth = canPublish ? 94 : 64
    setBlockActions({
      path,
      left: Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.left - menuWidth - 5)),
      top: Math.max(12, Math.min(window.innerHeight - 48, rect.top - 3)),
      canPublish,
    })
  }, [editor, onPublishParagraph])

  const runBlockAction = (action: 'publish' | 'duplicate' | 'delete') => {
    if (!blockActions) return
    const path = blockActions.path
    const parentPath = Path.parent(path)
    const index = path.at(-1)!
    try {
      const element = Node.get(editor, path) as NoteElement
      if (action === 'publish') {
        if (!isTextBlock(element) || !onPublishParagraph) return
        onPublishParagraph({
          id: `${publishSourceId}:block:${path.join('.')}`,
          markdown: serializeMarkdown([element]).trim(),
          preview: Node.string(element).trim(),
        })
      } else if (action === 'duplicate') {
        const duplicate = cloneElementWithNewIds(element)
        const nextPath = Path.next(path)
        Transforms.insertNodes(editor, duplicate, { at: nextPath })
        focusElementStart(editor, nextPath, duplicate)
      } else {
        Transforms.removeNodes(editor, { at: path })
        const parent = Node.get(editor, parentPath)
        if (!Editor.isEditor(parent) && !SlateElement.isElement(parent)) return
        const nextPath = [...parentPath, Math.min(index, parent.children.length - 1)]
        focusElementStart(editor, nextPath, Node.get(editor, nextPath) as NoteElement)
      }
    } finally {
      setBlockActions(null)
    }
  }

  const moveBlock = useCallback(
    (source: number[], target: number[], edge: 'before' | 'after') => {
      const parentPath = Path.parent(source)
      if (!Path.equals(parentPath, Path.parent(target))) return
      const sourceIndex = source.at(-1)!
      let destinationIndex = target.at(-1)! + (edge === 'after' ? 1 : 0)
      if (sourceIndex < destinationIndex) destinationIndex -= 1
      const destination = [...parentPath, destinationIndex]
      if (Path.equals(source, destination)) return
      Transforms.moveNodes(editor, { at: source, to: destination })
    },
    [editor],
  )

  const renderElement = useCallback(
    (props: RenderElementProps) => (
      <NoteElementRenderer
        {...props}
        element={props.element}
        storeAssetFile={storeAssetFile}
        resolveAssetURL={resolveAssetURL}
        openStoredAsset={openStoredAsset}
        onOpenMenu={openManualMenu}
        onOpenActions={openBlockActions}
        draggingPath={draggingPath}
        onDraggingPathChange={setDraggingPath}
        onMove={moveBlock}
      />
    ),
    [
      draggingPath,
      moveBlock,
      openBlockActions,
      openManualMenu,
      openStoredAsset,
      resolveAssetURL,
      storeAssetFile,
    ],
  )

  const updateInlineToolbar = useCallback(() => {
    window.requestAnimationFrame(() => {
      const domSelection = window.getSelection()
      if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
        dismissedInlineRangeRef.current = null
        setInlineToolbar(null)
        return
      }
      try {
        const range = ReactEditor.toSlateRange(editor, domSelection, {
          exactMatch: false,
          suppressThrow: true,
        })
        if (!range || Range.isCollapsed(range)) {
          dismissedInlineRangeRef.current = null
          setInlineToolbar(null)
          return
        }
        if (
          dismissedInlineRangeRef.current &&
          Range.equals(dismissedInlineRangeRef.current, range)
        ) {
          setInlineToolbar(null)
          return
        }
        dismissedInlineRangeRef.current = null
        const [leaf] = Editor.leaf(editor, range.anchor)
        const rect = domSelection.getRangeAt(0).getBoundingClientRect()
        const toolbarHalfWidth = onPublishParagraph ? 166 : 151
        setInlineToolbar({
          range,
          left: Math.max(
            toolbarHalfWidth,
            Math.min(window.innerWidth - toolbarHalfWidth, rect.left + rect.width / 2),
          ),
          top: rect.top - 7,
          color: leaf.color,
          backgroundColor: leaf.backgroundColor,
          canLink: selectionIsWithinSingleTextBlock(editor, range),
          marks: {
            bold: Boolean(leaf.bold),
            italic: Boolean(leaf.italic),
            underline: Boolean(leaf.underline),
            strike: Boolean(leaf.strike),
            code: Boolean(leaf.code),
          },
        })
      } catch {
        dismissedInlineRangeRef.current = null
        setInlineToolbar(null)
      }
    })
  }, [editor, onPublishParagraph])

  const applyMark = (
    mark: keyof Pick<NoteText, 'bold' | 'italic' | 'underline' | 'strike' | 'code'>,
  ) => {
    if (!inlineToolbar) return
    Transforms.select(editor, inlineToolbar.range)
    const marks = Editor.marks(editor)
    if (marks?.[mark]) Editor.removeMark(editor, mark)
    else Editor.addMark(editor, mark, true)
    ReactEditor.focus(editor)
    setInlineToolbar(null)
  }

  const applyLink = () => {
    if (!inlineToolbar) return
    Transforms.select(editor, inlineToolbar.range)
    insertInlineLink(editor)
    ReactEditor.focus(editor)
    setInlineToolbar(null)
  }

  const publishSelection = () => {
    if (!inlineToolbar || !onPublishParagraph) return
    const range = inlineToolbar.range
    const preview = Editor.string(editor, range).trim()
    if (!preview) return
    const fragment = Editor.fragment(editor, range).filter(isElement)
    const markdown = serializeMarkdown(fragment).trim() || preview
    const [start, end] = Range.edges(range)
    const blockEntry = Editor.above(editor, {
      at: start,
      match: (node) => SlateElement.isElement(node) && isTextBlock(node),
      mode: 'lowest',
    }) as [NoteElement, number[]] | undefined
    const selectionKey = [
      start.path.join('.'),
      start.offset,
      end.path.join('.'),
      end.offset,
    ].join('-')
    dismissedInlineRangeRef.current = range
    setInlineToolbar(null)
    onPublishParagraph({
      id: `${publishSourceId}:block:${
        blockEntry?.[1].join('.') ?? start.path.join('.')
      }:selection:${selectionKey}`,
      markdown,
      preview,
    })
  }

  const applyAlignment = (alignment: TextAlignment) => {
    if (!inlineToolbar) return
    Transforms.select(editor, inlineToolbar.range)
    Transforms.setNodes(
      editor,
      { align: alignment },
      {
        at: inlineToolbar.range,
        match: (node) =>
          SlateElement.isElement(node) && isTextBlock(node) && node.type !== 'code',
      },
    )
    ReactEditor.focus(editor)
    setInlineToolbar(null)
  }

  const applyColor = (mark: 'color' | 'backgroundColor', value?: string) => {
    if (!inlineToolbar) return
    Transforms.select(editor, inlineToolbar.range)
    if (value) Editor.addMark(editor, mark, value)
    else Editor.removeMark(editor, mark)
    ReactEditor.focus(editor)
    setInlineToolbar(null)
  }

  const handleTableTab = (event: KeyboardEvent) => {
    const cellEntry = Editor.above(editor, {
      match: (node) => SlateElement.isElement(node) && node.type === 'table-cell',
      mode: 'lowest',
    }) as [TableCellElement, number[]] | undefined
    if (!cellEntry) return false
    event.preventDefault()
    const cellPath = cellEntry[1]
    const tablePath = cellPath.slice(0, -2)
    const rowIndex = cellPath.at(-2) ?? 0
    const cellIndex = cellPath.at(-1) ?? 0
    const table = Node.get(editor, tablePath) as TableElement
    const width = table.children[0]?.children.length ?? 2
    const flatIndex = rowIndex * width + cellIndex + (event.shiftKey ? -1 : 1)
    if (flatIndex >= 0 && flatIndex < table.children.length * width) {
      const nextPath = [...tablePath, Math.floor(flatIndex / width), flatIndex % width]
      Transforms.select(editor, Editor.start(editor, nextPath))
      return true
    }
    if (event.shiftKey) return true
    const rowPath = [...tablePath, table.children.length]
    Transforms.insertNodes(editor, makeRow(width), { at: rowPath })
    Transforms.select(editor, Editor.start(editor, [...rowPath, 0]))
    return true
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process' || isComposingRef.current) return
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return
    }

    if (menu) {
      if (
        (event.key === 'PageDown' || event.key === 'PageUp') &&
        visibleCommands.length > 0
      ) {
        event.preventDefault()
        const direction = event.key === 'PageDown' ? 1 : -1
        setActiveCommandIndex((current) =>
          Math.max(
            0,
            Math.min(visibleCommands.length - 1, current + direction * commandMenuPageSize),
          ),
        )
        return
      }
      if (event.key === 'ArrowDown' && visibleCommands.length > 0) {
        event.preventDefault()
        setActiveCommandIndex((current) => (current + 1) % visibleCommands.length)
        return
      }
      if (event.key === 'ArrowUp' && visibleCommands.length > 0) {
        event.preventDefault()
        setActiveCommandIndex(
          (current) => (current - 1 + visibleCommands.length) % visibleCommands.length,
        )
        return
      }
      if (event.key === 'Enter' && visibleCommands[activeCommandIndex]) {
        event.preventDefault()
        insertCommand(editor, menu, visibleCommands[activeCommandIndex].id)
        setMenu(null)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        return
      }
    }

    if (event.key === 'Escape' && (inlineToolbar || blockActions)) {
      event.preventDefault()
      if (inlineToolbar) dismissedInlineRangeRef.current = inlineToolbar.range
      setInlineToolbar(null)
      setBlockActions(null)
      return
    }

    if (event.key === 'Tab' && handleTableTab(event)) return

    if (
      !event.nativeEvent.isComposing &&
      (event.key === '`' || event.key === '｀') &&
      applyInlineCodeShortcut(editor, event.key)
    ) {
      event.preventDefault()
      return
    }

    if (isMacShortcut(event, 'z')) {
      event.preventDefault()
      if (event.shiftKey) HistoryEditor.redo(editor)
      else HistoryEditor.undo(editor)
      return
    }

    if (
      isMacShortcut(event, 'b') ||
      isMacShortcut(event, 'i') ||
      isMacShortcut(event, 'u')
    ) {
      event.preventDefault()
      const key = event.key.toLowerCase()
      const mark = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline'
      const marks = Editor.marks(editor)
      if (marks?.[mark]) Editor.removeMark(editor, mark)
      else Editor.addMark(editor, mark, true)
      return
    }
    if (isMacShortcut(event, 'k')) {
      event.preventDefault()
      event.stopPropagation()
      insertInlineLink(editor)
      return
    }

    if (['Backspace', 'Delete'].includes(event.key) && editor.selection) {
      const voidEntry = Editor.above(editor, {
        match: (node) => SlateElement.isElement(node) && isVoidBlock(node),
        mode: 'lowest',
      }) as [NoteElement, number[]] | undefined
      if (voidEntry) {
        event.preventDefault()
        const index = voidEntry[1][0]
        Transforms.removeNodes(editor, { at: voidEntry[1] })
        if (editor.children.length === 0) Transforms.insertNodes(editor, createParagraph(), { at: [0] })
        const nextPath = [Math.min(index, editor.children.length - 1)]
        focusElementStart(editor, nextPath, Node.get(editor, nextPath) as NoteElement)
        return
      }
    }

    const entry = getEditableBlockEntry(editor)
    if (!entry || !editor.selection || !Range.isCollapsed(editor.selection)) return
    const [element, path] = entry

    if (
      ['ArrowUp', 'ArrowDown'].includes(event.key)
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
    ) {
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const sibling = siblingElement(editor, path, direction)
      if (sibling?.[0].type === 'task' && selectionIsAtVerticalEdge(editor, path, direction)) {
        event.preventDefault()
        if (direction < 0) focusElementEnd(editor, sibling[1], sibling[0])
        else focusElementStart(editor, sibling[1], sibling[0])
        return
      }
    }

    if (event.key === 'Tab' && element.type === 'code') {
      event.preventDefault()
      Editor.insertText(editor, '  ')
      return
    }

    if (event.key === 'Tab' && ['bullet', 'numbered', 'todo'].includes(element.type)) {
      event.preventDefault()
      const indent = 'indent' in element ? element.indent : 0
      Transforms.setNodes(
        editor,
        { indent: Math.max(0, Math.min(5, indent + (event.shiftKey ? -1 : 1))) },
        { at: path },
      )
      return
    }

    if ((event.key === ' ' || event.key === '\u3000') && applySpaceShortcut(editor)) {
      event.preventDefault()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (element.type === 'code') {
        event.preventDefault()
        if (event.metaKey || event.ctrlKey) {
          const nextPath = Path.next(path)
          const paragraph = createParagraph()
          Transforms.insertNodes(editor, paragraph, { at: nextPath })
          focusElementStart(editor, nextPath, paragraph)
          return
        }
        Editor.insertText(editor, '\n')
        return
      }
      if (Node.string(element) === '---') {
        event.preventDefault()
        Editor.withoutNormalizing(editor, () => {
          Transforms.removeNodes(editor, { at: path })
          const divider = createBlockForCommand('divider')
          const paragraph = createParagraph()
          Transforms.insertNodes(editor, [divider, paragraph], { at: path })
          focusElementStart(editor, Path.next(path), paragraph)
        })
        return
      }
      if (
        Node.string(element) === '' &&
        ['bullet', 'numbered', 'todo', 'quote'].includes(element.type)
      ) {
        event.preventDefault()
        Transforms.setNodes(editor, { type: 'paragraph', id: createElementId() }, { at: path })
        return
      }
      if (element.type === 'heading') {
        event.preventDefault()
        insertParagraphAfterHeading(editor, path)
        return
      }
      event.preventDefault()
      editor.insertBreak()
      return
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      Editor.insertText(editor, '\n')
      return
    }

    if (event.key === 'Backspace' && Editor.isStart(editor, editor.selection.anchor, path)) {
      if (path.at(-1)! > 0) {
        const previousPath = Path.previous(path)
        const previous = Node.get(editor, previousPath)
        if (isElement(previous) && isVoidBlock(previous)) {
          event.preventDefault()
          if (element.type === 'paragraph' && Node.string(element) === '') {
            const parentPath = Path.parent(path)
            const index = path.at(-1)!
            Transforms.removeNodes(editor, { at: path })
            const parent = Node.get(editor, parentPath)
            if (!Editor.isEditor(parent) && !SlateElement.isElement(parent)) return
            const nextPath = index < parent.children.length
              ? [...parentPath, index]
              : previousPath
            const next = Node.get(editor, nextPath) as NoteElement
            if (Path.equals(nextPath, previousPath)) {
              focusElementEnd(editor, nextPath, next)
            } else {
              focusElementStart(editor, nextPath, next)
            }
            return
          }
          selectVoidBlock(editor, previousPath)
          return
        }
      }

      const calloutEntry = Editor.above(editor, {
        at: path,
        match: (node) => SlateElement.isElement(node) && node.type === 'callout',
        mode: 'lowest',
      }) as [CalloutElement, number[]] | undefined
      if (
        calloutEntry &&
        Editor.isStart(editor, editor.selection.anchor, calloutEntry[1])
      ) {
        event.preventDefault()
        const [callout, calloutPath] = calloutEntry
        const children = callout.children.map(cloneElementWithNewIds)
        Editor.withoutNormalizing(editor, () => {
          Transforms.removeNodes(editor, { at: calloutPath })
          Transforms.insertNodes(editor, children, { at: calloutPath })
          focusElementStart(editor, calloutPath, children[0])
        })
        return
      }
    }

    if (
      event.key === 'Delete' &&
      Editor.isEnd(editor, editor.selection.anchor, path) &&
      path.length === 1 &&
      path[0] < editor.children.length - 1
    ) {
      const nextPath = Path.next(path)
      const next = Node.get(editor, nextPath)
      if (isElement(next) && isVoidBlock(next)) {
        event.preventDefault()
        selectVoidBlock(editor, nextPath)
      }
    }

    if (
      event.key === 'Backspace' &&
      Editor.isStart(editor, editor.selection.anchor, path) &&
      element.type !== 'paragraph'
    ) {
      if (['heading', 'bullet', 'numbered', 'todo', 'quote', 'code'].includes(element.type)) {
        event.preventDefault()
        Transforms.setNodes(editor, { type: 'paragraph', id: createElementId() }, { at: path })
      }
    }
  }

  const canvasBlocks = (canvas: HTMLDivElement) =>
    Array.from(canvas.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('docx-block'),
    )

  const insertParagraphAtGap = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(
      'a, button, input, select, textarea:not(.docx-task-title), '
      + '[data-slate-string], [data-slate-zero-width]',
    )) {
      return
    }
    const blocks = canvasBlocks(event.currentTarget)
    const boundaryHitSlop = target?.closest('textarea.docx-task-title') ? 7 : 10
    const nextIndex = blocks.findIndex((block, index) => {
      if (index === 0) return false
      const previousBottom = blocks[index - 1].getBoundingClientRect().bottom
      const nextTop = block.getBoundingClientRect().top
      const gap = nextTop - previousBottom
      if (gap < -1) return false
      const boundary = (previousBottom + nextTop) / 2
      return Math.abs(event.clientY - boundary) <= Math.max(boundaryHitSlop, gap / 2)
    })
    if (nextIndex <= 0) return

    event.preventDefault()
    event.stopPropagation()
    const paragraph = createParagraph()
    const path = [nextIndex]
    Transforms.insertNodes(editor, paragraph, { at: path })
    focusElementStart(editor, path, paragraph)
  }

  const focusCanvasEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const lastBlock = canvasBlocks(event.currentTarget).at(-1)
    if (lastBlock && event.clientY <= lastBlock.getBoundingClientRect().bottom) return
    event.preventDefault()

    let targetPath = [editor.children.length - 1]
    const lastElement = editor.children.at(-1)
    if (!lastElement || !isElement(lastElement) || lastElement.type !== 'paragraph') {
      targetPath = [editor.children.length]
      Transforms.insertNodes(editor, createParagraph(), { at: targetPath })
    }
    Transforms.select(editor, Editor.end(editor, targetPath))
    ReactEditor.focus(editor)
  }

  const syncEditorUI = (hasDocumentChange: boolean) => {
    if (hasDocumentChange) applyPendingMarkdownShortcut(editor)
    const slashMenu = getSlashMenuState(editor)
    setMenu((current) => (current?.mode === 'manual' ? current : slashMenu))
    if (!editor.selection || Range.isCollapsed(editor.selection)) setInlineToolbar(null)
  }

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        const hasDocumentChange = editor.operations.some((operation) => operation.type !== 'set_selection')
        if (hasDocumentChange) onTasksChangeRef.current?.(collectDocumentTasks(value))
        const composing = isComposingRef.current || composingEditors.has(editor)
        if (hasDocumentChange) {
          if (composing || compositionFlushFrameRef.current !== null) {
            compositionChangedRef.current = true
          } else {
            onValueChange(value)
          }
        }
        if (composing || compositionFlushFrameRef.current !== null) return
        window.requestAnimationFrame(() => {
          syncEditorUI(hasDocumentChange)
        })
      }}
    >
      <Editable
        id={editorId}
        className="docx-editor"
        aria-label={ariaLabel}
        renderElement={renderElement}
        renderLeaf={(props) => <NoteLeaf {...props} />}
        placeholder={t("输入 '/' 或 '、' 插入内容")}
        spellCheck={spellCheck}
        autoFocus={false}
        onCompositionStart={() => {
          const hadPendingFlush = compositionFlushFrameRef.current !== null
          if (compositionFlushFrameRef.current !== null) {
            window.cancelAnimationFrame(compositionFlushFrameRef.current)
            compositionFlushFrameRef.current = null
          }
          compositionChangedRef.current = hadPendingFlush
          isComposingRef.current = true
          composingEditors.add(editor)
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
          composingEditors.delete(editor)
          compositionFlushFrameRef.current = window.requestAnimationFrame(() => {
            compositionFlushFrameRef.current = null
            const changed = compositionChangedRef.current
            compositionChangedRef.current = false
            if (changed) {
              onValueChange(editor.children)
              syncEditorUI(true)
            }
          })
        }}
        onDOMBeforeInput={(event) => {
          const text = event.data
          if (
            !text ||
            event.isComposing ||
            composingEditors.has(editor) ||
            !['insertText', 'insertCompositionText', 'insertFromComposition'].includes(
              event.inputType,
            ) ||
            Array.from(text).length === 1
          ) {
            return
          }
          const lastCharacter = Array.from(text).at(-1)
          if (
            lastCharacter !== '`' &&
            lastCharacter !== '｀' &&
            lastCharacter !== ' ' &&
            lastCharacter !== '\u3000'
          ) {
            return
          }
          event.preventDefault()
          Editor.insertText(editor, text)
        }}
        onKeyDown={handleKeyDown}
        onDoubleClick={insertParagraphAtGap}
        onCopy={copyRichText}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length > 0) {
            event.preventDefault()
            void insertAssetFiles(editor, files, storeAssetFile)
            return
          }
          if (pasteMode === 'plain') {
            event.preventDefault()
            Editor.insertText(editor, event.clipboardData.getData('text/plain'))
            return
          }
          const text = event.clipboardData.getData('text/plain').trim()
          if (isWebURL(text)) {
            event.preventDefault()
            insertInlineLink(editor, text, normalizeUrl(text), false)
            return
          }
          const clipboardText = event.clipboardData.getData('text/plain')
          if (
            event.clipboardData.getData('text/html') ||
            isStructuredClipboardText(clipboardText)
          ) {
            event.preventDefault()
            editor.insertData(event.clipboardData)
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files)
          if (files.length === 0) return
          event.preventDefault()
          void insertAssetFiles(editor, files, storeAssetFile)
        }}
        onDragOver={(event) => {
          if (!draggingPath) return
          event.preventDefault()
          scrollEditorDuringDrag(event.currentTarget, event.clientY)
        }}
        onPointerDown={focusCanvasEnd}
        onSelect={updateInlineToolbar}
        onMouseUp={updateInlineToolbar}
        onKeyUp={updateInlineToolbar}
        onBlur={() => {
          window.setTimeout(() => {
            if (!document.activeElement?.closest('.docx-inline-editor')) setInlineToolbar(null)
          }, 0)
        }}
      />
      {menu && (
        <CommandMenu
          state={menu}
          commands={visibleCommands}
          activeIndex={activeCommandIndex}
          onActiveIndexChange={setActiveCommandIndex}
          onChoose={(command) => {
            insertCommand(editor, menu, command.id)
            setMenu(null)
          }}
        />
      )}
      {inlineToolbar && (
        <InlineToolbar
          state={inlineToolbar}
          onMark={applyMark}
          onLink={applyLink}
          onPublish={onPublishParagraph ? publishSelection : undefined}
          onAlign={applyAlignment}
          onColor={applyColor}
        />
      )}
      {blockActions && (
        <BlockActionMenu
          state={blockActions}
          onPublish={
            blockActions.canPublish ? () => runBlockAction('publish') : undefined
          }
          onDuplicate={() => runBlockAction('duplicate')}
          onDelete={() => runBlockAction('delete')}
        />
      )}
    </Slate>
  )
}

function LoadedDocumentEditor({
  documentId,
  libraryPath,
  frontMatter,
  initialRevision,
  title: initialTitle,
  markdown: initialMarkdown,
  beforeTitle,
  metadata,
  onPublishParagraph,
  onTasksChange,
  ariaLabel,
}: {
  documentId: string
  libraryPath: string
  frontMatter: string
  initialRevision: string | null
  title: string
  markdown: string
  beforeTitle?: ReactNode
  metadata?: ReactNode | ((value: { tags: string[]; setTags: (tags: string[]) => void }) => ReactNode)
  onPublishParagraph?: (paragraph: PublishParagraphPayload) => void
  onTasksChange?: (tasks: DocumentTaskSnapshot[]) => void
  ariaLabel: string
}) {
  const normalizedInitialMarkdown = useMemo(
    () => ensureTaskBlockIds(initialMarkdown),
    [initialMarkdown],
  )
  const [currentFrontMatter, setCurrentFrontMatter] = useState(frontMatter)
  const [title, setTitle] = useState(initialTitle)
  const [markdown, setMarkdown] = useState(normalizedInitialMarkdown)
  const [revision, setRevision] = useState(0)
  const [editorVersion, setEditorVersion] = useState(0)
  const [conflict, setConflict] = useState<DocumentConflict | null>(null)
  const editorSettings = useRuntimeSettings()
  const revisionRef = useRef(0)
  const baseRevisionRef = useRef(initialRevision)
  const conflictRef = useRef<DocumentConflict | null>(null)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const taskIdMigrationPendingRef = useRef(normalizedInitialMarkdown !== initialMarkdown)
  const editorId = `markdown-${documentId.replace(/[^a-z0-9_-]/gi, '-')}`
  const previewStorageKey = `note-down.preview-document.${documentId}`
  const frontMatterPrefix = currentFrontMatter ? `${currentFrontMatter}\n\n` : ''
  const normalizedTitle = title.trim() || '未命名文档'
  const latestSaveRef = useRef<DocumentSaveSnapshot>({
    content: `${frontMatterPrefix}# ${normalizedTitle}\n\n${markdown}\n`,
    revision,
    tags: frontMatterTags(currentFrontMatter),
    title: normalizedTitle,
  })
  latestSaveRef.current = {
    content: `${frontMatterPrefix}# ${normalizedTitle}\n\n${markdown}\n`,
    revision,
    tags: frontMatterTags(currentFrontMatter),
    title: normalizedTitle,
  }
  const storeAssetFile = useCallback(
    async (file: globalThis.File) => {
      if (!window.noteDown) return readLocalFile(file)
      const result = await window.noteDown.storeAsset({
        file,
        libraryPath,
        documentId,
        attachmentsPath: loadSettings().attachmentsPath,
        mode: loadSettings().attachmentMode,
      })
      return result.url
    },
    [documentId, libraryPath],
  )
  const resolveAssetURL = useCallback(
    async (url: string) => {
      if (!url || /^(?:https?:|data:|blob:|file:)/i.test(url) || !window.noteDown) return url
      return window.noteDown.resolveAsset({ url, libraryPath, documentId })
    },
    [documentId, libraryPath],
  )
  const openStoredAsset = useCallback(
    (url: string, name: string) => {
      if (!url) return
      if (window.noteDown) {
        void window.noteDown.openAsset({ url, name, libraryPath, documentId })
        return
      }
      if (!url.startsWith('data:')) {
        openExternal(url)
        return
      }
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name || 'attachment'
      anchor.click()
    },
    [documentId, libraryPath],
  )

  const enqueueSave = useCallback(
    (snapshot: DocumentSaveSnapshot) => {
      const save = async () => {
        if (conflictRef.current) return 'conflict' as const
        if (window.noteDown) {
          const result = await window.noteDown.saveDocument({
            documentId,
            libraryPath,
            content: snapshot.content,
            baseRevision: baseRevisionRef.current,
          })
          if (result.status === 'conflict') {
            const nextConflict = { content: result.content, revision: result.revision }
            conflictRef.current = nextConflict
            setConflict(nextConflict)
            emitSaveState('conflict')
            return 'conflict' as const
          }
          baseRevisionRef.current = result.revision
        } else {
          window.localStorage.setItem(previewStorageKey, snapshot.content)
        }
        if (revisionRef.current === snapshot.revision) {
          emitSaveState('saved')
          window.dispatchEvent(
            new CustomEvent('note-down:document-saved', {
              detail: {
                documentId,
                title: snapshot.title,
                tags: snapshot.tags,
              },
            }),
          )
        }
        return 'saved' as const
      }
      const pending = saveQueueRef.current.then(save, save)
      saveQueueRef.current = pending.then(() => undefined, () => undefined)
      window.dispatchEvent(
        new CustomEvent('note-down:save-pending', { detail: { pending } }),
      )
      return pending
    },
    [documentId, libraryPath, previewStorageKey],
  )

  useEffect(() => {
    if (revision === 0 || conflictRef.current) return
    const snapshot = latestSaveRef.current
    const timeout = window.setTimeout(() => {
      void enqueueSave(snapshot).catch(() => {
        if (revisionRef.current === snapshot.revision) emitSaveState('error')
      })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [enqueueSave, revision])

  useEffect(() => {
    const flush = () => {
      if (revisionRef.current === 0) return Promise.resolve()
      if (conflictRef.current) return Promise.reject(new Error('Document conflict'))
      return enqueueSave(latestSaveRef.current).then((status) => {
        if (status === 'conflict') throw new Error('Document conflict')
      })
    }
    const handleFlush = (event: Event) => {
      const pending = (
        event as CustomEvent<{ pending?: Promise<unknown>[] }>
      ).detail?.pending
      pending?.push(flush())
    }
    window.addEventListener('note-down:flush-request', handleFlush)
    return () => {
      window.removeEventListener('note-down:flush-request', handleFlush)
      if (revisionRef.current > 0 && !conflictRef.current) {
        void enqueueSave(latestSaveRef.current).catch(() => {})
      }
    }
  }, [enqueueSave])

  const loadDiskVersion = () => {
    if (!conflict) return
    const loaded = splitDocumentFile(conflict.content ?? '', initialTitle)
    setCurrentFrontMatter(loaded.frontMatter)
    setTitle(loaded.title)
    setMarkdown(loaded.markdown)
    baseRevisionRef.current = conflict.revision
    conflictRef.current = null
    setConflict(null)
    setEditorVersion((current) => current + 1)
    emitSaveState('saved')
  }

  const keepLocalVersion = async () => {
    if (!conflict || !window.noteDown) return
    const prefix = currentFrontMatter ? `${currentFrontMatter}\n\n` : ''
    const content = `${prefix}# ${title.trim() || '未命名文档'}\n\n${markdown}\n`
    emitSaveState('saving')
    try {
      const result = await window.noteDown.saveDocument({
        documentId,
        libraryPath,
        content,
        baseRevision: conflict.revision,
        force: true,
      })
      if (result.status !== 'saved') return
      baseRevisionRef.current = result.revision
      conflictRef.current = null
      setConflict(null)
      emitSaveState('saved')
    } catch {
      emitSaveState('error')
    }
  }

  const markChanged = () => {
    emitSaveState('saving')
    setRevision((current) => {
      revisionRef.current = current + 1
      return current + 1
    })
  }

  useEffect(() => {
    if (!taskIdMigrationPendingRef.current) return
    taskIdMigrationPendingRef.current = false
    markChanged()
  }, [])

  const metadataContent = typeof metadata === 'function'
    ? metadata({
        tags: frontMatterTags(currentFrontMatter),
        setTags: (tags) => {
          setCurrentFrontMatter((current) => updateFrontMatterTags(current, tags))
          markChanged()
        },
      })
    : metadata

  return (
    <div className="markdown-document is-ready">
      {beforeTitle}
      {conflict && (
        <div className="document-conflict" role="alert">
          <Refresh size={16} strokeWidth={1.9} />
          <span>
            <strong>磁盘内容已更新</strong>
            <small>选择载入外部修改，或保留当前内容。</small>
          </span>
          <button type="button" onClick={loadDiskVersion}>载入磁盘</button>
          <button type="button" onClick={() => void keepLocalVersion()}>保留当前</button>
        </div>
      )}
      <div className="document-title-layout">
        {metadataContent && <div className="document-title-leading">{metadataContent}</div>}
        <EditableTitle
          value={title}
          editorId={editorId}
          spellCheck={editorSettings.spellcheck}
          onChange={(value) => {
            setTitle(value)
            markChanged()
          }}
        />
      </div>
      {editorSettings.editorMode === 'source' ? (
        <textarea
          id={editorId}
          className="docx-source-editor"
          value={markdown}
          aria-label={`${ariaLabel}源码`}
          spellCheck={editorSettings.spellcheck}
          onChange={(event) => {
            const value = event.currentTarget.value
            setMarkdown(value)
            onTasksChange?.(collectDocumentTasks(parseMarkdown(value)))
            markChanged()
          }}
        />
      ) : (
        <SlateDocumentEditor
          key={`${editorId}-${editorVersion}`}
          editorId={editorId}
          publishSourceId={documentId}
          initialMarkdown={markdown}
          ariaLabel={ariaLabel}
          storeAssetFile={storeAssetFile}
          resolveAssetURL={resolveAssetURL}
          openStoredAsset={openStoredAsset}
          spellCheck={editorSettings.spellcheck}
          pasteMode={editorSettings.pasteMode}
          onPublishParagraph={onPublishParagraph}
          onTasksChange={onTasksChange}
          onValueChange={(value) => {
            setMarkdown(serializeMarkdown(value))
            markChanged()
          }}
        />
      )}
    </div>
  )
}

export default function MarkdownDocumentEditor({
  documentId,
  libraryPath,
  initialTitle,
  initialMarkdown,
  beforeTitle,
  metadata,
  onPublishParagraph,
  onTasksChange,
  ariaLabel,
}: {
  documentId: string
  libraryPath: string
  initialTitle: string
  initialMarkdown: string
  beforeTitle?: ReactNode
  metadata?: ReactNode | ((value: { tags: string[]; setTags: (tags: string[]) => void }) => ReactNode)
  onPublishParagraph?: (paragraph: PublishParagraphPayload) => void
  onTasksChange?: (tasks: DocumentTaskSnapshot[]) => void
  ariaLabel: string
}) {
  useI18n()
  const [loaded, setLoaded] = useState<{
    frontMatter: string
    title: string
    markdown: string
    revision: string | null
  } | null>(null)
  const previewStorageKey = `note-down.preview-document.${documentId}`

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const state = window.noteDown
        ? await window.noteDown.loadDocumentState({ documentId, libraryPath })
        : {
            content: window.localStorage.getItem(previewStorageKey),
            revision: null,
          }
      if (cancelled) return
      const content = state.content
      setLoaded(
        content
          ? { ...splitDocumentFile(content, initialTitle), revision: state.revision }
          : {
              frontMatter: '',
              title: initialTitle,
              markdown: initialMarkdown,
              revision: state.revision,
            },
      )
      emitSaveState('saved')
    }
    const handleRestored = (event: Event) => {
      const restoredId = (event as CustomEvent<{ documentId: string }>).detail?.documentId
      if (restoredId === documentId) void load()
    }
    window.addEventListener('note-down:document-restored', handleRestored)
    void load()
    return () => {
      cancelled = true
      window.removeEventListener('note-down:document-restored', handleRestored)
    }
  // 资料库监听只更新索引摘要；正文重载必须由切换文档或显式恢复触发，避免覆盖未保存输入。
  }, [documentId, libraryPath, previewStorageKey])

  if (!loaded) return <div className="markdown-document" aria-busy="true" />

  return (
    <LoadedDocumentEditor
      key={`${documentId}:${loaded.revision ?? 'new'}`}
      documentId={documentId}
      libraryPath={libraryPath}
      frontMatter={loaded.frontMatter}
      initialRevision={loaded.revision}
      title={loaded.title}
      markdown={loaded.markdown}
      beforeTitle={beforeTitle}
      metadata={metadata}
      onPublishParagraph={onPublishParagraph}
      onTasksChange={onTasksChange}
      ariaLabel={ariaLabel}
    />
  )
}
