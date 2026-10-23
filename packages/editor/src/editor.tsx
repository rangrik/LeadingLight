import { type Editor, type FocusPosition, getSchema, type JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";
import type { AssetStore } from "./assets";
import { BlockHandle } from "./block-handle";
import { selectedBlocks } from "./block-selection";
import { EmojiPicker } from "./emoji-prefix";
import { createExtensions } from "./extensions";
import type { LinkHost } from "./page-links";
import { SelectionToolbar } from "./selection-toolbar";
import { TableToolbar } from "./table";
import { type Count, countText, OFF, onFound, type Writing, writingKey } from "./writing";

export type EditorDoc = JSONContent;

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
  selection: () => Selected;
  find: (text: string, near: number) => Selected | null;
  // The page as plain text, for an assistant's context.
  text: () => string;
  // HTML (an answer as Markdown, converted) after the top-level block holding pos. Neither
  // takes focus: the panel that inserts keeps the keyboard.
  insertAfter: (pos: number, html: string) => void;
  replaceRange: (from: number, to: number, html: string) => void;
};

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
  openLink,
  links,
  readOnly,
  onAsk,
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
  // Focus mode, Syntax highlight and Style check (writing.ts).
  writing?: Writing;
  // Given, the counts for the word count, a moment after each change.
  onStats?: (stats: Stats) => void;
  // Whether the page is being written in, which Focus mode dims the rest of the page for.
  onFocusChange?: (focused: boolean) => void;
  ref?: Ref<BlockEditorHandle>;
}) {
  // Callbacks live in refs so the editor is created once per mount.
  const onChangeRef = useRef(onChange);
  const onExitTopRef = useRef(onExitTop);
  onChangeRef.current = onChange;
  onExitTopRef.current = onExitTop;

  const extensions = useMemo(
    () =>
      createExtensions({
        assets,
        openLink: openLink ?? ((href) => void window.open(href, "_blank", "noopener")),
        links,
        onExitTop: () => {
          onExitTopRef.current?.();
          return Boolean(onExitTopRef.current);
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
      refocus: () => {
        editor.commands.focus();
        editor.view.focus();
      },
      selection: () => selected(editor),
      find: (text, near) => locate(editor, text, near),
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
    }),
    [editor],
  );

  return (
    <div className={writing?.focus ? "ll-editor-root ll-typewriter" : "ll-editor-root"}>
      {unreadable && (
        <Alert className="mb-3" variant="warning">
          <TriangleAlert />
          <AlertTitle>This page has blocks this version can't show</AlertTitle>
          <AlertDescription>It opens read-only, so nothing in it is lost.</AlertDescription>
        </Alert>
      )}
      <EditorContent editor={editor} />
      <BlockHandle editor={editor} />
      <SelectionToolbar editor={editor} onAsk={onAsk ? () => onAsk(selected(editor)) : undefined} />
      <TableToolbar editor={editor} />
      <EmojiPicker editor={editor} />
    </div>
  );
}
