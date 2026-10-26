import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Transform } from "@tiptap/pm/transform";
import type { EditorDoc } from "./editor";

export type PageSelection = {
  text: string;
  content: EditorDoc;
  isCurrent: () => boolean;
  replaceWithLink: (id: string) => boolean;
  restoreFocus: () => void;
};

function withoutAnnotations(node: EditorDoc): EditorDoc {
  return {
    ...node,
    ...(node.marks && { marks: node.marks.filter((mark) => mark.type !== "note" && mark.type !== "cited") }),
    ...(node.content && { content: node.content.map(withoutAnnotations) }),
  };
}

export function capturePageSelection(editor: Editor): PageSelection | null {
  if (editor.isDestroyed || !editor.isEditable) return null;
  const { doc, selection, schema } = editor.state;
  const text = doc.textBetween(selection.from, selection.to, "\n", "\n");
  if (selection.empty || !text.trim()) return null;
  const empty = schema.topNodeType.createAndFill();
  if (!empty) return null;
  const slice = selection.content();
  let copied = schema.topNodeType.create(null, slice.content);
  try {
    copied.check();
  } catch {
    // Fill incomplete containers, such as a toggle with only its summary selected.
    copied = new Transform(empty).replace(0, empty.content.size, slice).doc;
  }
  const content = withoutAnnotations(copied.toJSON());
  const isCurrent = () => !editor.isDestroyed && editor.isEditable && editor.state.doc === doc;
  return {
    text,
    content,
    isCurrent,
    restoreFocus: () => {
      if (editor.isDestroyed) return;
      if (editor.state.doc === doc) editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
    },
    replaceWithLink: (id) => {
      if (!id || !isCurrent()) return false;
      const mention = schema.nodes.mention.create({ id, tag: false });
      const tr = closeHistory(editor.state.tr.setSelection(selection)).replaceSelectionWith(mention, false).scrollIntoView();
      if (!tr.docChanged) return false;
      editor.view.dispatch(tr);
      if (editor.state.doc === doc) return false;
      // Conversion stays separate from typing both before and after it.
      editor.view.dispatch(closeHistory(editor.state.tr));
      return true;
    },
  };
}
