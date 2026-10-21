// Text rules for website capture: invisible control characters, single-line metadata, byte bounds,
// and the existing literal-text refusal check. Pure string functions.
import {
  LiteralMarkdownTextError, encodeLiteralMarkdownLines, type LiteralMarkdownTextFailure,
} from '../extensions/extensionMarkdownText'
import { utf8Bytes } from '../extensions/extensionSchema'
import type { WebCaptureRefusal } from './webCaptureContract'

/** A refusal raised inside a stage and returned to the caller as `{ status: 'refused' }`. */
export class WebCaptureRefusalError extends Error {
  readonly reason: WebCaptureRefusal
  constructor(reason: WebCaptureRefusal) {
    super(reason)
    this.name = 'WebCaptureRefusalError'
    this.reason = reason
  }
}

export interface CleanText {
  readonly text: string
  readonly removed: number
}

// Browsers draw none of these. NUL already became U+FFFD in the HTML parser; tab, line feed and
// carriage return are whitespace, and form feed is whitespace that becomes a space here.
function isInvisibleControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c) return false
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/** Removes C0/C1 control characters other than whitespace, and turns form feeds into spaces. */
export function removeControlCharacters(text: string): CleanText {
  let removed = 0
  let result = ''
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (!isInvisibleControl(code) && code !== 0x0c) continue
    result += text.slice(start, index)
    if (code === 0x0c) result += ' '
    else removed += 1
    start = index + 1
  }
  return start === 0 ? { text, removed: 0 } : { text: result + text.slice(start), removed }
}

/** Collapses every whitespace run, line breaks included, to one space and trims. */
export function singleLine(text: string): string {
  return removeControlCharacters(text).text.replace(/\s+/gu, ' ').trim()
}

/** Keeps whole code points within `maxBytes`. */
export function clipUtf8(text: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const character of text) {
    const next = utf8Bytes(character)
    if (bytes + next > maxBytes) break
    bytes += next
    end += character.length
  }
  return text.slice(0, end)
}

/** UTF-8 length without allocating; a lone surrogate counts as the 3-byte U+FFFD. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** The literal encoder's own refusal for this text, or `null`. Reuses the accepted check, unedited. */
export function literalTextFailure(text: string): LiteralMarkdownTextFailure | null {
  try {
    encodeLiteralMarkdownLines(text)
    return null
  } catch (error) {
    if (error instanceof LiteralMarkdownTextError) return error.reason
    throw error
  }
}

/** Throws the capture refusal matching the literal check, so a whole page is refused, never cut. */
export function assertLiteralText(text: string): void {
  const failure = literalTextFailure(text)
  if (failure === null) return
  throw new WebCaptureRefusalError(failure === 'tooLong' ? 'tooLarge' : 'unsafeText')
}

/**
 * Single-line metadata that passes the literal check and fits `maxBytes`, or `null`. Longer values
 * are left out: an author or site name that long is almost always extraction noise.
 */
export function metadataText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string') return null
  const text = singleLine(value)
  if (!text || utf8Bytes(text) > maxBytes || literalTextFailure(text) !== null) return null
  return text
}

/** UTF-16 units other than whitespace. */
export function visibleLength(text: string): number {
  return text.replace(/\s+/gu, '').length
}
