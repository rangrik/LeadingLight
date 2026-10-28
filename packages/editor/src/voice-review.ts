import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { PageSelection } from "./page-selection";

export type VoiceReview = {
  id: string;
  text: string;
  audio: string;
  select: (from: number, to: number) => PageSelection | null;
  restoreFocus: () => void;
};

export function captureVoiceReview(editor: Editor, pos: number): VoiceReview | null {
  if (editor.isDestroyed || !editor.isEditable) return null;
  const { doc, schema } = editor.state;
  const voice = doc.nodeAt(pos);
  if (voice?.type.name !== "voiceRecording" || !voice.attrs.transcript || !voice.attrs.recordingId || !voice.attrs.src) return null;
  const text = String(voice.attrs.transcript);
  const isCurrent = () => !editor.isDestroyed && editor.isEditable && editor.state.doc === doc;
  const restoreFocus = () => { if (!editor.isDestroyed) editor.view.focus(); };
  return {
    id: String(voice.attrs.recordingId), text, audio: String(voice.attrs.src), restoreFocus,
    select: (from, to) => {
      if (!isCurrent() || from < 0 || to > text.length || from >= to) return null;
      const selected = text.slice(from, to);
      if (!selected.trim()) return null;
      return {
        text: selected,
        content: { type: "doc", content: selected.split(/\n/).map((line) => ({ type: "paragraph", ...(line && { content: [{ type: "text", text: line }] }) })) },
        isCurrent, restoreFocus,
        replaceWithLink: (id) => {
          if (!id || !isCurrent()) return false;
          // The recording and transcript stay intact; only the new page's link is added.
          const link = schema.nodes.pageLink.create({ id, view: "line" });
          editor.view.dispatch(closeHistory(editor.state.tr).insert(pos + voice.nodeSize, link));
          editor.view.dispatch(closeHistory(editor.state.tr));
          return true;
        },
      };
    },
  };
}
