import {
  AlarmClock,
  Bookmark,
  Checklist,
  Code,
  DocumentText,
  Grid,
  Image,
  InfoSquare,
  Layout,
  Link,
  LinkSquare,
  List,
  Math as MathIcon,
  Minus,
  OrderedList,
  QuoteUp,
  Task,
  Text,
  Video,
  type IconComponent,
} from 'reicon-react'
import type { BaseEditor, Descendant } from 'slate'
import type { HistoryEditor } from 'slate-history'
import type { ReactEditor } from 'slate-react'

export type CalloutTone =
  | 'default'
  | 'orange'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'gray'
  | 'gray-light'
  | 'gray-dark'
  | 'red-dark'
  | 'orange-dark'
  | 'yellow-dark'
  | 'green-dark'
  | 'blue-dark'
  | 'purple-dark'

export type TextAlignment = 'left' | 'center' | 'right' | 'justify'

export type NoteText = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  color?: string
  backgroundColor?: string
}

export type LinkElement = {
  id: string
  type: 'link'
  url: string
  children: NoteText[]
}

export type ReminderElement = {
  id: string
  type: 'reminder'
  date: string
  label: string
  children: NoteText[]
}

export type InlineChild = NoteText | LinkElement | ReminderElement

export type ParagraphElement = {
  id: string
  type: 'paragraph'
  align?: TextAlignment
  children: InlineChild[]
}

export type HeadingElement = {
  id: string
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  align?: TextAlignment
  children: InlineChild[]
}

export type ListElement = {
  id: string
  type: 'bullet' | 'numbered'
  indent: number
  align?: TextAlignment
  children: InlineChild[]
}

export type TodoElement = {
  id: string
  type: 'todo'
  indent: number
  checked: boolean
  align?: TextAlignment
  children: InlineChild[]
}

export type QuoteElement = {
  id: string
  type: 'quote'
  align?: TextAlignment
  children: InlineChild[]
}

export type CodeElement = {
  id: string
  type: 'code'
  language: string
  children: NoteText[]
}

export type CalloutElement = {
  id: string
  type: 'callout'
  emoji: string
  tone: CalloutTone
  children: NoteElement[]
}

export type DividerElement = {
  id: string
  type: 'divider'
  children: NoteText[]
}

export type TableCellElement = {
  id: string
  type: 'table-cell'
  header?: boolean
  children: NoteElement[]
}

export type TableRowElement = {
  id: string
  type: 'table-row'
  children: TableCellElement[]
}

export type TableElement = {
  id: string
  type: 'table'
  children: TableRowElement[]
}

export type ColumnElement = {
  id: string
  type: 'column'
  children: NoteElement[]
}

export type ColumnsElement = {
  id: string
  type: 'columns'
  widths?: number[]
  children: ColumnElement[]
}

export type EquationElement = {
  id: string
  type: 'equation'
  formula: string
  children: NoteText[]
}

export type ImageElement = {
  id: string
  type: 'image'
  url: string
  caption: string
  children: NoteText[]
}

export type MediaElement = {
  id: string
  type: 'media'
  url: string
  name: string
  mediaKind: 'video' | 'file'
  children: NoteText[]
}

export type BookmarkElement = {
  id: string
  type: 'bookmark'
  url: string
  title: string
  description: string
  children: NoteText[]
}

export type TaskElement = {
  id: string
  type: 'task'
  title: string
  checked: boolean
  due: string
  children: NoteText[]
}

export type ButtonElement = {
  id: string
  type: 'button'
  label: string
  url: string
  children: NoteText[]
}

export type RawElement = {
  id: string
  type: 'raw'
  source: string
  children: NoteText[]
}

export type NoteElement = (
  | ParagraphElement
  | HeadingElement
  | ListElement
  | TodoElement
  | QuoteElement
  | CodeElement
  | CalloutElement
  | DividerElement
  | TableElement
  | TableRowElement
  | TableCellElement
  | ColumnsElement
  | ColumnElement
  | EquationElement
  | ImageElement
  | MediaElement
  | BookmarkElement
  | TaskElement
  | ButtonElement
  | RawElement
  | LinkElement
  | ReminderElement
) & {
  markdownSource?: string
  markdownSnapshot?: string
  markdownIndex?: number
  markdownGapBefore?: number
  markdownTrailingLines?: number
}

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor
    Element: NoteElement
    Text: NoteText
  }
}

export type SlashCommandGroup = 'text' | 'media' | 'business'
export type HeadingCommandId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'heading7'
  | 'heading8'
  | 'heading9'

export type SlashCommandId =
  | 'paragraph'
  | HeadingCommandId
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'table'
  | 'columns'
  | 'equation'
  | 'link'
  | 'image'
  | 'media'
  | 'bookmark'
  | 'task'
  | 'reminder'
  | 'button'

export type SlashCommand = {
  id: SlashCommandId
  label: string
  hint: string
  keywords: string
  group: SlashCommandGroup
  icon: IconComponent
}

const headingCommands = Array.from({ length: 9 }, (_, index) => {
  const level = index + 1
  return {
    id: `heading${level}` as HeadingCommandId,
    label: `标题 ${level}`,
    hint: '#'.repeat(level),
    keywords: `h${level} 标题 heading`,
    group: 'text' as const,
    icon: DocumentText,
  }
})

export const slashCommands: SlashCommand[] = [
  {
    id: 'paragraph',
    label: '正文',
    hint: 'Text',
    keywords: '文本 text paragraph',
    group: 'text',
    icon: Text,
  },
  ...headingCommands,
  {
    id: 'bullet',
    label: '无序列表',
    hint: '-',
    keywords: '列表 bullet list',
    group: 'text',
    icon: List,
  },
  {
    id: 'numbered',
    label: '有序列表',
    hint: '1.',
    keywords: '列表 ordered numbered list',
    group: 'text',
    icon: OrderedList,
  },
  {
    id: 'todo',
    label: '任务列表',
    hint: '[]',
    keywords: '待办 checkbox todo',
    group: 'text',
    icon: Checklist,
  },
  {
    id: 'quote',
    label: '引用',
    hint: '>',
    keywords: 'quote blockquote',
    group: 'text',
    icon: QuoteUp,
  },
  {
    id: 'callout',
    label: '高亮块',
    hint: '!',
    keywords: 'callout highlight 提示',
    group: 'text',
    icon: InfoSquare,
  },
  {
    id: 'code',
    label: '代码块',
    hint: '```',
    keywords: 'code 代码',
    group: 'text',
    icon: Code,
  },
  {
    id: 'divider',
    label: '分割线',
    hint: '---',
    keywords: 'divider separator',
    group: 'text',
    icon: Minus,
  },
  {
    id: 'table',
    label: '表格',
    hint: '2 × 2',
    keywords: 'table grid',
    group: 'text',
    icon: Grid,
  },
  {
    id: 'columns',
    label: '分栏',
    hint: '2 栏',
    keywords: 'column layout 分列',
    group: 'text',
    icon: Layout,
  },
  {
    id: 'equation',
    label: '公式',
    hint: '$$',
    keywords: 'math equation latex',
    group: 'text',
    icon: MathIcon,
  },
  {
    id: 'link',
    label: '链接',
    hint: '⌘ K',
    keywords: 'link url 超链接',
    group: 'text',
    icon: Link,
  },
  {
    id: 'image',
    label: '图片',
    hint: 'Image',
    keywords: 'image picture 图片',
    group: 'media',
    icon: Image,
  },
  {
    id: 'media',
    label: '视频或文件',
    hint: 'File',
    keywords: 'video file 视频 文件 附件',
    group: 'media',
    icon: Video,
  },
  {
    id: 'bookmark',
    label: '网页卡片',
    hint: 'URL',
    keywords: 'bookmark web card 书签 网页',
    group: 'media',
    icon: Bookmark,
  },
  {
    id: 'task',
    label: '任务',
    hint: 'Task',
    keywords: 'task due 任务 截止',
    group: 'business',
    icon: Task,
  },
  {
    id: 'reminder',
    label: '日期提醒',
    hint: 'Date',
    keywords: 'reminder date calendar 提醒 日期',
    group: 'business',
    icon: AlarmClock,
  },
  {
    id: 'button',
    label: '按钮',
    hint: 'Link',
    keywords: 'button link 按钮 跳转',
    group: 'business',
    icon: LinkSquare,
  },
]

let elementSequence = 0

export function createElementId() {
  elementSequence += 1
  return `node-${Date.now().toString(36)}-${elementSequence.toString(36)}`
}

export function ensureTaskBlockIds(markdown: string) {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(newline)
  let changed = false
  const next = lines.map((line) => {
    if (!/^::: task\b/.test(line) || /\sid=\S+/.test(line)) return line
    changed = true
    return line.replace(/^::: task\b/, `::: task id=${createElementId()}`)
  })
  return changed ? next.join(newline) : markdown
}

export function splitDocumentFile(content: string, initialTitle: string) {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const frontMatterMatch = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/)
  const frontMatter = frontMatterMatch?.[0].trimEnd() ?? ''
  const documentBody = frontMatterMatch
    ? normalized.slice(frontMatterMatch[0].length).replace(/^\n+/, '')
    : normalized
  const [firstLine = '', ...body] = documentBody.split('\n')
  const titleMatch = firstLine.match(/^#\s+(.+)$/)
  const markdown = body[0] === '' ? body.slice(1).join('\n') : body.join('\n')
  return titleMatch
    ? { frontMatter, title: titleMatch[1].trim(), markdown }
    : { frontMatter, title: initialTitle, markdown: documentBody }
}

const textChildren = (text = ''): InlineChild[] => [{ text }]
const voidChildren = (): NoteText[] => [{ text: '' }]

export function createParagraph(text = ''): ParagraphElement {
  return { id: createElementId(), type: 'paragraph', children: textChildren(text) }
}

const createCell = (header = false, text = ''): TableCellElement => ({
  id: createElementId(),
  type: 'table-cell',
  header,
  children: [createParagraph(text)],
})

const createRow = (width: number, header = false, values: string[] = []): TableRowElement => ({
  id: createElementId(),
  type: 'table-row',
  children: Array.from({ length: width }, (_, index) =>
    createCell(header, values[index] ?? ''),
  ),
})

export function createTable(width = 2, height = 2): TableElement {
  return {
    id: createElementId(),
    type: 'table',
    children: Array.from({ length: height }, (_, index) => createRow(width, index === 0)),
  }
}

export function normalizeColumnWidths(count: number, values: number[] = []) {
  if (count <= 0) return []
  const valid = values.length === count && values.every((value) => Number.isFinite(value) && value > 0)
  const source = valid ? values : Array.from({ length: count }, () => 100 / count)
  const total = source.reduce((sum, value) => sum + value, 0)
  return source.map((value) => Number(((value / total) * 100).toFixed(3)))
}

export function createBlockForCommand(id: SlashCommandId, text = ''): NoteElement {
  if (id.startsWith('heading')) {
    return {
      id: createElementId(),
      type: 'heading',
      level: Number(id.slice(7)) as HeadingElement['level'],
      children: textChildren(text),
    }
  }
  if (id === 'paragraph') return createParagraph(text)
  if (id === 'bullet' || id === 'numbered') {
    return { id: createElementId(), type: id, indent: 0, children: textChildren(text) }
  }
  if (id === 'todo') {
    return {
      id: createElementId(),
      type: 'todo',
      checked: false,
      indent: 0,
      children: textChildren(text),
    }
  }
  if (id === 'quote') {
    return { id: createElementId(), type: 'quote', children: textChildren(text) }
  }
  if (id === 'callout') {
    return {
      id: createElementId(),
      type: 'callout',
      emoji: '💡',
      tone: 'orange',
      children: [createParagraph(text)],
    }
  }
  if (id === 'code') {
    return { id: createElementId(), type: 'code', language: '', children: [{ text }] }
  }
  if (id === 'divider') {
    return { id: createElementId(), type: 'divider', children: voidChildren() }
  }
  if (id === 'table') return createTable()
  if (id === 'columns') {
    return {
      id: createElementId(),
      type: 'columns',
      widths: [50, 50],
      children: Array.from({ length: 2 }, () => ({
        id: createElementId(),
        type: 'column' as const,
        children: [createParagraph()],
      })),
    }
  }
  if (id === 'equation') {
    return {
      id: createElementId(),
      type: 'equation',
      formula: text || 'E = mc^2',
      children: voidChildren(),
    }
  }
  if (id === 'image') {
    return { id: createElementId(), type: 'image', url: '', caption: text, children: voidChildren() }
  }
  if (id === 'media') {
    return {
      id: createElementId(),
      type: 'media',
      url: '',
      name: text,
      mediaKind: 'video',
      children: voidChildren(),
    }
  }
  if (id === 'bookmark') {
    return {
      id: createElementId(),
      type: 'bookmark',
      url: '',
      title: text,
      description: '',
      children: voidChildren(),
    }
  }
  if (id === 'task') {
    return {
      id: createElementId(),
      type: 'task',
      title: text,
      checked: false,
      due: '',
      children: voidChildren(),
    }
  }
  if (id === 'button') {
    return {
      id: createElementId(),
      type: 'button',
      label: text || '打开链接',
      url: '',
      children: voidChildren(),
    }
  }
  if (id === 'link') {
    return createParagraph(text || '链接')
  }
  return createParagraph(text)
}

export function createReminder(label = '今天', date = new Date().toISOString()): ReminderElement {
  return { id: createElementId(), type: 'reminder', date, label, children: voidChildren() }
}

export function createLink(text = '链接', url = 'https://'): LinkElement {
  return { id: createElementId(), type: 'link', url, children: [{ text }] }
}

export const isElement = (node: unknown): node is NoteElement =>
  Boolean(node && typeof node === 'object' && 'type' in node && 'children' in node)

export const isTextBlock = (
  element: NoteElement,
): element is ParagraphElement | HeadingElement | ListElement | TodoElement | QuoteElement | CodeElement =>
  ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote', 'code'].includes(element.type)

export const isVoidBlock = (element: NoteElement) =>
  ['divider', 'equation', 'image', 'media', 'bookmark', 'task', 'button', 'raw'].includes(
    element.type,
  )

export function blockLabel(element: NoteElement) {
  if (element.type === 'heading') return `标题 ${element.level}`
  const labels: Partial<Record<NoteElement['type'], string>> = {
    paragraph: '正文',
    bullet: '无序列表',
    numbered: '有序列表',
    todo: '任务列表',
    quote: '引用',
    callout: '高亮块',
    code: '代码块',
    divider: '分割线',
    table: '表格',
    columns: '分栏',
    equation: '公式',
    image: '图片',
    media: '视频或文件',
    bookmark: '网页卡片',
    task: '任务',
    button: '按钮',
    raw: '原始 Markdown',
  }
  return labels[element.type] ?? '内容'
}

const inlinePattern = new RegExp(
  [
    '<span\\s+style="[^"]+">[\\s\\S]*?<\\/span>',
    '\\*\\*[^*\\n]+\\*\\*',
    '~~[^~\\n]+~~',
    '`[^`\\n]+`',
    '<u>[\\s\\S]*?<\\/u>',
    '\\[reminder:[^\\]\\n]+\\]\\([^)\\n]*\\)',
    '\\[[^\\]\\n]+\\]\\([^)\\n]+\\)',
    '\\*[^*\\n]+\\*',
  ].join('|'),
  'g',
)

const inlineColor = (style: string, property: 'color' | 'background-color') =>
  style.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)(?:;|$)`, 'i'))?.[1].trim()

const applyInlineColors = (
  child: InlineChild,
  color?: string,
  backgroundColor?: string,
): InlineChild => {
  if ('text' in child) return { ...child, color, backgroundColor }
  if (child.type === 'link') {
    return {
      ...child,
      children: child.children.map((text) => ({ ...text, color, backgroundColor })),
    }
  }
  return child
}

const applyInlineUnderline = (child: InlineChild): InlineChild => {
  if ('text' in child) return { ...child, underline: true }
  return {
    ...child,
    children: child.children.map((text) => ({ ...text, underline: true })),
  }
}

function parseInline(text: string): InlineChild[] {
  const source = text.replace(/<br\s*\/?\s*>/gi, '\n')
  const children: InlineChild[] = []
  let cursor = 0
  for (const match of source.matchAll(inlinePattern)) {
    const start = match.index ?? 0
    if (start > cursor) children.push({ text: source.slice(cursor, start) })
    const token = match[0]
    if (token.startsWith('<span')) {
      const styled = token.match(/^<span\s+style="([^"]+)">([\s\S]*)<\/span>$/)
      if (styled) {
        const color = inlineColor(styled[1], 'color')
        const backgroundColor = inlineColor(styled[1], 'background-color')
        children.push(
          ...parseInline(styled[2]).map((child) =>
            applyInlineColors(child, color, backgroundColor),
          ),
        )
      }
    } else if (token.startsWith('**')) children.push({ text: token.slice(2, -2), bold: true })
    else if (token.startsWith('~~')) children.push({ text: token.slice(2, -2), strike: true })
    else if (token.startsWith('`')) children.push({ text: token.slice(1, -1), code: true })
    else if (token.startsWith('<u>')) {
      children.push(...parseInline(token.slice(3, -4)).map(applyInlineUnderline))
    }
    else if (token.startsWith('[reminder:')) {
      const reminder = token.match(/^\[reminder:([^\]]+)\]\(([^)]*)\)$/)
      if (reminder) children.push(createReminder(reminder[1], reminder[2]))
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) children.push(createLink(link[1], link[2]))
    } else children.push({ text: token.slice(1, -1), italic: true })
    cursor = start + token.length
  }
  if (cursor < source.length) children.push({ text: source.slice(cursor) })
  return children.length > 0 ? children : [{ text: '' }]
}

const parseTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))

const isTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

const markdownElementSnapshot = (element: NoteElement) =>
  JSON.stringify(element, (key, value) =>
    [
      'id',
      'markdownSource',
      'markdownSnapshot',
      'markdownIndex',
      'markdownGapBefore',
      'markdownTrailingLines',
    ].includes(key)
      ? undefined
      : value,
  )

const markdownBlockStartsAt = (lines: string[], index: number) => {
  const line = lines[index]
  const trimmed = line.trim()
  return (
    !trimmed
    || trimmed.startsWith('```')
    || trimmed === '$$'
    || /^:::\s*\S+/.test(trimmed)
    || /^\s*>\s*\[!(?:CALLOUT|NOTE|TIP|WARNING)\]/i.test(line)
    || (
      index + 1 < lines.length
      && line.includes('|')
      && isTableSeparator(lines[index + 1])
    )
    || /^(?:#{1,9})\s+/.test(line)
    || /^\s*---+\s*$/.test(line)
    || /^(\s*)-\s+\[([ xX])\]\s*/.test(line)
    || /^!\[(.*)\]\((.*?)\)$/.test(line)
    || /^\[(?:video|file):[^\]]*\]\((.*?)\)$/i.test(line)
    || /^\[bookmark:[^\]]*\]\(/i.test(line)
    || /^\[button:[^\]]*\]\(/i.test(line)
    || /^(\s*)[-*+]\s+/.test(line)
    || /^(\s*)\d+\.\s+/.test(line)
    || /^\s*>\s?/.test(line)
  )
}

export function parseMarkdown(markdown: string): Descendant[] {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const nodes: NoteElement[] = []
  let index = 0
  let sourceStart = 0
  let previousSourceEnd = -1
  const pushNode = (node: NoteElement) => {
    const withSource = {
      ...node,
      markdownSource: lines.slice(sourceStart, index + 1).join('\n'),
      markdownIndex: nodes.length,
      markdownGapBefore: sourceStart - previousSourceEnd - 1,
    }
    withSource.markdownSnapshot = markdownElementSnapshot(withSource)
    nodes.push(withSource)
    previousSourceEnd = index
  }
  let pendingAlignment: TextAlignment | undefined
  const takeAlignment = () => {
    const alignment = pendingAlignment
    pendingAlignment = undefined
    return alignment
  }

  for (index = 0; index < lines.length; index += 1) {
    if (!pendingAlignment) sourceStart = index
    const line = lines[index]
    const alignment = line.trim().match(/^<!--\s*align:(left|center|right|justify)\s*-->$/)
    if (alignment) {
      pendingAlignment = alignment[1] as TextAlignment
      continue
    }
    if (!line.trim()) continue

    if (line.trimStart().startsWith('```')) {
      const language = line.trimStart().slice(3).trim()
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) {
        body.push(lines[index])
        index += 1
      }
      pushNode({
        id: createElementId(),
        type: 'code',
        language,
        children: [{ text: body.join('\n') }],
      })
      continue
    }

    if (line.trim() === '$$') {
      const body: string[] = []
      index += 1
      while (index < lines.length && lines[index].trim() !== '$$') {
        body.push(lines[index])
        index += 1
      }
      pushNode({
        id: createElementId(),
        type: 'equation',
        formula: body.join('\n').trim(),
        children: voidChildren(),
      })
      continue
    }

    const columnsDirective = line.trim().match(/^::: columns(?:\s+widths=([\d.,]+))?$/)
    if (columnsDirective) {
      const columns: ColumnElement[] = []
      let columnLines: string[] = []
      let hasColumn = false
      index += 1
      for (; index < lines.length; index += 1) {
        if (lines[index].trim() === '::: column') {
          if (hasColumn) {
            columns.push({
              id: createElementId(),
              type: 'column',
              children: parseMarkdown(columnLines.join('\n')) as NoteElement[],
            })
            columnLines = []
          }
          hasColumn = true
          continue
        }
        if (lines[index].trim() === ':::') break
        columnLines.push(lines[index])
      }
      if (hasColumn || columnLines.length > 0 || columns.length === 0) {
        columns.push({
          id: createElementId(),
          type: 'column',
          children: parseMarkdown(columnLines.join('\n')) as NoteElement[],
        })
      }
      while (columns.length < 2) {
        columns.push({ id: createElementId(), type: 'column', children: [createParagraph()] })
      }
      const widths = columnsDirective[1]
        ?.split(',')
        .map(Number)
        .filter((value) => Number.isFinite(value))
      pushNode({
        id: createElementId(),
        type: 'columns',
        widths: normalizeColumnWidths(columns.length, widths),
        children: columns,
      })
      continue
    }

    const taskDirective = line.match(
      /^::: task(?:\s+id=(\S+))?(?:\s+checked=(true|false))?(?:\s+due=(\S+))?\s*$/,
    )
    if (taskDirective) {
      const title: string[] = []
      index += 1
      while (index < lines.length && lines[index].trim() !== ':::') {
        title.push(lines[index])
        index += 1
      }
      pushNode({
        id: taskDirective[1] ?? createElementId(),
        type: 'task',
        title: title.join('\n').trim(),
        checked: taskDirective[2] === 'true',
        due: taskDirective[3] ?? '',
        children: voidChildren(),
      })
      continue
    }

    if (/^\s*:::\s*\S+/.test(line)) {
      const source = [line]
      index += 1
      while (index < lines.length) {
        source.push(lines[index])
        if (lines[index].trim() === ':::') break
        index += 1
      }
      pushNode({
        id: createElementId(),
        type: 'raw',
        source: source.join('\n'),
        children: voidChildren(),
      })
      continue
    }

    const callout = line.match(
      /^\s*>\s*\[!(CALLOUT|NOTE|TIP|WARNING)\](?:\s+(\S+))?(?:\s+\{tone=([\w-]+)\})?\s*$/i,
    )
    if (callout) {
      const body: string[] = []
      index += 1
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      index -= 1
      const legacyTone = callout[1].toLowerCase()
      const tone =
        (callout[3] as CalloutTone | undefined) ??
        (legacyTone === 'tip' ? 'green' : legacyTone === 'warning' ? 'yellow' : 'orange')
      pushNode({
        id: createElementId(),
        type: 'callout',
        emoji: callout[2] && !callout[2].startsWith('{') ? callout[2] : '💡',
        tone,
        children: parseMarkdown(body.join('\n')) as NoteElement[],
      })
      continue
    }

    if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
      const values = [parseTableRow(line)]
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        values.push(parseTableRow(lines[index]))
        index += 1
      }
      index -= 1
      const width = Math.max(2, ...values.map((row) => row.length))
      pushNode({
        id: createElementId(),
        type: 'table',
        children: values.map((row, rowIndex) => createRow(width, rowIndex === 0, row)),
      })
      continue
    }

    const heading = line.match(/^(#{1,9})\s+(.*)$/)
    if (heading) {
      pushNode({
        id: createElementId(),
        type: 'heading',
        level: heading[1].length as HeadingElement['level'],
        align: takeAlignment(),
        children: parseInline(heading[2]),
      })
      continue
    }

    if (/^\s*---+\s*$/.test(line)) {
      pushNode({ id: createElementId(), type: 'divider', children: voidChildren() })
      continue
    }

    const todo = line.match(/^(\s*)-\s+\[([ xX])\]\s*(.*)$/)
    if (todo) {
      pushNode({
        id: createElementId(),
        type: 'todo',
        checked: todo[2].toLowerCase() === 'x',
        indent: Math.floor(todo[1].length / 2),
        align: takeAlignment(),
        children: parseInline(todo[3]),
      })
      continue
    }

    const image = line.match(/^!\[(.*)\]\((.*?)\)$/)
    if (image) {
      pushNode({
        id: createElementId(),
        type: 'image',
        caption: image[1],
        url: image[2].trim(),
        children: voidChildren(),
      })
      continue
    }

    const media = line.match(/^\[(video|file):([^\]]*)\]\((.*?)\)$/i)
    if (media) {
      pushNode({
        id: createElementId(),
        type: 'media',
        mediaKind: media[1].toLowerCase() === 'file' ? 'file' : 'video',
        name: media[2].trim(),
        url: media[3].trim(),
        children: voidChildren(),
      })
      continue
    }

    const bookmark = line.match(/^\[bookmark:([^\]]*)\]\(([^)\s]*)(?:\s+"((?:\\.|[^"])*)")?\)$/i)
    if (bookmark) {
      pushNode({
        id: createElementId(),
        type: 'bookmark',
        title: bookmark[1].trim(),
        url: bookmark[2].trim(),
        description: (bookmark[3] ?? '').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        children: voidChildren(),
      })
      continue
    }

    const button = line.match(/^\[button:([^\]]*)\]\((.*?)\)$/i)
    if (button) {
      pushNode({
        id: createElementId(),
        type: 'button',
        label: button[1].trim(),
        url: button[2].trim(),
        children: voidChildren(),
      })
      continue
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bullet) {
      pushNode({
        id: createElementId(),
        type: 'bullet',
        indent: Math.floor(bullet[1].length / 2),
        align: takeAlignment(),
        children: parseInline(bullet[2]),
      })
      continue
    }

    const numbered = line.match(/^(\s*)\d+\.\s+(.*)$/)
    if (numbered) {
      pushNode({
        id: createElementId(),
        type: 'numbered',
        indent: Math.floor(numbered[1].length / 2),
        align: takeAlignment(),
        children: parseInline(numbered[2]),
      })
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      pushNode({
        id: createElementId(),
        type: 'quote',
        align: takeAlignment(),
        children: parseInline(quote[1]),
      })
      continue
    }

    const paragraphLines = [line]
    while (
      index + 1 < lines.length
      && lines[index + 1].trim()
      && !markdownBlockStartsAt(lines, index + 1)
    ) {
      index += 1
      paragraphLines.push(lines[index])
    }
    pushNode({
      id: createElementId(),
      type: 'paragraph',
      align: takeAlignment(),
      children: parseInline(paragraphLines.join('\n')),
    })
  }

  if (nodes.length === 0) return [createParagraph()]
  nodes.at(-1)!.markdownTrailingLines = lines.length - previousSourceEnd - 1
  const last = nodes.at(-1)
  const needsTrailingParagraph = [
    'heading',
    'divider',
    'table',
    'columns',
    'callout',
    'equation',
    'image',
    'media',
    'bookmark',
    'task',
    'button',
    'raw',
  ]
  if (last && needsTrailingParagraph.includes(last.type)) {
    nodes.push(createParagraph())
  }
  return nodes
}

const plainText = (node: NoteElement | NoteText): string => {
  if ('text' in node) return node.text
  return node.children.map((child) => plainText(child as NoteElement | NoteText)).join('')
}

const serializeText = (text: NoteText) => {
  let value = text.text.replace(/\n/g, '<br>')
  if (text.code) value = `\`${value}\``
  if (text.bold) value = `**${value}**`
  if (text.italic) value = `*${value}*`
  if (text.strike) value = `~~${value}~~`
  if (text.underline) value = `<u>${value}</u>`
  const styles = [
    text.color && `color:${text.color}`,
    text.backgroundColor && `background-color:${text.backgroundColor}`,
  ].filter(Boolean)
  if (styles.length > 0) value = `<span style="${styles.join(';')}">${value}</span>`
  return value
}

const serializeInline = (children: InlineChild[]): string =>
  children
    .map((child) => {
      if ('text' in child) return serializeText(child)
      if (child.type === 'link') return `[${serializeInline(child.children)}](${child.url})`
      return `[reminder:${child.label}](${child.date})`
    })
    .join('')

const serializeTable = (table: TableElement) => {
  const values = table.children.map((row) =>
    row.children.map((cell) => plainText(cell).replace(/\|/g, '\\|')),
  )
  const width = Math.max(2, ...values.map((row) => row.length))
  const normalize = (row: string[]) =>
    Array.from({ length: width }, (_, index) => row[index] ?? '')
  const [header = [], ...body] = values
  return [
    `| ${normalize(header).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${normalize(row).join(' | ')} |`),
  ].join('\n')
}

const withAlignment = (
  element: { align?: TextAlignment },
  value: string,
) => element.align && element.align !== 'left' ? `<!-- align:${element.align} -->\n${value}` : value

const serializeElement = (element: NoteElement, siblings: NoteElement[], index: number): string => {
  if (
    element.markdownSource !== undefined
    && element.markdownIndex === index
    && element.markdownSnapshot === markdownElementSnapshot(element)
  ) {
    return element.markdownSource
  }
  if (element.type === 'paragraph') {
    return withAlignment(element, serializeInline(element.children))
  }
  if (element.type === 'heading') {
    return withAlignment(
      element,
      `${'#'.repeat(element.level)} ${serializeInline(element.children)}`,
    )
  }
  if (element.type === 'bullet') {
    return withAlignment(
      element,
      `${'  '.repeat(element.indent)}- ${serializeInline(element.children)}`,
    )
  }
  if (element.type === 'numbered') {
    let number = 1
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const sibling = siblings[cursor]
      if (sibling.type !== 'numbered' || sibling.indent !== element.indent) break
      number += 1
    }
    return withAlignment(
      element,
      `${'  '.repeat(element.indent)}${number}. ${serializeInline(element.children)}`,
    )
  }
  if (element.type === 'todo') {
    return withAlignment(
      element,
      `${'  '.repeat(element.indent)}- [${element.checked ? 'x' : ' '}] ${serializeInline(element.children)}`,
    )
  }
  if (element.type === 'quote') {
    return withAlignment(element, `> ${serializeInline(element.children)}`)
  }
  if (element.type === 'code') return `\`\`\`${element.language}\n${plainText(element)}\n\`\`\``
  if (element.type === 'callout') {
    const body = serializeMarkdown(element.children)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    return `> [!CALLOUT] ${element.emoji} {tone=${element.tone}}\n${body}`
  }
  if (element.type === 'divider') return '---'
  if (element.type === 'table') return serializeTable(element)
  if (element.type === 'columns') {
    const widths = normalizeColumnWidths(element.children.length, element.widths)
    const equalWidth = 100 / element.children.length
    const widthAttribute = widths.some((value) => Math.abs(value - equalWidth) > 0.1)
      ? ` widths=${widths.map((value) => Number(value.toFixed(2))).join(',')}`
      : ''
    const columns = element.children
      .map((column) => `::: column\n${serializeMarkdown(column.children)}`)
      .join('\n')
    return `::: columns${widthAttribute}\n${columns}\n:::`
  }
  if (element.type === 'equation') return `$$\n${element.formula}\n$$`
  if (element.type === 'image') return `![${element.caption}](${element.url})`
  if (element.type === 'media') {
    return `[${element.mediaKind}:${element.name || '未命名'}](${element.url})`
  }
  if (element.type === 'bookmark') {
    const description = element.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()
    return `[bookmark:${element.title || element.url}](${element.url}${description ? ` "${description}"` : ''})`
  }
  if (element.type === 'task') {
    return `::: task id=${element.id} checked=${element.checked} due=${element.due || '-'}\n${element.title}\n:::`
  }
  if (element.type === 'button') return `[button:${element.label}](${element.url})`
  if (element.type === 'raw') return element.source
  return plainText(element)
}

export function serializeMarkdown(nodes: readonly Descendant[]) {
  const elements = nodes.filter(isElement)
  const last = elements.at(-1)
  const lastIsEmptyParagraph =
    last?.type === 'paragraph' &&
    last.children.length === 1 &&
    'text' in last.children[0] &&
    last.children[0].text === ''
  const serializable =
    lastIsEmptyParagraph ? elements.slice(0, -1) : elements
  const content = serializable
    .map((node, index) => {
      const separator = index === 0
        ? '\n'.repeat(node.markdownGapBefore ?? 0)
        : '\n'.repeat((node.markdownGapBefore ?? 1) + 1)
      return `${separator}${serializeElement(node, serializable, index)}`
    })
    .join('')
  const trailingLines = serializable.at(-1)?.markdownTrailingLines ?? 0
  return `${content}${'\n'.repeat(trailingLines)}`
}
