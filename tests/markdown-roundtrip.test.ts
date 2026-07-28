import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseMarkdown,
  serializeMarkdown,
  splitDocumentFile,
} from '../src/markdownBlocks'

test('未编辑的 Markdown 保留原始换行与未知内联语法', () => {
  const source = [
    '第一行',
    '第二行包含 [复杂链接](https://example.com/a_(b)) 和 **嵌套 *强调***。',
    '',
    '',
    '## 标题',
    '',
    '<details><summary>原始 HTML</summary>内容</details>',
  ].join('\n')

  assert.equal(serializeMarkdown(parseMarkdown(source)), source)
})

test('修改后的块只规范化当前块', () => {
  const source = [
    '保持 **原始** 格式',
    '',
    '第二段',
  ].join('\n')
  const nodes = parseMarkdown(source)
  const second = nodes[1]
  assert.ok('children' in second && 'text' in second.children[0])
  if ('children' in second && 'text' in second.children[0]) {
    second.children[0].text = '已修改'
  }

  assert.equal(serializeMarkdown(nodes), '保持 **原始** 格式\n\n已修改')
})

test('任务标题保留任务内换行', () => {
  const source = [
    '::: task id=task-1 checked=false due=-',
    '第一行',
    '第二行',
    ':::',
  ].join('\n')

  assert.equal(serializeMarkdown(parseMarkdown(source)), source)
})

test('文章标题后的结构空行不会吞掉正文前导空白', () => {
  const source = [
    '# 标题',
    '',
    '  正文保留缩进',
    '',
    '下一段',
  ].join('\n')

  assert.deepEqual(splitDocumentFile(source, '无标题'), {
    frontMatter: '',
    title: '标题',
    markdown: '  正文保留缩进\n\n下一段',
  })
})
