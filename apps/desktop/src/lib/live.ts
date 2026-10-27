import type { BlockEditorHandle, EditorDoc } from "@leadinglight/editor/editor";
import { objects } from "./objects";
import { markSaved, patchSummary } from "./space";

// Pages open in a pane. A change to one of them from elsewhere (linking a mention, merging a
// tag, Claude's edits) must go through its editor, or the pane would save its own copy over it.
type Live = {
  editor: () => BlockEditorHandle | null;
  content: () => EditorDoc;
  setContent: (doc: EditorDoc) => void;
  properties: () => Record<string, unknown>;
  setProperties: (props: Record<string, unknown>) => void;
  setTitle: (title: string) => void;
  // Quotes into an essay, and scrolls to an anchor (DECISIONS.md, 11).
  insertQuote: (quote: { text: string; id: string; href: string; label: string }) => void;
  reveal: (anchor: string) => void;
  // The cursor at the end of the body, for a page opened to write on.
  focus: () => void;
};
const live = new Map<string, Live>();
const waiting = new Map<string, ((page: Live) => void)[]>();

export function registerLive(id: string, page: Live) {
  live.set(id, page);
  for (const fn of waiting.get(id)?.splice(0) ?? []) fn(page);
  return () => void (live.get(id) === page && live.delete(id));
}

export const isLive = (id: string) => live.has(id);

// Hears every edit to an open page, so another page showing part of it can follow.
const watchers = new Map<string, Set<() => void>>();
export function watchLive(id: string, fn: () => void) {
  const set = watchers.get(id) ?? new Set();
  watchers.set(id, set.add(fn));
  return () => void set.delete(fn);
}
export const touchLive = (id: string) => watchers.get(id)?.forEach((fn) => fn());
// What an open page holds right now, edits not yet saved included, and its editor.
export const liveContent = (id: string) => live.get(id)?.content();
export const liveProperties = (id: string) => live.get(id)?.properties();
export const liveEditor = (id: string) => live.get(id)?.editor() ?? null;

// Runs fn with the page's editor now if it is open, else as soon as it opens.
export function whenLive(id: string, fn: (page: Live) => void) {
  const open = live.get(id);
  if (open) return fn(open);
  waiting.set(id, [...(waiting.get(id) ?? []), fn]);
}

type Change = { title?: string; content?: (doc: EditorDoc) => EditorDoc; properties?: (props: Record<string, unknown>) => Record<string, unknown> };

export async function editPage(id: string, change: Change) {
  const { title } = change;
  const open = live.get(id);
  if (open) {
    if (title !== undefined) open.setTitle(title);
    if (change.content) open.setContent(change.content(open.content()));
    if (change.properties) open.setProperties(change.properties(open.properties()));
    return;
  }
  const obj = await objects.get(id);
  if (!obj) return;
  // A page never written in has no body yet; the change starts one.
  const content = change.content?.(obj.content ?? { type: "doc", content: [] });
  const properties = change.properties?.(obj.properties);
  await objects.update(id, { ...(title !== undefined && { title }), ...(content && { content }), ...(properties && { properties }) });
  patchSummary(id, { ...(title !== undefined && { title }), ...(properties && { properties }) });
  markSaved();
}
