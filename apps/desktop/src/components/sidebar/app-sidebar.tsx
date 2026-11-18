// shadcn sidebar-08 (base-vega), on COSS primitives.
// Changes: shared Notes/Browser modes, pinned pages and a searchable Library, one sidebar toggle.
import { CalendarDays, CalendarCheck, ChevronRight, FileText, Globe, Library, Mail, Plus, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@leadinglight/ui/components/input-group";
import { Input } from "@leadinglight/ui/components/input";
import { RadioGroup, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { openSettings } from "@/views/settings/open";
import { useMobile } from "~/lib/platform";
import { CloudButton } from "~/components/cloud-settings";
import { useRemoteWork } from "~/lib/mobile-agents";
import { MobileAgentsButton } from "~/components/mobile-agents";
import { UsageButton } from "~/components/usage-button";
import { enter, leave, space } from "~/lib/browser-space";
import { useKeysFor } from "~/lib/keymap";
import { openFrom, openBeside } from "~/lib/panes";
import { CALENDAR_VIEW, MAIL_VIEW, browserView } from "~/lib/space";
import { NavProjects } from "./nav-projects";
import { NavTypes } from "./nav-types";

function Mark({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 512 512">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={46}
        transform="translate(72 72) scale(0.71875)"
      >
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
      <div className="flex h-12 items-center gap-2 px-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Mark className="size-8" />
        </div>
        <div className="grid min-w-0 flex-1 text-sm leading-tight">
          <span className="truncate font-medium">LeadingLight</span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <SidebarTrigger aria-label="Hide sidebar" />
      </div>
    </SidebarHeader>
  );
}

const switchMode = (browser: boolean) => (browser ? enter() : leave());

export function AppSidebar({
  pinned,
  pages,
  types,
  onCreate,
  onToday,
  todayActive,
  browser,
  native,
  loading,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  browser?: ReactNode;
  native: boolean;
  loading: boolean;
  onToday: (e: React.MouseEvent) => void;
  todayActive: boolean;
  pinned: React.ComponentProps<typeof NavProjects>["projects"];
  pages: React.ComponentProps<typeof NavProjects>["projects"];
  types: React.ComponentProps<typeof NavTypes>["types"];
  onCreate: () => void;
}) {
  const { isMobile, state, setOpenMobile } = useSidebar();
  const mobile = useMobile();
  const front = space.use().front && !mobile;
  const remoteWork = useRemoteWork();
  const keys = useKeysFor();
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!sidebar || mobile) return;
    let total = 0,
      last = 0,
      latched = false;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last > 240) {
        total = 0;
        latched = false;
      }
      last = now;
      if (latched) return;
      total += e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(total) >= 64) {
        switchMode(total > 0);
        latched = true;
      }
    };
    sidebar.addEventListener("wheel", wheel, { passive: false });
    return () => sidebar.removeEventListener("wheel", wheel);
  }, [sidebar, mobile]);
  const select =
    (fn: (e: React.MouseEvent) => void, closeLibrary = false) =>
    (e: React.MouseEvent) => {
      fn(e);
      if (closeLibrary) setLibrary(false);
      if (isMobile) setOpenMobile(false);
    };
  const navigable = (items: typeof pages, closeLibrary = false) =>
    items.map((p) => ({
      ...p,
      onSelect: select(p.onSelect, closeLibrary),
      onBeside: () => {
        p.onBeside?.();
        if (closeLibrary) setLibrary(false);
      },
      onDelete: () => {
        setLibrary(false);
        p.onDelete();
      },
      children: p.children.map((c) => ({ ...c, onSelect: select(c.onSelect, closeLibrary) })),
    }));
  const matches = (items: typeof pages, search: string) =>
    items.filter((p) => p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const searching = !!query.trim();
  const results = searching ? matches(pages, query) : pinned;
  return (
    <>
      <Sidebar
        inert={!isMobile && state === "collapsed"}
        aria-hidden={(!isMobile && state === "collapsed") || undefined}
        variant={mobile ? "sidebar" : "inset"}
        {...props}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          ref={setSidebar}
          data-sidebar-modes
          onTouchCancel={() => {
            touch.current = null;
          }}
          onTouchStart={(e) => {
            if (e.touches.length === 1) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            else touch.current = null;
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            if (!start || mobile || !e.changedTouches[0]) return;
            const dx = start.x - e.changedTouches[0].clientX,
              dy = start.y - e.changedTouches[0].clientY;
            if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) switchMode(dx > 0);
          }}
        >
          <AppSidebarHeader subtitle={front ? "Browser" : "Notes"} />
          {front ? (
            native ? (
              browser
            ) : (
              <SidebarContent>
                <SidebarGroup>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton onClick={select(() => openBeside(browserView("")))}>
                        <Globe />
                        <span>Open browser</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                  <p className="px-2 pt-2 text-xs text-muted-foreground">Your browser opens beside your notes.</p>
                </SidebarGroup>
              </SidebarContent>
            )
          ) : (
            <>
              <SidebarContent>
                <SidebarGroup className="gap-2 pb-0 pt-0">
                  <InputGroup className="h-8 **:data-[slot=input]:h-7.5">
                    <InputGroupInput
                      disabled={loading}
                      aria-label="Search notes"
                      placeholder="Search notes…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <InputGroupAddon>
                      <Search className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                  </InputGroup>
                  <Button
                    disabled={loading}
                    aria-label="New page"
                    className="h-8 w-full justify-start"
                    onClick={() => {
                      onCreate();
                      if (isMobile) setOpenMobile(false);
                    }}
                    variant="ghost"
                  >
                    <Plus className="size-4" />
                    New page<span className="ml-auto text-xs text-muted-foreground">{keys("new-page")}</span>
                  </Button>
                  <div className="grid grid-cols-3 gap-1" aria-label="Shortcuts">
                    {[
                      { name: "Today", Icon: CalendarCheck, run: onToday, active: todayActive },
                      { name: "Calendar", Icon: CalendarDays, run: (e: React.MouseEvent) => openFrom(CALENDAR_VIEW, e) },
                      { name: "Mail", Icon: Mail, run: (e: React.MouseEvent) => openFrom(MAIL_VIEW, e) },
                    ].map(({ name, Icon, run, active }) => (
                      <Tooltip key={name}>
                        <TooltipTrigger
                          render={
                            <Button
                              disabled={loading}
                              aria-label={name}
                              aria-current={active ? "page" : undefined}
                              className="h-8 bg-sidebar-accent/60"
                              onClick={select(run)}
                              variant="ghost"
                            />
                          }
                        >
                          <Icon className="size-4" />
                        </TooltipTrigger>
                        <TooltipPopup>{name}</TooltipPopup>
                      </Tooltip>
                    ))}
                  </div>
                </SidebarGroup>
                <nav aria-label={searching ? "Search results" : "Pinned"}>
                  <NavProjects label={searching ? "Results" : "Pinned"} projects={navigable(results)} />
                  {!results.length && (
                    <p className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
                      {searching ? "No pages match this search." : "Pin pages from Library to keep them here."}
                    </p>
                  )}
                </nav>
                <SidebarGroup className="pt-0">
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        disabled={loading}
                        onClick={() => {
                          setLibraryQuery("");
                          setLibrary(true);
                        }}
                      >
                        <Library />
                        <span>Library</span>
                        <ChevronRight className="ml-auto size-4" />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>
            </>
          )}
          <SidebarFooter>
            {!mobile && (
              <Tooltip>
                <TooltipTrigger render={<div />}>
                  <RadioGroup
                    aria-label="Sidebar mode"
                    className="w-full flex-row gap-0.5"
                    value={front ? "browser" : "notes"}
                    onValueChange={(v) => switchMode(v === "browser")}
                    render={<SegmentedControl className="w-full" size="sm" />}
                  >
                    <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root value="notes" />}>
                      <FileText />
                      Notes
                    </SegmentedControlItem>
                    <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root value="browser" />}>
                      <Globe />
                      Browser
                    </SegmentedControlItem>
                  </RadioGroup>
                </TooltipTrigger>
                <TooltipPopup>Swipe across the sidebar or press {keys("browser")}</TooltipPopup>
              </Tooltip>
            )}
            {(mobile || remoteWork) && <MobileAgentsButton />}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={select(() => openSettings())}>
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <CloudButton />
          </SidebarFooter>
          {!mobile && <UsageButton />}
        </div>
      </Sidebar>
      <Dialog open={library} onOpenChange={setLibrary}>
        <DialogPopup className="max-h-[80svh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Library</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              aria-label="Search library"
              className="mt-4"
              placeholder="Find a page…"
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
            />
            <div className="mt-3 flex min-h-0 flex-1 gap-4 overflow-y-auto">
              <nav aria-label="Types" className="w-36 shrink-0">
                <NavTypes types={types.map((t) => ({ ...t, onSelect: select(t.onSelect, true) }))} />
              </nav>
              <nav aria-label="Library" className="min-w-0 flex-1">
                <NavProjects
                  label="All pages"
                  projects={navigable(matches(pages, libraryQuery), true)}
                  onCreate={() => {
                    setLibrary(false);
                    onCreate();
                  }}
                  onNotebook={() => setLibrary(false)}
                />
                {!matches(pages, libraryQuery).length && (
                  <p className="p-2 text-sm text-muted-foreground">No pages match. Try another search.</p>
                )}
              </nav>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
