import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { writingKey } from "./writing";

// Leave reading room below a typed line without moving a page being clicked or selected.
export const CaretScroll = Extension.create({
  name: "caretScroll",
  addProseMirrorPlugins() {
    let requested = false;
    let frame = 0;
    return [new Plugin({
      props: {
        handleDOMEvents: {
          beforeinput: () => { requested = true; return false; },
          paste: () => { requested = true; return false; },
          keydown: (_view, event) => {
            requested = event.key === "Enter" || (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key.length === 1 || /^(Backspace|Delete|ArrowDown|ArrowUp)$/.test(event.key)));
            return false;
          },
          mousedown: () => { requested = false; cancelAnimationFrame(frame); return false; },
        },
      },
      view: () => ({
        update(view, prev) {
          if (!requested || (view.state.doc === prev.doc && view.state.selection.eq(prev.selection))) return;
          requested = false;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (view.isDestroyed || !view.hasFocus() || !view.editable || writingKey.getState(view.state)?.writing.focus) return;
            if (!(view.state.selection instanceof TextSelection) || !view.state.selection.empty) return;
            const box = view.dom.closest<HTMLElement>("[data-page-scroller]");
            if (!box) return;
            const caret = view.coordsAtPos(view.state.selection.head);
            const rect = box.getBoundingClientRect();
            const bottom = Math.min(rect.bottom, window.innerHeight);
            const gap = Math.min(120, rect.height / 4);
            if (caret.bottom > bottom - gap) box.scrollTop += caret.bottom - (bottom - gap);
          });
        },
        destroy: () => cancelAnimationFrame(frame),
      }),
    })];
  },
});
