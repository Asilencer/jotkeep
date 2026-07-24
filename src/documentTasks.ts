export type DocumentTaskBlockValue = {
  title: string
  checked: boolean
  due: string
}

export function updateDocumentTaskBlock(
  content: string,
  blockId: string,
  value: DocumentTaskBlockValue | null,
) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(newline)

  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index].match(/^::: task\b(.*)$/)
    if (!opener || opener[1].match(/\sid=(\S+)/)?.[1] !== blockId) continue

    const closeIndex = lines.findIndex(
      (line, candidate) => candidate > index && line.trim() === ':::',
    )
    if (closeIndex < 0) return content

    if (value) {
      lines.splice(
        index,
        closeIndex - index + 1,
        `::: task id=${blockId} checked=${value.checked} due=${value.due || '-'}`,
        value.title.replace(/\s+/g, ' ').trim(),
        ':::',
      )
    } else {
      let removeEnd = closeIndex + 1
      if (lines[index - 1] === '' && lines[removeEnd] === '') removeEnd += 1
      lines.splice(index, removeEnd - index)
    }
    return lines.join(newline)
  }

  return content
}
