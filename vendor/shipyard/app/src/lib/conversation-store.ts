import { create } from "zustand";

import type { Artifact, CrewMember, TranscriptItem } from "@/lib/transcript";

// The conversations the app holds for agents shown as a conversation rather
// than a terminal: each session's recent items and the crew working beside
// it. Only sessions someone opened are kept, and only their last items.

const KEEP = 300;

interface ConversationState {
  // Transcripts and crews by "box/session".
  items: Record<string, TranscriptItem[]>;
  crew: Record<string, CrewMember[]>;
  // When each agent last wrote to its record (ms), for Thinking's time.
  last: Record<string, number>;
  // The pages each agent published on claude.ai, newest last.
  artifacts: Record<string, Artifact[]>;
  push(key: string, item: TranscriptItem): void;
  // merge replaces items with the same id and appends the rest, as the
  // box resends a tool group that was still open.
  merge(key: string, items: TranscriptItem[]): void;
  // resync takes a window the box read afresh (lib/transcript-feed): what
  // the chat holds from before start stays, the rest is the window's, so
  // nothing it showed goes. fresh: another conversation, nothing stays.
  resync(key: string, window: TranscriptItem[], start: number, fresh?: boolean): void;
  // fill puts items read between what was held and a window into place.
  fill(key: string, items: TranscriptItem[]): void;
  update(key: string, id: string, patch: Partial<TranscriptItem>): void;
  remove(key: string, id: string): void;
  setCrew(key: string, crew: CrewMember[]): void;
  setLast(key: string, at: number): void;
  // Set only when the list changed, so its chip draws again only then.
  setArtifacts(key: string, list: Artifact[]): void;
}

// Where an item's line starts in the agent's record (boxes send it as off;
// 0 is left out).
export const offOf = (it: TranscriptItem) => (it as { off?: number }).off ?? 0;

// spill hears the items a chat lets go past KEEP, oldest first: the chat's
// older turns (lib/history) take them, so what it shows has no hole.
let spill: ((key: string, items: TranscriptItem[]) => void) | undefined;
export const onSpill = (fn: typeof spill) => void (spill = fn);

export const useConversations = create<ConversationState>()((set, get) => {
  // put sets a chat's items, letting the oldest past KEEP go to spill.
  const put = (key: string, list: TranscriptItem[]) => {
    const over = Math.max(0, list.length - KEEP);
    set((s) => ({ items: { ...s.items, [key]: over ? list.slice(over) : list } }));
    if (over) spill?.(key, list.slice(0, over));
  };
  return {
    items: {},
    last: {},
    crew: {},
    artifacts: {},
    push: (key, item) => put(key, [...(get().items[key] ?? []), item]),
    merge: (key, incoming) => {
      const list = [...(get().items[key] ?? [])];
      const at = new Map(list.map((it, i) => [it.id, i]));
      for (const it of incoming) {
        const i = at.get(it.id);
        if (i === undefined) {
          at.set(it.id, list.length);
          list.push(it);
        } else list[i] = it;
      }
      put(key, list);
    },
    resync: (key, window, start, fresh) => {
      const held = fresh ? [] : (get().items[key] ?? []).filter((it) => offOf(it) < start);
      const ids = new Set(window.map((it) => it.id));
      put(key, [...held.filter((it) => !ids.has(it.id)), ...window]);
    },
    fill: (key, items) => {
      const list = get().items[key] ?? [];
      const have = new Set(list.map((it) => it.id));
      const add = items.filter((it) => !have.has(it.id));
      if (!add.length) return;
      // In the record's order; a sort that keeps the order of equals.
      put(key, [...list, ...add].map((it, i) => [it, i] as const).sort((a, b) => offOf(a[0]) - offOf(b[0]) || a[1] - b[1]).map(([it]) => it));
    },
    update: (key, id, patch) =>
      set((s) => ({ items: { ...s.items, [key]: (s.items[key] ?? []).map((i) => (i.id === id ? ({ ...i, ...patch } as TranscriptItem) : i)) } })),
    remove: (key, id) => set((s) => ({ items: { ...s.items, [key]: (s.items[key] ?? []).filter((i) => i.id !== id) } })),
    setCrew: (key, crew) => set((s) => ({ crew: { ...s.crew, [key]: crew } })),
    setLast: (key, at) => set((s) => (s.last[key] === at ? s : { last: { ...s.last, [key]: at } })),
    setArtifacts: (key, list) => set((s) => (sameArtifacts(s.artifacts[key], list) ? s : { artifacts: { ...s.artifacts, [key]: list } })),
  };
});

const sameArtifacts = (a: Artifact[] | undefined, b: Artifact[]) =>
  (a ?? []).length === b.length && (a ?? []).every((x, i) => x.tool === b[i].tool && x.url === b[i].url && x.title === b[i].title && x.description === b[i].description);

export const keyOf = (box: string, session: string) => `${box}/${session}`;
