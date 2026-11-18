import { watchAccountReturns } from '~/lib/account-return';
import { CALENDAR_VIEW, MAIL_VIEW } from '~/lib/space';
import { CloudSettings } from "~/components/cloud-settings";
import { BrowserAddressBanner } from '~/components/browser-migration';
import { FileText, Plus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { ToastProvider as ShipyardToasts } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ZoomHud } from "@/components/zoom-hud";
import { useBerthConnection } from "@/hooks/use-berth-connection";
import { useApplyTheme } from "@/hooks/use-theme";
import { watchStillness } from "@/lib/still";
import { useStore } from "@/lib/store";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
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
import { AskBar } from "~/components/ask-bar";
import { BarPanel, BarStrip, toggleView } from "~/components/bar";
import { CaptureBox, type CaptureHost, POPUP } from "~/components/capture-box";
import { AppUpdates } from "~/components/app-update";
import { CliUpdates } from "~/components/cli-updates";
import { DeletePageDialog } from "~/components/delete-page-dialog";
import { makeLinkHost } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { CARD, PaneArea } from "~/components/pane-area";
import { armDrag } from "~/components/pane-drag";
import { PanelHeader } from "~/components/panel-header";
import { PhoneShell } from "~/components/phone-shell";
import { MailRoot } from "~/components/mail";
import { useRemoteWork } from "~/lib/mobile-agents";
import { MobileAgentsHost } from "~/components/mobile-agents";
import { AppSidebar } from "~/components/sidebar/app-sidebar";
import { BrowserSidebar } from "~/components/browser-sidebar";
import { BrowserCommand } from "~/components/browser-command";
import { available as browserAvailable, leave as leaveBrowser, useFront } from "~/lib/browser-space";
import { clampWidth, SidebarEdge } from "~/components/sidebar/sidebar-edge";
import { hostCapture, openIdea, saveCapture, saveVoice, saveWebpage } from "~/lib/capture";
import { dayPage, dayShown, ensureDaily, today } from "~/lib/daily";
import { setPages as setAskPages } from "~/lib/ask";
import { openEssay } from "~/lib/essay";
import { pageLabel } from "~/lib/labels";
import { parentOf, roleOf } from "~/lib/linked";
import { copyPageLink } from "~/lib/links";
import { editPage } from "~/lib/live";
import type { ObjectSummary } from "~/lib/objects";
import { focusedPage, leaves, PERSONAL_BROWSER, openBeside, openFrom, openPage, panes, restorePanes, showOnly } from "~/lib/panes";
import { isDesktop, phone, useMobile } from "~/lib/platform";
import { watchViewport } from "~/lib/viewport";
import { serveAgents } from "~/lib/project-runtime/bridge";
import { folders, loadFolders } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { flushAll } from "~/lib/saving";
import { AGENT, taskOfAgent } from "~/lib/work";
import { createPage, foldDescriptions, iconFor, listed, loadSpace, removePage, space, typeOf } from "~/lib/space";
import { createNote, workspaceSearch } from "~/lib/workspace-search";
import { WorkspaceSearch } from "~/components/workspace-search";
import { useCodeColors } from "~/lib/use-code-colors";
import { useShortcuts } from "~/lib/use-shortcuts";
import { readCapture, startTail, tookCapture } from "~/lib/tail";
import { ABOUT } from "~/lib/tail-memory";
import { ASK_VIEW, BROWSER_VIEW, CHAT_VIEW, FEED_VIEW, SUGGESTIONS_VIEW, isPageView } from "~/lib/space";

const SIDEBAR_KEY = "ll.sidebar.open";
const WIDTH_KEY = "ll.sidebar.width";
// Tasks given to an agent, their own or a subtask's, are listed like any page, with their state.
// Found from the agents' pages in two passes; a search per task was 40 ms on 3000 pages.
function atWork(pages: ObjectSummary[]) {
  const given = new Set(pages.flatMap((p) => (p.typeId === AGENT && !(p.properties["agent-parent"] as unknown[] | undefined)?.length ? [taskOfAgent(p)] : [])));
  return new Set([...given, ...pages.flatMap((p) => (given.has(p.id) ? [(p.properties["subtask-of"] as string[] | undefined)?.[0]] : []))]);
}

// Settings loads on first use: most of the vendored Shipyard tree sits behind its sections.
const SettingsView = lazy(() => import("~/components/settings/settings-view").then((m) => ({ default: m.SettingsView })));

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
  const mobile = useMobile();
  const remoteWork = useRemoteWork();
  useEffect(() => mobile ? watchViewport() : undefined, [mobile]);
  const [gmailReturn] = useState(() => new URL(location.href).searchParams.has('gmail'));
  const [calendarReturn] = useState(() => new URL(location.href).searchParams.has('calendar'));
  const view = useStore((s) => s.view);
  const settings = view.kind === "settings";
  const searching = workspaceSearch.use();
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
      if (t && !t.closest(".ll-settings, [data-slot=sidebar], [data-bar], [role=dialog]")) captureFrom.current = t;
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

  const { pages } = space.use();
  const { root } = panes.use();
  const current = focusedPage();
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "false");
  const [native, setNative] = useState(false);
  const mac = native || new URLSearchParams(location.search).has("mac");
  const [sidebarWidth, setSidebarWidth] = useState(() => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 256));
  const [resizing, setResizing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ObjectSummary | null>(null);
  const projectsOn = projectPrefs.use().enabled && !mobile;
  // Switching sidebar content leaves the open panes alone.
  const browserFront = useFront() && !mobile;
  const canBrowse = browserAvailable.use();

  useEffect(() => void isDesktop.then(setNative), []);
  // A linked folder's agents read and publish here, whichever page is open (lib/project-runtime/bridge.ts).
  const linkedFolders = folders.use().size > 0;
  useEffect(() => void (projectsOn && loadFolders().catch(console.error)), [projectsOn]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => void (loaded && projectsOn && linkedFolders && serveAgents()), [loaded, projectsOn, linkedFolders]);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen)), [sidebarOpen]);
  // Toasts stay over the sidebar while the browser is in front: a native page would cut them (styles.css).
  useEffect(() => {
    document.documentElement.toggleAttribute("data-toasts-beside", !!root && leaves(root).some((l) => l.page === PERSONAL_BROWSER) && sidebarOpen);
    document.documentElement.style.setProperty("--toast-room", `${sidebarWidth}px`);
  }, [root, sidebarOpen, sidebarWidth]);
  useEffect(() => void (resizing || localStorage.setItem(WIDTH_KEY, String(sidebarWidth))), [resizing, sidebarWidth]);
  // The composer's @mentions of other pages read the same list as the sidebar.
  useEffect(() => setAskPages(pages.filter(listed).map((p) => ({ id: p.id, title: p.title }))), [pages]);

  useEffect(() => {
    const opening = panes.get().root;
    loadSpace()
      .then(async (list) => {
        await foldDescriptions().catch(console.error);
        const mac = await isDesktop;
        setLoaded(true);
        void startTail();
        // Browser tabs restore on demand; a browser belonging to a deleted page does not.
        const exists = (id: string) => {
          if (mobile && ([ASK_VIEW, FEED_VIEW, SUGGESTIONS_VIEW].includes(id) || id.startsWith(BROWSER_VIEW) || id.startsWith(CHAT_VIEW))) return false;
          if (id === PERSONAL_BROWSER) return !mobile && (mac || browserAvailable.get());
          const page = id.startsWith(BROWSER_VIEW) ? id.slice(BROWSER_VIEW.length).split("/")[0] : isPageView(id) ? id : "";
          // In the Mac app a streamed pane is only an agent's tab beside its chat; personal browsing is the browser space.
          if (mac && id.startsWith(BROWSER_VIEW) && !page && !id.split("/")[2]) return false;
          return !page || list.some((p) => p.id === page);
        };
        // Restoring the workspace must not undo a page the person already opened.
        if (panes.get().root !== opening) return;
        if (gmailReturn) { openPage(MAIL_VIEW); return; }
        if (calendarReturn) { openPage(CALENDAR_VIEW); return; }
        const work = atWork(list);
        if (!restorePanes(exists)) showOnly(list.filter((p) => listed(p) && (p.typeId !== "task" || work.has(p.id)) && !typeOf(p.typeId).made && !parentOf(p)).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null);
      })
      .catch(console.error);
  }, []);

  useEffect(() => loaded ? watchAccountReturns((integration) => { useStore.getState().setView({ kind: 'workspace' }); leaveBrowser(); openPage(integration === 'gmail' ? MAIL_VIEW : CALENDAR_VIEW); }) : undefined, [loaded]);

  const creating = useRef(false);
  const create = useCallback(() => {
    if (!loaded || creating.current) return;
    creating.current = true;
    void createNote().catch(() => toastManager.add({ type: "error", title: "Could not create a page. Try again." }))
      .finally(() => { creating.current = false; });
  }, [loaded]);

  // The capture box (features/capture.feature): in the app a panel of its own (capture.rs),
  // whose drafts are saved here; in a browser the same box inside the window, which gives the
  // keyboard back to where it was when it closes.
  const [capture, setCapture] = useState(false);
  const closeCapture = useCallback(() => {
    setCapture(false);
    if (!phone && captureFrom.current?.isConnected) captureFrom.current.focus();
  }, []);
  const toggleCapture = useCallback(() => {
    void isDesktop.then(async (native) => {
      if (native) return (await import("@tauri-apps/api/core")).invoke("capture_show");
      if (capture && phone) window.dispatchEvent(new Event("leadinglight:close-capture"));
      else if (capture) closeCapture();
      else setCapture(true);
    });
  }, [capture, closeCapture]);
  const captureHost = useMemo<CaptureHost>(
    () => ({
      save: saveCapture,
      saveVoice,
      saveWeb: saveWebpage,
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
  // A click anywhere else closes the box, as the panel does; the editor's menus count as inside,
  // and the bar's button that opened it closes it itself.
  useEffect(() => {
    if (!capture || phone) return;
    const onDown = (e: PointerEvent) => !(e.target as Element | null)?.closest(`[role=dialog], ${POPUP}, [data-quick-capture]`) && closeCapture();
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [capture, closeCapture]);

  // One sidebar state for the pages and Settings, so folding it in one holds in the other.
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  useShortcuts(useMemo(() => ({ newPage: create, newIdea: toggleCapture, toggleSidebar, toggleView }), [create, toggleCapture, toggleSidebar]));

  // Save pending edits whenever the app might be about to go away.
  useEffect(() => {
    const save = () => void flushAll();
    const onHidden = () => document.visibilityState === "hidden" && save();
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    let unlisten: (() => void) | undefined;
    void isDesktop.then(async (native) => {
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
  const navPages = pages
    .filter((p) => isPinned(p) && p.typeId !== ABOUT && !p.properties.templateOf)
    .sort((a, b) => pageLabel(a.title).localeCompare(pageLabel(b.title)))
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
        onBeside: () => openBeside(p.id),
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
  // Layout from shadcn's sidebar-08 page.tsx. Changes: the inset is a bare stage and each open
  // page is a card in it with its own header (see PaneArea); the header is 36 px in the app (see
  // chrome) and a window drag area with room for the traffic lights.
  // Under Settings it stays mounted, so the page's edits are kept, and goes inert; the
  // sidebar's own ⌘\ is then the Settings shell's to handle.
  const shell = (
      <SidebarProvider
        // Nothing slides while the sidebar's edge is dragged, so the sidebar keeps up with the pointer.
        className="ll-shell isolate h-svh min-h-0 overflow-hidden data-resizing:**:transition-none"
        data-resizing={resizing || undefined}
        inert={settings || !!searching}
        onOpenChange={(open) => !settings && setSidebarOpen(open)}
        open={sidebarOpen}
        style={chrome(mac, sidebarWidth)}
      >
        {phone ? <PhoneShell returnFocus={captureFrom} loaded={loaded} onCapture={toggleCapture} onCreate={create} /> : <>
        {/* The hidden sidebar's button leaves room for the traffic lights. */}
        {mac && !sidebarOpen && <SidebarTrigger className="fixed top-2.5 left-[86px] z-20 hidden md:flex" />}
        {!mobile && <SidebarEdge onResize={setSidebarWidth} onResizing={setResizing} width={sidebarWidth} />}
        <AppSidebar
          browser={browserFront ? <BrowserSidebar /> : undefined}
          native={canBrowse}
          loading={!loaded}
          onCreate={create}
          onToday={(e) => void dayPage(today()).then((id) => opener(id)(e))}
          pinned={navPages.filter((p) => p.pinned)}
          todayActive={current !== undefined && current === dayShown(today())}
        />
        <SidebarInset className="ll-inset relative h-svh overflow-hidden bg-transparent md:h-[calc(100svh_-_1rem)] md:peer-data-[variant=inset]:shadow-none">
          {loaded && <BrowserAddressBanner />}
          {/* The bar's panel is a card beside the pages, never over them. */}
          <div className="flex min-h-0 flex-1">
            {root ? (
              <PaneArea windowToggle={mac} />
            ) : (
              <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", CARD)}>
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
                    <Button disabled={!loaded} onClick={create}>
                      <Plus />
                      New page
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            )}
            <BarPanel />
          </div>
          {/* The ask bar sits by the selected words. */}
          {root && !mobile && <AskBar />}
        </SidebarInset>
        <BrowserCommand />
        {loaded && <WorkspaceSearch returnFocus={captureFrom} />}
        <BarStrip onCapture={toggleCapture} />
        </>}
        <DeletePageDialog
          onCancel={() => setPendingDelete(null)}
          onConfirm={(id) => {
            removePage(id);
            setPendingDelete(null);
          }}
          page={pendingDelete}
        />
        <CloudSettings />
      </SidebarProvider>
    );

  return (
    // Toasts sit in the bottom corner across from the bar, so they never cover it.
    <ToastProvider position="bottom-left">
      <ShipyardToasts>
        <TooltipProvider delay={300}>
          {shell}
          {remoteWork && <MobileAgentsHost />}
          {settings && (
            <div ref={settingsRef} tabIndex={-1} className="ll-settings fixed inset-0 z-40 bg-sidebar outline-hidden">
              <Suspense fallback={null}>
                <SettingsView onOpenChange={setSidebarOpen} open={sidebarOpen} style={chrome(mac, sidebarWidth)} windowToggle={mac} />
              </Suspense>
            </div>
          )}
          {/* The row only places the box; a click beside it reaches the page under it. */}
          {capture && (phone ? <Dialog open onOpenChange={(open) => { if (!open) window.dispatchEvent(new Event("leadinglight:close-capture")); }}>
            <DialogPopup aria-label="New idea" className="ll-phone-capture" finalFocus={false} showCloseButton={false}>
              <DialogTitle className="sr-only">New idea</DialogTitle>
              <CaptureBox className="h-full" embedded host={captureHost} />
            </DialogPopup>
          </Dialog> : (
            <div className="ll-capture-overlay pointer-events-none fixed inset-x-0 top-[15vh] z-50 flex justify-center px-3">
              <CaptureBox className="pointer-events-auto h-80 max-h-[70dvh] w-full max-w-[640px] shadow-2xl" host={captureHost} />
            </div>
          ))}
          <ShortcutsSheet />
          {!phone && <MailRoot />}
          {!mobile && <CliUpdates />}
          <AppUpdates />
          <ZoomHud />
        </TooltipProvider>
      </ShipyardToasts>
    </ToastProvider>
  );
}
