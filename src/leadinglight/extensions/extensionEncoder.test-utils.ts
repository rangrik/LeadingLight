// A stand-in for the encoder snapshot in UI tests, with no imports at all: a vi.mock factory that
// imported anything reaching the encoder would wait on itself and never finish collecting.
// The encoder's documented contract without its escapes: validate, trim, split lines.
export function encoderStandIn() {
  class LiteralMarkdownTextError extends Error {
    readonly reason: string
    constructor(reason: string) { super(reason); this.reason = reason }
  }
  const lines = (text: string) => {
    if ([...text].some(char => char.codePointAt(0)! < 0x09)) throw new LiteralMarkdownTextError('controlCharacter')
    const all = text.split('\n').map(line => line.trim())
    const first = all.findIndex(Boolean)
    if (first === -1) return []
    let last = all.length - 1
    while (!all[last]) last -= 1
    return all.slice(first, last + 1)
  }
  return {
    LiteralMarkdownTextError,
    encodeLiteralMarkdownLines: lines,
    encodeLiteralMarkdownInline: (text: string) => {
      if (text.includes('\n')) throw new LiteralMarkdownTextError('lineBreak')
      lines(text)
      return text.trim()
    },
  }
}
