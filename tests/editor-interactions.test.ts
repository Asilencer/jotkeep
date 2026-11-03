import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { Node as SlateNode } from 'slate'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://jotkeep.test',
  pretendToBeVisual: true,
})
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Text',
  'Document', 'DocumentFragment', 'ShadowRoot', 'Selection', 'Range', 'DOMParser',
  'HTMLAnchorElement', 'HTMLImageElement',
  'HTMLTableElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'MutationObserver', 'CustomEvent', 'Event', 'InputEvent', 'CompositionEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'devicePixelRatio',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? dom.window : dom.window[key],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  get() { return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true' },
})
Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList

const { createRoot } = await import('react-dom/client')
const { default: MarkdownDocumentEditor } = await import('../src/MarkdownDocumentEditor')
const { htmlToMarkdown } = await import('../src/htmlToMarkdown')
const { parseMarkdown, serializeMarkdown } = await import('../src/markdownBlocks')
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test('自动保存和摘要刷新保留标题、正文实例与中文输入选区', async () => {
  let content = '# 原标题\n\n正文\n'
  let revision = 0
  let loads = 0
  window.noteDown = {
    loadDocumentState: async () => {
      loads += 1
      return { content, revision: String(revision) }
    },
    saveDocument: async (snapshot) => {
      content = snapshot.content
      revision += 1
      return { status: 'saved', revision: String(revision) }
    },
  } as typeof window.noteDown
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (initialTitle: string) => root.render(createElement(MarkdownDocumentEditor, {
    documentId: 'notes/title-regression',
    libraryPath: '/test-library',
    initialTitle,
    initialMarkdown: '',
    ariaLabel: 'Markdown 编辑器',
    onNotice: () => {},
  }))
  const refreshSummary = (event: Event) => {
    render((event as CustomEvent<{ title: string }>).detail.title)
  }
  window.addEventListener('note-down:document-saved', refreshSummary)
  try {
    await act(async () => render('原标题'))
    const title = container.querySelector<HTMLElement>('.document-title-editor')!
    const body = container.querySelector('.docx-editor')!
    await act(async () => {
      title.focus()
      title.textContent = '修改后的标题'
      title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      const range = document.createRange()
      range.setStart(title.firstChild!, 3)
      range.collapse(true)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      await wait(350)
    })
    assert.match(content, /^# 修改后的标题\n/)
    assert.equal(loads, 1, '保存后的摘要更新不应重新读取正文')
    assert.equal(container.querySelector('.document-title-editor'), title)
    assert.equal(container.querySelector('.docx-editor'), body)
    assert.equal(document.activeElement, title)
    assert.equal(window.getSelection()!.anchorOffset, 3)

    await act(async () => {
      title.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      title.textContent = '中文输入中'
      render('后台更新的摘要')
    })
    assert.equal(container.querySelector('.document-title-editor'), title)
    assert.equal(title.textContent, '中文输入中')
    assert.equal(document.activeElement, title)
    await act(async () => {
      title.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      await wait(350)
    })
    assert.match(content, /^# 中文输入中\n/)
    assert.equal(loads, 1)
  } finally {
    window.removeEventListener('note-down:document-saved', refreshSummary)
    await act(async () => root.unmount())
    container.remove()
    delete window.noteDown
  }
})

test('富文本粘贴与保存重载不增加可见转义符，也不激活被转义的 Markdown', () => {
  const text = '[方括号] *星号* \\路径 [文字](https://example.com)'
  let markdown = htmlToMarkdown(`<p>${text}</p>`)
  for (let index = 0; index < 3; index += 1) {
    const nodes = parseMarkdown(markdown)
    assert.equal(SlateNode.string(nodes[0]), text)
    const paragraph = nodes[0]
    assert.equal(paragraph.type, 'paragraph')
    assert.ok(paragraph.children.every((child) => 'text' in child && !child.italic))
    // 编辑后重新序列化，覆盖原文直通缓存之外的保存路径。
    delete paragraph.markdownSource
    markdown = serializeMarkdown(nodes)
  }
})

test('HTML 粘贴保留内嵌图片，并将行内图片转换为独立图片块', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo='
  const nodes = parseMarkdown(htmlToMarkdown(`<p>前文<img src="${image}" alt="图示">后文</p>`))
  assert.equal(SlateNode.string(nodes[0]), '前文')
  assert.ok(nodes.some((node) => node.type === 'image' && node.url === image && node.caption === '图示'))
  assert.ok(nodes.some((node) => SlateNode.string(node) === '后文'))
})

test('富文本中的字面符号保留粗体、斜体、链接与代码语义', () => {
  let markdown = htmlToMarkdown([
    '<p><strong>[加粗] *文字*</strong> <em>[斜体]</em> ',
    '<a href="https://example.com/a_(b)">[链接] *字符*</a> <code>\\[原样]</code></p>',
  ].join(''))
  for (let index = 0; index < 2; index += 1) {
    const nodes = parseMarkdown(markdown)
    assert.equal(SlateNode.string(nodes[0]), '[加粗] *文字* [斜体] [链接] *字符* \\[原样]')
    const children = nodes[0].children
    assert.ok(children.some((child) => 'text' in child && child.bold && child.text === '[加粗] *文字*'))
    assert.ok(children.some((child) => child.type === 'link' && child.url === 'https://example.com/a_(b)'))
    assert.ok(children.some((child) => 'text' in child && child.code && child.text === '\\[原样]'))
    delete nodes[0].markdownSource
    markdown = serializeMarkdown(nodes)
  }
})

test('复制和剪切保留图片与任务结构，粘贴生成独立 ID，块内输入框使用原生剪贴板', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const image = 'data:image/png;base64,iVBORw0KGgo='
  const source = [
    '前文 [方括号]',
    `![图片说明](${image})`,
    '::: task id=original-task checked=false due=-\n任务标题\n:::',
    '| 表头一 | 表头二 |\n| --- | --- |\n| 单元格 [内容] | 第二列 |',
    '后文',
  ].join('\n\n')
  const data = new Map<string, string>()
  const clipboardData = {
    files: [],
    getData: (format: string) => data.get(format) ?? '',
    setData: (format: string, value: string) => data.set(format, value),
  }
  const dispatchClipboard = (target: Element, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: clipboardData })
    target.dispatchEvent(event)
    return event
  }
  const render = (id: string, markdown: string) => root.render(createElement(MarkdownDocumentEditor, {
    key: id,
    documentId: `notes/${id}`,
    libraryPath: '/test-library',
    initialTitle: '剪贴板回归',
    initialMarkdown: markdown,
    ariaLabel: 'Markdown 编辑器',
    onNotice: () => {},
  }))
  const selectBody = async (collapsed = false) => {
    const body = container.querySelector<HTMLElement>('.docx-editor')!
    await act(async () => {
      body.focus()
      const range = document.createRange()
      range.selectNodeContents(body)
      if (collapsed) range.collapse(false)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      await wait(100)
    })
    return body
  }
  try {
    await act(async () => render('clipboard-source', source))
    const body = await selectBody()
    assert.equal(dispatchClipboard(body, 'copy').defaultPrevented, true)
    const fragment = JSON.parse(decodeURIComponent(window.atob(data.get('application/x-jotkeep-fragment')!)))
    assert.ok(fragment.some((node) => node.type === 'image' && node.url === image))
    assert.ok(fragment.some((node) => node.type === 'task' && node.title === '任务标题'))
    assert.ok(fragment.some((node) => node.type === 'table'))
    const copiedHTML = new DOMParser().parseFromString(data.get('text/html')!, 'text/html')
    assert.equal(copiedHTML.querySelector('img')!.getAttribute('src'), image)
    assert.doesNotMatch(data.get('text/html')!, /图片地址|选择图片|移除图片/)
    assert.ok(data.get('text/plain')!.includes('[方括号]'))

    const caption = container.querySelector('input[aria-label="图片说明"]')!
    assert.equal(dispatchClipboard(caption, 'copy').defaultPrevented, false)
    assert.equal(dispatchClipboard(caption, 'paste').defaultPrevented, false)
    const taskTitle = container.querySelector('textarea[aria-label="任务标题"]')!
    assert.equal(dispatchClipboard(taskTitle, 'paste').defaultPrevented, false)

    await selectBody()
    await act(async () => {
      assert.equal(dispatchClipboard(body, 'cut').defaultPrevented, true)
    })
    assert.equal(container.querySelector('img'), null)
    await act(async () => render('clipboard-target', ''))
    const target = await selectBody(true)
    await act(async () => {
      assert.equal(dispatchClipboard(target, 'paste').defaultPrevented, true)
    })
    assert.equal(container.querySelector('img')!.getAttribute('src'), image)
    assert.equal(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务标题"]')!.value, '任务标题')
    assert.equal(container.querySelector('[data-block-id="original-task"]'), null)
    assert.equal(container.querySelectorAll('td').length, 2)
    assert.ok(target.textContent!.includes('[方括号]'))
    await act(async () => wait(350))
    const saved = window.localStorage.getItem('note-down.preview-document.notes/clipboard-target')!
    assert.doesNotMatch(saved, /id=original-task\b/)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
