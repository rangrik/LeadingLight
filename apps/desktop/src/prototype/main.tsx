import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Columns2, FileText, Globe, HelpCircle, Library, Mail, MoreHorizontal, PanelLeft, Pin, PinOff, Plus, Search, Settings, X } from "lucide-react";
import { BlockEditor, type EditorDoc } from "@leadinglight/editor/editor";
import { type AssetStore } from "@leadinglight/editor/assets";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Input } from "@leadinglight/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { RadioGroup, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { Separator } from "@leadinglight/ui/components/separator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@leadinglight/ui/components/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { currentURL, openItem, restore, seed, siteFor, sites, STORAGE, types, type Item, type Mode } from "./data";
import "../styles.css";
import "./prototype.css";

const assets: AssetStore = {
  async put(file) { return { url: URL.createObjectURL(file), name: file.name, size: file.size, mime: file.type }; },
  open(asset) { window.open(asset.url, "_blank", "noopener"); },
};
const iconFor = (item: Item) => item.kind === "browser" ? <Globe /> : item.type === "Collections" ? <BookOpen /> : <FileText />;

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tooltip><TooltipTrigger render={children} /><TooltipPopup>{label}</TooltipPopup></Tooltip>;
}

function Prototype() {
  const [demo, setDemo] = useState(restore);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"library" | "tab" | "help" | null>(null);
  const [filter, setFilter] = useState("All");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [address, setAddress] = useState("");
  const sidebar = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const state = useRef(demo);
  state.current = demo;
  const { toggleSidebar, isMobile, openMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    const save = () => { try { localStorage.setItem(STORAGE, JSON.stringify(state.current)); } catch { /* The demo still works when browser storage is full. */ } };
    const timer = window.setTimeout(save, 250);
    window.addEventListener("pagehide", save);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); save(); };
  }, [demo]);

  const switchMode = (mode: Mode) => { setQuery(""); setDemo((s) => ({ ...s, mode })); };
  const open = (id: string, beside = false) => {
    setDemo((s) => openItem(s, id, beside));
    if (isMobile) setOpenMobile(false);
  };
  const patch = (id: string, value: Partial<Item>) => setDemo((s) => ({ ...s, items: s.items.map((i) => i.id === id ? { ...i, ...value } : i) }));
  const newNote = () => {
    const id = crypto.randomUUID();
    setDemo((s) => openItem({ ...s, mode: "notes", items: [...s.items, { id, kind: "note", title: "Untitled", type: "Pages", doc: { type: "doc", content: [{ type: "paragraph" }] } }] }, id));
    if (isMobile) setOpenMobile(false);
  };
  const newTab = (url: string) => {
    if (!url.trim()) return;
    const site = siteFor(url.trim());
    const id = crypto.randomUUID();
    setDemo((s) => openItem({ ...s, mode: "browser", items: [...s.items, { id, kind: "browser", title: site?.title ?? url.trim(), history: [site?.id ?? url.trim()], at: 0 }] }, id));
    setDialog(null); setAddress("");
  };
  const navigate = (id: string, url: string) => {
    if (!url.trim()) return;
    setDemo((s) => ({ ...s, items: s.items.map((item) => {
      if (item.id !== id) return item;
      const site = siteFor(url.trim());
      const history = [...(item.history ?? []).slice(0, (item.at ?? 0) + 1), site?.id ?? url.trim()];
      return { ...item, history, at: history.length - 1, title: site?.title ?? url.trim() };
    }) }));
  };
  const travel = (item: Item, step: number) => {
    const at = Math.max(0, Math.min((item.history?.length ?? 1) - 1, (item.at ?? 0) + step));
    patch(item.id, { at, title: siteFor(item.history?.[at] ?? "")?.title ?? item.history?.[at] ?? "New tab" });
  };
  const closeTab = (id: string) => setDemo((s) => {
    const items = s.items.filter((i) => i.id !== id);
    const next = items.find((i) => i.kind === "browser" && i.id !== "new-tab")?.id ?? "new-tab";
    return { ...s, items, panes: s.panes.map((p) => p.item === id ? { ...p, item: next } : p) };
  });
  const split = (item: Item) => {
    const partner = demo.items.find((i) => i.kind === (item.kind === "browser" ? "note" : "browser") && i.id !== "new-tab");
    if (partner) open(partner.id, true); else setDialog("tab");
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyB") { e.preventDefault(); switchMode(state.current.mode === "notes" ? "browser" : "notes"); }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "Backslash") { e.preventDefault(); toggleSidebar(); }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyN") { e.preventDefault(); newNote(); }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyT") { e.preventDefault(); setDialog("tab"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  useEffect(() => {
    const el = sidebar.current;
    if (!el) return;
    let total = 0, last = 0, latched = false;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last > 240) { total = 0; latched = false; }
      last = now;
      if (latched) return;
      total += e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(total) >= 64) { switchMode(total > 0 ? "browser" : "notes"); latched = true; }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [isMobile, openMobile]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const selected = new Set(demo.panes.map((p) => p.item));
  const list = demo.items.filter((i) => demo.mode === "notes" ? i.kind === "note" && (query || i.pinned) : i.kind === "browser" && i.id !== "new-tab").filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));

  function row(item: Item, inLibrary = false) {
    return <SidebarMenuItem key={item.id}>
      <SidebarMenuButton isActive={selected.has(item.id)} aria-current={selected.has(item.id) ? "page" : undefined} onClick={(e) => { open(item.id, e.shiftKey); if (inLibrary) setDialog(null); }}>
        {iconFor(item)}<span className="min-w-0 flex-1">{item.title || "Untitled"}</span>
      </SidebarMenuButton>
      <Menu><MenuTrigger render={<SidebarMenuAction aria-label={`Actions for ${item.title}`} showOnHover />}><MoreHorizontal /></MenuTrigger>
        <MenuPopup side="right" align="start">
          <MenuItem onClick={() => { open(item.id, true); setDialog(null); }}><Columns2 />Open beside</MenuItem>
          {item.kind === "note" && <MenuItem onClick={() => patch(item.id, { pinned: !item.pinned })}>{item.pinned ? <PinOff /> : <Pin />}{item.pinned ? "Unpin" : "Pin"}</MenuItem>}
          {item.kind === "browser" && <MenuItem onClick={() => closeTab(item.id)}><X />Close tab</MenuItem>}
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>;
  }

  return <>
    <Sidebar variant="inset" className="demo-sidebar" aria-label="Shared sidebar">
      <div ref={sidebar} data-testid="sidebar-gesture" className="flex h-full min-h-0 flex-col" onTouchStart={(e) => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }} onTouchEnd={(e) => {
        if (!touch.current || !e.changedTouches[0]) return;
        const dx = touch.current.x - e.changedTouches[0].clientX, dy = touch.current.y - e.changedTouches[0].clientY;
        touch.current = null;
        if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) switchMode(dx > 0 ? "browser" : "notes");
      }}>
        <SidebarHeader className="gap-5 px-3 pt-5 pb-3">
          <div className="flex h-8 items-center gap-2.5 px-1"><img src="/icon.svg" className="size-7 rounded-lg" alt="" /><span className="flex-1 font-medium">LeadingLight</span><Tip label="Hide sidebar · ⌘\\"><Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label="Hide sidebar"><PanelLeft /></Button></Tip></div>
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 z-10 size-4 text-muted-foreground" /><Input aria-label={demo.mode === "notes" ? "Search notes" : "Search tabs"} placeholder={demo.mode === "notes" ? "Search notes" : "Search tabs"} value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 bg-sidebar-accent/50 pl-9 shadow-none" /></div>
          <div className="grid grid-cols-4 gap-1.5" aria-label={demo.mode === "notes" ? "Shortcuts" : "Pinned websites"}>
            {demo.mode === "notes" ? [["Today", CalendarDays, () => open("today-note")], ["Calendar", CalendarDays, () => open("calendar")], ["Mail", Mail, () => open("mail")], ["Browser", Globe, () => switchMode("browser")]].map(([label, Icon, click]) => {
              const Glyph = Icon as typeof Globe;
              return <Button key={String(label)} className="demo-dock" variant="secondary" onClick={click as () => void}><Glyph /><span>{String(label)}</span></Button>;
            }) : sites.map((site, i) => <Tip key={site.id} label={site.title}><Button className="demo-dock" variant="secondary" onClick={() => {
              const existing = demo.items.find((item) => item.kind === "browser" && currentURL(item) === site.id);
              if (existing) open(existing.id); else newTab(site.id);
            }}><Globe /><span>{["Kyoto", "Rail", "Stays", "Reading"][i]}</span></Button></Tip>)}
          </div>
          <Button variant="outline" className="mt-1 justify-start bg-transparent shadow-none" onClick={demo.mode === "notes" ? newNote : () => setDialog("tab")}><Plus /><span className="flex-1 text-left">{demo.mode === "notes" ? "New page" : "New tab"}</span><span className="text-xs text-muted-foreground">{demo.mode === "notes" ? "⌘N" : "⌘T"}</span></Button>
        </SidebarHeader>
        <SidebarContent className="gap-1">
          <SidebarGroup className="px-3" key={demo.mode} data-mode={demo.mode}>
            <SidebarGroupLabel>{query ? "Results" : demo.mode === "notes" ? "Pinned" : "Tabs"}</SidebarGroupLabel>
            <SidebarMenu aria-label={demo.mode === "notes" ? "Notes" : "Browser tabs"}>{list.map((i) => row(i))}</SidebarMenu>
            {!list.length && <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">{query ? "Nothing matches this search." : demo.mode === "notes" ? "Pin a page from Library to keep it here." : "Open a new tab to start browsing."}</p>}
          </SidebarGroup>
          {demo.mode === "notes" && <SidebarGroup className="px-3"><Separator className="mb-3" /><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={() => { setFilter("All"); setLibraryQuery(""); setDialog("library"); }}><Library /><span className="flex-1">Library</span><ChevronRight className="size-3.5" /></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>}
        </SidebarContent>
        <SidebarFooter className="gap-3 px-3 pb-3">
          <div className="px-1"><RadioGroup aria-label="Sidebar mode" className="w-full flex-row gap-0.5" value={demo.mode} onValueChange={(v) => switchMode(v as Mode)} render={<SegmentedControl className="w-full" size="sm" />}>
            <RadioPrimitive.Root value="notes" render={<SegmentedControlItem className="flex-1" />}><FileText />Notes</RadioPrimitive.Root>
            <RadioPrimitive.Root value="browser" render={<SegmentedControlItem className="flex-1" />}><Globe />Browser</RadioPrimitive.Root>
          </RadioGroup><p className="mt-2 text-center text-[11px] text-muted-foreground">Swipe sideways · ⌥⌘B</p></div>
          <SidebarMenu><SidebarMenuItem><Menu><MenuTrigger render={<SidebarMenuButton />}><Settings /><span className="flex-1">Settings & account</span><MoreHorizontal /></MenuTrigger><MenuPopup side="top" align="start">
            <MenuItem onClick={() => setDialog("help")}><HelpCircle />How to try this prototype</MenuItem>
            <MenuSeparator /><MenuItem onClick={() => { setDemo(seed()); setQuery(""); }}><ArrowLeft />Reset sample workspace</MenuItem>
          </MenuPopup></Menu></SidebarMenuItem></SidebarMenu>
          <Button variant="ghost" size="xs" className="self-start text-muted-foreground" onClick={() => setDialog("help")}><HelpCircle />Prototype · sample data</Button>
        </SidebarFooter>
      </div>
    </Sidebar>
    <div className="demo-workspace" ref={area} data-split={demo.panes.length === 2} style={{ "--split": `${demo.ratio}%` } as React.CSSProperties}>
      {demo.panes.map((pane, index) => {
        const item = demo.items.find((i) => i.id === pane.item)!;
        return <React.Fragment key={pane.id}>
          {index > 0 && <Separator orientation="vertical" role="separator" tabIndex={0} aria-label="Resize panes" aria-valuemin={30} aria-valuemax={70} aria-valuenow={demo.ratio} className="demo-divider" onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
            e.preventDefault(); setDemo((s) => ({ ...s, ratio: e.key === "Home" ? 50 : Math.max(30, Math.min(70, s.ratio + (e.key === "ArrowRight" ? 2 : -2))) }));
          }} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const box = area.current?.getBoundingClientRect();
            if (box) setDemo((s) => ({ ...s, ratio: Math.max(30, Math.min(70, (e.clientX - box.left) / box.width * 100)) }));
          }} onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />}
          <SidebarInset data-testid={`pane-${pane.id}`} className="demo-pane" data-focused={demo.focus === pane.id} onPointerDownCapture={() => setDemo((s) => s.focus === pane.id ? s : { ...s, focus: pane.id })} onFocusCapture={() => setDemo((s) => s.focus === pane.id ? s : { ...s, focus: pane.id })}>
            <header className="demo-pane-header">
              <SidebarTrigger className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.kind === "browser" ? "Browser" : item.type ?? item.title}<ChevronRight className="mx-1 inline size-3" /><span className="text-foreground">{item.title || "Untitled"}</span></span>
              {item.kind === "note" && <Tip label={item.pinned ? "Unpin page" : "Pin page"}><Button aria-label={item.pinned ? "Unpin page" : "Pin page"} variant="ghost" size="icon-sm" onClick={() => patch(item.id, { pinned: !item.pinned })}>{item.pinned ? <PinOff /> : <Pin />}</Button></Tip>}
              {demo.panes.length === 1 ? <Tip label={item.kind === "browser" ? "Open a note beside this tab" : "Open browser beside this note"}><Button aria-label="Open split view" variant="ghost" size="icon-sm" onClick={() => split(item)}><Columns2 /></Button></Tip> : <Tip label="Close this pane"><Button aria-label={`Close ${index === 0 ? "left" : "right"} pane`} variant="ghost" size="icon-sm" onClick={() => setDemo((s) => ({ ...s, panes: s.panes.filter((p) => p.id !== pane.id), focus: s.panes.find((p) => p.id !== pane.id)!.id }))}><X /></Button></Tip>}
            </header>
            {item.kind === "note" ? <div className="demo-page-scroll"><div className="demo-note">
              <Input unstyled aria-label="Page title" className="demo-title" value={item.title} onChange={(e) => patch(item.id, { title: e.target.value })} />
              <div className="mb-8 flex items-center gap-2 text-xs text-muted-foreground"><FileText className="size-3.5" />{item.type === "Pages" ? "Page" : item.type}<span className="ml-auto inline-flex items-center gap-1"><Check className="size-3" />Saved in demo</span></div>
              <BlockEditor key={item.id} content={item.doc ?? null} assets={assets} onChange={(read: () => EditorDoc) => patch(item.id, { doc: read() })} openLink={(url) => newTab(url)} />
            </div></div> : item.kind === "browser" ? <BrowserContent key={item.id} item={item} onNavigate={(url) => navigate(item.id, url)} onBack={() => travel(item, -1)} onForward={() => travel(item, 1)} onNew={() => setDialog("tab")} /> : <UtilityContent item={item} onOpen={() => open("meeting-note", true)} />}
          </SidebarInset>
        </React.Fragment>;
      })}
    </div>
    <Dialog open={dialog !== null} onOpenChange={(v) => { if (!v) setDialog(null); }}><DialogPopup className={dialog === "library" ? "max-w-2xl" : ""}>
      <DialogHeader><DialogTitle>{dialog === "library" ? "Library" : dialog === "tab" ? "New tab" : "Try the shared sidebar"}</DialogTitle><DialogDescription>{dialog === "library" ? "All your sample notes, organized by type." : dialog === "tab" ? "Choose a sample site, or try an address." : "An isolated workspace with editable notes and simulated websites."}</DialogDescription></DialogHeader>
      <div className="max-h-[65vh] overflow-y-auto px-6 pb-6">
        {dialog === "library" && <><Input aria-label="Search library" placeholder="Find a note…" value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} /><div className="my-4 flex flex-wrap gap-1">{["All", ...types].map((t) => <Button key={t} size="xs" variant={filter === t ? "secondary" : "ghost"} aria-pressed={filter === t} onClick={() => setFilter(t)}>{t}</Button>)}</div><SidebarMenu aria-label="Library notes">{demo.items.filter((i) => i.kind === "note" && (filter === "All" || i.type === filter) && i.title.toLowerCase().includes(libraryQuery.toLowerCase())).map((i) => row(i, true))}</SidebarMenu>{!demo.items.some((i) => i.kind === "note" && (filter === "All" || i.type === filter) && i.title.toLowerCase().includes(libraryQuery.toLowerCase())) && <p className="py-6 text-sm text-muted-foreground">No notes match. Try another type or search.</p>}</>}
        {dialog === "tab" && <><form onSubmit={(e) => { e.preventDefault(); newTab(address); }} className="mb-5 flex gap-2"><Input autoFocus aria-label="New tab address" placeholder="Search or enter address" value={address} onChange={(e) => setAddress(e.target.value)} /><Button type="submit" disabled={!address.trim()}>Open</Button></form><div className="flex flex-col gap-1">{sites.map((site) => <Button key={site.id} variant="ghost" className="h-auto justify-start py-3 text-left" onClick={() => newTab(site.id)}><Globe /><span><span className="block">{site.title}</span><span className="block text-xs font-normal text-muted-foreground">{site.host}</span></span></Button>)}</div></>}
        {dialog === "help" && <div className="space-y-5 text-sm leading-relaxed"><p>Swipe horizontally over the sidebar, press <strong>⌥⌘B</strong>, or use the Notes / Browser controls at its foot. Switching mode leaves your open panes in place.</p><p><strong>Shift-click a note or tab</strong> to open it beside the current page. Its menu also offers Open beside. In a split, ordinary clicks change the pane of the same kind.</p><p>Write in the note, follow sample website links, resize the divider, and close either pane. <strong>⌘N</strong> creates a page; <strong>⌘T</strong> creates a tab; <strong>⌘\</strong> toggles the sidebar.</p><p className="text-muted-foreground">Sample notes are saved only for this prototype in this browser. Websites, Calendar, and Mail are fictional local content. Account connections, native webviews, and sync are not part of this prototype. Reset sample workspace restores the starting examples.</p></div>}
      </div>
    </DialogPopup></Dialog>
    <span role="status" className="sr-only">{demo.mode === "notes" ? "Notes" : "Browser"} sidebar. {demo.panes.length === 2 ? "Split view" : "Single pane"}.</span>
  </>;
}

function BrowserContent({ item, onNavigate, onBack, onForward, onNew }: { item: Item; onNavigate: (url: string) => void; onBack: () => void; onForward: () => void; onNew: () => void }) {
  const url = currentURL(item), site = siteFor(url);
  const [draft, setDraft] = useState(site ? `https://${site.host}` : url);
  useEffect(() => setDraft(site ? `https://${site.host}` : url), [url, site]);
  return <><form className="demo-address" onSubmit={(e) => { e.preventDefault(); onNavigate(draft); }}>
    <Tip label="Back"><Button variant="ghost" size="icon-sm" aria-label="Back" disabled={!item.at} onClick={onBack}><ArrowLeft /></Button></Tip>
    <Tip label="Forward"><Button variant="ghost" size="icon-sm" aria-label="Forward" disabled={(item.at ?? 0) >= (item.history?.length ?? 0) - 1} onClick={onForward}><ArrowRight /></Button></Tip>
    <Input aria-label="Website address" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 min-w-0 flex-1 text-xs" placeholder="Enter a sample address" /><Button aria-label="Go to address" type="submit" size="icon-sm" variant="ghost"><ArrowRight /></Button>
  </form><div className="demo-page-scroll"><article className="demo-article">
    {site ? <><p className="mb-10 text-[10px] font-medium tracking-[0.14em] text-muted-foreground">{site.section}</p><h1>{site.heading}</h1><p className="demo-intro">{site.intro}</p><Separator className="my-8" />{site.parts.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}<Button variant="link" className="mt-4 px-0" onClick={() => onNavigate(site.next)}>{site.nextLabel}<ArrowRight /></Button><p className="mt-12 text-xs text-muted-foreground">Sample website · local preview</p></> : <><Globe className="mb-5 size-8 text-muted-foreground" /><h1>{url ? "A sample browser" : "A fresh tab"}</h1><p className="demo-intro">{url ? "This prototype only opens the sample websites below. The address you entered has not been contacted." : "Open a sample website to try browsing beside your notes."}</p><Button variant="outline" onClick={onNew}>Choose a sample site</Button></>}
  </article></div></>;
}

function UtilityContent({ item, onOpen }: { item: Item; onOpen: () => void }) {
  return <div className="demo-page-scroll"><article className="demo-article"><p className="mb-8 text-xs text-muted-foreground">Monday, November 16, 2026 · sample data</p><h1>{item.kind === "calendar" ? "Today’s schedule" : "A note from Maya"}</h1>{item.kind === "calendar" ? <><h2>10:00 · Design catch-up</h2><p>Review the shared sidebar and try a research session with notes and the browser side by side.</p><h2>15:30 · Reading time</h2><p>A quiet half hour, with notifications off.</p></> : <><p className="demo-intro">The sidebar is ready to try</p><p>I added a few travel pages for the Kyoto plan. Try keeping the guide beside your notes, then switch to a different tab. Your writing should stay right where you left it.</p><p>See you at the design catch-up,<br />Maya</p></>}<Button className="mt-6" variant="outline" onClick={onOpen}><Columns2 />Open meeting note beside</Button></article></div>;
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", media.matches);
applyTheme(); media.addEventListener("change", applyTheme);
createRoot(document.getElementById("root")!).render(<React.StrictMode><TooltipProvider><SidebarProvider className="demo-shell isolate" style={{ "--sidebar-width": "272px" } as React.CSSProperties}><Prototype /></SidebarProvider></TooltipProvider></React.StrictMode>);
