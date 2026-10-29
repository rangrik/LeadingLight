import type { LLObject } from "./store";

export type Author = { kind: "human" | "agent" | "unknown"; name: string; model?: string; run?: string };
export type ChangeContext = { action: string; label: string; author: Author; preserveOrigin?: boolean };
export type PageChange = { before: LLObject | null; after: LLObject | null };
export type HistoryEntry = ChangeContext & {
  id: string;
  at: number;
  changes: PageChange[];
  milestone?: string;
  undoOf?: string;
};
export interface JournalStore {
  history(): Promise<HistoryEntry[]>;
  commit(entry: HistoryEntry): Promise<void>;
}
let lastTime = 0;
export const historyTime = () => (lastTime = Math.max(Date.now(), lastTime + 1));
export const YOU: Author = { kind: "human", name: "You" };
export const UNKNOWN: Author = { kind: "unknown", name: "Origin unknown" };
export const action = (label: string, author: Author = YOU): ChangeContext => ({ action: crypto.randomUUID(), label, author });
export const pageId = (change: PageChange) => (change.after ?? change.before)!.id;
export const sameRevision = (a: LLObject | null, b: LLObject | null) => (!a && !b) || (!!a && !!b && a.id === b.id && a.revision === b.revision);
export const samePage = (a: LLObject | null, b: LLObject | null) => {
  if (!a || !b) return a === b;
  const { revision: _a, updatedAt: _at, ...left } = a;
  const { revision: _b, updatedAt: _bt, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
};
export const conflict = () => new Error("This page has newer changes. Your edits are still here. Open history to keep a copy before reloading.");

export function inverse(entries: HistoryEntry[], actionId: string): PageChange[] {
  const pages = new Map<string, PageChange[]>();
  for (const entry of entries.filter((e) => e.action === actionId).sort((a, b) => a.at - b.at)) {
    for (const change of entry.changes) pages.set(pageId(change), [...(pages.get(pageId(change)) ?? []), change]);
  }
  return [...pages.values()].map((changes) => {
    const after = new Set(changes.map((c) => c.after?.revision).filter(Boolean));
    const before = new Set(changes.map((c) => c.before?.revision).filter(Boolean));
    const starts = changes.filter((c) => !c.before || !after.has(c.before.revision));
    if (starts.length > 1) throw new Error("There are newer changes between steps of this action. Nothing was changed. Keep a version as a copy instead.");
    const first = starts[0] ?? changes[0];
    const last = changes.find((c) => !c.after || !before.has(c.after.revision)) ?? changes[changes.length - 1];
    return { before: last.after, after: first.before };
  }).filter((c) => !samePage(c.before, c.after));
}
