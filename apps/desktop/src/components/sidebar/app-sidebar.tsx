// shadcn sidebar-08 (base-vega) app-sidebar, on COSS primitives.
// Changes: our name and logo, room for the macOS traffic lights, inert while collapsed (so Tab
// skips it), NavProjects as Pinned (while a page is) and Recent under our Types, and the plans'
// usage as the footer (NavUser's place), and a Browser entry, and a filter field under the header
// (shadcn sidebar-01's search form, as COSS's p-input-group-13 and -22).
// The header is its own export, so Settings' sidebar wears the same one.
import { CalendarDays, Globe, Search, Settings, TextSearch, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@leadinglight/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@leadinglight/ui/components/input-group";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { openSettings } from "@/views/settings/open";
import { useMobile } from "~/lib/platform";
import { CloudButton } from "~/components/cloud-settings";
import { MobileAgentsButton } from "~/components/mobile-agents";
import { Marked } from "~/components/text-search";
import { UsageButton } from "~/components/usage-button";
import { type Hit, narrow, wordsOf } from "~/lib/filter";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { openFrom, openBeside } from "~/lib/panes";
import { CALENDAR_VIEW, browserView, searchView, typeView } from "~/lib/space";
import { type Child, NavProjects, RESULT } from "./nav-projects";
import { NavTypes } from "./nav-types";

// ⌘K (lib/use-shortcuts.ts) asks the sidebar to open and focus its filter field.
export const FILTER = "ll:filter";
// Matching pages listed under a type row; its count says how many there are in all.
const UNDER_TYPE = 5;
const RESULTS = "[data-filter-result]";

// A title with the words bold, or the title and the alias that matched, muted.
const labelOf = (p: ObjectSummary, hit: Hit) =>
  hit.alias ? (
    <>
      {pageLabel(p.title)} <span className="text-muted-foreground"><Marked spans={hit.spans} text={hit.alias} /></span>
    </>
  ) : (
    <Marked spans={hit.spans} text={pageLabel(p.title)} />
  );

// The app mark (a t whose crossbar ends in a dot), placed as in the app icon's tile. Drawn in
// currentColor so the tile's theme colours apply.
function Mark({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 512 512">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={46} transform="translate(72 72) scale(0.71875)">
        <path d="M226,104 V358 A56,56 0 0 0 282,414 H314" />
        <path d="M140,204 H226" />
        <circle cx="300" cy="204" fill="currentColor" r="32" stroke="none" />
      </g>
    </svg>
  );
}

export function AppSidebarHeader({ subtitle }: { subtitle: string }) {
  const mobile = useMobile();
  return (
    <SidebarHeader className="pt-[calc(var(--traffic-top)_+_0.5rem)]" data-tauri-drag-region={!mobile || undefined}>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton render={<a href="#" />} size="lg">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Mark className="size-8" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">LeadingLight</span>
              <span className="truncate text-xs">{subtitle}</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}

export function AppSidebar({
  pinned,
  pages,
  types,
  all,
  pageRow,
  onCreate,
  onToday,
  todayActive,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onToday: (e: React.MouseEvent) => void;
  todayActive: boolean;
  pinned: React.ComponentProps<typeof NavProjects>["projects"];
  pages: React.ComponentProps<typeof NavProjects>["projects"];
  types: React.ComponentProps<typeof NavTypes>["types"];
  // Every page, and a sub-row for one, for the types' matches.
  all: ObjectSummary[];
  pageRow: (p: ObjectSummary) => Child;
  onCreate: () => void;
}) {
  const { isMobile, state, setOpen, setOpenMobile } = useSidebar();
  const mobile = useMobile();
  const select = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    fn(e);
    if (isMobile) setOpenMobile(false);
  };
  const navigable = (items: typeof pages) => items.map((p) => ({ ...p, onSelect: select(p.onSelect), children: p.children.map((c) => ({ ...c, onSelect: select(c.onSelect) })) }));

  const [query, setQuery] = useState("");
  const words = wordsOf(query);
  const filtering = words.length > 0;
  const field = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Where the keyboard was before the field, for Escape to give it back.
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const focus = () => {
      if (isMobile) setOpenMobile(true);
      else flushSync(() => setOpen(true));
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener(FILTER, focus);
    return () => window.removeEventListener(FILTER, focus);
  }, [isMobile, setOpen, setOpenMobile]);
  // The lists come back scrolled where they were, kept before results replace them; results start at the top.
  const viewport = () => content.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
  const scroll = useRef(0);
  const type = (value: string) => {
    if (!filtering) scroll.current = viewport()?.scrollTop ?? 0;
    setQuery(value);
  };
  useLayoutEffect(() => {
    const v = viewport();
    if (v) v.scrollTop = filtering ? 0 : scroll.current;
  }, [filtering]);

  // Results aren't marked open, so the one highlighted row is the one the keys are on.
  const byId = new Map(filtering ? all.map((p) => [p.id, p]) : []);
  const narrowed = (rows: typeof pages) =>
    narrow(rows, (r) => byId.get(r.id), words).map(({ item, hit }) => ({ ...item, label: labelOf(byId.get(item.id)!, hit), result: item.id, isActive: false, open: false }));
  const shownPinned = filtering ? narrowed(pinned) : pinned;
  const shownPages = filtering ? narrowed(pages) : pages;
  const latest = filtering ? all.filter((p) => !p.properties.templateOf).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const shownTypes = !filtering
    ? types
    : types.flatMap((t) => {
        const hits = narrow(latest, (p) => (p.typeId === t.id ? p : undefined), words);
        const pages = hits.slice(0, UNDER_TYPE).map(({ item, hit }) => ({ ...pageRow(item), label: labelOf(item, hit), result: item.id, isActive: false }));
        return hits.length ? [{ ...t, found: { count: hits.length, pages, view: typeView(t.id) } }] : [];
      });
  const none = filtering && !shownPinned.length && !shownPages.length && !shownTypes.length;
  const phrase = query.trim().replace(/\s+/g, " ");

  const open = (view: string, e: { shiftKey: boolean; metaKey: boolean }) => {
    openFrom(view, e);
    if (isMobile) setOpenMobile(false);
  };
  const clear = (refocus: boolean) => {
    setQuery("");
    const to = back.current;
    if (refocus) field.current?.focus();
    else if (to?.isConnected) to.focus();
    else field.current?.blur();
  };
  const results = () => [...(content.current?.querySelectorAll<HTMLElement>(RESULTS) ?? [])];
  // ↑↓ walk every result, Enter opens one (⇧ beside, ⌘ in a new tab), Escape goes back to the field.
  const onResultKey = (e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(RESULTS);
    if (!row) return;
    const rows = results();
    const at = rows.indexOf(row);
    if (e.key === "ArrowDown") rows[at + 1]?.focus();
    else if (e.key === "ArrowUp") (rows[at - 1] ?? field.current)?.focus();
    else if (e.key === "Escape") field.current?.focus();
    else if (e.key === "Enter") open(row.dataset.filterResult!, e);
    else return;
    e.preventDefault();
  };
  const onFieldKey = (e: React.KeyboardEvent) => {
    const first = results()[0];
    if (e.key === "ArrowDown") first?.focus();
    else if (e.key === "Enter" && first) open(first.dataset.filterResult!, e);
    else if (e.key === "Escape") clear(false);
    else return;
    e.preventDefault();
  };

  return (
    <Sidebar inert={!isMobile && state === "collapsed"} variant="inset" {...props}>
      <AppSidebarHeader subtitle="Notes" />
      <SidebarGroup className="py-0">
        <InputGroup>
          <InputGroupInput
            aria-label="Filter pages"
            autoComplete="off"
            // Its text starts where the rows' titles do.
            className="*:[input]:ps-2.5!"
            onChange={(e) => type(e.target.value)}
            onFocus={(e) => {
              const from = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
              if (!from?.closest(`${RESULTS}, [data-slot=input-group]`)) back.current = from;
            }}
            onKeyDown={onFieldKey}
            placeholder="Filter pages"
            ref={field}
            size="sm"
            spellCheck={false}
            type="search"
            value={query}
          />
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          {query && (
            <InputGroupAddon align="inline-end">
              <Button aria-label="Clear filter" onClick={() => clear(true)} size="icon-xs" variant="ghost">
                <X aria-hidden="true" />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </SidebarGroup>
      <SidebarContent onKeyDown={onResultKey} ref={content}>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton aria-current={todayActive ? "page" : undefined} isActive={todayActive} onClick={select(onToday)}>
                <CalendarDays />
                <span>Today</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton onClick={select((e) => openFrom(CALENDAR_VIEW, e))}><CalendarDays /><span>Calendar</span></SidebarMenuButton></SidebarMenuItem>
            {!mobile && <SidebarMenuItem>
              <SidebarMenuButton onClick={select(() => openBeside(browserView("")))}>
                <Globe className="size-4" />
                <span>Browser</span>
              </SidebarMenuButton>
            </SidebarMenuItem>}
          </SidebarMenu>
        </SidebarGroup>
        {shownTypes.length > 0 && (
          <nav aria-label="Types">
            <NavTypes types={shownTypes.map((t) => ({ ...t, onSelect: select(t.onSelect), found: t.found && { ...t.found, pages: t.found.pages.map((c) => ({ ...c, onSelect: select(c.onSelect) })) } }))} />
          </nav>
        )}
        {shownPinned.length > 0 && (
          <nav aria-label="Pinned">
            <NavProjects label="Pinned" projects={navigable(shownPinned)} />
          </nav>
        )}
        {(!filtering || shownPages.length > 0) && (
          <nav aria-label="Recent">
            <NavProjects label="Recent" onCreate={() => { onCreate(); if (isMobile) setOpenMobile(false); }} projects={navigable(shownPages)} sortable />
          </nav>
        )}
        {filtering && (
          <SidebarGroup>
            {none && <p className="px-2 py-1.5 text-sm">No page named that.</p>}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton className={RESULT} data-filter-result={searchView(phrase)} onClick={(e) => open(searchView(phrase), e)}>
                  <TextSearch />
                  <span>Search in page text for “{phrase}”</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <CloudButton />
      <SidebarFooter>
        {mobile && <MobileAgentsButton />}
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={select(() => openSettings())}><Settings /><span>Settings</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
      {!mobile && <UsageButton />}
    </Sidebar>
  );
}
