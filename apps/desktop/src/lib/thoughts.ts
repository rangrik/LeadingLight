import type { EditorDoc, NotesStore } from "@leadinglight/editor/editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { childOf, createChild } from "./linked";
import { editPage, isLive, liveContent, watchLive } from "./live";
import { type LLObject, type ObjectSummary, objects } from "./objects";
import { reportSaveError, trackFlush } from "./saving";

const SAVE_DELAY_MS = 500;

type Change = (doc: EditorDoc) => EditorDoc;

// The thought block with this id, wherever the user has moved it in the Thoughts page.
function find(nodes: EditorDoc[] | undefined, id: string): EditorDoc | undefined {
  for (const node of nodes ?? []) {
    if (node.type === "thought" && node.attrs?.id === id) return node;
    const inner = find(node.content, id);
    if (inner) return inner;
  }
}

// Every thought block, at any depth, through fn (null drops it).
function eachThought(doc: EditorDoc, fn: (node: EditorDoc) => EditorDoc | null): EditorDoc {
  const walk = (nodes: EditorDoc[] = []): EditorDoc[] =>
    nodes.flatMap((n) => {
      const next = n.type === "thought" ? fn(n) : n;
      if (!next) return [];
      return next.content ? [{ ...next, content: walk(next.content) }] : [next];
    });
  return { ...doc, content: walk(doc.content) };
}

// A Thoughts page can't be empty, or it would open as unreadable.
const readable = (doc: EditorDoc): EditorDoc => (doc.content?.length ? doc : { type: "doc", content: [{ type: "paragraph" }] });

// What every editor showing one page's notes shares: its own page's and its report's place on the
// task (DECISIONS.md, 24). One queue writes the Thoughts page, so neither saves over the other.
type Shared = {
  id?: string;
  // The Thoughts page as loaded, with the changes since; null while it loads.
  doc: EditorDoc;
  version: number | null;
  loading?: boolean;
  changes: Change[];
  timer?: ReturnType<typeof setTimeout>;
  frame?: number;
  creating?: Promise<void>;
  saving: Promise<void>;
  hosts: Set<() => void>;
};
const shared = new Map<string, Shared>();
function sharedFor(page: string): Shared {
  const s = shared.get(page) ?? { doc: { type: "doc", content: [] }, version: null, changes: [], saving: Promise.resolve(), hosts: new Set() };
  shared.set(page, s);
  return s;
}

// Changes are kept as steps and laid over the Thoughts page as it is when they're saved: through
// its editor when it is open in a pane, so that pane never saves its copy over them (DECISIONS.md,
// 9), else over what is stored. One write at a time, so none reads what another is replacing.
function flush(s: Shared): Promise<void> {
  clearTimeout(s.timer);
  const target = s.id;
  if (!target || !s.changes.length) return s.saving;
  const batch = s.changes.splice(0);
  const run = (d: EditorDoc) => readable(batch.reduce((acc, change) => change(acc), d));
  s.saving = s.saving.then(async () => {
    if (isLive(target)) return editPage(target, { content: run });
    const obj = await objects.get(target);
    if (obj) await objects.update(target, { content: run(obj.content ?? { type: "doc", content: [] }) });
  }).catch(reportSaveError);
  return s.saving;
}

// An open Thoughts page takes each change at once, so an edit made there next can't land
// underneath one still waiting here; a stored one is written after a pause. The page's other
// editors show it on the next frame.
function change(s: Shared, step: Change, from: () => void) {
  s.doc = step(s.doc);
  s.changes.push(step);
  clearTimeout(s.timer);
  if (s.id && isLive(s.id)) void flush(s);
  else s.timer = setTimeout(() => void flush(s), SAVE_DELAY_MS);
  cancelAnimationFrame(s.frame ?? 0);
  s.frame = requestAnimationFrame(() => s.hosts.forEach((h) => h !== from && h()));
}

// Sidenote text for `page`, kept as thought blocks in its Thoughts page, which is made with the
// first note. Undefined while that page loads; a new store each time it (re)loads or changes
// elsewhere. `onNote` hears of every new note, and gets the Thoughts page when the note made it.
export function useThoughts(page: ObjectSummary, onNote: (thoughts?: LLObject) => void): NotesStore | undefined {
  const linked = childOf(page, "thoughts");
  const s = useMemo(() => sharedFor(page.id), [page.id]);
  const [tick, setTick] = useState(0);
  const hear = useRef(() => setTick((t) => t + 1)).current;
  const noted = useRef(onNote);
  noted.current = onNote;

  useEffect(() => {
    // Back in the map after StrictMode's trial unmount took it out.
    shared.set(page.id, s);
    s.hosts.add(hear);
    const untrack = trackFlush(() => flush(s));
    return () => {
      untrack();
      s.hosts.delete(hear);
      void flush(s);
      if (!s.hosts.size) shared.delete(page.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  // Loads on open, and again when the link changes under it: a Thoughts page deleted (start an
  // empty one) or replaced. A page made here, or loaded for another editor, is already loaded.
  useEffect(() => {
    if (linked === s.id && (s.version !== null || s.loading)) return;
    void flush(s);
    s.id = linked;
    s.creating = undefined;
    s.changes = [];
    s.doc = { type: "doc", content: [] };
    s.loading = true;
    const done = (content?: EditorDoc) => {
      if (s.id !== linked || !s.loading) return;
      s.loading = false;
      if (content) s.doc = content;
      s.version = (s.version ?? 0) + 1;
      s.hosts.forEach((h) => h());
    };
    if (!linked) return done();
    s.version = null;
    s.hosts.forEach((h) => h());
    const open = liveContent(linked);
    (open ? Promise.resolve({ content: open }) : objects.get(linked)).then((obj) => done(obj?.content ?? undefined)).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, s]);

  // With the Thoughts page open in a pane, its edits (a thought rewritten or deleted there) reach
  // the notes; changes not yet saved stay on top.
  useEffect(() => {
    const target = s.id;
    if (!target || s.version === null) return;
    // On the next frame, so a quick switch to the other pane can't get ahead of it.
    let frame = 0;
    const unwatch = watchLive(target, () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const open = liveContent(target);
        if (!open) return;
        s.doc = s.changes.reduce((d, step) => step(d), open);
        hear();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, s.version]);

  return useMemo<NotesStore | undefined>(
    () =>
      s.version !== null
        ? {
            read: (note) => find(s.doc.content, note)?.content,
            write: (note, body) => change(s, (d) => eachThought(d, (n) => (n.attrs?.id === note ? { ...n, content: body } : n)), hear),
            add: (note, quote) => {
              const thought = { type: "thought", attrs: { id: note, source: page.id, quote }, content: [{ type: "paragraph" }] };
              change(s, (d) => (find(d.content, note) ? d : { ...d, content: [...(d.content ?? []), thought] }), hear);
              s.creating ??= s.id
                ? Promise.resolve()
                : createChild(page.id, "thoughts").then((thoughts) => {
                    s.id = thoughts.id;
                    noted.current(thoughts);
                    void flush(s);
                  });
              void s.creating.catch(console.error);
              noted.current();
            },
            remove: (note) => change(s, (d) => eachThought(d, (n) => (n.attrs?.id === note ? null : n)), hear),
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, s.version, tick],
  );
}
