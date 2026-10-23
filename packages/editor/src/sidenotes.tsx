// Margin notes after xevrion's sidenotes (MIT, github.com/xevrion/ui-lab): each note sits level with
// its words, pushed below the note above when they'd collide, and a hairline ties it to its words.
// Changes: notes are always open and editable; for the active note only, its words are tinted and
// the curve runs from the text's edge (no dotted leader under other words); no motion lib.
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { anchors } from "./anchors";
import type { AssetStore } from "./assets";
import { createExtensions } from "./extensions";

// Where note bodies live: the page's Thoughts page, kept by the app.
export type NotesStore = {
  read: (id: string) => JSONContent[] | undefined;
  write: (id: string, body: JSONContent[]) => void;
  add: (id: string, quote: string) => void;
  remove: (id: string) => void;
};

export const GUTTER = 32;
const STACK_GAP = 12;
// Notes are 13px on a 19.5px line (editor.css).
const NOTE_FONT = { size: "13px", line: "19.5px" };

// How far below the top of its glyph box (or of its line, given a line height) text sits on its
// baseline, measured once per font off screen: a 0-height inline-block rests on the baseline.
const baselines = new Map<string, number>();
function baselineOffset(s: { fontStyle: string; fontWeight: string; fontSize: string; fontFamily: string }, line?: string) {
  const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const key = `${font}/${line}`;
  let at = baselines.get(key);
  if (at === undefined) {
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;line-height:${line ?? "normal"}`;
    box.style.font = font;
    if (line) box.style.lineHeight = line;
    box.append("x", Object.assign(document.createElement("span"), { style: "display:inline-block;width:0;height:0" }));
    document.body.append(box);
    const glyphs = document.createRange();
    glyphs.selectNodeContents(box.firstChild!);
    const top = line ? box.getBoundingClientRect().top : glyphs.getBoundingClientRect().top;
    at = box.lastElementChild!.getBoundingClientRect().bottom - top;
    box.remove();
    baselines.set(key, at);
  }
  return at;
}
// Hover must survive the trip from the words across to the note.
const HOVER_GRACE = 160;

type Spot = { top: number; line: number };

function NoteEditor({
  id,
  label,
  notes,
  assets,
  openLink,
  autoFocus,
  onAutoFocus,
  quote,
}: {
  id: string;
  label: string;
  notes: NotesStore;
  assets: AssetStore;
  openLink: (href: string) => void;
  autoFocus: boolean;
  onAutoFocus: () => void;
  // The words the note is written against, now.
  quote: () => string;
}) {
  const store = useRef(notes);
  store.current = notes;
  const extensions = useMemo(
    () => createExtensions({ assets, openLink, onExitTop: () => false, placeholder: "Write a thought" }),
    [assets, openLink],
  );
  const editor = useEditor({
    extensions,
    content: { type: "doc", content: notes.read(id) ?? [{ type: "paragraph" }] },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: "ll-editor", role: "textbox", "aria-label": label } },
    onUpdate: ({ editor }) => {
      // A note brought back without its thought (by undo, redo or paste) gets one again, so
      // nothing typed into it is lost.
      if (!store.current.read(id)) store.current.add(id, quote());
      store.current.write(id, editor.getJSON().content ?? []);
    },
  });
  useEffect(() => {
    if (!autoFocus) return;
    editor.commands.focus("end");
    onAutoFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The thought changed elsewhere (its Thoughts page, open in a pane): show it. While this note is
  // being typed in it waits, and catches up on focus and on blur, so the next keystroke here never
  // writes an older copy over it.
  useEffect(() => {
    const sync = () => {
      const body = store.current.read(id) ?? [{ type: "paragraph" }];
      if (JSON.stringify(body) !== JSON.stringify(editor.getJSON().content)) editor.commands.setContent({ type: "doc", content: body }, { emitUpdate: false });
    };
    if (!editor.isFocused) sync();
    editor.on("focus", sync);
    editor.on("blur", sync);
    return () => {
      editor.off("focus", sync);
      editor.off("blur", sync);
    };
  }, [editor, notes, id]);
  return <EditorContent editor={editor} />;
}

export function Sidenotes({
  editor,
  notes,
  assets,
  openLink,
  focusId,
}: {
  editor: Editor;
  notes: NotesStore;
  assets: AssetStore;
  openLink: (href: string) => void;
  focusId: string | null;
}) {
  const key = useEditorState({ editor, selector: ({ editor }) => anchors(editor.state.doc, "note").map((a) => a.id).join(" ") });
  const ids = useMemo(() => (key ? key.split(" ") : []), [key]);
  const cards = useRef(new Map<string, HTMLElement>());
  const [spots, setSpots] = useState<Record<string, Spot>>({});
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const [tops, setTops] = useState<Record<string, number>>({});
  const [edge, setEdge] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // A new note takes the cursor once; a card remounting later must not take it back.
  const autoFocused = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = hovered ?? focused;

  // Measure each note's words: where its line starts, and where its chip ends.
  useEffect(() => {
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root");
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      const { fontFamily } = getComputedStyle(editor.view.dom);
      const note = baselineOffset({ fontStyle: "normal", fontWeight: "400", fontSize: NOTE_FONT.size, fontFamily }, NOTE_FONT.line);
      const next: Record<string, Spot> = {};
      for (const id of ids) {
        const span = editor.view.dom.querySelector(`[data-note="${CSS.escape(id)}"]`);
        const words = span?.getClientRects()[0];
        const chip = editor.view.dom.querySelector(`[data-note-chip="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        // Not measurable for a moment (its pane re-laying out): keep where it was.
        if (!span || !words || !chip) {
          if (spotsRef.current[id]) next[id] = spotsRef.current[id];
          continue;
        }
        // The note's first baseline on its words' first baseline.
        next[id] = { top: words.top - box.top + baselineOffset(getComputedStyle(span)) - note, line: chip.top - box.top + chip.height / 2 };
      }
      setSpots(next);
      setEdge(editor.view.dom.getBoundingClientRect().right - box.left);
    };
    const schedule = () => (frame ||= requestAnimationFrame(measure));
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    editor.on("update", schedule);
    return () => {
      ro.disconnect();
      editor.off("update", schedule);
      cancelAnimationFrame(frame);
    };
  }, [editor, ids]);

  // Stack the notes: each level with its words, or just under the note above.
  useLayoutEffect(() => {
    let floor = -Infinity;
    const next: Record<string, number> = {};
    for (const id of ids) {
      const spot = spots[id];
      if (!spot) continue;
      next[id] = Math.max(spot.top, floor);
      floor = next[id] + (cards.current.get(id)?.offsetHeight ?? 0) + STACK_GAP;
    }
    setTops(next);
    // Notes that stack past the end of the text still belong to the page.
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root");
    if (root) root.style.minHeight = floor > 0 ? `${floor}px` : "";
  }, [editor, ids, spots]);

  // A note growing pushes the ones below it.
  const grow = useRef<ResizeObserver>(null);
  useEffect(() => {
    grow.current = new ResizeObserver(() => setSpots((s) => ({ ...s })));
    cards.current.forEach((el) => grow.current?.observe(el));
    return () => grow.current?.disconnect();
  }, []);

  // The chip after the words points at its note: hover shows the line, a click goes to the note.
  useEffect(() => {
    const dom = editor.view.dom;
    const chipOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-note-chip], [data-note]");
    const idOf = (el: HTMLElement) => el.dataset.noteChip ?? el.dataset.note ?? null;
    const over = (e: Event) => {
      const el = chipOf(e);
      if (!el) return;
      clearTimeout(timer.current);
      setHovered(idOf(el));
    };
    const out = (e: Event) => chipOf(e) && leave();
    const click = (e: Event) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-note-chip]")?.dataset.noteChip;
      if (id) cards.current.get(id)?.querySelector<HTMLElement>(".ProseMirror")?.focus();
    };
    dom.addEventListener("pointerover", over);
    dom.addEventListener("pointerout", out);
    dom.addEventListener("click", click);
    return () => {
      dom.removeEventListener("pointerover", over);
      dom.removeEventListener("pointerout", out);
      dom.removeEventListener("click", click);
    };
  }, [editor]);

  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(null), HOVER_GRACE);
  };

  const remove = (id: string) => {
    const type = editor.schema.marks.note;
    const tr = editor.state.tr;
    for (const a of anchors(editor.state.doc, "note")) if (a.id === id) tr.removeMark(a.from, a.to, type.create({ id }));
    editor.view.dispatch(tr);
    notes.remove(id);
  };

  const spot = active ? spots[active] : undefined;
  const top = active ? tops[active] : undefined;
  const bend = edge + GUTTER * 0.45;
  const end = (top ?? 0) + 10;

  return (
    <>
      {/* A style rule, not a class on the words: the editor would re-read words whose DOM changed. */}
      {active && <style>{`.ll-editor [data-note="${CSS.escape(active)}"] { background: color-mix(in srgb, var(--info) 12%, transparent); border-radius: 2px; }`}</style>}
      {spot && top !== undefined && (
        <svg aria-hidden className="ll-note-line">
          <path d={`M ${edge} ${spot.line} C ${bend} ${spot.line} ${bend} ${end} ${edge + GUTTER - 6} ${end}`} strokeWidth={1} />
        </svg>
      )}
      {ids.map((id, i) =>
        spots[id] ? (
          <aside
            className="ll-note"
            data-active={active === id || undefined}
            data-new={focusId === id || undefined}
            data-note-id={id}
            key={id}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(null)}
            onFocus={() => setFocused(id)}
            onPointerEnter={() => {
              clearTimeout(timer.current);
              setHovered(id);
            }}
            onPointerLeave={leave}
            ref={(el) => {
              if (el) {
                cards.current.set(id, el);
                grow.current?.observe(el);
              } else cards.current.delete(id);
            }}
            style={{ top: tops[id] ?? spots[id].top, left: edge + GUTTER }}
          >
            <span className="ll-note-num">{i + 1}</span>
            <NoteEditor
              assets={assets}
              autoFocus={focusId === id && autoFocused.current !== id}
              id={id}
              label={`Sidenote ${i + 1}`}
              notes={notes}
              onAutoFocus={() => (autoFocused.current = id)}
              openLink={openLink}
              quote={() => {
                const a = anchors(editor.state.doc, "note").find((x) => x.id === id);
                return a ? editor.state.doc.textBetween(a.from, a.to, " ").trim() : "";
              }}
            />
            <Button aria-label="Remove sidenote" className="ll-note-remove" onClick={() => remove(id)} size="icon-xs" variant="ghost">
              <X />
            </Button>
          </aside>
        ) : null,
      )}
    </>
  );
}
