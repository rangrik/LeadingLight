import { type FocusPosition, getSchema, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { type Ref, useImperativeHandle, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";
import type { AssetStore } from "./assets";
import { BlockHandle } from "./block-handle";
import { EmojiPicker } from "./emoji-prefix";
import { createExtensions } from "./extensions";
import type { LinkHost } from "./page-links";
import { SelectionToolbar } from "./selection-toolbar";
import { TableToolbar } from "./table";

export type EditorDoc = JSONContent;

// The parts of a document the schema knows: unknown nodes and marks are left out.
function known(schema: Schema, node: JSONContent): JSONContent | null {
  if (!node.type || !schema.nodes[node.type]) return null;
  const content = node.content?.map((c) => known(schema, c)).filter((c) => c !== null);
  return { ...node, marks: node.marks?.filter((m) => schema.marks[m.type]), content };
}

export type BlockEditorHandle = {
  focus: (position?: FocusPosition) => void;
  // For changes made from outside the page (linking a mention, merging a tag).
  getJSON: () => EditorDoc;
  setContent: (doc: EditorDoc) => void;
};

export function BlockEditor({
  content,
  assets,
  onChange,
  onExitTop,
  openLink,
  links,
  readOnly,
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
      attributes: {
        class: "ll-editor",
        role: "textbox",
        "aria-label": "Page body",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => !unreadable && !readOnly && onChangeRef.current?.(() => editor.getJSON()),
  });

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
    }),
    [editor],
  );

  return (
    <div className="ll-editor-root">
      {unreadable && (
        <Alert className="mb-3" variant="warning">
          <TriangleAlert />
          <AlertTitle>This page has blocks this version can't show</AlertTitle>
          <AlertDescription>It opens read-only, so nothing in it is lost.</AlertDescription>
        </Alert>
      )}
      <EditorContent editor={editor} />
      <BlockHandle editor={editor} />
      <SelectionToolbar editor={editor} />
      <TableToolbar editor={editor} />
      <EmojiPicker editor={editor} />
    </div>
  );
}
