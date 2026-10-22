import { useEffect } from "react";
import { toggleShortcuts } from "@/components/shortcuts-sheet";
import { SHORTCUTS } from "@/lib/shortcuts";
import { zoom } from "@/lib/zoom";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings } from "@/views/settings/open";
import { isNative } from "~/lib/platform";
import { flushAll } from "~/lib/saving";

// The keys in lib/shortcuts.json, by id. In the Mac app the menu bar takes
// each key first and says which one (menu.rs emits berth://menu); in a
// browser the page reads the keys itself. The sidebar's ⌘\ is the sidebar's
// own in a browser (packages/ui sidebar.tsx), so only the menu's event
// toggles it here.
export function useShortcuts(actions: { newPage(): void; toggleSidebar(): void }) {
  useEffect(() => {
    const run = (id: string) => {
      switch (id) {
        case "new-page":
          // A new page is made to be written in: Settings goes first.
          if (useStore.getState().view.kind === "settings") closeSettings();
          return actions.newPage();
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
        case "shortcuts":
          return toggleShortcuts();
      }
    };
    const byAccel = new Map(SHORTCUTS.filter((s) => s.accel && s.id !== "sidebar").map((s) => [s.accel as string, s.id]));
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.length > 1) return;
      // ⌘+ arrives as "=" or, with Shift held on some layouts, "+".
      const key = e.key === "+" ? "=" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const id = byAccel.get(`CmdOrCtrl+${e.shiftKey && key !== "=" ? "Shift+" : ""}${key}`);
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
