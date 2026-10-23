import type { TranscriptItem } from "@/lib/transcript";

// The reply an agent is writing, read from its screen (box: draft.go), as
// the chat shows it until its transcript has the words: a draft that grows,
// then gives way to the transcript's own message in the same row. Pure, so
// the parts can be tested (draft-text.test.ts); lib/draft.ts reads it.

// One read of the screen: the reply's words as Markdown, and whether its
// start was above the top of the screen.
export interface DraftRead {
  text: string;
  clipped?: boolean;
}

// The draft the chat shows: the words read so far (the earliest kept when
// the reply grew taller than the screen), named by id for as long as it is
// the same reply, so its row stays put.
export interface Draft {
  id: string;
  text: string;
  // Its start is still unknown: the chat says "…" above it.
  clipped: boolean;
}

// The same words, as the screen and the transcript each draw them: letters
// and digits only.
export const wordsOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// A line worth matching on: enough words that it can't be any line.
const telling = (l: string) => wordsOf(l).length >= 8 && !l.startsWith("```");

// The row a message is drawn in: the draft's it replaced, so the row stays
// and only its words change (no new row moving in), else its own.
const rows = new Map<string, string>();
// Drafts the transcript has taken: never drawn again, though the screen may
// show their words a while longer.
const settled = new Set<string>();

// mergeDraft takes a new read into the draft. A reply that starts on screen
// is the read itself. One taller than the screen shows only its end: it
// joins what was read before where the two meet (a line both have, or the
// start of its first line within the earlier words), so the earliest words
// stay; with nowhere to meet, it is its end alone, clipped. The id stays
// while it is the same reply.
export function mergeDraft(prev: Draft | undefined, read: DraftRead, id: () => string): Draft | undefined {
  const text = read.text.trim();
  if (!text) return undefined;
  if (!read.clipped) {
    const same = !!prev && wordsOf(text).startsWith(wordsOf(prev.text).slice(0, 48));
    return { id: same && prev ? prev.id : id(), text, clipped: false };
  }
  if (!prev) return { id: id(), text, clipped: true };
  const was = prev.text.split("\n");
  const now = text.split("\n");
  // A whole line both reads have (the first of the new one may be cut).
  for (let k = 1; k < Math.min(now.length, 12); k++) {
    if (!telling(now[k])) continue;
    const j = was.lastIndexOf(now[k]);
    if (j >= 0) return { id: prev.id, text: [...was.slice(0, j + 1), ...now.slice(k + 1)].join("\n"), clipped: prev.clipped };
  }
  // The new first line's start within the earlier words, where the rest
  // of those words lead into the new ones (one paragraph taller than the
  // screen; the earlier read may have ended a few words in).
  for (const len of [48, 24, 12]) {
    const anchor = now[0].slice(0, len);
    if (!telling(anchor)) continue;
    const at = prev.text.lastIndexOf(anchor);
    const rest = at >= 0 ? prev.text.slice(at).trimEnd() : "";
    if (rest && (text.startsWith(rest) || rest.startsWith(text))) return { id: prev.id, text: prev.text.slice(0, at) + (rest.length > text.length ? rest : text), clipped: prev.clipped };
  }
  // Nowhere to meet: the same reply scrolled far, or, after one the
  // transcript took, a new one.
  return { id: settled.has(prev.id) ? id() : prev.id, text, clipped: true };
}

// settledBy finds the transcript's message that has the draft's words: the
// draft's start (its first words, or for a clipped one, the first it has)
// within a recent message of the agent's.
export function settledBy(draft: string, items: TranscriptItem[]): TranscriptItem | undefined {
  const want = wordsOf(draft).slice(0, 64);
  if (want.length < 4) return undefined;
  for (let i = items.length - 1; i >= Math.max(0, items.length - 24); i--) {
    const it = items[i];
    if (it.kind === "text" && !it.live && wordsOf(it.text).includes(want)) return it;
  }
  return undefined;
}

export const rowKeyOf = (id: string) => rows.get(id) ?? id;
export const wasSettled = (draftId: string) => settled.has(draftId);

// withDraft is the chat's items with the draft at their end (above a
// "thinking" row, which stays under it, so nothing below the words comes
// or goes as the message replaces it), as a message in progress (live),
// until the transcript has its words; from then on the transcript's
// message takes the draft's row.
export function withDraft(items: TranscriptItem[], draft: Draft | undefined): { items: TranscriptItem[]; drafting: boolean } {
  if (!draft?.text || settled.has(draft.id)) return { items, drafting: false };
  const by = settledBy(draft.text, items);
  if (by) {
    if (!rows.has(by.id)) rows.set(by.id, draft.id);
    settled.add(draft.id);
    return { items, drafting: false };
  }
  let at = items.length;
  while (at > 0 && items[at - 1].kind === "thinking") at--;
  const live: TranscriptItem = { kind: "text", id: draft.id, text: draft.text, live: true, clipped: draft.clipped };
  return { items: [...items.slice(0, at), live, ...items.slice(at)], drafting: true };
}

// caretAfter puts the draft's caret after its last words, inside whatever
// holds them (a paragraph, a list item, a code block, a table cell),
// rather than on a line of its own.
export function caretAfter(html: string, caret: string): string {
  const tail = /(?:\s|<\/[a-z0-9]+>)*$/i.exec(html);
  const at = tail ? tail.index : html.length;
  return html.slice(0, at) + caret + html.slice(at);
}
