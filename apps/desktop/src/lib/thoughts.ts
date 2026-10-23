import type { EditorDoc, NotesStore } from "@leadinglight/editor/editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { childOf, createChild } from "./linked";
import { editPage, isLive, liveContent, watchLive } from "./live";
import { type LLObject, objects } from "./objects";
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

// Sidenote text for `page`, kept as thought blocks in its Thoughts page, which is made with the
// first note. Undefined while that page loads; a new store each time it (re)loads. `onNote` hears
// of every new note, and gets the Thoughts page when the note made it.
// Changes are kept as steps and laid over the Thoughts page as it is when they're saved: through
// its editor when it is open in a pane, so that pane never saves its copy over them (DECISIONS.md,
// 9), else over what is stored.
export function useThoughts(page: LLObject, onNote: (thoughts?: LLObject) => void): NotesStore | undefined {
  const linked = childOf(page, "thoughts");
  const id = useRef<string>(undefined);
  // What reads see: the Thoughts page as loaded, with this page's changes since.
  const doc = useRef<EditorDoc>({ type: "doc", content: [] });
  const [version, setVersion] = useState<number | null>(null);
  // Bumped when the open Thoughts page changes under the notes.
  const [rev, setRev] = useState(0);
  const creating = useRef<Promise<void>>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changes = useRef<Change[]>([]);
  const noted = useRef(onNote);
  noted.current = onNote;

  const flush = async () => {
    clearTimeout(timer.current);
    const target = id.current;
    if (!target || !changes.current.length) return;
    const batch = changes.current.splice(0);
    const run = (d: EditorDoc) => readable(batch.reduce((acc, change) => change(acc), d));
    if (isLive(target)) return editPage(target, { content: run });
    const obj = await objects.get(target);
    if (obj) await objects.update(target, { content: run(obj.content ?? { type: "doc", content: [] }) }).catch(reportSaveError);
  };
  // An open Thoughts page takes each change at once, so an edit made there next can't land
  // underneath one still waiting here; a stored one is written after a pause.
  const change = (step: Change) => {
    doc.current = step(doc.current);
    changes.current.push(step);
    clearTimeout(timer.current);
    if (id.current && isLive(id.current)) void flush();
    else timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  useEffect(() => {
    const untrack = trackFlush(flush);
    return () => {
      untrack();
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loads on open, and again when the link changes under it: a Thoughts page deleted (start an
  // empty one) or replaced. A page this hook just made is already loaded.
  useEffect(() => {
    if (linked === id.current && version !== null) return;
    void flush();
    id.current = linked;
    creating.current = undefined;
    changes.current = [];
    doc.current = { type: "doc", content: [] };
    if (!linked) return setVersion((v) => (v ?? 0) + 1);
    setVersion(null);
    let stale = false;
    const open = liveContent(linked);
    (open ? Promise.resolve({ content: open }) : objects.get(linked))
      .then((obj) => {
        if (stale) return;
        if (obj?.content) doc.current = obj.content;
        setVersion((v) => (v ?? 0) + 1);
      })
      .catch(console.error);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  // With the Thoughts page open in a pane, its edits (a thought rewritten or deleted there) reach
  // the notes; this page's own changes not yet saved stay on top.
  useEffect(() => {
    const target = id.current;
    if (!target || version === null) return;
    // On the next frame, so a quick switch to the other pane can't get ahead of it.
    let frame = 0;
    const unwatch = watchLive(target, () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const open = liveContent(target);
        if (!open) return;
        doc.current = changes.current.reduce((d, step) => step(d), open);
        setRev((r) => r + 1);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unwatch();
    };
  }, [linked, version]);

  return useMemo<NotesStore | undefined>(
    () =>
      version !== null
        ? {
            read: (note) => find(doc.current.content, note)?.content,
            write: (note, body) => change((d) => eachThought(d, (n) => (n.attrs?.id === note ? { ...n, content: body } : n))),
            add: (note, quote) => {
              const thought = { type: "thought", attrs: { id: note, source: page.id, quote }, content: [{ type: "paragraph" }] };
              change((d) => (find(d.content, note) ? d : { ...d, content: [...(d.content ?? []), thought] }));
              creating.current ??= id.current
                ? Promise.resolve()
                : createChild(page.id, "thoughts").then((thoughts) => {
                    id.current = thoughts.id;
                    noted.current(thoughts);
                    void flush();
                  });
              void creating.current.catch(console.error);
              noted.current();
            },
            remove: (note) => change((d) => eachThought(d, (n) => (n.attrs?.id === note ? null : n))),
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, rev],
  );
}
