// A chat's reply box, reachable from the rest of its chat: words selected in
// the transcript go into it as a quote (components/conversation/
// selection-actions), with a question to send at once or to finish there.
// Each reply box listens under its chat's key (box/session) while it shows.

export interface QuoteFill {
  // What goes into the box, after anything already typed there.
  text: string;
  // Send it as soon as it is in, as Enter would.
  send?: boolean;
}

type Listener = (fill: QuoteFill) => void;
const boxes = new Map<string, Listener>();

export function listenForQuotes(key: string, fn: Listener): () => void {
  boxes.set(key, fn);
  return () => {
    if (boxes.get(key) === fn) boxes.delete(key);
  };
}

// Whether the chat has a reply box to quote into (an ended agent has none).
export const canQuote = (key: string) => boxes.has(key);

// quoteInto fills the chat's reply box; false when it has none.
export function quoteInto(key: string, fill: QuoteFill): boolean {
  const fn = boxes.get(key);
  if (!fn) return false;
  fn(fill);
  return true;
}

// quoted marks text as a Markdown quote, line by line, without the blank
// lines at its ends a selection picks up.
export function quoted(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/^\s*\n|\n\s*$/g, "")
    .split("\n")
    .map((l) => (l.trim() ? `> ${l.trimEnd()}` : ">"))
    .join("\n");
}

// joinDraft adds a fill to what is typed already, a blank line between.
export const joinDraft = (typed: string, add: string) => (typed.trim() ? `${typed.replace(/\s+$/, "")}\n\n${add}` : add);
