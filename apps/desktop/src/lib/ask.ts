import type { BlockEditorHandle } from "@leadinglight/editor/editor";
import { useSyncExternalStore } from "react";

// What the agent panel is open on: the page in front and the words selected when Ask
// was pressed. The page registers itself and its editor while it is mounted.
export type Quote = { text: string; from: number; to: number };
export type AskPage = { id: string; title: () => string; text: () => string };
type State = { open: boolean; quote: Quote | null; page: AskPage | null };

let state: State = { open: false, quote: null, page: null };
let editor: BlockEditorHandle | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function registerPage(page: AskPage, handle: BlockEditorHandle | null) {
  editor = handle;
  set({ page, open: false, quote: null });
}

export function unregisterPage(id: string) {
  if (state.page?.id !== id) return;
  editor = null;
  set({ page: null, open: false, quote: null });
}

export const askEditor = () => editor;

// Opens the panel on the words given, or the editor's own selection; none means the page.
export function openAsk(quote?: Quote | null) {
  if (!state.page) return;
  const q = quote === undefined ? (editor?.selection() ?? null) : quote;
  set({ open: true, quote: q && q.text.trim() ? q : null });
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
