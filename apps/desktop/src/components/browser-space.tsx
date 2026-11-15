// The browser space's page area (features/browser-space.feature): one rounded card with a single
// row of controls, then the page. A native page is a view laid over the card (native_browser.rs);
// when something of the app's opens over it, WebKit's picture of the page stands in for it.
import { Bookmark, Bot, Check, ChevronLeft, ChevronRight, Ellipsis, ExternalLink, Globe, Link, Lock, PanelLeft, Pin, RotateCw, Sparkles, Square, TriangleAlert, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@leadinglight/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@leadinglight/ui/components/empty";
import { Input } from "@leadinglight/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "@leadinglight/ui/components/menu";
import { useSidebar } from "@leadinglight/ui/components/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { OVERLAYS } from "@/lib/overlays";
import { BrowserCommand, shortURL } from "~/components/browser-command";
import { SiteIcon } from "~/components/browser-sidebar";
import { BrowserSurface } from "~/components/browser-surface";
import { CARD } from "~/components/pane-area";
import { safeBrowserURL, type BrowserEntry } from "~/lib/browser-data";
import { askAboutBrowser } from "~/lib/ask";
import { useShowing } from "~/lib/bar";
import { BROWSER_ASK } from "~/lib/page-tools";
import { stopTurn } from "~/lib/turn";
import { toggleView } from "~/components/bar";
import { act, acting, bar, closeTab, dataBase, ensure, hostOf, live, openTab, pin, reopen, savedNote, select, shown, space, toggleSaved, zoom, type Shown } from "~/lib/browser-space";
import { useKeysFor } from "~/lib/keymap";
import { engine, standin, standinDone, standinMarks, standinShown, type Engine } from "~/lib/native-browser";
import { useBrowserViewportOwner } from "~/lib/browser-viewport";
import { tabRoute, useBrowserData, useBrowserState } from "~/lib/project-runtime/browser";
import { ask } from "~/lib/project-runtime/transport";

// Anything of the app's that can be drawn over the page: dialogs, menus, popovers, tooltips,
// toasts and Settings. Only what is shown and reaches the page area counts (useCovered).
const COVERS = `${OVERLAYS}, [data-slot=tooltip-popup], [data-slot=toast-viewport] > *, .ll-settings`;

function useEngine() {
  const [e, setE] = useState<Engine | null>(null);
  useEffect(() => void engine.then(setE), []);
  return e;
}

// Whether something of the app's is drawn over the page area: an element that is shown and
// overlaps it. Something elsewhere (Ask's panel, the sidebar) or left in the page unseen never
// counts, so the page is never held as a picture by what isn't over it. It uncovers a moment
// late, so moving between tooltips doesn't flicker, and looks again while covered.
function useCovered(area: React.RefObject<HTMLElement | null>) {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const over = (el: Element, a: DOMRect) => [...el.getClientRects()].some((r) => r.width > 0 && r.height > 0 && r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top);
    const check = () => {
      frame = 0;
      const a = area.current?.getBoundingClientRect();
      const now = !!a && [...document.querySelectorAll(COVERS)].some((el) => over(el, a));
      window.clearTimeout(timer);
      if (now) setCovered(true);
      else timer = window.setTimeout(() => setCovered(false), 120);
    };
    check();
    const watch = new MutationObserver(() => (frame ||= requestAnimationFrame(check)));
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-slot", "class", "style", "hidden"] });
    const again = window.setInterval(check, 500);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timer); window.clearInterval(again); };
  }, [area]);
  return covered;
}

// A toolbar button, 28 px. Its tooltip opens below it, over the page, which then freezes.
function Tool({ label, keys, children, className, ...props }: ButtonProps & { label: string; keys?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} className={cn("text-muted-foreground hover:text-foreground disabled:opacity-40", className)} size="icon-sm" variant="ghost" {...props} />}>{children}</TooltipTrigger>
      <TooltipPopup>{label}{keys && <span className="ms-2 text-muted-foreground">{keys}</span>}</TooltipPopup>
    </Tooltip>
  );
}

// The pill: where the page is, how its load goes, and a moment's "Saved". It opens the command bar.
function Pill({ view, agentURL }: { view: Shown; agentURL: string }) {
  const { tabs, selected } = space.use();
  const tab = tabs.find((t) => t.id === selected);
  const page = live.use()[selected];
  const note = savedNote.use();
  const [, tick] = useState(0);
  const saying = Date.now() - note < 2000;
  useEffect(() => {
    if (!saying) return;
    const t = window.setTimeout(() => tick((n) => n + 1), 2000 - (Date.now() - note));
    return () => window.clearTimeout(t);
  }, [note, saying]);
  const url = view.kind === "agent" ? agentURL : view.kind === "tab" ? (tab?.url ?? "") : "";
  const loading = view.kind === "tab" && !!page?.loading;
  const text = shortURL(url);
  const host = hostOf(url) && text.slice(0, text.indexOf("/") < 0 ? undefined : text.indexOf("/"));
  const path = host ? text.slice(host.length) : "";
  const failed = view.kind === "tab" && !!page?.failed;
  // As the Parts sheet has it: a lock only on a working https page, "Not secure" on plain http.
  const http = view.kind === "tab" && !failed && url.startsWith("http:") && !/^http:\/\/(localhost|127\.|\[::1\])/.test(url);
  const open = () => bar.set(view.kind === "tab" && tab ? { mode: "here", text: tab.url } : { mode: "new", text: "" });
  const working = acting.use();
  const claude = view.kind === "tab" ? working[selected] : undefined;
  if (claude)
    return (
      <div className="relative flex h-7 w-full max-w-[32.5rem] items-center gap-1.5 overflow-hidden rounded-lg bg-muted ps-2.5 pe-[3px] text-[0.8125rem]" data-testid="browser-pill">
        <Sparkles className="size-3.5 shrink-0 text-info" />
        <span className="min-w-0 flex-1 truncate">{claude.state === "waiting" ? `${claude.who} is waiting for your OK` : `${claude.who} is working in this tab`}</span>
        <Button className="h-[22px] gap-1 px-2 text-xs sm:h-[22px]" onClick={() => void stopTurn(BROWSER_ASK, claude.thread)} size="xs" variant="outline"><Square className="size-2.5 fill-current" />Stop</Button>
      </div>
    );
  let middle: ReactNode;
  if (saying && view.kind === "tab") middle = <><Check className="size-3.5 text-success" /><span>Saved</span></>;
  else if (view.kind === "saved" || view.kind === "history") middle = <><span className="text-muted-foreground">{view.kind === "saved" ? "Saved" : "History"}</span></>;
  else if (!url) middle = <span className="text-muted-foreground">Search or enter address</span>;
  else middle = (
    <>
      {view.kind === "agent" ? <Bot className="size-3.5 text-muted-foreground" /> : failed ? <Globe className="size-3.5 text-muted-foreground" /> : http ? <TriangleAlert className="size-3.5 text-warning-foreground" /> : url.startsWith("https:") && <Lock className="size-3 text-muted-foreground" />}
      {http && <span className="shrink-0 text-warning-foreground">Not secure</span>}
      <span className={cn("min-w-0 truncate", http && "text-muted-foreground")}>{host || text}<span className="text-muted-foreground">{path}</span></span>
    </>
  );
  return (
    <div className="relative h-7 w-full max-w-[32.5rem] overflow-hidden rounded-lg bg-muted" data-testid="browser-pill">
      <Button aria-label={url ? `${text}. Search or enter an address` : "Search or enter an address"} className={cn("size-full gap-1.5 rounded-[inherit] px-8 font-normal text-[0.8125rem] leading-[1.125rem] hover:bg-accent sm:h-full sm:text-[0.8125rem]", view.kind === "agent" && "justify-start ps-2.5 pe-36")} onClick={open} variant="ghost">
        {middle}
      </Button>
      {view.kind === "agent" ? (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[5px] bg-accent px-1.5 font-medium text-[0.6875rem] text-muted-foreground leading-[1.125rem]">Agent’s own browser</span>
      ) : view.kind === "tab" && tab ? (
        <Button aria-label={loading ? "Stop" : "Reload"} className="absolute top-1/2 right-[5px] -translate-y-1/2 text-muted-foreground [&_svg]:size-3.5" onClick={() => void act(loading ? "stop" : "reload")} size="icon-xs" variant="ghost">
          {loading ? <X /> : <RotateCw />}
        </Button>
      ) : null}
      {loading && <span className="absolute bottom-0 left-0 h-0.5 bg-info transition-[width] duration-200 ease-out" style={{ width: `${Math.max(8, (page?.progress ?? 0) * 100)}%` }} />}
    </div>
  );
}

function Toolbar({ mac }: { mac: boolean }) {
  const { open, toggleSidebar } = useSidebar();
  const keys = useKeysFor();
  const view = shown.use();
  const { tabs, selected, closed } = space.use();
  const tab = tabs.find((t) => t.id === selected);
  const page = live.use()[selected];
  const [data] = useBrowserData(dataBase(space.use().base));
  const agentState = useBrowserState(view.kind === "agent" ? view.base : "", view.kind === "agent" ? view.tab : "", view.kind === "agent");
  const url = view.kind === "agent" ? (agentState.state?.url ?? "") : (tab?.url ?? "");
  const onPage = view.kind === "tab" && !!tab;
  const saved = data.bookmarks.some((e) => e.url === url);
  const travel = (action: "back" | "forward") => view.kind === "agent" ? void ask("POST", tabRoute(view.base, "navigate", view.tab), { action }).catch(() => {}) : void act(action);
  const back = view.kind === "agent" ? !!agentState.state?.canGoBack : onPage && !!page?.back;
  const forward = view.kind === "agent" ? !!agentState.state?.canGoForward : onPage && !!page?.forward;
  const asking = useShowing("ask");
  return (
    <header className={cn("box-content flex h-9 shrink-0 items-center gap-0.5 border-b px-2 transition-[padding] duration-200 ease-out", mac && !open && "ps-[calc(var(--traffic-left)_+_0.75rem)]")} data-tauri-drag-region>
      <Tool keys={keys("sidebar")} label={open ? "Hide the sidebar" : "Show the sidebar"} onClick={toggleSidebar}><PanelLeft /></Tool>
      <Tool disabled={!back} keys={keys("back")} label="Back" onClick={() => travel("back")}><ChevronLeft /></Tool>
      <Tool disabled={!forward} keys={keys("forward")} label="Forward" onClick={() => travel("forward")}><ChevronRight /></Tool>
      <div className="flex min-w-0 flex-1 justify-center px-3" data-tauri-drag-region>
        <Pill agentURL={view.kind === "agent" ? url : ""} view={view} />
      </div>
      <Tool aria-pressed={saved} disabled={!safeBrowserURL(url)} keys={keys("save-link")} label={saved ? "Saved" : "Save"} onClick={() => toggleSaved(url, view.kind === "agent" ? (agentState.state?.title ?? "") : (tab?.title ?? ""))}>
        <Bookmark className={cn(saved && "fill-current")} />
      </Tool>
      <Tool aria-pressed={asking} className={cn(asking && "bg-accent text-foreground")} keys={keys("ask")} label="Ask" onClick={() => toggleView("ask")}><Sparkles /></Tool>
      <Menu>
        <Tooltip>
          <TooltipTrigger render={<MenuTrigger render={<Button aria-label="More" className="text-muted-foreground hover:text-foreground" size="icon-sm" variant="ghost" />} />}><Ellipsis /></TooltipTrigger>
          <TooltipPopup>More</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" className="[&_[data-inset]]:ps-[1.875rem] sm:[&_[data-inset]]:ps-7">
          <MenuItem disabled={!onPage} onClick={() => void act("reload")}><RotateCw />Reload<MenuShortcut>{keys("reload")}</MenuShortcut></MenuItem>
          <MenuItem disabled={!onPage} onClick={() => void zoom(1)}><ZoomIn />Zoom in<MenuShortcut>{keys("zoom-in")}</MenuShortcut></MenuItem>
          <MenuItem disabled={!onPage} onClick={() => void zoom(-1)}><ZoomOut />Zoom out<MenuShortcut>{keys("zoom-out")}</MenuShortcut></MenuItem>
          <MenuItem disabled={!onPage} inset onClick={() => void zoom(0)}>Actual size<MenuShortcut>{keys("zoom-reset")}</MenuShortcut></MenuItem>
          <MenuSeparator />
          {view.kind === "agent" && safeBrowserURL(url) && <MenuItem onClick={() => void openTab(url)}><Globe />Open in a tab of mine</MenuItem>}
          <MenuItem disabled={!onPage || !!tab?.pin} onClick={() => tab && pin(tab.id)}><Pin />Pin tab</MenuItem>
          <MenuItem disabled={!safeBrowserURL(url)} onClick={() => void navigator.clipboard?.writeText(url).catch(() => {})}><Link />Copy link</MenuItem>
          <MenuItem disabled={!safeBrowserURL(url)} onClick={() => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)).catch(() => window.open(url, "_blank", "noopener,noreferrer"))}><ExternalLink />Open in default browser</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!closed.length} inset onClick={() => void reopen()}>Reopen closed tab<MenuShortcut>{keys("reopen-tab")}</MenuShortcut></MenuItem>
          <MenuItem disabled={!onPage} onClick={() => void closeTab()}><X />Close tab<MenuShortcut>{keys("close-tab")}</MenuShortcut></MenuItem>
        </MenuPopup>
      </Menu>
    </header>
  );
}

// Saved pages or history, in the page area: a click shows the page's tab, or opens it.
function List({ kind }: { kind: "saved" | "history" }) {
  const { tabs, base } = space.use();
  const [data, update] = useBrowserData(dataBase(base));
  const [filter, setFilter] = useState("");
  const list = (kind === "saved" ? data.bookmarks : data.history).filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const remove = (e: BrowserEntry) => update((d) => (kind === "saved" ? { ...d, bookmarks: d.bookmarks.filter((x) => x.url !== e.url) } : { ...d, history: d.history.filter((x) => x.url !== e.url) }));
  const show = (e: BrowserEntry) => {
    const tab = tabs.find((t) => t.url === e.url);
    if (tab) select(tab.id, true);
    else void openTab(e.url);
  };
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-3 px-6 pt-8">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-medium text-base">{kind === "saved" ? "Saved" : "History"}</h2>
        {kind === "history" && list.length > 0 && <Button onClick={() => update((d) => ({ ...d, history: [] }))} size="sm" variant="ghost">Clear history</Button>}
      </div>
      <Input aria-label={`Search ${kind === "saved" ? "saved pages" : "history"}`} onChange={(e) => setFilter(e.currentTarget.value)} placeholder="Search" size="sm" value={filter} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto pb-6">
        {list.map((e) => (
          <div className="group/row flex items-center rounded-lg hover:bg-accent" key={e.url}>
            <Button className="h-10 min-w-0 flex-1 justify-start gap-2.5 px-2 font-normal hover:bg-transparent sm:h-10" onClick={() => show(e)} variant="ghost">
              <SiteIcon tab={{ url: e.url, title: e.title }} />
              <span className="min-w-0 shrink truncate">{e.title || hostOf(e.url)}</span>
              <span className="min-w-0 flex-1 truncate text-left text-[0.8125rem] text-muted-foreground">{hostOf(e.url)}</span>
            </Button>
            <Button aria-label={`Remove ${e.title || hostOf(e.url)}`} className="me-1 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" onClick={() => remove(e)} size="icon-xs" variant="ghost"><X /></Button>
          </div>
        ))}
        {!list.length && <p className="p-6 text-center text-muted-foreground text-sm">{filter ? "Nothing matches." : kind === "saved" ? "Pages you save appear here. Press Save, or ⌘D, on a page." : "Pages you visit appear here."}</p>}
      </div>
    </div>
  );
}

// An agent's own tab, streamed as in the old pane, its page sized to the area as the old pane sizes
// its own tabs (the runtime's resize), so it fills it. Shared ownership keeps two viewers of one tab
// from fighting over its size. The surface grows in a column; in a block it has no height.
function AgentPage({ base, tab }: { base: string; tab: string }) {
  const owner = useBrowserViewportOwner(`${base}/${tab}`, true, true);
  const { state } = useBrowserState(base, tab, true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { owns, auto, resize, resizeState } = owner;
  useEffect(() => {
    if (!owns || !auto || !size.width || !size.height || resizeState.busy) return;
    const width = Math.max(320, Math.min(3840, Math.round(size.width)));
    const height = Math.max(240, Math.min(2160, Math.round(size.height)));
    if (state?.viewport?.width === width && state.viewport.height === height) return;
    const timer = window.setTimeout(() => {
      void resize({ width, height }, async () => {
        await ask("POST", tabRoute(base, "resize", tab), { size: `${width}x${height}`, scale: "1" });
        return { viewport: { width, height } };
      }, true).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [owns, auto, size.width, size.height, state?.viewport?.width, state?.viewport?.height, resizeState.busy]);
  return (
    <div className="absolute inset-0 flex flex-col" onFocusCapture={owner.claim} onPointerDownCapture={owner.claim}>
      <BrowserSurface active base={base} expectedViewport={resizeState.target} fit onViewport={setSize} resizeBusy={resizeState.busy || resizeState.unresolved} tab={tab} />
    </div>
  );
}

// A page that could not load: the reason in plain words, and Try again.
function Failed({ url, why }: { url: string; why: string }) {
  return (
    <Empty className="absolute inset-0 bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Globe /></EmptyMedia>
        <EmptyTitle>Couldn’t reach {hostOf(url) || "this page"}</EmptyTitle>
        <EmptyDescription>{why}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => void act("reload")} variant="outline">Try again</Button>
      </EmptyContent>
    </Empty>
  );
}

// The page area. In the Mac app the tab's view is laid exactly over it, at its bottom corners'
// radius; zoomed notes change CSS pixels, so the notes webview's width goes along.
function Page({ e }: { e: Engine | null }) {
  const view = shown.use();
  const { tabs, selected } = space.use();
  const tab = tabs.find((t) => t.id === selected);
  const page = live.use()[selected];
  const area = useRef<HTMLDivElement>(null);
  const covered = useCovered(area);
  const [frozen, setFrozen] = useState<{ id: string; src: string } | null>(null);
  const keys = useKeysFor();
  const working = !!acting.use()[selected];
  const marks = standinMarks.use();
  const done = standinDone.use();
  const shownNow = standinShown.use();
  const pageShown = !!e && view.kind === "tab" && !!tab && !page?.failed;

  useLayoutEffect(() => {
    if (!e) return;
    if (!pageShown || !tab) {
      setFrozen(null);
      void e.hide().catch(() => {});
      if (tab && view.kind === "tab") void ensure(tab.id);
      return;
    }
    const id = tab.id;
    if (covered) {
      let current = true;
      // Hide the view only once its picture is drawn; an unchanged picture fires no load event.
      void (async () => {
        const src = await e.freeze(id).catch(() => "");
        if (!current) return;
        if (src) {
          setFrozen({ id, src });
          const img = new Image();
          img.src = src;
          await img.decode().catch(() => {});
          await new Promise(requestAnimationFrame);
        }
        if (current) await e.hide();
      })().catch(() => {});
      return () => { current = false; };
    }
    let last = "";
    let raf = 0;
    let until = 0;
    // A late answer from before something covered the page must not show the view again.
    let alive = true;
    const sync = () => {
      const el = area.current;
      if (!el || !alive) return;
      const r = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el.closest(".ll-card") ?? el).borderBottomLeftRadius) || 0;
      const key = `${r.left},${r.top},${r.width},${r.height},${window.innerWidth},${radius}`;
      if (key === last) return;
      last = key;
      // The picture goes once the live view is back over it, not on a timer a re-render can cancel.
      void e.show(id, { x: r.left, y: r.top, w: r.width, h: r.height }, window.innerWidth, radius).then(() => alive && setFrozen(null), () => {});
    };
    // A sidebar or panel slides for 200 ms: follow it frame by frame until it settles.
    const settle = () => {
      sync();
      if (performance.now() < until) raf = requestAnimationFrame(settle);
    };
    const kick = () => {
      until = performance.now() + 400;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(settle);
    };
    // Once the view exists, place it even where an earlier try found none.
    void ensure(id).then(() => { last = ""; sync(); });
    const resize = new ResizeObserver(kick);
    if (area.current) resize.observe(area.current);
    window.addEventListener("resize", kick);
    return () => { alive = false; resize.disconnect(); window.removeEventListener("resize", kick); cancelAnimationFrame(raf); };
  }, [e, pageShown, covered, tab?.id, view.kind]);
  // Leaving the space hides every page; they keep running for when it comes back.
  useEffect(() => () => void e?.hide().catch(() => {}), [e]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background" data-testid="browser-page" ref={area}>
      {view.kind === "saved" || view.kind === "history" ? (
        <List kind={view.kind} />
      ) : view.kind === "agent" ? (
        <AgentPage base={view.base} key={`${view.base}/${view.tab}`} tab={view.tab} />
      ) : !tab ? (
        <Empty className="absolute inset-0">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Globe /></EmptyMedia>
            <EmptyTitle>No page open</EmptyTitle>
            <EmptyDescription>Search for something, or enter an address.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => bar.set({ mode: "new", text: "" })} variant="outline">New tab<span className="text-muted-foreground">{keys("new-tab")}</span></Button>
          </EmptyContent>
        </Empty>
      ) : page?.failed ? (
        <Failed url={tab.url} why={page.failed} />
      ) : (
        <>
          {standin && (
            <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-8 text-center text-neutral-900", working && "ring-2 ring-info/70 ring-inset")} data-done={done[tab.id] ?? 0} data-live={shownNow === tab.id} data-testid="standin-page">
              <SiteIcon large tab={tab} />
              <h1 className="font-semibold text-2xl">{tab.title}</h1>
              <p className="text-neutral-500 text-sm">{tab.url}</p>
              {marks[tab.id] && <p className="rounded-md bg-info px-2 font-medium text-white text-xs leading-[22px]" role="status">{marks[tab.id]}</p>}
            </div>
          )}
          {frozen?.id === tab.id && frozen.src && <img alt="" className="absolute inset-0 size-full object-cover object-top" data-testid="page-picture" src={frozen.src} />}
        </>
      )}
    </div>
  );
}

export function BrowserSpace({ mac }: { mac: boolean }) {
  const e = useEngine();
  // Ask is about the browser while it is in front (lib/ask.ts), titled by the tab in view.
  useEffect(() => {
    const title = () => space.get().tabs.find((t) => t.id === space.get().selected)?.title ?? "";
    askAboutBrowser({ id: BROWSER_ASK, title, text: () => "", browser: true });
    return () => askAboutBrowser(null);
  }, []);
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", CARD)} data-testid="browser-space">
      <Toolbar mac={mac} />
      <Page e={e} />
      <BrowserCommand />
    </div>
  );
}

