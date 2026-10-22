import type { EditorDoc, NotesStore } from "@leadinglight/editor/editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { childOf, createChild } from "./linked";
import { type LLObject, objects } from "./objects";
import { reportSaveError, trackFlush } from "./saving";

const SAVE_DELAY_MS = 500;

// The thought block with this id, wherever the user has moved it in the Thoughts page.
function find(nodes: EditorDoc[] | undefined, id: string): EditorDoc | undefined {
  for (const node of nodes ?? []) {
    if (node.type === "thought" && node.attrs?.id === id) return node;
    const inner = find(node.content, id);
    if (inner) return inner;
  }
}

// Sidenote text for `page`, kept as thought blocks in its Thoughts page, which is made with the
// first note. Undefined while that page loads; a new store each time it (re)loads. `onNote` hears
// of every new note, and gets the Thoughts page when the note made it.
export function useThoughts(page: LLObject, onNote: (thoughts?: LLObject) => void): NotesStore | undefined {
  const linked = childOf(page, "thoughts");
  const id = useRef<string>(undefined);
  const doc = useRef<EditorDoc>({ type: "doc", content: [] });
  const [version, setVersion] = useState<number | null>(null);
  const creating = useRef<Promise<void>>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const noted = useRef(onNote);
  noted.current = onNote;

  const flush = async () => {
    clearTimeout(timer.current);
    if (!dirty.current || !id.current) return;
    dirty.current = false;
    // A Thoughts page can't be empty, or it would open as unreadable.
    const content = doc.current.content?.length ? doc.current : { type: "doc", content: [{ type: "paragraph" }] };
    await objects.update(id.current, { content }).catch(reportSaveError);
  };
  const save = () => {
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
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
    doc.current = { type: "doc", content: [] };
    if (!linked) return setVersion((v) => (v ?? 0) + 1);
    setVersion(null);
    let stale = false;
    objects
      .get(linked)
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

  return useMemo<NotesStore | undefined>(
    () =>
      version !== null
        ? {
            read: (note) => find(doc.current.content, note)?.content,
            write: (note, body) => {
              const node = find(doc.current.content, note);
              if (!node) return;
              node.content = body;
              save();
            },
            add: (note, quote) => {
              doc.current.content = [...(doc.current.content ?? []), { type: "thought", attrs: { id: note, source: page.id, quote }, content: [{ type: "paragraph" }] }];
              creating.current ??= id.current
                ? Promise.resolve()
                : createChild(page, "thoughts").then((thoughts) => {
                    id.current = thoughts.id;
                    noted.current(thoughts);
                  });
              void creating.current.then(save, console.error);
              noted.current();
            },
            remove: (note) => {
              const drop = (nodes: EditorDoc[] = []): EditorDoc[] =>
                nodes.filter((n) => !(n.type === "thought" && n.attrs?.id === note)).map((n) => (n.content ? { ...n, content: drop(n.content) } : n));
              doc.current.content = drop(doc.current.content);
              save();
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}
