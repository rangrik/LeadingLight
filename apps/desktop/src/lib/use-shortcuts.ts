import { useEffect } from "react";
import { toggleShortcuts } from "@/components/shortcuts-sheet";
import { SHORTCUTS } from "@/lib/shortcuts";
import { zoom } from "@/lib/zoom";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings } from "@/views/settings/open";
import { POPUP } from "~/components/capture-box";
import { openAsk } from "~/lib/ask";
import { accelOf, sendKeys } from "~/lib/keymap";
import { isNative } from "~/lib/platform";
import { flushAll } from "~/lib/saving";
import { nodFront } from "~/lib/tail";
import { toggleTool } from "~/lib/writing";

// A dialog (the capture box among them) or a menu open over the page; a toast, also a dialog, is not.
const COVERS = `[role=dialog]:not([data-closed], [data-slot^=toast] *), [role=alertdialog]:not([data-closed]), ${POPUP}`;

// The keys in lib/shortcuts.json, by id, as changed in Settings (lib/keymap.ts). In the Mac app
// the menu bar takes each key first and says which one (menu.rs emits berth://menu); in a
// browser the page reads the keys itself. ⌃⌥I is the Mac app's global shortcut (capture.rs),
// which takes the key before the menu sees it; the menu item and a browser's key come through here.
export function useShortcuts(actions: { newPage(): void; newIdea(): void; toggleSidebar(): void; toggleView(view: "feed" | "captures" | "suggestions"): void }) {
  useEffect(() => {
    const run = (id: string) => {
      switch (id) {
        case "new-page":
          // A new page is made to be written in: Settings goes first.
          if (useStore.getState().view.kind === "settings") closeSettings();
          return actions.newPage();
        case "new-idea":
          return actions.newIdea();
        case "save":
          return void flushAll();
        case "sidebar":
          return actions.toggleSidebar();
        case "zoom-in":
          return zoom(1, "ui");
        case "zoom-out":
          return zoom(-1, "ui");
        case "zoom-reset":
          return zoom(0, "ui");
        case "settings":
          return openSettings();
        case "ask":
          return openAsk();
        case "feed":
        case "captures":
        case "suggestions":
          return actions.toggleView(id);
        case "nod":
          // Only at a page in front: never under Settings, a dialog or a menu, or another window.
          if (useStore.getState().view.kind === "settings" || !document.hasFocus() || document.querySelector(COVERS)) return;
          return nodFront();
        case "shortcuts":
          return toggleShortcuts();
        case "focus":
        case "syntax":
        case "style":
        case "grammar":
        case "count":
          return toggleTool(id);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // The editor's own keys (⌘B, ⌘/ for the block menu) are handled before this. A held key
      // runs once: its repeats would make page after page, or run keys just recorded in Settings.
      // ProseMirror prevents every Enter, though it does nothing with ⌃↩ (tail's nod).
      const editorEnter = e.key === "Enter" && (e.target as Element | null)?.closest?.(".ProseMirror");
      const accel = (e.defaultPrevented && !editorEnter) || e.repeat ? undefined : accelOf(e);
      if (!accel) return;
      // Control alone matches a Ctrl accelerator first; otherwise it stands in for Cmd.
      const find = (a: string) => SHORTCUTS.find((s) => s.accel === a)?.id;
      const id = find(accel) ?? (e.ctrlKey && !e.metaKey ? find(accel.replace("Ctrl", "CmdOrCtrl")) : undefined);
      if (!id) return;
      e.preventDefault();
      run(id);
    };
    window.addEventListener("keydown", onKey);
    let unlisten: (() => void) | undefined;
    let gone = false;
    void isNative.then(async (native) => {
      if (!native || gone) return;
      sendKeys();
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("berth://menu", (e) => run(e.payload));
      if (gone) unlisten();
    });
    return () => {
      gone = true;
      window.removeEventListener("keydown", onKey);
      unlisten?.();
    };
  }, [actions]);
}
