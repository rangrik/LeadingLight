import { CHECKS, type Check, type Part, PARTS, type Writing } from "@leadinglight/editor/writing";
import { useRef } from "react";
import { askEditor } from "~/lib/ask";
import { localPrefs } from "~/lib/local-prefs";

// The writing tools (features/writing.feature): one setting for the whole app, kept on this Mac.
// What each tool shows is kept while it is off.
export type WritingPrefs = {
  focus: boolean;
  focusOn: "sentence" | "paragraph" | "typewriter";
  syntax: boolean;
  parts: Part[];
  style: boolean;
  checks: Check[];
  grammar: boolean;
  count: boolean;
};
export type Tool = "focus" | "syntax" | "style" | "grammar" | "count";

const prefs = localPrefs<WritingPrefs>("ll.writing", {
  focus: false,
  focusOn: "sentence",
  syntax: false,
  parts: PARTS,
  style: false,
  checks: CHECKS,
  grammar: true,
  count: true,
});

export const setWritingPrefs = prefs.set;
export const useWritingPrefs = prefs.use;
export const toggleTool = (tool: Tool) => prefs.set({ [tool]: !prefs.get()[tool] });

// What the editor is asked to show.
export const editorWriting = (p: WritingPrefs): Writing => ({
  focus: p.focus ? p.focusOn : null,
  syntax: p.syntax ? p.parts : [],
  style: p.style ? p.checks : [],
  grammar: p.grammar,
});

// A writing tool's menu or popover gives the keyboard back to the page it was opened from, so
// what it changed shows at once.
export function useBackToPage() {
  const writing = useRef(false);
  return {
    // Only to a page in the same card: a menu used on another card moves there instead.
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const editor = document.activeElement?.closest(".ll-editor");
      writing.current = Boolean(editor && e.currentTarget.closest("[data-pane-area] > section")?.contains(editor));
    },
    finalFocus: () => {
      if (!writing.current) return true;
      askEditor()?.refocus();
      return false;
    },
  };
}
