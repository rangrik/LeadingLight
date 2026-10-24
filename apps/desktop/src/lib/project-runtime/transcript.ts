// A conversation as the runtime reads it from the agent's record (Shipyard's transcript): items
// named by where they start in the record, sent again when they change, and all of them again
// after the record is read afresh. merge() keeps one copy of each, in order.

export type ToolCall = { verb: string; target: string; file?: boolean; id?: string; at?: number };
export type Question = { question: string; header?: string; multi?: boolean; id?: string; options?: { label: string; description?: string }[] };
export type TranscriptItem = {
  kind: string;
  id: string;
  text?: string;
  verb?: string;
  items?: ToolCall[];
  done?: boolean;
  file?: string;
  added?: number;
  removed?: number;
  tool?: string;
  notice?: string;
  level?: string;
  error?: boolean;
  questions?: Question[];
  answers?: string[];
  // A worker's outcome, told to the agent that started it.
  report?: { kind?: string; session?: string; run?: string; template?: string; title?: string; status?: string; duration?: string; summary?: string; answer?: string; error?: string };
  // Claude's own subagents, by name.
  names?: string[];
  // A slash command the person sent, as the record keeps it.
  command?: string;
  args?: string;
  off?: number;
};

// What the person said in an item: their words, or a slash command and its words.
export const said = (i: TranscriptItem) => (i.kind === "command" ? `${i.command ?? ""} ${i.args ?? ""}` : i.kind === "user" ? (i.text ?? "") : null);
// items is null when nothing came since the last read (the runtime's empty list).
export type TranscriptPage = { items: TranscriptItem[] | null; next: number; gen?: string; reset?: boolean; start?: number; source?: string; reason?: string };
export type Window = { items: TranscriptItem[]; next: number; gen?: string };

export const emptyWindow: Window = { items: [], next: 0 };

export function merge(w: Window, page: TranscriptPage): Window {
  // Read afresh: what came before its first item stays, the rest is the page's.
  const kept = page.reset ? w.items.filter((i) => (i.off ?? 0) < (page.start ?? 0)) : w.items;
  const at = new Map(kept.map((i, k) => [i.id, k]));
  const items = [...kept];
  for (const item of page.items ?? []) {
    const k = at.get(item.id);
    if (k === undefined) {
      at.set(item.id, items.length);
      items.push(item);
    } else items[k] = item;
  }
  return { items, next: page.next, gen: page.gen };
}
