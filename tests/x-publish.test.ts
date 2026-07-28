import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeXPublishText,
  recommendedXDeliveryMode,
  splitXThread,
  xComposerUrl,
  xPublishText,
} from '../src/xPublish'

test('按 X 加权规则计算中文普通帖子长度', () => {
  const valid = analyzeXPublishText('你'.repeat(140))
  const overLimit = analyzeXPublishText('你'.repeat(141))

  assert.equal(valid.weightedLength, 280)
  assert.equal(valid.standardPostValid, true)
  assert.equal(overLimit.weightedLength, 282)
  assert.equal(overLimit.standardPostValid, false)
})

test('长内容不再进入 Web Intent 查询参数', () => {
  const content = '长内容'.repeat(1_000)
  const analysis = analyzeXPublishText(content)

  assert.equal(recommendedXDeliveryMode(analysis), 'long')
  assert.equal(analysis.intentSafe, false)
  assert.equal(xComposerUrl(content, 'long'), 'https://x.com/intent/tweet')
})

test('帖子串的每一条都符合普通帖子限制', () => {
  const segments = splitXThread([
    '第一段。'.repeat(80),
    '第二段。'.repeat(80),
  ].join('\n\n'))

  assert.ok(segments.length > 1)
  segments.forEach((segment) => {
    assert.equal(analyzeXPublishText(segment).standardPostValid, true)
  })
})

test('Markdown 转换继续保留现有纯文本排版', () => {
  assert.equal(
    xPublishText('# 标题\n\n- 第一项\n- [链接](https://example.com)'),
    '标题\n第一项\n链接 https://example.com',
  )
})
