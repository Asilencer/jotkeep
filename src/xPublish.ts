import twitterText from 'twitter-text'
import type { PublishDeliveryMode } from './model'

export const X_STANDARD_WEIGHTED_LIMIT = 280
export const X_LONG_POST_CHARACTER_LIMIT = 25_000

const X_INTENT_BASE_URL = 'https://x.com/intent/tweet'
const X_INTENT_SAFE_URL_BYTES = 2_048

export type XPublishAnalysis = {
  characterCount: number
  intentSafe: boolean
  intentUrl: string
  intentUrlBytes: number
  longPostValid: boolean
  standardPostValid: boolean
  weightedLength: number
}

const publishBody = (markdown: string) =>
  markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

export const xPublishText = (markdown: string) => publishBody(markdown)
  .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[(?:bookmark|button):([^\]]*)\]\(([^)]+)\)/gi, '$1 $2')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
  .replace(/^\s*:::[^\n]*$/gm, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s*(?:#{1,9}|>|[-+*]\s+\[[ xX]\]|[-+*]|\d+\.)\s*/gm, '')
  .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, '')
  .replace(/\s*\|\s*/g, ' · ')
  .replace(/[*_~`$]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const weightedLength = (text: string) => twitterText.parseTweet(text).weightedLength

const intentUrl = (text?: string) =>
  text ? `${X_INTENT_BASE_URL}?text=${encodeURIComponent(text)}` : X_INTENT_BASE_URL

export const analyzeXPublishText = (text: string): XPublishAnalysis => {
  const normalized = text.normalize('NFC')
  const parsed = twitterText.parseTweet(normalized)
  const url = intentUrl(normalized)
  const urlBytes = new TextEncoder().encode(url).length
  return {
    characterCount: Array.from(normalized).length,
    intentSafe: parsed.valid && urlBytes <= X_INTENT_SAFE_URL_BYTES,
    intentUrl: url,
    intentUrlBytes: urlBytes,
    longPostValid: Array.from(normalized).length <= X_LONG_POST_CHARACTER_LIMIT,
    standardPostValid: parsed.valid && normalized.trim().length > 0,
    weightedLength: parsed.weightedLength,
  }
}

export const recommendedXDeliveryMode = (
  analysis: XPublishAnalysis,
): PublishDeliveryMode => {
  if (analysis.standardPostValid) return 'standard'
  return analysis.longPostValid ? 'long' : 'thread'
}

export const xComposerUrl = (text: string, mode: PublishDeliveryMode) => {
  const analysis = analyzeXPublishText(text)
  return mode === 'standard' && analysis.intentSafe
    ? analysis.intentUrl
    : X_INTENT_BASE_URL
}

const splitOversizedText = (text: string, limit: number) => {
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ segment }) => segment,
  )
  const chunks: string[] = []
  let start = 0
  while (start < graphemes.length) {
    let low = start + 1
    let high = graphemes.length
    let end = low
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (weightedLength(graphemes.slice(start, middle).join('')) <= limit) {
        end = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (end < graphemes.length) {
      const preferredBreak = graphemes
        .slice(start, end)
        .findLastIndex((value) => /[\s。！？!?；;，,、]/u.test(value))
      if (preferredBreak > Math.floor((end - start) / 2)) {
        end = start + preferredBreak + 1
      }
    }
    chunks.push(graphemes.slice(start, end).join('').trim())
    start = end
  }
  return chunks.filter(Boolean)
}

const splitTextWithinLimit = (text: string, limit: number) => {
  const paragraphs = text.trim().split(/\n{2,}/)
  const chunks: string[] = []
  for (const paragraph of paragraphs) {
    const candidate = chunks.length > 0
      ? `${chunks[chunks.length - 1]}\n\n${paragraph}`
      : paragraph
    if (chunks.length > 0 && weightedLength(candidate) <= limit) {
      chunks[chunks.length - 1] = candidate
      continue
    }
    if (weightedLength(paragraph) <= limit) {
      chunks.push(paragraph)
      continue
    }
    const sentences = paragraph.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [paragraph]
    sentences.forEach((sentence, sentenceIndex) => {
      const current = chunks[chunks.length - 1]
      const separator = current && sentenceIndex === 0 ? '\n\n' : ''
      const sentenceCandidate = current ? `${current}${separator}${sentence}` : sentence
      if (current && weightedLength(sentenceCandidate) <= limit) {
        chunks[chunks.length - 1] = sentenceCandidate
      } else if (weightedLength(sentence) <= limit) {
        chunks.push(sentence.trim())
      } else {
        chunks.push(...splitOversizedText(sentence, limit))
      }
    })
  }
  return chunks.filter(Boolean)
}

export const splitXThread = (text: string) => {
  let total = 1
  let chunks: string[] = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const digits = String(total).length
    const suffixWeight = weightedLength(`\n\n${'9'.repeat(digits)}/${'9'.repeat(digits)}`)
    chunks = splitTextWithinLimit(text, X_STANDARD_WEIGHTED_LIMIT - suffixWeight)
    if (chunks.length === total) break
    total = chunks.length
  }
  return chunks.map((chunk, index) => `${chunk}\n\n${index + 1}/${chunks.length}`)
}
