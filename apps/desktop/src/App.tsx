import { FileText, Plus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { ToastProvider as ShipyardToasts } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ZoomHud } from "@/components/zoom-hud";
import { useBerthConnection } from "@/hooks/use-berth-connection";
import { useApplyTheme } from "@/hooks/use-theme";
import { watchStillness } from "@/lib/still";
import { useStore } from "@/lib/store";
import { Button } from "@leadinglight/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@leadinglight/ui/components/empty";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@leadinglight/ui/components/sidebar";
import { ToastProvider, toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { AgentPanel } from "~/components/agent-panel";
import { AskBar } from "~/components/ask-bar";
import { CaptureBox, type CaptureHost, POPUP } from "~/components/capture-box";
import { CliUpdates } from "~/components/cli-updates";
import { DeletePageDialog } from "~/components/delete-page-dialog";
import { makeLinkHost } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { CARD, PaneArea, widthNeeded } from "~/components/pane-area";
import { armDrag } from "~/components/pane-drag";
import { PanelHeader } from "~/components/panel-header";
import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { byRecent, recentOrder } from "~/components/sidebar/nav-projects";
import { clampWidth, SidebarEdge } from "~/components/sidebar/sidebar-edge";
import { hostCapture, openIdea, saveCapture } from "~/lib/capture";
import { dayPage, dayShown, ensureDaily, today } from "~/lib/daily";
import { setPages as setAskPages } from "~/lib/ask";
import { openEssay } from "~/lib/essay";
import { pageLabel } from "~/lib/labels";
import { parentOf, roleOf } from "~/lib/linked";
import { copyPageLink } from "~/lib/links";
import { editPage } from "~/lib/live";
import type { ObjectSummary } from "~/lib/objects";
import { closePane, focusedPage, leaves, openBeside, openFrom, openPage, panes, restorePanes, showOnly } from "~/lib/panes";
import { feedPrefs, wantFocus } from "~/lib/feed";
import { FEED_W, FeedLane } from "~/components/feed";
import { isNative } from "~/lib/platform";
import { serveAgents } from "~/lib/project-runtime/bridge";
import { folders, loadFolders } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { flushAll } from "~/lib/saving";
import { createPage, FEED_VIEW, INBOX_VIEW, foldDescriptions, iconFor, listed, loadSpace, removePage, space, typeOf, typeView } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { newPage } from "~/lib/templates";
import { useAiPrefs } from "~/lib/ai-prefs";
import { useCodeColors } from "~/lib/use-code-colors";
import { useShortcuts } from "~/lib/use-shortcuts";
import { readCapture, startTail, tookCapture } from "~/lib/tail";
import { ABOUT } from "~/lib/tail-memory";
import { BROWSER_VIEW, isPageView } from "~/lib/space";

const SIDEBAR_KEY = "ll.sidebar.open";
const WIDTH_KEY = "ll.sidebar.width";

// Settings loads on first use: most of the vendored Shipyard tree sits behind its sections.
const SettingsView = lazy(() => import("~/components/settings/settings-view").then((m) => ({ default: m.SettingsView })));
const SaveWebpage = lazy(() => import("~/components/save-webpage").then((m) => ({ default: m.SaveWebpage })));

// Room for the macOS traffic lights, which tauri.conf.json centres on the panel header's
// middle line (y 26; they span x 18-78). Measured from AppKit's frames: centre = position.y - 2.
// The app's header is 36 px, level with the lights; a browser keeps sidebar-08's 64 px, level
// with the sidebar's logo row. "?mac" lays a browser out as the app, for checking.
const chrome = (native: boolean, sidebarWidth: number) =>
  ({
    "--traffic-top": native ? "24px" : "0px",
    "--traffic-left": native ? "72px" : "0px",
    "--header-height": native ? "36px" : "64px",
    "--sidebar-width": `${sidebarWidth}px`,
  }) as React.CSSProperties;

export default function App() {
  // Shipyard's pieces (vendor/shipyard/README.md): the theme, its agent data
  // (on mock fixtures for now), and animations that hold still in the background.
  useApplyTheme();
  useCodeColors();
  useBerthConnection();
  useEffect(watchStillness, []);
  const view = useStore((s) => s.view);
  const { corner, pinned } = useAiPrefs();
  const settings = view.kind === "settings";
  // Settings is Shipyard's page, laid over the shell; it takes the keyboard, and
  // gives it back to where it was (the last place focused in the shell).
  const settingsRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  // The capture box gives the keyboard back to the page, not to the sidebar row that opened it.
  const captureFrom = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && !t.closest(".ll-settings")) lastFocus.current = t;
      if (t && !t.closest(".ll-settings, [data-slot=sidebar], [role=dialog]")) captureFrom.current = t;
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
  useEffect(() => {
    if (settings) settingsRef.current?.focus();
    else if (lastFocus.current?.isConnected) lastFocus.current.focus();
  }, [settings]);
  // Its code is fetched once the app has settled, so the first ⌘, paints at once.
  useEffect(() => {
    const t = window.setTimeout(() => void import("~/components/settings/settings-view"), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const { pages, types } = space.use();
  const { root } = panes.use();
  const current = focusedPage();
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "false");
  const [native, setNative] = useState(false);
  const mac = native || new URLSearchParams(location.search).has("mac");
  const [sidebarWidth, setSidebarWidth] = useState(() => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 256));
  const [resizing, setResizing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ObjectSummary | null>(null);
  // Pinned, the panel takes what the pages beside it don't need (pane-area.tsx), up to half the
  // row they share; with less than its 280 px left it floats until there is room again.
  const row = useRef<HTMLDivElement>(null);
  const [rowW, setRowW] = useState(0);
  // Measured once the sidebar has slid, so the panel isn't placed for a width on the way.
  const sliding = useRef(false);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    setRowW(el.clientWidth);
    const observer = new ResizeObserver(() => !sliding.current && setRowW(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!root]);
  useEffect(() => {
    sliding.current = true;
    const t = window.setTimeout(() => {
      sliding.current = false;
      if (row.current) setRowW(row.current.clientWidth);
    }, 220);
    return () => window.clearTimeout(t);
  }, [sidebarOpen]);
  const { enabled: projectsOn } = projectPrefs.use();
  // The Feed's lane (features/feed.feature) while there is room for it beside a page; in a narrower
  // window the Feed is a pane, as any page is.
  const feed = feedPrefs.use();
  const lane = projectsOn && feed.open && rowW >= FEED_W + 8 + 480;
  const paneW = rowW - (lane ? FEED_W + 8 : 0);
  const fit = root && rowW ? Math.min(paneW / 2, paneW - 8 - widthNeeded(root)) : Infinity;
  const toggleFeed = useCallback(() => {
    if (!projectPrefs.get().enabled) return;
    const narrow = (row.current?.clientWidth ?? 0) < FEED_W + 8 + 480;
    const open = panes.get().root && leaves(panes.get().root!).find((l) => l.page === FEED_VIEW);
    wantFocus.now = !feedPrefs.get().open;
    if (!narrow) return feedPrefs.set({ open: !feedPrefs.get().open });
    if (open) closePane(open.id);
    else openBeside(FEED_VIEW);
  }, []);
  const dock = pinned && fit >= 280 ? pinned : null;

  useEffect(() => void isNative.then(setNative), []);
  // A linked folder's agents read and publish here, whichever page is open (lib/project-runtime/bridge.ts).
  const linkedFolders = folders.use().size > 0;
  useEffect(() => void (projectsOn && loadFolders().catch(console.error)), [projectsOn]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => void (loaded && projectsOn && linkedFolders && serveAgents()), [loaded, projectsOn, linkedFolders]);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen)), [sidebarOpen]);
  useEffect(() => void (resizing || localStorage.setItem(WIDTH_KEY, String(sidebarWidth))), [resizing, sidebarWidth]);
  // The composer's @mentions of other pages read the same list as the sidebar.
  useEffect(() => setAskPages(pages.filter(listed).map((p) => ({ id: p.id, title: p.title }))), [pages]);

  useEffect(() => {
    loadSpace()
      .then(async (list) => {
        await foldDescriptions().catch(console.error);
        setLoaded(true);
        void startTail();
        // The panes left open last time, less pages gone since and live browsers; else the top of
        // Recent (which leaves tasks out), in the order chosen.
        const exists = (id: string) => (isPageView(id) ? list.some((p) => p.id === id) : !id.startsWith(BROWSER_VIEW));
        if (!restorePanes(exists)) showOnly(list.filter((p) => listed(p) && p.typeId !== "task" && !typeOf(p.typeId).made && !parentOf(p)).sort(byRecent)[0]?.id ?? null);
      })
      .catch(console.error);
  }, []);

  const create = useCallback(() => {
    newPage(PAGE_TYPE)
      .then((obj) => openPage(obj.id))
      .catch(console.error);
  }, []);

  // The capture box (features/capture.feature): in the app a panel of its own (capture.rs),
  // whose drafts are saved here; in a browser the same box inside the window, which gives the
  // keyboard back to where it was when it closes.
  const [capture, setCapture] = useState(false);
  const [saveWebpage, setSaveWebpage] = useState(false);
  const closeCapture = useCallback(() => {
    setCapture(false);
    if (captureFrom.current?.isConnected) captureFrom.current.focus();
  }, []);
  const toggleCapture = useCallback(() => {
    void isNative.then(async (native) => {
      if (native) return (await import("@tauri-apps/api/core")).invoke("capture_show");
      if (capture) closeCapture();
      else setCapture(true);
    });
  }, [capture, closeCapture]);
  const captureHost = useMemo<CaptureHost>(
    () => ({
      save: saveCapture,
      open: (id) => {
        setCapture(false);
        openIdea(id);
      },
      close: closeCapture,
      // Not the main host: the page in view is another page here, so "@" must offer it.
      links: makeLinkHost({ create: async (title, typeId) => (await createPage({ title, typeId })).id, day: ensureDaily }),
      guess: readCapture,
      took: tookCapture,
    }),
    [closeCapture],
  );
  useEffect(() => {
    let gone = false;
    let off: (() => void) | undefined;
    void hostCapture({ guess: readCapture, took: tookCapture }).then((f) => (gone ? f() : (off = f)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  // A click anywhere else closes the box, as the panel does; the editor's menus count as inside.
  useEffect(() => {
    if (!capture) return;
    const onDown = (e: PointerEvent) => !(e.target as Element | null)?.closest(`[role=dialog], ${POPUP}`) && closeCapture();
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [capture, closeCapture]);

  // One sidebar state for the pages and Settings, so folding it in one holds in the other.
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  useShortcuts(useMemo(() => ({ newPage: create, newIdea: toggleCapture, toggleSidebar, toggleFeed }), [create, toggleCapture, toggleSidebar, toggleFeed]));

  // Save pending edits whenever the app might be about to go away.
  useEffect(() => {
    const save = () => void flushAll();
    const onHidden = () => document.visibilityState === "hidden" && save();
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    let unlisten: (() => void) | undefined;
    void isNative.then(async (native) => {
      if (!native) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      // Tauri waits for this before closing the window (Close window, the close button and ⌘Q). A
      // throw here would leave the window unable to close, so errors are only logged.
      unlisten = await getCurrentWindow().onCloseRequested(async () => {
        await flushAll().catch(console.error);
      });
    });
    return () => {
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      unlisten?.();
    };
  }, []);

  // Adding a sidenote or opening an essay asks for room (lib/essay.ts).
  useEffect(() => {
    const fold = () => setSidebarOpen(false);
    window.addEventListener("ll:make-room", fold);
    return () => window.removeEventListener("ll:make-room", fold);
  }, []);

  // A row opens its page; Shift opens it beside the one in front, as Shift on a link does; ⌘ in a new tab.
  const opener = (id: string) => (e: React.MouseEvent) => openFrom(id, e);

  // Nothing on screen shows a copied link, so a toast says so.
  const copyLink = (id: string, name: string) => () =>
    void copyPageLink(id, name).then(
      () => toastManager.add({ type: "success", title: "Link copied", timeout: 2000 }),
      () => toastManager.add({ type: "error", title: "Couldn't copy the link" }),
    );
  const isPinned = (p: ObjectSummary) => p.properties.pinned === true;

  // A Thoughts page or an essay sits under its page in the sidebar (the crumbs: describe()).
  const isChild = (p: ObjectSummary) => pages.some((q) => q.id === parentOf(p));
  recentOrder.use(); // the list follows a change of order
  const navPages = pages
    // Tasks live in their type's view; there are too many for this list. So do agents' pages.
    .filter((p) => listed(p) && p.typeId !== "task" && !typeOf(p.typeId).made && !isChild(p))
    .sort(byRecent)
    .map((p) => {
      // Its Thoughts page and essay; its reports read in the page itself.
      const kids = pages.filter((c) => parentOf(c) === p.id && (roleOf(c) === "thoughts" || roleOf(c) === "essay")).sort((a, b) => (roleOf(a) === "thoughts" ? -1 : roleOf(b) === "thoughts" ? 1 : 0));
      const name = roleOf(p) === "essay" && !p.title.trim() ? "Essay" : pageLabel(p.title);
      return {
        id: p.id,
        name,
        title: p.title,
        icon: <RowIcon icon={iconFor(p)} />,
        isActive: p.id === current,
        onSelect: opener(p.id),
        onDrag: (e: React.PointerEvent<HTMLElement>) => armDrag(e, { page: p.id, label: pageLabel(p.title) }),
        // Both go through the page's editor when it is open, so its own next save keeps them.
        onRename: (title: string) => void editPage(p.id, { title }),
        pinned: isPinned(p),
        onPin: () => void editPage(p.id, { properties: ({ pinned: _, ...rest }) => (isPinned(p) ? rest : { ...rest, pinned: true }) }),
        onCopyLink: copyLink(p.id, name),
        onDelete: () => setPendingDelete(p),
        open: p.id === current || kids.some((c) => c.id === current),
        children: kids.map((c) => {
          const name = roleOf(c) === "thoughts" ? "Thoughts" : c.title.trim() || "Essay";
          return {
            name,
            isActive: c.id === current,
            // An essay opens beside its page.
            onSelect: (e: React.MouseEvent) => (roleOf(c) === "essay" ? void openEssay(p.id) : opener(c.id)(e)),
            onDrag: (e: React.PointerEvent<HTMLElement>) => armDrag(e, { page: c.id, label: name }),
            onCopyLink: copyLink(c.id, name),
            onDelete: () => setPendingDelete(c),
          };
        }),
      };
    });
  // The app's own types (agents, reports, feedback) are listed once there is one of them; tail's
  // page about you is reached from Settings and search, so tail never adds a row here.
  const navTypes = types.filter((t) => !t.made || (t.id !== ABOUT && pages.some((p) => p.typeId === t.id))).map((t) => ({
    id: t.id,
    name: t.plural,
    icon: <RowIcon icon={t.icon} />,
    isActive: current === typeView(t.id),
    onSelect: opener(typeView(t.id)),
    onDrag: (e: React.PointerEvent<HTMLElement>) => armDrag(e, { page: typeView(t.id), label: t.plural }),
  }));

  // Layout from shadcn's sidebar-08 page.tsx. Changes: the inset is a bare stage and each open
  // page is a card in it with its own header (see PaneArea); the header is 36 px in the app (see
  // chrome) and a window drag area with room for the traffic lights.
  // Under Settings it stays mounted, so the page's edits are kept, and goes inert; the
  // sidebar's own ⌘\ is then the Settings shell's to handle.
  const shell = (
      <SidebarProvider
        // Nothing slides while the sidebar's edge is dragged, so the sidebar keeps up with the pointer.
        className="isolate h-svh overflow-hidden data-resizing:**:transition-none"
        data-resizing={resizing || undefined}
        inert={settings || undefined}
        onOpenChange={(open) => !settings && setSidebarOpen(open)}
        open={sidebarOpen}
        style={chrome(mac, sidebarWidth)}
      >
        {/* In the app the sidebar button stays beside the traffic lights, as in the Claude app. */}
        {mac && <SidebarTrigger className="fixed top-2.5 left-[86px] z-20" />}
        <SidebarEdge onResize={setSidebarWidth} onResizing={setResizing} width={sidebarWidth} />
        <AppSidebar
          onCreate={create}
          feed={projectsOn ? { open: lane || !!(root && leaves(root).some((l) => l.page === FEED_VIEW)), toggle: toggleFeed } : undefined}
          inbox={{ open: current === INBOX_VIEW, onSelect: opener(INBOX_VIEW) }}
          onNewIdea={toggleCapture}
          onSaveWebpage={() => setSaveWebpage(true)}
          onToday={(e) => void dayPage(today()).then((id) => opener(id)(e))}
          pages={navPages.filter((p) => !p.pinned)}
          pinned={navPages.filter((p) => p.pinned)}
          todayActive={current !== undefined && current === dayShown(today())}
          types={navTypes}
        />
        <SidebarInset className="relative h-svh overflow-hidden bg-transparent md:h-[calc(100svh_-_1rem)] md:peer-data-[variant=inset]:shadow-none">
          {/* A pinned agent panel is a card beside the pages; a floating one sits over them. */}
          {root ? (
            <div className="flex min-h-0 flex-1" ref={row}>
              {lane && <FeedLane sidebarOpen={sidebarOpen} windowToggle={mac} />}
              <PaneArea dock={dock} lead={!lane} windowToggle={mac} />
              <AgentPanel dock={dock} fit={fit} windowToggle={mac} />
            </div>
          ) : (
            <div className={cn("flex min-h-0 flex-1 flex-col", CARD)}>
              <PanelHeader current={null} sidebarOpen={sidebarOpen} toggle={!mac} />
              <Empty className="min-h-0 flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>No page open</EmptyTitle>
                  <EmptyDescription>Create a page to start writing.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={create}>
                    <Plus />
                    New page
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
          {/* The ask bar sits by the selected words. */}
          {root && <AskBar />}
        </SidebarInset>
        <DeletePageDialog
          onCancel={() => setPendingDelete(null)}
          onConfirm={(id) => {
            removePage(id);
            setPendingDelete(null);
          }}
          page={pendingDelete}
        />
      </SidebarProvider>
    );

  return (
    // Toasts sit in the bottom corner across from the Ask panel, so they never cover it.
    <ToastProvider position={(dock ?? (corner.endsWith("l") ? "left" : "right")) === "left" ? "bottom-right" : "bottom-left"}>
      <ShipyardToasts>
        <TooltipProvider delay={300}>
          {shell}
          {settings && (
            <div ref={settingsRef} tabIndex={-1} className="ll-settings fixed inset-0 z-40 bg-sidebar outline-hidden">
              <Suspense fallback={null}>
                <SettingsView onOpenChange={setSidebarOpen} open={sidebarOpen} style={chrome(mac, sidebarWidth)} windowToggle={mac} />
              </Suspense>
            </div>
          )}
          {/* The row only places the box; a click beside it reaches the page under it. */}
          {capture && (
            <div className="pointer-events-none fixed inset-x-0 top-[15vh] z-50 flex justify-center">
              <CaptureBox className="pointer-events-auto h-80 w-[640px] shadow-2xl" host={captureHost} />
            </div>
          )}
          <ShortcutsSheet />
          {saveWebpage && <Suspense fallback={null}><SaveWebpage open onOpenChange={setSaveWebpage} /></Suspense>}
          <CliUpdates />
          <ZoomHud />
        </TooltipProvider>
      </ShipyardToasts>
    </ToastProvider>
  );
}
