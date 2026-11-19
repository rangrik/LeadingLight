import { cn } from "@leadinglight/ui/lib/utils";
// shadcn sidebar-08 (base-vega), on COSS primitives.
// Changes: shared Notes/Browser modes, pinned pages and shared search, one sidebar toggle.
import { CalendarDays, CalendarCheck, ChevronDown, FileText, Globe, Mail, Plus, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@leadinglight/ui/components/button";
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
import { CloudIconButton } from "~/components/cloud-settings";
import { MobileAgentsButton } from "~/components/mobile-agents";
import { UsageButton } from "~/components/usage-button";
import { enter, leave, space } from "~/lib/browser-space";
import { useKeysFor } from "~/lib/keymap";
import { openFrom, openBeside } from "~/lib/panes";
import { CALENDAR_VIEW, MAIL_VIEW, browserView } from "~/lib/space";
import { NavProjects } from "./nav-projects";
import { openSearch, workspaceSearch } from "~/lib/workspace-search";

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
  onCreate: () => void;
}) {
  const { isMobile, state, setOpenMobile } = useSidebar();
  const mobile = useMobile();
  const front = space.use().front && !mobile;
  const keys = useKeysFor();
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  useEffect(() => isMobile ? workspaceSearch.subscribe(() => { if (workspaceSearch.get()) setOpenMobile(false); }) : undefined, [isMobile, setOpenMobile]);
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
  const select = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    fn(e);
    if (isMobile) setOpenMobile(false);
  };
  const navigable = pinned.map((p) => ({
    ...p,
    onSelect: select(p.onSelect),
    children: p.children.map((c) => ({ ...c, onSelect: select(c.onSelect) })),
  }));
  const search = (create = false) => {
    if (isMobile) setOpenMobile(false);
    openSearch(create ? "create" : "search");
  };
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
          <SidebarGroup className="pt-0 pb-1">
            <Button aria-label="Search library" disabled={loading} variant="outline" className={cn("h-8 w-full justify-start", mobile && "min-h-11")} onClick={() => search()}>
              <Search className="size-4" />
              Search library<span className="ml-auto text-xs text-muted-foreground">{keys("search")}</span>
            </Button>
          </SidebarGroup>
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
                  <div className="flex items-center gap-1">
                  <Button
                    disabled={loading}
                    aria-label="New page"
                    className="h-8 min-w-0 flex-1 justify-start"
                    onClick={() => {
                      onCreate();
                      if (isMobile) setOpenMobile(false);
                    }}
                    variant="ghost"
                  >
                    <Plus className="size-4" />
                    New page<span className="ml-auto text-xs text-muted-foreground">{keys("new-page")}</span>
                  </Button>
                  <Tooltip>
                    <TooltipTrigger render={<Button disabled={loading} aria-label="Choose page type" size="icon-sm" variant="ghost" onClick={() => search(true)} />}>
                      <ChevronDown className="size-4" />
                    </TooltipTrigger>
                    <TooltipPopup>Create any type of page</TooltipPopup>
                  </Tooltip>
                  </div>
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
                <nav aria-label="Pinned">
                  <NavProjects label="Pinned" projects={navigable} />
                  {!pinned.length && <p className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">Pin pages from Search library to keep them here.</p>}
                </nav>
              </SidebarContent>
            </>
          )}
          <SidebarFooter>
            {!mobile && <UsageButton />}
            <div className="flex items-center gap-0.5 pe-0.5 pointer-coarse:gap-4">
              {!mobile && (
                <RadioGroup
                  aria-label="Sidebar mode"
                  className="me-1 flex-row gap-0.5"
                  value={front ? "browser" : "notes"}
                  onValueChange={(v) => switchMode(v === "browser")}
                  render={<SegmentedControl size="sm" />}
                >
                  {([["notes", "Notes", FileText], ["browser", "Browser", Globe]] as const).map(([value, name, Icon]) => (
                    <Tooltip key={value}>
                      <SegmentedControlItem aria-label={name} className="h-6 w-7 px-0 sm:h-6" render={<TooltipTrigger render={<RadioPrimitive.Root value={value} />} />}>
                        <Icon />
                      </SegmentedControlItem>
                      <TooltipPopup>{name} · {keys("browser")}</TooltipPopup>
                    </Tooltip>
                  ))}
                </RadioGroup>
              )}
              <MobileAgentsButton icon onOpen={isMobile ? () => setOpenMobile(false) : undefined} />
              <span className="flex-1" />
              <CloudIconButton />
              <Tooltip>
                <TooltipTrigger render={<Button aria-label="Settings" size="icon-sm" variant="ghost" onClick={select(() => openSettings())} />}>
                  <Settings />
                </TooltipTrigger>
                <TooltipPopup>Settings · {keys("settings")}</TooltipPopup>
              </Tooltip>
            </div>
          </SidebarFooter>
        </div>
      </Sidebar>
    </>
  );
}
