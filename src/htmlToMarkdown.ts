import TurndownService from 'turndown'

const safeRemoteURL = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const tableMarkdown = (table: HTMLTableElement) => {
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) =>
      (cell.textContent ?? '').trim().replaceAll('|', '\\|').replace(/\s+/g, ' '),
    ),
  )
  if (rows.length === 0) return ''
  const width = Math.max(2, ...rows.map((row) => row.length))
  const normalize = (row: string[]) =>
    Array.from({ length: width }, (_, index) => row[index] ?? '')
  const [head, ...body] = rows
  return [
    `| ${normalize(head).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${normalize(row).join(' | ')} |`),
  ].join('\n')
}

export const htmlToMarkdown = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((node) => {
    node.remove()
  })
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLocaleLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
    })
    if (
      element instanceof HTMLAnchorElement &&
      !safeRemoteURL(element.getAttribute('href') ?? '')
    ) {
      element.removeAttribute('href')
    }
    if (
      element instanceof HTMLImageElement &&
      !safeRemoteURL(element.getAttribute('src') ?? '')
    ) {
      element.removeAttribute('src')
    }
  })

  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
  })
  turndown.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed'])
  turndown.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => `~~${content}~~`,
  })
  turndown.addRule('underline', {
    filter: 'u',
    replacement: (content) => `<u>${content}</u>`,
  })
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) =>
      node instanceof HTMLTableElement ? `\n\n${tableMarkdown(node)}\n\n` : '',
  })

  return turndown
    .turndown(document.body.innerHTML)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
