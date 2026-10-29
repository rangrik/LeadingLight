import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, ChevronUp, Copy, Download, Ellipsis, ExternalLink, Globe, History, Maximize2, MessagesSquare, Minimize2, Monitor, MousePointer2, Plus, RotateCw, Search, ShieldCheck, Smartphone, Square, Terminal, TextSearch, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Input } from "@leadinglight/ui/components/input";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Tabs, TabsList, TabsTab } from "@leadinglight/ui/components/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { BrowserSurface, type BrowserAreaSelection, type BrowserViewport } from "~/components/browser-surface";
import { BrowserAddress } from "~/components/browser-address";
import { BrowserClearData, type BrowserClearSelection } from "~/components/browser-clear-data";
import { BrowserDeveloper, BrowserDeveloperNotice } from "~/components/browser-developer";
import { BrowserFeedback, type BrowserInspection } from "~/components/browser-feedback";
import { BrowserAreaFeedback, BrowserComments } from "~/components/browser-comments";
import { captureArea, captureElementComment, useBrowserAnnotationLease, useBrowserAnnotations, type BrowserAreaCapture } from "~/lib/browser-annotations";
import { BrowserTools, type BrowserToolsView } from "~/components/browser-tools";
import { useFolder } from "~/components/project-folder";
import { agentBrowserInstructions, browserAddress, clearBrowserHistory, personalTab, rememberVisit, safeBrowserURL, type BrowserEntry } from "~/lib/browser-data";
import { browserOpening } from "~/lib/browser-opening";
import { useNativeBrowserDownloads } from "~/lib/browser-preferences";
import { useStore } from "@/lib/store";
import { saveBrowserFile } from "~/lib/browser-files";
import { browserBase, browserError, tabRoute, useBrowserData, useBrowserState, useBrowserTabs, type BrowserTab } from "~/lib/project-runtime/browser";
import { ask } from "~/lib/project-runtime/transport";
import { isNative } from "~/lib/platform";
import { attachBrowser, detachBrowser, type BrowserAnnotation } from "~/lib/browser-context";
import { useBrowserViewportOwner } from "~/lib/browser-viewport";
import { openBeside } from "~/lib/panes";
import { chatView } from "~/lib/space";

export { useBrowserTabs } from "~/lib/project-runtime/browser";
type Workspace = { location: string; worktree: string; port?: number };
type Loc = { name: string; path?: string; worktrees?: { name: string; path?: string; main?: boolean; port?: number }[] };

export function useWorkspace(pageId: string, worktree?: string) {
  const folder = useFolder(pageId);
  const location = folder?.folder.location;
  const [found, setFound] = useState<(Workspace & { key: string }) | null>(null);
  const [error, setError] = useState("");
  const key = `${pageId}/${location ?? ""}/${worktree ?? ""}`;
  useEffect(() => {
    let live = true;
    setError("");
    const read = !pageId ? ask<Workspace>("POST", "/v1/browser/workspace") : !location ? Promise.resolve(null) : ask<Loc[]>("GET", "/v1/locations").then((all) => {
      const project = all.find((l) => l.name === location);
      const wts = project?.worktrees ?? [];
      const w = worktree ? wts.find((x) => x.name === worktree) : wts.find((x) => x.path === project?.path) ?? wts.find((x) => x.main);
      if (!w) throw new Error("This workspace is no longer available. Relink its folder to browse.");
      return { location, worktree: w.name, port: w.port };
    });
    void read.then((ws) => live && setFound(ws ? { ...ws, key } : null), (e) => live && setError(browserError(e)));
    return () => { live = false; };
  }, [key]);
  return { workspace: found?.key === key ? found : null, error };
}

function Tool({ label, children, ...props }: ButtonProps & { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger render={<Button aria-label={label} size="icon-sm" variant="ghost" {...props} />}>{children}</TooltipTrigger><TooltipPopup>{label}</TooltipPopup></Tooltip>;
}

export function BrowserPane({ pageId, worktree, session, active = true }: { pageId: string; worktree?: string; session?: string; active?: boolean }) {
  const { workspace, error } = useWorkspace(pageId, worktree);
  if (!workspace) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><Globe className="size-6" /><p role={error ? "alert" : "status"}>{error || (pageId ? "Opening this workspace’s browser…" : "Starting the browser…")}</p></div>;
  return <WorkspaceBrowser active={active} key={`${workspace.location}/${workspace.worktree}/${session ?? ""}`} pageId={pageId} session={session} workspace={workspace} />;
}

function WorkspaceBrowser({ workspace, session, active, pageId }: { workspace: Workspace; session?: string; active: boolean; pageId: string }) {
  const opening = browserOpening.use();
  const { location, worktree } = workspace;
  const base = browserBase(location, worktree);
  const { error: downloadError } = useNativeBrowserDownloads(base);
  const [data, update] = useBrowserData(base);
  const visitedURLs = useRef(new Map(data.tabs.map((tab) => [tab.name, tab.url])));
  const { tabs, error: tabsError, loaded, refresh: refreshTabs } = useBrowserTabs(location, worktree, active);
  const [selected, setSelected] = useState(() => personalTab(data.selected) ? data.selected : data.tabs[0]?.name || "");
  const [blank, setBlank] = useState<string[]>([]);
  const { state, error: stateError, readStartedAt, refresh: refreshState } = useBrowserState(base, selected, active && tabs.some((t) => t.name === selected));
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissedError, setDismissedError] = useState("");
  const [fit, setFit] = useState(true);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<BrowserToolsView | "bookmarks" | "history" | "developer" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [find, setFind] = useState<string | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [refused, setRefused] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [pendingURL, setPendingURL] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const [picking, setPicking] = useState(false);
  const [inspection, setInspection] = useState<BrowserInspection | null>(null);
  const [area, setArea] = useState<BrowserAreaCapture | null>(null);
  const pickSequence = useRef(0);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [viewportAck, setViewportAck] = useState({ key: "", revision: 0 });
  const root = useRef<HTMLDivElement>(null);
  const wasFull = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const addressRevision = useRef(0);
  const addressDraft = useRef(false);
  const closingTabs = useRef(new Set<string>());
  const interacted = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = tabs.find((t) => t.name === selected) ?? data.tabs.find((t) => t.name === selected);
  const url = state?.url || current?.url || "";
  const running = !!tabs.find((t) => t.name === selected) && state?.running !== false;
  const annotationLease = useBrowserAnnotationLease(base, selected, active && running && (picking || !!inspection));
  const annotations = useBrowserAnnotations(base, selected, url);
  const viewportKey = `${base}/${selected}`;
  const viewportOwner = useBrowserViewportOwner(viewportKey, active && running, personalTab(selected));
  const { auto: autoViewport, setAuto: setAutoViewport } = viewportOwner;
  const { resizeState } = viewportOwner;
  const pendingViewport = viewportAck.key === viewportKey && viewportAck.revision === resizeState.revision ? undefined : resizeState.target;
  const resizePage = useCallback((width: number, height: number, automatic = false) => viewportOwner.resize({ width, height }, async () => {
    try {
      await ask("POST", tabRoute(base, "resize", selected), { size: `${width}x${height}`, scale: "1" });
      return { viewport: { width, height } };
    } catch (error) {
      try {
        const actual = await ask<{ viewport?: BrowserViewport }>("GET", tabRoute(base, "state", selected));
        if (!actual.viewport?.width || !actual.viewport.height) throw error;
        return { viewport: actual.viewport, error };
      } catch {
        return { error: new Error(`${browserError(error)} Could not confirm page size. Choose Phone or Desktop viewport to retry.`) };
      }
    }
  }, automatic), [base, selected, viewportOwner.resize]);
  const title = state?.title || current?.title || (safeBrowserURL(url) ? new URL(url).hostname : "New tab");
  const known: BrowserTab[] = [...tabs, ...data.tabs.filter((t) => !tabs.some((x) => x.name === t.name)), ...blank.filter((name) => !tabs.some((t) => t.name === name) && !data.tabs.some((t) => t.name === name)).map((name) => ({ name, title: "New tab" }))];
  const tabTitle = (tab: BrowserTab) => tab.name === selected && pendingURL && (!tab.url || tab.url === "about:blank") && (!tab.title || tab.title === "New tab" || tab.title === "about:blank") ? new URL(pendingURL).hostname : tab.title || (tab.url && safeBrowserURL(tab.url) ? new URL(tab.url).hostname : personalTab(tab.name) ? "New tab" : tab.name === session ? "This chat’s agent" : "Agent tab");
  const marked = data.bookmarks.some((e) => e.url === url);
  const currentError = error || downloadError || tabsError || stateError || state?.error || "";
  const blockedSite = !!refused.length && currentError.includes("ERR_TUNNEL_CONNECTION_FAILED");

  const choose = (name: string, fromUser = true, keepDraft = false) => {
    if (fromUser) interacted.current = true;
    setSelected(name); setError(""); setDismissedError(""); setFind(null); setView(null); setPendingURL("");
    if (!keepDraft) { addressDraft.current = false; setAddress(known.find((t) => t.name === name)?.url || ""); }
    update((d) => ({ ...d, selected: name }));
  };
  const fresh = () => {
    const name = `user-${crypto.randomUUID().slice(0, 12)}`;
    setBlank((all) => [...all, name]); choose(name); setAddress("");
    window.setTimeout(() => field.current?.focus(), 0);
    return name;
  };
  useEffect(() => {
    if (!loaded || interacted.current) return;
    choose((session && tabs.find((t) => t.name === session)?.name) || selected || data.tabs[0]?.name || tabs.find((t) => personalTab(t.name))?.name || "", false);
  }, [loaded]);
  useEffect(() => { if (url && !addressDraft.current) setAddress(url); }, [url, selected]);
  useEffect(() => {
    if (active && (full || wasFull.current)) root.current?.focus({ preventScroll: true });
    wasFull.current = full;
  }, [active, full]);
  useEffect(() => { pickSequence.current++; setPicking(false); setInspection(null); setArea(null); }, [selected, url]);
  useEffect(() => {
    if (annotationLease.error) { pickSequence.current++; setInspection(null); setPicking(false); setError(annotationLease.error); }
  }, [annotationLease.error]);
  useEffect(() => {
    if (!resizeState.busy && !resizeState.unresolved && pendingViewport && state?.viewport && readStartedAt > resizeState.settledAt) setViewportAck({ key: viewportKey, revision: resizeState.revision });
  }, [viewportKey, resizeState, pendingViewport, state?.viewport?.width, state?.viewport?.height, readStartedAt]);
  useEffect(() => {
    if (!active || !viewportOwner.owns || !autoViewport || !running || !paneSize.width || !paneSize.height || view || resizeState.busy || resizeState.unresolved) return;
    const width = Math.max(320, Math.min(3840, Math.round(paneSize.width)));
    const height = Math.max(240, Math.min(2160, Math.round(paneSize.height)));
    if ((state?.viewport?.width === width && state?.viewport?.height === height) || (pendingViewport?.width === width && pendingViewport.height === height) || !viewportOwner.canAutoResize({ width, height })) return;
    const timer = window.setTimeout(() => {
      if (!alive.current || selectedRef.current !== selected || !viewportOwner.canAutoResize({ width, height })) return;
      void resizePage(width, height, true).then(() => { if (alive.current && selectedRef.current === selected) refreshState(); }, (e) => { if (alive.current && selectedRef.current === selected) { refreshState(); setError(browserError(e)); } });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [active, viewportOwner.owns, viewportOwner.canAutoResize, autoViewport, running, selected, paneSize.width, paneSize.height, state?.viewport?.width, state?.viewport?.height, view, resizeState, pendingViewport, resizePage]);
  useEffect(() => {
    if (state?.loading) visitedURLs.current.delete(selected);
    if (state?.running && !state.loading && !state.error && safeBrowserURL(state.url)) {
      const navigated = visitedURLs.current.get(selected) !== state.url;
      visitedURLs.current.set(selected, state.url);
      update((d) => rememberVisit(d, selected, state.url, state.title, navigated));
      setPendingURL("");
    }
  }, [selected, state?.url, state?.title, state?.loading, state?.error, readStartedAt]);
  useEffect(() => { setPrompt(state?.dialog?.defaultPrompt ?? ""); }, [selected, state?.dialog?.message, state?.dialog?.defaultPrompt]);
  useEffect(() => {
    setRefused([]);
    if (!active || !selected || !running || !state?.refusedHosts?.length) return;
    let live = true;
    const read = async () => {
      const permissions = await ask<{ hosts: string[] }>("GET", "/v1/browser/permissions").catch(() => null);
      if (live && permissions) setRefused([...new Set(state.refusedHosts)].filter((h) => !permissions.hosts.includes(h) && !/(^|\.)localhost$|^127\.|^\[?::1/.test(h)));
    };
    void read();
    const timer = window.setInterval(read, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [base, selected, url, active, running, state?.refusedHosts?.join("\n")]);

  const run = async (task: () => Promise<unknown>, target = selected) => {
    setBusy(true); setError(""); setDismissedError("");
    try { await task(); }
    catch (e) { if (alive.current && selectedRef.current === target) setError(browserError(e)); }
    finally { if (alive.current) { setBusy(false); refreshTabs(); refreshState(); } }
  };
  const navigate = async (input: string, target = selected) => {
    setDismissedError("");
    let next: string;
    try { next = browserAddress(input); } catch (e) { setError(browserError(e)); return; }
    if (!target || closingTabs.current.has(target) || (!personalTab(target) && !tabs.some((t) => t.name === target))) target = fresh();
    addressDraft.current = false;
    setAddress(next); setPendingURL(next); setView(null);
    await run(async () => {
      await ask("POST", tabRoute(base, tabs.some((t) => t.name === target) ? "navigate" : "open", target), { action: "open", url: next, ...(data.tabs.some((t) => t.name === target) ? {} : { size: "1280x800" }) });
      visitedURLs.current.delete(target);
    }, target);
  };
  const action = (name: string) => run(async () => { await ask("POST", tabRoute(base, "navigate", selected), { action: name }); if (name !== "stop") visitedURLs.current.delete(selected); });
  useEffect(() => {
    if (!loaded || opening?.base !== base) return;
    browserOpening.set(null);
    void navigate(opening.url, fresh());
  }, [loaded, opening?.id, base]);
  const close = async (name = selected) => {
    if (!name) return;
    const revision = addressRevision.current;
    closingTabs.current.add(name);
    await run(async () => {
      if (tabs.some((t) => t.name === name)) await ask("POST", tabRoute(base, "close", name));
      const entry = known.find((t) => t.name === name);
      const rest = known.filter((t) => t.name !== name);
      setBlank((all) => all.filter((t) => t !== name));
      update((d) => ({ ...d, tabs: d.tabs.filter((t) => t.name !== name), closed: entry?.url && safeBrowserURL(entry.url) ? [{ url: entry.url, title: entry.title || entry.url, time: Date.now() }, ...d.closed].slice(0, 20) : d.closed }));
      if (selectedRef.current === name) choose(rest[Math.max(0, known.findIndex((t) => t.name === name) - 1)]?.name || "", true, addressRevision.current !== revision);
    }, name);
    closingTabs.current.delete(name);
  };
  const reopen = () => {
    const entry = data.closed[0];
    if (!entry) return;
    const name = fresh();
    update((d) => ({ ...d, closed: d.closed.slice(1) }));
    void navigate(entry.url, name);
  };
  const zoom = (factor: number) => { pickSequence.current++; setPicking(false); setInspection(null); setArea(null); return run(() => ask("POST", tabRoute(base, "zoom", selected), { factor: Math.max(0.25, Math.min(3, factor)) })); };
  const resize = (width: number, height: number) => {
    setAutoViewport(false);
    return run(() => resizePage(width, height));
  };
  const search = async (backwards = false) => {
    if (!find) return;
    const target = selected;
    await run(async () => {
      const result = await ask<{ found: boolean }>("POST", tabRoute(base, "find", target), { text: find, backwards });
      if (selectedRef.current === target) setMatch(result.found);
    });
  };
  const toggleBookmark = () => safeBrowserURL(url) && update((d) => ({ ...d, bookmarks: marked ? d.bookmarks.filter((e) => e.url !== url) : [{ url, title, time: Date.now() }, ...d.bookmarks].slice(0, 200) }));
  const askWithAnnotations = (notes: BrowserAnnotation[] = annotations.comments) => {
    if (notes.length > 20) throw new Error("Send the saved comments first, or remove one before adding this feedback.");
    attachBrowser(pageId, { location, worktree, tab: selected, url, title, session, ...(notes.length ? { annotations: notes } : {}) });
    setInspection(null); setArea(null); setPicking(false); setFull(false); openBeside(chatView(pageId));
  };
  const captureComment = async (comment: string, styles: Record<string, string>) => {
    if (!inspection || !state?.viewport || resizeState.busy || resizeState.unresolved || pendingViewport) throw new Error("Wait for the page to finish resizing before saving feedback.");
    const sequence = pickSequence.current;
    const note = await captureElementComment(base, selected, inspection, state.viewport, comment, styles, annotationLease.lease);
    if (!alive.current || sequence !== pickSequence.current || selectedRef.current !== selected) throw new Error("The page changed. Select it again before saving feedback.");
    return note;
  };
  const askAboutPage = async (comment?: string, styles: Record<string, string> = {}) => {
    const note = comment !== undefined ? await captureComment(comment, styles) : undefined;
    askWithAnnotations(note ? [...annotations.comments, note] : annotations.comments);
  };
  const pickArea = (selection: BrowserAreaSelection) => {
    const sequence = ++pickSequence.current;
    void run(async () => {
      const next = await captureArea(base, selected, selection);
      if (alive.current && sequence === pickSequence.current && selectedRef.current === selected) { setArea(next); setInspection(null); setPicking(false); }
    });
  };
  const pickElement = (point: { x: number; y: number }) => {
    const sequence = ++pickSequence.current;
    void run(async () => {
      try {
        const lease = await annotationLease.ensure();
        const next = await ask<BrowserInspection>("POST", tabRoute(base, "inspect", selected), { ...point, lease });
        if (alive.current && sequence === pickSequence.current) { setInspection(next); setPicking(false); }
      } catch (e) { if (sequence === pickSequence.current) throw e; }
    });
  };
  const clearProfile = async ({ history, website, range }: BrowserClearSelection) => {
    setBusy(true); setClearError("");
    try {
      if (website) await ask("DELETE", `${base}/profile`, { confirm: true });
      if (!alive.current) return;
      if (website) {
        setSelected(""); setBlank([]); setAddress(""); setPendingURL(""); setFind(null); setView(null); setError(""); setRefused([]);
        detachBrowser(pageId);
      }
      update((d) => ({ ...(history ? clearBrowserHistory(d, range) : d), ...(website ? { selected: "", tabs: [], closed: [] } : {}) }));
      setClearing(false); refreshTabs(); refreshState();
    } catch (e) { if (alive.current) setClearError(browserError(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const copyAgent = () => run(async () => {
    await navigator.clipboard.writeText(agentBrowserInstructions(location, worktree, selected));
    setCopied(true); window.setTimeout(() => alive.current && setCopied(false), 2500);
  });
  const shot = () => run(async () => {
    const result = await ask<{ file?: string; text: string }>("POST", tabRoute(base, "shot", selected), { native: true });
    const name = result.file?.split("/").pop();
    if (!name) throw new Error(result.text || "The browser did not return a screenshot.");
    await saveBrowserFile(await ask("GET", tabRoute(base, `shots/${encodeURIComponent(name)}/data`, selected)));
  });
  const show = (next: typeof view) => { pickSequence.current++; setInspection(null); setArea(null); setPicking(false); setView((v) => v === next ? null : next); setFilter(""); };
  const toggleFull = () => { pickSequence.current++; setInspection(null); setArea(null); setPicking(false); setFull((v) => !v); };
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const target = selected;
    const chooser = state?.fileChooser?.id;
    void run(async () => {
      if (!chooser) throw new Error("The file request changed. Choose the file again.");
      const list = [...files];
      if (list.length > 20 || list.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new Error("Choose up to 20 files, at most 32 MB in total.");
      const payload = await Promise.all(list.map((file) => new Promise<{ name: string; data: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(",")[1] });
        reader.readAsDataURL(file);
      })));
      if (selectedRef.current === target) await ask("POST", tabRoute(base, "upload", target), { chooser, files: payload });
    }, target);
  };
  const command = (id: string) => {
    switch (id) {
      case "new-tab": fresh(); break;
      case "close-tab": void close(); break;
      case "reopen-tab": reopen(); break;
      case "back": if (state?.canGoBack) void action("back"); break;
      case "forward": if (state?.canGoForward) void action("forward"); break;
      case "zoom-in": if (running) void zoom((state?.zoom ?? 1) + 0.1); break;
      case "zoom-out": if (running) void zoom((state?.zoom ?? 1) - 0.1); break;
      case "zoom-reset": if (running) void zoom(1); break;
      case "next-tab": case "previous-tab": {
        const at = known.findIndex((t) => t.name === selected);
        if (known.length) choose(known[(at + (id === "next-tab" ? 1 : -1) + known.length) % known.length].name);
        break;
      }
      default: return false;
    }
    return true;
  };
  useEffect(() => {
    const on = (event: Event) => {
      if (active && (menuOpen || clearing || !!state?.dialog || root.current?.contains(document.activeElement)) && command((event as CustomEvent<string>).detail)) { setMenuOpen(false); event.preventDefault(); }
    };
    window.addEventListener("ll:browser-shortcut", on);
    return () => window.removeEventListener("ll:browser-shortcut", on);
  });

  const content = <div className={cn("@container/browser flex h-full min-h-0 min-w-0 flex-col bg-background text-sm outline-none", full && "fixed inset-x-3 bottom-3 top-10 z-40 h-auto overflow-hidden rounded-xl border shadow-lg")} data-testid="agent-browser" onFocusCapture={viewportOwner.claim} onPointerDownCapture={viewportOwner.claim} ref={root} tabIndex={-1} onKeyDownCapture={(e) => {
    if (e.key === "Escape") {
      // Portaled popups and expanded triggers dismiss before the containing browser pane.
      if (!e.currentTarget.contains(e.target as Node) || (e.target as Element).closest('[aria-haspopup][aria-expanded="true"]')) return;
      if (picking) { pickSequence.current++; setPicking(false); } else if (area) setArea(null); else if (inspection) setInspection(null); else if (find !== null) setFind(null); else if (view) setView(null); else if (full) toggleFull(); else return;
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "l") { field.current?.focus(); field.current?.select(); }
    else if (key === "f" && !e.shiftKey && running) { setFind(""); setMatch(null); }
    else if (key === "r" && running) void action("reload");
    else if (key === "b" && e.shiftKey) toggleFull();
    else return;
    e.preventDefault(); e.stopPropagation();
  }}>
    <div className="flex min-h-9 shrink-0 items-center gap-1 border-b px-2">
      <Tabs className="min-w-0 flex-1 gap-0 overflow-x-auto" onValueChange={(v) => choose(String(v))} value={selected}>
        <TabsList aria-label="Browser tabs" className="max-w-none justify-start" size="sm" variant="underline">
          {known.map((t) => <div className="flex min-w-0 max-w-48 shrink-0 items-center" key={t.name}>
            <TabsTab className="min-w-0 max-w-40 gap-1.5 px-2" value={t.name}><Globe className="size-4 shrink-0" /><span className="truncate">{tabTitle(t)}</span>{!personalTab(t.name) && <span className="text-xs text-muted-foreground">Agent</span>}</TabsTab>
            <Tool disabled={busy} label={`Close ${tabTitle(t)}`} onClick={() => void close(t.name)}><X className="size-4" /></Tool>
          </div>)}
        </TabsList>
      </Tabs>
      <Tool label="New browser tab" onClick={fresh}><Plus className="size-4" /></Tool>
      <Tool label={full ? "Return to split view" : "Enter full view"} onClick={toggleFull}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Tool>
    </div>
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 border-b px-2 py-1.5 @min-[420px]/browser:flex-nowrap" data-testid="browser-toolbar">
      <Tool disabled={!state?.canGoBack || busy} label="Back" onClick={() => void action("back")}><ArrowLeft className="size-4" /></Tool>
      <Tool disabled={!state?.canGoForward || busy} label="Forward" onClick={() => void action("forward")}><ArrowRight className="size-4" /></Tool>
      <Tool disabled={!running} label={state?.loading ? "Stop loading" : "Reload"} onClick={() => void action(state?.loading ? "stop" : "reload")}>{state?.loading ? <Square className="size-4" /> : <RotateCw className="size-4" />}</Tool>
      <BrowserAddress history={data.history} inputRef={field} onChange={setAddress} onEdit={() => { addressRevision.current++; addressDraft.current = true; interacted.current = true; }} onFocus={() => { interacted.current = true; }} onNavigate={(value) => void navigate(value)} value={address} />
      <span aria-hidden="true" className="flex-1 @min-[420px]/browser:hidden" />
      <Tool disabled={!safeBrowserURL(url)} label={marked ? "Remove bookmark" : "Bookmark this page"} onClick={toggleBookmark}><Bookmark className={cn("size-4", marked && "fill-current")} /></Tool>
      <Tool disabled={!running} label="Ask about page" onClick={() => void run(() => askAboutPage())}><MessagesSquare className="size-4" /></Tool>
      <Menu onOpenChange={setMenuOpen} open={menuOpen}><Tooltip><TooltipTrigger render={<MenuTrigger render={<Button aria-label="Browser menu" size="icon-sm" variant="ghost" />} />}><Ellipsis className="size-4" /></TooltipTrigger><TooltipPopup>Browser menu</TooltipPopup></Tooltip><MenuPopup align="end">
        <MenuItem onClick={() => show("bookmarks")}><Bookmark />Bookmarks</MenuItem><MenuItem onClick={() => show("history")}><History />History</MenuItem><MenuItem onClick={() => show("downloads")}><Download />Downloads</MenuItem>
        <MenuItem disabled={!data.closed.length} onClick={reopen}>Reopen closed tab</MenuItem><MenuSeparator />
        <MenuItem disabled={!running} onClick={() => { setFind(""); setMatch(null); }}><Search />Find in page</MenuItem>
        <MenuItem disabled={!running} onClick={() => void zoom((state?.zoom ?? 1) + 0.1)}><ZoomIn />Zoom in</MenuItem><MenuItem disabled={!running} onClick={() => void zoom((state?.zoom ?? 1) - 0.1)}><ZoomOut />Zoom out</MenuItem><MenuItem disabled={!running} onClick={() => void zoom(1)}>Actual size · {Math.round((state?.zoom ?? 1) * 100)}%</MenuItem>
        <MenuCheckboxItem checked={fit} onCheckedChange={setFit}>Fit page to pane</MenuCheckboxItem>
        <MenuCheckboxItem checked={autoViewport} disabled={!running} onCheckedChange={setAutoViewport}>Use pane size</MenuCheckboxItem>
        <MenuItem disabled={!running} onClick={() => void resize(390, 844)}><Smartphone />Phone viewport</MenuItem><MenuItem disabled={!running} onClick={() => void resize(1280, 800)}><Monitor />Desktop viewport</MenuItem><MenuSeparator />
        <MenuItem disabled={!running || busy || !!inspection || !!area} onClick={() => { setView(null); setPicking(true); }}><MousePointer2 />Comment on an element</MenuItem>
        <MenuItem disabled={!running} onClick={() => show("console")}><Terminal />Console</MenuItem><MenuItem disabled={!running} onClick={() => show("network")}>Network failures</MenuItem><MenuItem disabled={!running} onClick={() => show("text")}><TextSearch />Page text</MenuItem><MenuItem disabled={!running} onClick={() => void shot()}>Save screenshot</MenuItem>
        <MenuItem onClick={() => show("permissions")}><ShieldCheck />Site permissions</MenuItem><MenuItem disabled={!running} onClick={() => void copyAgent()}>{copied ? <Check /> : <Copy />}Copy agent instructions</MenuItem>
        <MenuItem disabled={!safeBrowserURL(url)} onClick={() => void run(async () => { if (await isNative) await (await import("@tauri-apps/plugin-opener")).openUrl(url); else window.open(url, "_blank", "noopener,noreferrer"); })}><ExternalLink />Open in default browser</MenuItem>
        <MenuItem disabled={!running} onClick={() => show("developer")}>Developer tools</MenuItem>
        <MenuSeparator /><MenuItem onClick={() => useStore.getState().setView({ kind: "settings", section: "browser" })}>Browser settings</MenuItem><MenuItem onClick={() => { setClearError(""); setClearing(true); }}>Clear browsing data…</MenuItem>
      </MenuPopup></Menu>
    </div>
    {find !== null && <form className="flex shrink-0 items-center gap-1 border-b px-3 py-2" onSubmit={(e) => { e.preventDefault(); void search(); }}><Input aria-label="Find in page" autoFocus className="min-w-0 flex-1" onChange={(e) => { setFind(e.currentTarget.value); setMatch(null); }} size="sm" value={find} /><span className="text-xs text-muted-foreground" role="status">{match === false ? "No match" : match ? "Found" : ""}</span><Tool disabled={!find || busy} label="Previous match" onClick={() => void search(true)}><ChevronUp className="size-4" /></Tool><Tool disabled={!find || busy} label="Next match" onClick={() => void search()}><ChevronDown className="size-4" /></Tool><Tool label="Close find" onClick={() => setFind(null)}><X className="size-4" /></Tool></form>}
    {picking && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs"><p className="min-w-0 flex-1">Click an element or drag an area to add feedback without activating the page.</p><Button onClick={() => { pickSequence.current++; setPicking(false); }} size="xs" variant="ghost">Cancel selection</Button></div>}
    {active && running && view !== "developer" && <BrowserDeveloperNotice base={base} onReview={() => show("developer")} tab={selected} />}
    {currentError && currentError !== dismissedError && !blockedSite && (!view || error || tabsError || downloadError) && <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs text-destructive-foreground" role="alert"><p className="min-w-0 flex-1 break-words">{currentError}</p><Tool label="Dismiss browser error" onClick={() => setDismissedError(currentError)}><X className="size-4" /></Tool></div>}
    {!view && running && !!refused.length && <div className="max-h-32 shrink-0 overflow-y-auto">{refused.map((host) => <div className="flex items-center gap-2 border-b px-3 py-2 text-xs" key={host}><p className="min-w-0 flex-1 break-words">Allow <strong>{host}</strong> for browsing? This also allows agents to reach this site.</p><Button disabled={busy} onClick={() => void run(async () => { await ask("POST", "/v1/browser/allow", { origin: host }); setRefused((r) => r.filter((h) => h !== host)); if (pendingURL) await navigate(pendingURL); else await ask("POST", tabRoute(base, "navigate", selected), { action: "reload" }); })} size="xs" variant="outline">Allow</Button></div>)}</div>}
    {view === "bookmarks" || view === "history" ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-center gap-2 border-b px-3 py-2"><strong className="text-sm">{view === "bookmarks" ? "Bookmarks" : "History"}</strong><Input aria-label={`Search ${view}`} className="min-w-0 flex-1" onChange={(e) => setFilter(e.currentTarget.value)} placeholder="Search" size="sm" value={filter} />{view === "history" && <Button onClick={() => update((d) => ({ ...d, history: [] }))} size="xs" variant="ghost">Clear history</Button>}<Tool label="Close browser list" onClick={() => setView(null)}><X className="size-4" /></Tool></div><div className="min-h-0 flex-1 overflow-auto p-2">{(view === "bookmarks" ? data.bookmarks : data.history).filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(filter.toLowerCase())).map((entry) => <SavedRow entry={entry} key={entry.url} onOpen={() => void navigate(entry.url)} onRemove={() => update((d) => view === "bookmarks" ? ({ ...d, bookmarks: d.bookmarks.filter((e) => e.url !== entry.url) }) : ({ ...d, history: d.history.filter((e) => e.url !== entry.url) }))} removeLabel={`Remove ${view === "bookmarks" ? "bookmark" : "history"} ${entry.title}`} />)}{!(view === "bookmarks" ? data.bookmarks : data.history).length && <p className="p-4 text-center text-muted-foreground">{view === "bookmarks" ? "Pages you bookmark appear here." : "Pages you visit appear here."}</p>}</div></div> : view === "developer" ? <BrowserDeveloper base={base} onClose={() => setView(null)} tab={selected} /> : view ? <BrowserTools base={base} onClose={() => setView(null)} onError={setError} onNavigate={(address) => void navigate(address)} tab={selected} view={view} /> : running ? <BrowserSurface active={active} base={base} expectedViewport={pendingViewport ?? state?.viewport} resizeBusy={resizeState.busy || resizeState.unresolved} fit={fit} highlight={inspection?.bounds} onError={setError} onArea={pickArea} onPick={pickElement} onViewport={setPaneSize} picking={picking} tab={selected} /> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6 text-center"><Globe className="size-8 text-muted-foreground" /><h2 className="font-medium">{current?.url ? "This tab is closed" : "Your browser, beside your notes"}</h2><p className="max-w-sm text-sm text-muted-foreground">{current?.url ? "Reopen it to continue where you left off." : "Enter an address to browse. You and your agent can use the same page."}</p>{current?.url && <Button disabled={busy} onClick={() => void navigate(current.url!)} size="sm" variant="outline">Reopen tab</Button>}{!selected && <Button onClick={fresh} size="sm" variant="outline"><Plus className="size-4" />New tab</Button>}{data.tabs.some((t) => !tabs.some((x) => x.name === t.name)) && <Button disabled={busy} onClick={() => void run(async () => { for (const t of data.tabs) if (!tabs.some((x) => x.name === t.name)) await ask("POST", tabRoute(base, "open", t.name), { url: t.url }); })} size="sm" variant="ghost">Restore saved tabs</Button>}</div>}
    {inspection && !view && running && <BrowserFeedback base={base} inspection={inspection} lease={annotationLease.lease} onAsk={askAboutPage} onSave={async (comment, styles) => { annotations.save(await captureComment(comment, styles)); }} onChange={(next) => { if (selectedRef.current === selected && next.url === url) setInspection((current) => current?.handle === next.handle ? next : current); }} onClose={() => setInspection(null)} tab={selected} viewport={!resizeState.busy && !resizeState.unresolved && !pendingViewport ? state?.viewport : undefined} />}
    {area && !view && running && <BrowserAreaFeedback area={area} base={base} onAsk={(note) => askWithAnnotations([...annotations.comments, note])} onClose={() => setArea(null)} onSave={(note) => { annotations.save(note); }} tab={selected} />}
    {!view && running && !picking && !inspection && !area && <BrowserComments base={base} comments={annotations.comments} onAsk={() => askWithAnnotations()} onRemove={annotations.remove} tab={selected} />}
    {annotationLease.error && (picking || inspection) && <p className="border-t px-3 py-2 text-xs text-destructive-foreground" role="alert">{annotationLease.error}</p>}
    <div className="flex min-h-6 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{busy || state?.loading ? "Loading…" : running ? personalTab(selected) ? "Personal tab · sign-ins stay in this workspace" : "Agent tab · shared live view" : "Ready"}</span>{state?.viewport && <span className="shrink-0">{state.viewport.width} × {state.viewport.height}</span>}</div>
    {active && state?.fileChooser && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-3"><p className="text-xs text-muted-foreground">This page is asking for {state.fileChooser.multiple ? "files" : "a file"}. Only files you choose will be uploaded.</p><Input aria-label="Files to upload" key={state.fileChooser.id} disabled={busy} multiple={state.fileChooser.multiple} onChange={(e) => upload(e.currentTarget.files)} size="sm" type="file" /><Button onClick={() => void run(() => ask("POST", tabRoute(base, "upload", selected), { chooser: state.fileChooser?.id, files: [] }))} size="xs" variant="ghost">Cancel upload</Button></div>}
    <BrowserClearData busy={busy} error={clearError} onClear={clearProfile} onClose={() => setClearing(false)} open={active && clearing} />
    <Dialog onOpenChange={(open) => { if (!open && state?.dialog) void run(() => ask("POST", tabRoute(base, "dialog", selected), { accept: false })); }} open={active && !clearing && !!state?.dialog}><DialogPopup className="sm:max-w-md"><DialogHeader><DialogTitle>This page says</DialogTitle><DialogDescription className="break-words">{state?.dialog?.message}</DialogDescription></DialogHeader>{state?.dialog?.type === "prompt" && <DialogPanel><Input aria-label="Response to page" autoFocus onChange={(e) => setPrompt(e.currentTarget.value)} value={prompt} /></DialogPanel>}<DialogFooter>{state?.dialog?.type !== "alert" && <Button onClick={() => void run(() => ask("POST", tabRoute(base, "dialog", selected), { accept: false }))} variant="outline">Cancel</Button>}<Button onClick={() => void run(() => ask("POST", tabRoute(base, "dialog", selected), { accept: true, promptText: prompt }))}>OK</Button></DialogFooter></DialogPopup></Dialog>
  </div>;
  return full && active ? createPortal(<><div aria-hidden="true" className="fixed inset-0 z-40 bg-background" />{content}</>, document.body) : content;
}

function SavedRow({ entry, onOpen, onRemove, removeLabel }: { entry: BrowserEntry; onOpen(): void; onRemove?: () => void; removeLabel?: string }) {
  return <div className="flex min-w-0 items-center gap-1"><Button className="h-auto min-w-0 flex-1 justify-start py-2 text-left sm:h-auto" onClick={onOpen} variant="ghost"><Globe className="size-4" /><span className="min-w-0 flex-1"><span className="block truncate">{entry.title}</span><span className="block truncate text-xs font-normal text-muted-foreground">{entry.url}</span></span></Button>{onRemove && <Tool label={removeLabel || `Remove bookmark ${entry.title}`} onClick={onRemove}><X className="size-4" /></Tool>}</div>;
}
