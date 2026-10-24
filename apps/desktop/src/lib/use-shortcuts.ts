import { useEffect } from "react";
import { toggleShortcuts } from "@/components/shortcuts-sheet";
import { SHORTCUTS } from "@/lib/shortcuts";
import { zoom } from "@/lib/zoom";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings } from "@/views/settings/open";
import { openAsk } from "~/lib/ask";
import { isNative } from "~/lib/platform";
import { flushAll } from "~/lib/saving";
import { toggleTool } from "~/lib/writing";

// Punctuation keys as the table's accelerators name them.
const CODES: Record<string, string | undefined> = { Slash: "/", Backslash: "\\", Comma: ",", Period: ".", Equal: "=", Minus: "-" };

// The keys in lib/shortcuts.json, by id. In the Mac app the menu bar takes
// each key first and says which one (menu.rs emits berth://menu); in a
// browser the page reads the keys itself. The sidebar's ⌘\ is the sidebar's
// own in a browser (packages/ui sidebar.tsx), so only the menu's event
// toggles it here. ⌃⌥I is the Mac app's global shortcut (capture.rs), which takes the key
// before the menu sees it; the menu item and a browser's key come through here.
export function useShortcuts(actions: { newPage(): void; newIdea(): void; toggleSidebar(): void }) {
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
    const byAccel = new Map(SHORTCUTS.filter((s) => s.accel && s.id !== "sidebar").map((s) => [s.accel as string, s.id]));
    const onKey = (e: KeyboardEvent) => {
      // The editor's own keys (⌘B, ⌘/ for the block menu) are handled before this.
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      // By physical key, so Option and Shift (which change e.key) still match the table.
      const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : CODES[e.code];
      if (!key) return;
      const rest = `${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${key}`;
      // Control alone matches a Ctrl accelerator first; otherwise it stands in for Cmd.
      const id = (e.ctrlKey && !e.metaKey && byAccel.get(`Ctrl+${rest}`)) || byAccel.get(`CmdOrCtrl+${rest}`);
      if (!id) return;
      e.preventDefault();
      run(id);
    };
    window.addEventListener("keydown", onKey);
    let unlisten: (() => void) | undefined;
    let gone = false;
    void isNative.then(async (native) => {
      if (!native || gone) return;
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
