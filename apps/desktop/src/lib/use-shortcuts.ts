import { useEffect } from "react";
import { toggleShortcuts } from "@/components/shortcuts-sheet";
import { SHORTCUTS } from "@/lib/shortcuts";
import { zoom } from "@/lib/zoom";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings } from "@/views/settings/open";
import { POPUP, shown } from "~/components/capture-box";
import { newWork, openNewWork } from "~/components/new-work";
import { searching, toggleSearch } from "~/components/search-panel";
import { openAsk } from "~/lib/ask";
import { accelOf, sendKeys } from "~/lib/keymap";
import { available, space, spaceKey } from "~/lib/browser-space";
import { liveContent, liveEditor, liveProperties } from "~/lib/live";
import { MAIL_VIEW, browserView, pageOf } from "~/lib/space";
import { NOTEBOOK_TYPE } from "~/lib/page-format";
import { openPaper, readPaper } from "~/lib/paper";
import { closeTab, focusedPage, cycleTab, newTab, openBeside, openPage, reopenTab, travel } from "~/lib/panes";
import { isDesktop, useMobile } from "~/lib/platform";
import { pick } from "~/lib/scope";
import { toggleReading } from "~/lib/reading";
import { flushAll } from "~/lib/saving";
import { nodFront } from "~/lib/tail";
import { toggleTool } from "~/lib/writing";

// A dialog (the capture box among them) or a menu open over the page; a toast, also a dialog, is not.
export const COVERS = `[role=dialog]:not([data-closed], [data-slot^=toast] *), [role=alertdialog]:not([data-closed]), ${POPUP}`;
// The keys that still act while the search panel covers the page; the rest would move things behind it.
const OVER_SEARCH = new Set(["search", "new-page", "new-idea", "save", "settings", "shortcuts", "zoom-in", "zoom-out", "zoom-reset"]);
// The New work box is for one project: nothing may change the project or open over it.
const OVER_NEW_WORK = new Set(["save", "zoom-in", "zoom-out", "zoom-reset"]);
const TABS: Record<string, (() => void) | undefined> = {
  "new-tab": () => newTab(),
  "close-tab": () => closeTab(),
  "reopen-tab": reopenTab,
  back: () => travel(-1),
  forward: () => travel(1),
  "next-tab": () => cycleTab(1),
  "previous-tab": () => cycleTab(-1),
};

// The keys in lib/shortcuts.json, by id, as changed in Settings (lib/keymap.ts). In the Mac app
// the menu bar takes each key first and says which one (menu.rs emits berth://menu); in a
// browser the page reads the keys itself. ⌃⌥I is the Mac app's global shortcut (capture.rs),
// which takes the key before the menu sees it; the menu item and a browser's key come through here.
export function useShortcuts(actions: { newPage(): void; newIdea(): void; toggleSidebar(): void; toggleView(key: "inbox" | "feed" | "captures" | "suggestions"): void }) {
  const mobile = useMobile();
  useEffect(() => {
    const run = (id: string) => {
      if (searching.get() && !OVER_SEARCH.has(id)) return;
      if (newWork.get() && !OVER_NEW_WORK.has(id)) return;
      if (useStore.getState().view.kind !== "settings") {
        // The browser space in front takes the keys that act on a tab (lib/browser-space.ts).
        if (spaceKey(id)) return;
        const browser = new CustomEvent("ll:browser-shortcut", { detail: id, cancelable: true });
        if (!window.dispatchEvent(browser)) return;
      }
      // Tabs and history act on the panes, so not while Settings covers them.
      const tabKey = TABS[id];
      if (tabKey) return useStore.getState().view.kind === "settings" ? undefined : tabKey();
      // ⌘1–9 pick on the rail (features/project-rail.feature); the Mac menu says rail-3 for ⌘3.
      if (id.startsWith("rail-")) return useStore.getState().view.kind === "settings" || mobile ? undefined : pick(Number(id.slice(5)));
      switch (id) {
        case "new-page":
          // A new page is made to be written in: Settings goes first.
          if (useStore.getState().view.kind === "settings") closeSettings();
          return actions.newPage();
        case "new-idea":
          return actions.newIdea();
        case "new-work":
          return useStore.getState().view.kind === "settings" || mobile || shown(COVERS) ? undefined : openNewWork();
        case "quick-record": {
          if (useStore.getState().view.kind === "settings" || shown(COVERS)) return;
          const id = focusedPage();
          if (id && pageOf(id)?.typeId === NOTEBOOK_TYPE && !readPaper(liveProperties(id)?.paper)) return;
          if (id && readPaper(liveProperties(id)?.paper) && !liveContent(id)?.content?.some((node) => node.type !== "paragraph" || node.content?.length)) return openPaper(id, "record");
          return id ? liveEditor(id)?.record() : undefined;
        }
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
        case "search":
          return toggleSearch();
        case "inbox":
        case "feed":
        case "captures":
        case "suggestions":
          return actions.toggleView(id);
        case "mail":
          if (useStore.getState().view.kind === "settings") closeSettings();
          return openPage(MAIL_VIEW);
        case "nod":
          // Only at a page in front: never under Settings, a dialog or a menu, or another window.
          if (useStore.getState().view.kind === "settings" || !document.hasFocus() || shown(COVERS)) return;
          return nodFront();
        case "shortcuts":
          return toggleShortcuts();
        // Where the space can't be shown (the browser build), Browser is the streamed pane.
        case "browser":
          return available.get() ? undefined : openBeside(browserView(""));
        case "focus":
        case "syntax":
        case "style":
        case "grammar":
        case "count":
          return toggleTool(id);
        case "reading":
          return useStore.getState().view.kind === "settings" ? undefined : toggleReading(focusedPage());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // The editor's own keys (⌘B, ⌘/ for the block menu) are handled before this. A held key
      // runs once: its repeats would make page after page, or run keys just recorded in Settings.
      // ProseMirror prevents every Enter, though it does nothing with ⌃↩ (tail's nod).
      const editorEnter = e.key === "Enter" && (e.target as Element | null)?.closest?.(".ProseMirror");
      const accel = (e.defaultPrevented && !editorEnter) || e.repeat ? undefined : accelOf(e);
      if (!accel) return;
      // Control alone matches a Ctrl accelerator first; otherwise it stands in for Cmd. The browser
      // space's own keys count only while it is in front, and then before others: ⌘1 is the numbered
      // "tab-1" there and the rail's "rail-1" elsewhere.
      const front = available.get() && space.get().front;
      const isBrowser = (s: (typeof SHORTCUTS)[number]) => !!(s as { browser?: boolean }).browser;
      const rows = front ? [...SHORTCUTS.filter(isBrowser), ...SHORTCUTS.filter((s) => !isBrowser(s))] : SHORTCUTS.filter((s) => !isBrowser(s));
      const find = (a: string) => {
        const n = /^(.*\+)([1-9])$/.exec(a);
        const counted = n && rows.find((s) => s.count && s.accel === `${n[1]}{n}`);
        return counted ? `${counted.id}-${n[2]}` : rows.find((s) => s.accel === a)?.id;
      };
      const id = find(accel) ?? (e.ctrlKey && !e.metaKey ? find(accel.replace("Ctrl", "CmdOrCtrl")) : undefined);
      if (!id) return;
      e.preventDefault();
      run(id);
    };
    window.addEventListener("keydown", onKey);
    let unlisten: (() => void) | undefined;
    let gone = false;
    void isDesktop.then(async (native) => {
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
  }, [actions, mobile]);
}
