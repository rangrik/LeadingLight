const WORD_CHARACTER_RE = /[\p{L}\p{N}]/u
const MARKDOWN_ESCAPABLE_PUNCTUATION_RE = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/u
// Literal text must not reopen as syntax: backticks and tildes start fences and code/strike spans,
// `*` emphasis, and brackets link/image/wikilink/footnote syntax. Structural renderers add their
// own markers around this escaped text, so escaping here cannot weaken them. `$` is optional below.
const ALWAYS_ESCAPED_RE = /[`*~[\]]/u
// A `==` pair is consumed by the highlight injector after parsing, so each `=` in a run of two or
// more is escaped; `markdownLiteralProtection` carries that escape past the injector.
// Only escape `<` where it could open a tag, comment, declaration or autolink, so that comparisons
// (`a < b`) and arrows (`<-`) stay unescaped in the saved file.
const HTML_MARKUP_START_RE = /[A-Za-z!/?]/u
// A character reference is decoded by the next parse, so leaving it raw would decode once per save:
// the visible text would change and reference text could reassemble a reserved placeholder.
const CHARACTER_REFERENCE_RE = /^&(?:#\d{1,8}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/u
const CHARACTER_REFERENCE_MAX_LENGTH = 34
// `compactMarkdown` decodes any `&#x..;` on a line, including a backslash-escaped one, so a
// backslash cannot protect a hexadecimal reference. Writing the leading `&` as its own decimal
// reference keeps the exact visible characters while leaving no `&#x` for that pass to decode.
const HEX_CHARACTER_REFERENCE_RE = /^&#[xX][0-9a-fA-F]{1,6};/u
const AMPERSAND_REFERENCE = '&#38;'
// GFM autolinks a bare URL from this same text and uses the raw source as the target, so a
// backslash inserted here would show up inside the link target.
const AUTOLINKED_WORD_RE = /^(?:https?:\/\/|www\.)/iu
const WHITESPACE_RE = /\s/u

function shouldEscapeBackslash(nextCharacter: string): boolean {
  return nextCharacter !== '{' && MARKDOWN_ESCAPABLE_PUNCTUATION_RE.test(nextCharacter)
}

function isIdentifierUnderscore(characters: string[], index: number): boolean {
  return WORD_CHARACTER_RE.test(characters.at(index - 1) ?? '')
    && WORD_CHARACTER_RE.test(characters.at(index + 1) ?? '')
}

/** Positions of `&` inside whitespace-delimited words that GFM turns into a bare-URL link. */
function autolinkedAmpersands(characters: string[]): Set<number> {
  const inside = new Set<number>()
  let wordStart = -1

  for (let index = 0; index <= characters.length; index += 1) {
    const character = characters.at(index)
    if (character !== undefined && !WHITESPACE_RE.test(character)) {
      if (wordStart === -1) wordStart = index
      continue
    }
    if (wordStart !== -1 && AUTOLINKED_WORD_RE.test(characters.slice(wordStart, index).join(''))) {
      for (let scan = wordStart; scan < index; scan += 1) {
        if (characters.at(scan) === '&') inside.add(scan)
      }
    }
    wordStart = -1
  }
  return inside
}

function escapedAmpersand(characters: string[], index: number): string {
  // A trailing `&` can meet a following text run that begins with the rest of a reference.
  if (index === characters.length - 1) return '\\&'

  const candidate = characters.slice(index, index + CHARACTER_REFERENCE_MAX_LENGTH).join('')
  if (HEX_CHARACTER_REFERENCE_RE.test(candidate)) return AMPERSAND_REFERENCE
  return CHARACTER_REFERENCE_RE.test(candidate) ? '\\&' : '&'
}

/**
 * Escapes a literal text run so that re-parsing the saved Markdown yields the same characters.
 * Inline only: block syntax at the start of a line is handled by the block renderers.
 */
/**
 * Positions, in the same code-point array the escaper maps over, of every `=` in a run of two or
 * more. A regex match index would count UTF-16 units and drift after any supplementary character.
 */
function equalsRunIndexes(characters: string[]): Set<number> {
  const indexes = new Set<number>()
  let runStart = -1
  for (let index = 0; index <= characters.length; index += 1) {
    if (characters.at(index) === '=') {
      if (runStart === -1) runStart = index
      continue
    }
    if (runStart !== -1 && index - runStart >= 2) {
      for (let scan = runStart; scan < index; scan += 1) indexes.add(scan)
    }
    runStart = -1
  }
  return indexes
}

export interface InlineEscapeOptions {
  /**
   * Escape `$`. Math needs two, so a caller that can see a whole block with fewer than two may
   * leave a lone `$` as written; the default escapes it.
   */
  escapeDollars: boolean
}

const DEFAULT_INLINE_ESCAPE: InlineEscapeOptions = { escapeDollars: true }

export function escapeInlineMarkdownText(text: string, options: InlineEscapeOptions = DEFAULT_INLINE_ESCAPE): string {
  const characters = [...text]
  const autolinked = text.includes('&') ? autolinkedAmpersands(characters) : null
  const equalsRuns = text.includes('==') ? equalsRunIndexes(characters) : null

  return characters.map((character, index) => {
    if (character === '\\') {
      return shouldEscapeBackslash(characters.at(index + 1) ?? '') ? '\\\\' : character
    }
    if (ALWAYS_ESCAPED_RE.test(character)) return `\\${character}`
    if (character === '<') {
      return HTML_MARKUP_START_RE.test(characters.at(index + 1) ?? '') ? '\\<' : character
    }
    if (character === '&') {
      return autolinked?.has(index) ? character : escapedAmpersand(characters, index)
    }
    if (character === '=' && equalsRuns?.has(index)) return '\\='
    if (character === '$') return options.escapeDollars ? '\\$' : character
    if (character !== '_') return character
    return isIdentifierUnderscore(characters, index) ? character : `\\${character}`
  }).join('')
}

export function wrapInlineMarkdown(text: string, marker: string): string {
  if (!text) return text
  const leadingWhitespace = text.match(/^\s*/u)?.[0] ?? ''
  const trailingWhitespace = text.slice(leadingWhitespace.length).match(/\s*$/u)?.[0] ?? ''
  const contentEnd = text.length - trailingWhitespace.length
  const content = text.slice(leadingWhitespace.length, contentEnd)
  if (!content) return text
  return `${leadingWhitespace}${marker}${content}${marker}${trailingWhitespace}`
}
