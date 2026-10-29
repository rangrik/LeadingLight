import type { BlockEditorHandle } from "@leadinglight/editor/editor";
import { useSyncExternalStore } from "react";
import { hideBar, showBar, showing } from "~/lib/bar";
import { isNative } from "~/lib/platform";
import { remoteReady, selectedPair } from "~/lib/remote";

// What asking is about: the page in front, the words selected when Ask was pressed, and
// which surface has them. Words selected get the ask bar beside them (Shipyard's pattern);
// a question typed there opens the bar's Ask with it already sent. No words: Ask itself.
export type Quote = { text: string; from: number; to: number };
export type AskPage = { id: string; title: () => string; text: () => string };
export type PageRef = { id: string; title: string };
type State = {
  quote: Quote | null;
  page: AskPage | null;
  // The ask bar beside the words; it asks the editor where they are each time it places itself.
  bar: { quote: Quote } | null;
  // A question the bar sent: the panel picks it up and sends it as soon as it opens.
  askNow: { id: string; question: string } | null;
  // Every page, for @mentions in the composer.
  pages: PageRef[];
  // Counts each ask, so the panel takes the keyboard then, not when the page in front changes.
  asked: number;
};

let state: State = { quote: null, page: null, bar: null, askNow: null, pages: [], asked: 0 };
let editor: BlockEditorHandle | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

// Ask stays open as the page in front changes, and follows it.
export function registerPage(page: AskPage, handle: BlockEditorHandle | null) {
  if (state.page?.id === page.id && editor === handle) return; // already in front
  editor = handle;
  set({ page, quote: null, bar: null, askNow: null });
}

export function unregisterPage(id: string) {
  if (state.page?.id !== id) return;
  editor = null;
  set({ page: null, quote: null, bar: null, askNow: null });
}

export const setPages = (pages: PageRef[]) => set({ pages });
export const askEditor = () => editor;

// Ask on the words given, or the editor's own selection: words get the bar; none, Ask itself.
// ⌘J from inside Ask closes it, as the Ask button does.
export function openAsk(quote?: Quote | null) {
  if (import.meta.env.DEV && !selectedPair()) return openLocalAsk(quote);
  void isNative.then((native) => {
    if (native || remoteReady()) return openLocalAsk(quote);
    set({ quote: null, bar: null, askNow: null, asked: state.asked + 1 });
    showBar("ask");
  });
}

function openLocalAsk(quote?: Quote | null) {
  if (!state.page) return;
  if (showing("ask") && quote === undefined && document.activeElement?.closest("[data-testid=agent-panel]")) return closeAsk();
  const q = quote === undefined ? (editor?.selection() ?? null) : quote;
  if (q && q.text.trim()) return set({ bar: { quote: q } });
  set({ quote: null, bar: null, asked: state.asked + 1 });
  showBar("ask");
}

export function closeBar(back = true) {
  set({ bar: null });
  if (back) editor?.refocus();
}

// The bar's two ways out: send the question now, or carry the words into Ask.
export function askFromBar(question: string) {
  const bar = state.bar;
  if (!bar) return;
  set({ bar: null, quote: bar.quote, askNow: { id: crypto.randomUUID(), question }, asked: state.asked + 1 });
  showBar("ask");
}

export function quoteInReply() {
  const bar = state.bar;
  if (!bar) return;
  set({ bar: null, quote: bar.quote, asked: state.asked + 1 });
  showBar("ask");
}

export function takeAskNow() {
  const now = state.askNow;
  if (now) set({ askNow: null });
  return now;
}

export function closeAsk(back = true) {
  hideBar("ask");
  if (back) editor?.refocus();
}

export const useAsk = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
