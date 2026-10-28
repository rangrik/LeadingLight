// When tail reads a block, and that it reads each wording once (docs/TAIL.md, "When it reads").
// No app imports, so both rules can be tested alone.

// A block's words as tail judges them: the same words are the same block, whatever the case.
export const fingerprint = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

// Milliseconds of quiet: after a block ends in a full stop, and in any case.
export type ReadAfter = { stop: number; quiet: number };

// After an edit, which block to read and when: on the empty line an Enter at a block's end made,
// that block at once; else the block edited, after a full stop's wait or the longer one.
export function nextRead(was: number | undefined, at: number, text: string, empty: boolean, w: ReadAfter) {
  if (empty) return was === at - 1 ? { block: at - 1, wait: 0 } : null;
  return { block: at, wait: /[.!?…]["”’)]*$/.test(text.trim()) ? w.stop : w.quiet };
}

// One page's turns: a wording goes once, one turn at a time; a block finished meanwhile waits and
// goes only if still unsent. go sends it, and marks it sent, when its words still stand.
export function reader(o: { sent: (fp: string) => boolean; go: (fp: string) => Promise<unknown> }) {
  let busy = false;
  const waiting: string[] = [];
  const next = (): void => {
    const fp = busy ? undefined : waiting.shift();
    if (fp === undefined) return;
    if (o.sent(fp)) return next();
    busy = true;
    void o
      .go(fp)
      .catch(() => {})
      .finally(() => {
        busy = false;
        next();
      });
  };
  return (fp: string) => {
    if (!o.sent(fp) && !waiting.includes(fp)) waiting.push(fp);
    next();
  };
}
