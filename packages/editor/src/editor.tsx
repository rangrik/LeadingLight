import { type Editor, type Extensions, type FocusPosition, generateJSON, getSchema, type JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";
import { anchors, newId, setLiveQuotes, trimmed } from "./anchors";
import type { AssetStore } from "./assets";
import { BlockHandle } from "./block-handle";
import { MarkTip } from "./mark-tip";
import { selectedBlocks } from "./block-selection";
import { EmojiPicker } from "./emoji-prefix";
import { createExtensions } from "./extensions";
import type { LinkHost } from "./page-links";
import { SelectionToolbar } from "./selection-toolbar";
import { type NotesStore, Sidenotes } from "./sidenotes";
import { TableToolbar } from "./table";
import { TableOfContents } from "./toc";
import { type Count, countText, OFF, onFound, type Writing, writingKey } from "./writing";

export type { NotesStore } from "./sidenotes";
export { citesIn } from "./anchors";

export type EditorDoc = JSONContent;

// A page body from HTML, for a page no editor has open (one an assistant makes).
let parsing: Extensions | null = null;
export function htmlDoc(html: string): EditorDoc {
  parsing ??= createExtensions({ onExitTop: () => false, openLink: () => {}, assets: { put: () => Promise.reject(new Error("No files here")), open: () => {} } });
  return generateJSON(html, parsing);
}

// How a page looks: Plain is the calm default, Playful adds hand-made touches (see editor.css).
export type PageStyle = "plain" | "playful";

// The parts of a document the schema knows: unknown nodes and marks are left out.
function known(schema: Schema, node: JSONContent): JSONContent | null {
  if (!node.type || !schema.nodes[node.type]) return null;
  const content = node.content?.map((c) => known(schema, c)).filter((c) => c !== null);
  return { ...node, marks: node.marks?.filter((m) => schema.marks[m.type]), content };
}

export type Selected = { text: string; from: number; to: number };
export type Stats = { page: Count; selected: Count | null };

export type BlockEditorHandle = {
  focus: (position?: FocusPosition) => void;
  // For changes made from outside the page (linking a mention, merging a tag).
  getJSON: () => EditorDoc;
  setContent: (doc: EditorDoc) => void;
  // Focus back where the caret was, for a panel giving the keyboard back.
  refocus: () => void;
  hasFocus: () => boolean;
  placeAt: (x: number, y: number) => boolean;
  clearBlocks: () => void;
  // Quotes words from another page, with a reference back to them (see DECISIONS.md, 11).
  insertQuote: (quote: { text: string; id: string; href: string; label: string }) => void;
  // Scrolls to an anchor (a note, quoted words, or a reference) and lights it for a moment.
  reveal: (id: string) => void;
  selection: () => Selected;
  find: (text: string, near: number) => Selected | null;
  // A fresh DOM range for a span of the page, made each time a surface places itself by the
  // words: a Range kept from before collapses once the editor redraws those nodes.
  domRange: (from: number, to: number) => Range | null;
  // The page as plain text, for an assistant's context.
  text: () => string;
  // HTML (an answer as Markdown, converted) after the top-level block holding pos. Neither
  // takes focus: the panel that inserts keeps the keyboard.
  insertAfter: (pos: number, html: string) => void;
  replaceRange: (from: number, to: number, html: string) => void;
};

// Where "Add to essay" sends selected words.
export type QuoteTarget = { essay: string; add: (text: string, id: string) => void };

const selected = (editor: Editor): Selected => {
  const { from, to } = editor.state.selection;
  return { text: editor.state.doc.textBetween(from, to, "\n"), from, to };
};

// Where text (as selection() wrote it, "\n" between blocks) now is, nearest to where it was:
// an answer's Insert or Replace must not trust positions from before the page was edited.
function locate(editor: Editor, text: string, near: number): Selected | null {
  if (!text) return null;
  let s = "";
  const at: number[] = [];
  let first = true;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) {
        s += "\n";
        at.push(-1);
      }
      first = false;
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) at.push(pos + i);
      s += node.text;
    }
    return true;
  });
  let best: Selected | null = null;
  for (let i = s.indexOf(text); i >= 0; i = s.indexOf(text, i + 1)) {
    const from = at[i];
    const last = at[i + text.length - 1];
    if (from < 0 || last < 0) continue;
    if (!best || Math.abs(from - near) < Math.abs(best.from - near)) best = { text, from, to: last + 1 };
  }
  return best;
}

const isEmptyLine = (node?: PMNode | null) => node?.type.name === "paragraph" && node.content.size === 0;

const TEXT_LINE = "p, h1, h2, h3, h4, summary, pre";
// How far a line's box is from a point along one axis (0 when the point is inside it).
const gap = (from: number, to: number, at: number) => (at < from ? from - at : at > to ? at - to : 0);

// A click on blank page space; returns whether it placed the cursor. Beside a block the cursor
// goes into the line at that height; above the blocks, to the start; below them a new line opens
// after the last block, unless that block is already an empty line.
function placeAt(editor: Editor, x: number, y: number): boolean {
  if (!editor.isEditable) return false;
  const { view, state } = editor;
  const { doc } = state;
  const go = (tr: Transaction) => {
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  };
  let above: { node: PMNode; pos: number } | null = null;
  for (let i = 0, pos = 0; i < doc.childCount; pos += doc.child(i).nodeSize, i++) {
    const node = doc.child(i);
    const rect = (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect();
    if (!rect || rect.top > y) break;
    if (y <= rect.bottom) {
      if (node.isAtom) return go(state.tr.setSelection(NodeSelection.create(doc, pos)));
      // Of this block's text lines, take the one at this height nearest the clicked side (a
      // table's first or last cell), then put the cursor at its near end, clamped into its text
      // so padding can't send it to a neighbour.
      const left = x < rect.left + rect.width / 2;
      const px = left ? rect.left : rect.right;
      const block = view.nodeDOM(pos) as HTMLElement;
      const away = (l: HTMLElement) => {
        const r = l.getBoundingClientRect();
        return gap(r.top, r.bottom, y) * 1000 + gap(r.left, r.right, px);
      };
      const lines = [...(block.matches(TEXT_LINE) ? [block] : []), ...block.querySelectorAll<HTMLElement>(TEXT_LINE)];
      const line = lines.sort((a, b) => away(a) - away(b))[0];
      if (line) {
        const box = line.getBoundingClientRect();
        const s = getComputedStyle(line);
        const top = box.top + parseFloat(s.paddingTop) + 1;
        const bottom = box.bottom - parseFloat(s.paddingBottom) - 1;
        // Hit the line's start (its right edge can hold controls, or be blank past the text), then
        // for a right-side click walk along that visual line to its end. Measuring the next
        // character's start stops before a wrapped line's trailing space, where the caret shows
        // at that line's end rather than the next line's start.
        const hit = view.posAtCoords({ left: box.left + parseFloat(s.paddingLeft) + 1, top: Math.min(Math.max(y, top), bottom) });
        if (hit) {
          let at = hit.pos;
          const lineTop = view.coordsAtPos(at, 1).top;
          const end = doc.resolve(at).end();
          while (!left && at < end && doc.textBetween(at, at + 1) !== "\n" && Math.abs(view.coordsAtPos(at + 1, 1).top - lineTop) < 2) at++;
          return go(state.tr.setSelection(TextSelection.near(doc.resolve(at))));
        }
      }
      return go(state.tr.setSelection(TextSelection.near(doc.resolve(pos + 1))));
    }
    above = { node, pos };
  }
  if (!above) return go(state.tr.setSelection(Selection.atStart(doc)));
  if (isEmptyLine(above.node)) return go(state.tr.setSelection(TextSelection.create(doc, above.pos + 1)));
  const at = above.pos + above.node.nodeSize;
  const tr = state.tr.insert(at, state.schema.nodes.paragraph.create());
  return go(tr.setSelection(TextSelection.create(tr.doc, at + 1)));
}

export function BlockEditor({
  content,
  assets,
  onChange,
  onExitTop,
  openLink: open = (href) => void window.open(href, "_blank", "noopener"),
  links,
  readOnly,
  onAsk,
  style = "plain",
  notes,
  quoteTo,
  quotes,
  onCites,
  writing,
  onStats,
  onFocusChange,
  ref,
}: {
  content: EditorDoc | null;
  assets: AssetStore;
  // Gets a reader, not the document: serialising a long page on every keystroke is slow.
  onChange?: (read: () => EditorDoc) => void;
  links?: LinkHost;
  // An embedded page: shown, never edited or saved from here.
  readOnly?: boolean;
  onExitTop?: () => void;
  openLink?: (href: string) => void;
  // Given, the selection toolbar offers Ask with the selected words.
  onAsk?: (selected: Selected) => void;
  style?: PageStyle;
  // Where sidenotes keep their text; without it the page can't take notes.
  notes?: NotesStore;
  quoteTo?: QuoteTarget;
  // The quotes this page's essay still holds (null until known); words whose quote is gone stop
  // showing as quoted, and are dropped from the page when it first learns which are gone.
  quotes?: string[] | null;
  // Hears which quotes (cite ids) this page holds, whenever that changes.
  onCites?: (ids: string[]) => void;
  // Focus mode, Syntax highlight, Style check and Grammar check (writing.ts).
  writing?: Writing;
  // Given, the counts beside the page's name, a moment after each change.
  onStats?: (stats: Stats) => void;
  // Whether the page is being written in, which Focus mode dims the rest of the page for.
  onFocusChange?: (focused: boolean) => void;
  ref?: Ref<BlockEditorHandle>;
}) {
  // Callbacks live in refs so the editor is created once per mount.
  const onChangeRef = useRef(onChange);
  const onExitTopRef = useRef(onExitTop);
  const notesRef = useRef(notes);
  const openRef = useRef(open);
  onChangeRef.current = onChange;
  onExitTopRef.current = onExitTop;
  notesRef.current = notes;
  openRef.current = open;
  // The note just added, which opens with the cursor in it.
  const [newNote, setNewNote] = useState<string | null>(null);

  const extensions = useMemo(
    () =>
      createExtensions({
        assets,
        openLink: (href) => openRef.current(href),
        links,
        onExitTop: () => {
          onExitTopRef.current?.();
          return Boolean(onExitTopRef.current);
        },
        onNote: (id, quote, existing) => {
          if (!notesRef.current) return false;
          if (existing) {
            const root = editor.view.dom.closest(".ll-editor-root");
            root?.querySelector<HTMLElement>(`.ll-note[data-note-id="${CSS.escape(id)}"] .ProseMirror`)?.focus();
            return true;
          }
          notesRef.current.add(id, quote);
          setNewNote(id);
          return true;
        },
      }),
    // The store is a module-level singleton in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A page holding blocks this version doesn't know shows the rest, read-only, and is never
  // saved from here, so nothing stored is lost.
  const { unreadable, start } = useMemo(() => {
    if (!content) return { unreadable: false, start: content };
    const schema = getSchema(extensions);
    try {
      schema.nodeFromJSON(content);
      return { unreadable: false, start: content };
    } catch {
      return { unreadable: true, start: known(schema, content) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor({
    extensions,
    content: start ?? undefined,
    editable: !unreadable && !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      // Plain text gets one line per line of text, not blank lines for every list level.
      clipboardTextSerializer: (slice) => {
        const lines: string[] = [];
        slice.content.descendants((node) => {
          if (node.isTextblock) lines.push(node.textBetween(0, node.content.size, "\n", "\n"));
          return !node.isTextblock;
        });
        return lines.join("\n");
      },
      attributes: {
        class: "ll-editor",
        role: "textbox",
        "aria-label": "Page body",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => !unreadable && !readOnly && onChangeRef.current?.(() => editor.getJSON()),
  });

  const aids = JSON.stringify(writing ?? OFF);
  useLayoutEffect(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(writingKey, JSON.parse(aids)));
  }, [editor, aids]);

  const onFocusRef = useRef(onFocusChange);
  onFocusRef.current = onFocusChange;
  useEffect(() => {
    const on = () => onFocusRef.current?.(true);
    const off = () => onFocusRef.current?.(false);
    editor.on("focus", on).on("blur", off);
    return () => void editor.off("focus", on).off("blur", off);
  }, [editor]);

  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const counting = Boolean(onStats);
  useEffect(() => {
    if (!counting) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = 0;
    const later = (ms = 150) => {
      clearTimeout(timer);
      timer = setTimeout(send, ms);
    };
    // A slice at a time on a long page, so the first count never freezes it. Each count sent
    // redraws the header, so unfinished ones go at most once a second.
    const send = () => {
      const { doc, selection } = editor.state;
      const deadline = performance.now() + 20;
      const page = countText(doc, 0, doc.content.size, deadline);
      const selected = selection.empty ? null : countText(doc, selection.from, selection.to, deadline);
      const done = page.done && selected?.done !== false;
      if (done || performance.now() - sent > 1000) {
        sent = performance.now();
        onStatsRef.current?.({ page: page.count, selected: selected?.count ?? null });
      }
      if (!done) later(0);
    };
    const changed = () => later();
    send();
    editor.on("transaction", changed);
    const off = onFound(changed);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", changed);
      off();
    };
  }, [editor, counting]);

  // Dev-only hook so QA scripts can read editor state.
  if (import.meta.env.DEV && !readOnly) (window as unknown as { __editor: unknown }).__editor = editor;

  // Words whose thought is gone (its Thoughts page or block was deleted) stop being noted, each
  // time the notes (re)load.
  useEffect(() => {
    if (!notes || unreadable || readOnly) return;
    const tr = editor.state.tr;
    for (const a of anchors(tr.doc, "note")) if (!notes.read(a.id)) tr.removeMark(a.from, a.to, editor.schema.marks.note.create({ id: a.id }));
    if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
  }, [editor, notes, unreadable, readOnly]);

  const pruned = useRef(false);
  useEffect(() => {
    if (!quotes || unreadable || readOnly) return;
    const tr = setLiveQuotes(editor.state.tr, quotes);
    if (!pruned.current) {
      pruned.current = true;
      const live = new Set(quotes);
      for (const a of anchors(tr.doc, "cited")) if (!live.has(a.id)) tr.removeMark(a.from, a.to, editor.schema.marks.cited.create(a.attrs));
      tr.setMeta("addToHistory", false);
    }
    editor.view.dispatch(tr);
  }, [editor, quotes, unreadable, readOnly]);

  const onCitesRef = useRef(onCites);
  onCitesRef.current = onCites;
  useEffect(() => {
    let last: string | undefined;
    const report = () => {
      if (!onCitesRef.current) return;
      const ids: string[] = [];
      editor.state.doc.descendants((node) => void (node.type.name === "cite" && ids.push(node.attrs.id)));
      if (ids.join(" ") === last) return;
      last = ids.join(" ");
      onCitesRef.current?.(ids);
    };
    report();
    editor.on("update", report);
    return () => void editor.off("update", report);
  }, [editor]);

  // A quote goes after the block holding the cursor once the page has been written in, else at
  // the end. An empty line there is replaced rather than left above the quote.
  const touched = useRef(false);
  useEffect(() => {
    const touch = () => (touched.current = true);
    editor.on("focus", touch);
    return () => void editor.off("focus", touch);
  }, [editor]);

  // TipTap focuses on the next frame; focusing the view too makes it immediate.
  useImperativeHandle(
    ref,
    () => ({
      focus: (position = "start") => {
        editor.commands.focus(position);
        editor.view.focus();
      },
      getJSON: () => editor.getJSON(),
      setContent: (doc) => editor.commands.setContent(doc),
      // The view alone: TipTap's own focus lands a frame later, and would take the keyboard
      // from a surface (the ask bar) opened in between.
      refocus: () => editor.view.focus(),
      selection: () => selected(editor),
      find: (text, near) => locate(editor, text, near),
      domRange: (from, to) => {
        if (from >= to || from < 0 || to > editor.state.doc.content.size) return null;
        try {
          const a = editor.view.domAtPos(from);
          const b = editor.view.domAtPos(to);
          const range = document.createRange();
          range.setStart(a.node, a.offset);
          range.setEnd(b.node, b.offset);
          return range;
        } catch {
          return null;
        }
      },
      text: () => editor.getText(),
      insertAfter: (pos, html) => {
        const doc = editor.state.doc;
        const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
        editor.commands.insertContentAt($pos.depth ? $pos.after(1) : $pos.pos, html);
      },
      replaceRange: (from, to, html) => {
        const size = editor.state.doc.content.size;
        editor.commands.insertContentAt({ from: Math.min(from, size), to: Math.min(to, size) }, html);
      },
      // Focus in the editor's own toolbars (the link field) counts too.
      hasFocus: () => editor.view.hasFocus() || Boolean(editor.view.dom.closest(".ll-editor-root")?.contains(document.activeElement)),
      placeAt: (x, y) => placeAt(editor, x, y),
      // Selected blocks give way when focus goes elsewhere on the page (the title).
      clearBlocks: () => {
        const range = selectedBlocks(editor.state.selection);
        if (range) editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(range.from), 1)));
      },
      insertQuote: ({ text, id, href, label }) => {
        const { doc, selection } = editor.state;
        const quote = editor.schema.nodeFromJSON({
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: `${text} ` }, { type: "cite", attrs: { id, href, label } }] }],
        });
        const { $head } = selection;
        const [from, to] = !touched.current
          ? [doc.content.size - (doc.lastChild?.nodeSize ?? 0), doc.content.size]
          : $head.depth
            ? [$head.before(1), $head.after(1)]
            : [selection.from, selection.to];
        const range = isEmptyLine(doc.nodeAt(from)) ? { from, to } : to;
        const start = typeof range === "number" ? range : from;
        // Its own undo step, closed on both sides, so an undo never takes it with other edits.
        editor
          .chain()
          .command(({ tr }) => !!closeHistory(tr))
          .insertContentAt(range, [quote.toJSON(), { type: "paragraph" }])
          .setTextSelection(start + quote.nodeSize + 1)
          .scrollIntoView()
          .run();
        editor.view.dispatch(closeHistory(editor.state.tr));
        touched.current = true;
      },
      reveal: (id) => {
        // The cursor goes to the end of the anchor too, so typing continues there.
        const { doc } = editor.state;
        let at = [...anchors(doc, "note"), ...anchors(doc, "cited")].find((a) => a.id === id)?.to;
        doc.descendants((node, pos) => {
          if (node.type.name === "cite" && node.attrs.id === id) at = pos + 1;
        });
        if (at !== undefined) editor.chain().setTextSelection(at).focus(undefined, { scrollIntoView: false }).run();
        const sel = ["note", "cited", "cite"].map((k) => `[data-${k}="${CSS.escape(id)}"]`).join(", ");
        const els = [...editor.view.dom.querySelectorAll<HTMLElement>(sel)];
        els[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
        // An animation, not a class: changing the text's DOM would make the editor re-read it.
        const tint = "color-mix(in srgb, var(--info) 24%, transparent)";
        for (const el of els) el.animate([{ backgroundColor: tint }, { backgroundColor: tint, offset: 0.6 }, { backgroundColor: "transparent" }], 1400);
      },
    }),
    [editor],
  );

  const quote = quoteTo && {
    label: "Add to essay",
    run: () => {
      const [from, to] = trimmed(editor.state.doc, editor.state.selection.from, editor.state.selection.to);
      const id = newId();
      editor.chain().setTextSelection({ from, to }).setMark("cited", { id, essay: quoteTo.essay }).setTextSelection(to).run();
      quoteTo.add(editor.state.doc.textBetween(from, to, " ").trim(), id);
    },
  };
  const hasNotes = useEditorState({ editor, selector: ({ editor }) => anchors(editor.state.doc, "note").length > 0 });

  return (
    <div className={writing?.focus ? "ll-editor-root ll-typewriter" : "ll-editor-root"} data-notes={(notes && hasNotes) || undefined} data-style={style}>
      {unreadable && (
        <Alert className="mb-3" variant="warning">
          <TriangleAlert />
          <AlertTitle>This page has blocks this version can't show</AlertTitle>
          <AlertDescription>It opens read-only, so nothing in it is lost.</AlertDescription>
        </Alert>
      )}
      {/* Before the text, so Tab from the title reaches it (the text keeps Tab for itself). */}
      {!readOnly && <TableOfContents editor={editor} />}
      <EditorContent editor={editor} />
      {notes && <Sidenotes assets={assets} editor={editor} focusId={newNote} notes={notes} openLink={(href) => openRef.current(href)} />}
      <BlockHandle editor={editor} />
      <SelectionToolbar editor={editor} note={Boolean(notes)} onAsk={onAsk ? () => onAsk(selected(editor)) : undefined} quote={quote} />
      <TableToolbar editor={editor} />
      <MarkTip editor={editor} />
      <EmojiPicker editor={editor} />
    </div>
  );
}
