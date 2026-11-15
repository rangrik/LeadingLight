import { useEffect, useRef } from "react";
import { shown } from "~/components/capture-box";
import { leaves, panes } from "~/lib/panes";
import { COVERS } from "~/lib/use-shortcuts";
import { canUndo, undoLast } from "./act";

// Mail's single keys (design 6): only in the pane that has the keyboard, while this view is in
// front and no dialog covers it. on says whether it used the key. Z undoes anywhere in Mail.
// button: a button in this pane has the keyboard, so Enter is that button's.
export function useMailKeys(pane: string, view: string, on: (e: KeyboardEvent, typing: boolean, button: boolean) => boolean | void) {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { root, focus } = panes.get();
      const front = root && leaves(root).find((l) => l.id === pane)?.page;
      // A checkbox or button may claim Enter; ⌘Enter is still Send or Make task.
      const command = e.metaKey && e.key === "Enter";
      if ((e.defaultPrevented && !command) || e.repeat || focus !== pane || front !== view || shown(COVERS)) return;
      const typing = !!(e.target as Element).closest?.("input, textarea, select, [contenteditable=true]");
      const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && e.key.toLowerCase() === "z" && canUndo()) return void (e.preventDefault(), undoLast());
      const button = !!(e.target as Element).closest?.(`[data-pane="${pane}"] :is(button, a, [role=tab])`);
      if (latest.current(e, typing, button)) e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pane, view]);
}
