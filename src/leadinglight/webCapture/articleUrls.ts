// URL policy for website capture. A captured page names three kinds of address: the page's own
// (source and requested), links in the article, and media in the article. All are untrusted text;
// only absolute http(s) addresses without credentials survive, and link destinations are written
// in a form the note's Markdown preprocessors read back unchanged.

const MAX_URL_LENGTH = 2048
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
// Characters the Markdown URI normalizer leaves alone. Everything else is percent-encoded here,
// and so are some it keeps: `[`, `]` and `$`, because the wikilink and math preprocessors read the
// raw line, so a destination holding `[[x]]` or `$` could reopen as a wikilink or math; and `(` and
// `)`, because the canonical serializer then writes the `<…>` destination form, which the editor's
// fast parser for notes over 16 KiB misreads.
const SAFE_DESTINATION_CHARACTER = /^[A-Za-z0-9;/?:@&=+,\-_.!~*'#]$/u
const PERCENT_ESCAPE = /^%[0-9A-Fa-f]{2}$/u
const RESERVED_TEXT = '@@TOLARIA'

function parseAbsolute(value: string, base?: string): URL | null {
  try {
    return base === undefined ? new URL(value) : new URL(value, base)
  } catch {
    return null
  }
}

function isPlainHttpUrl(url: URL): boolean {
  return HTTP_PROTOCOLS.has(url.protocol) && url.hostname !== '' && url.username === '' && url.password === ''
}

function withoutFragment(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  return copy.href
}

/**
 * The capture's own addresses (W1's `requestedUrl` and `finalUrl`): absolute http(s), a host,
 * no credentials, at most 2048 characters. The fragment is removed. `null` when unusable.
 */
export function normalizeCaptureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || value.trim() !== value) return null
  const url = parseAbsolute(value)
  if (!url || !isPlainHttpUrl(url)) return null
  const href = withoutFragment(url)
  return href.length <= MAX_URL_LENGTH ? href : null
}

function encodeDestinationCharacter(character: string, next: string): string {
  if (character === '%') return PERCENT_ESCAPE.test(`%${next}`) ? character : '%25'
  if (SAFE_DESTINATION_CHARACTER.test(character)) return character
  const code = character.codePointAt(0) ?? 0
  // encodeURIComponent keeps `(` and `)`, so ASCII is escaped directly.
  return code < 0x80 ? `%${code.toString(16).toUpperCase().padStart(2, '0')}` : encodeURIComponent(character)
}

/** Percent-encodes everything outside the normalizer's safe set, plus `[`, `]`, `$`, `(` and `)`. */
export function encodeLinkDestination(href: string): string {
  const characters = [...href]
  return characters
    .map((character, index) => encodeDestinationCharacter(character, characters.slice(index + 1, index + 3).join('')))
    .join('')
}

/**
 * An article link or media address, resolved against the captured final URL only. Returns the
 * destination to write, or `null` when the text must stay unlinked: not http(s), credentials,
 * too long, an internal marker, or a jump within the captured page itself.
 */
export function articleHref(value: string | null, pageUrl: string): string | null {
  if (!value) return null
  const url = parseAbsolute(value.trim(), pageUrl)
  if (!url || !isPlainHttpUrl(url)) return null
  const bare = withoutFragment(url)
  // Any `#`, even an empty fragment, makes it a jump within the captured page.
  if (bare === pageUrl && url.href !== bare) return null
  const destination = encodeLinkDestination(url.href)
  if (destination.length > MAX_URL_LENGTH || destination.includes(RESERVED_TEXT)) return null
  return destination
}

/** The host name shown when a page has no usable title. */
export function hostLabel(pageUrl: string): string {
  return parseAbsolute(pageUrl)?.hostname ?? pageUrl
}
