import type { BlockEditorHandle } from "@leadinglight/editor/editor";
import { useSyncExternalStore } from "react";

// What asking is about: the page in front, the words selected when Ask was pressed, and
// which surface has them. Words selected get the ask bar beside them (Shipyard's pattern);
// a question typed there opens the panel with it already sent. No words: the panel itself.
export type Quote = { text: string; from: number; to: number };
export type AskPage = { id: string; title: () => string; text: () => string };
export type PageRef = { id: string; title: string };
type State = {
  open: boolean;
  quote: Quote | null;
  page: AskPage | null;
  // The ask bar beside the words; it asks the editor where they are each time it places itself.
  bar: { quote: Quote } | null;
  // A question the bar sent: the panel picks it up and sends it as soon as it opens.
  askNow: { id: string; question: string } | null;
  // Every page, for @mentions in the composer.
  pages: PageRef[];
};

let state: State = { open: false, quote: null, page: null, bar: null, askNow: null, pages: [] };
let editor: BlockEditorHandle | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function registerPage(page: AskPage, handle: BlockEditorHandle | null) {
  if (state.page?.id === page.id && editor === handle) return; // already in front; keep the panel
  editor = handle;
  set({ page, open: false, quote: null, bar: null, askNow: null });
}

export function unregisterPage(id: string) {
  if (state.page?.id !== id) return;
  editor = null;
  set({ page: null, open: false, quote: null, bar: null, askNow: null });
}

export const setPages = (pages: PageRef[]) => set({ pages });
export const askEditor = () => editor;

// Ask on the words given, or the editor's own selection: words get the bar; none, the panel.
export function openAsk(quote?: Quote | null) {
  if (!state.page) return;
  const q = quote === undefined ? (editor?.selection() ?? null) : quote;
  if (q && q.text.trim()) set({ bar: { quote: q } });
  else set({ open: true, quote: null, bar: null });
}

export function closeBar(back = true) {
  set({ bar: null });
  if (back) editor?.refocus();
}

// The bar's two ways out: send the question now, or carry the words into the panel.
export function askFromBar(question: string) {
  const bar = state.bar;
  if (!bar) return;
  set({ bar: null, open: true, quote: bar.quote, askNow: { id: crypto.randomUUID(), question } });
}

export function quoteInReply() {
  const bar = state.bar;
  if (!bar) return;
  set({ bar: null, open: true, quote: bar.quote });
}

export function takeAskNow() {
  const now = state.askNow;
  if (now) set({ askNow: null });
  return now;
}

export function closeAsk(back = true) {
  set({ open: false });
  if (back) editor?.refocus();
}

export const useAsk = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
