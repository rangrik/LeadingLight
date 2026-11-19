// shadcn sidebar-08 (base-vega), on COSS primitives.
// Changes: pinned pages and sites, browser tabs and shared search in one list, one sidebar toggle.
import { CalendarDays, CalendarCheck, ChevronDown, Globe, Mail, Plus, Search, Settings } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
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
import { BrowserSidebar, PinnedSites } from "~/components/browser-sidebar";
import { available, space } from "~/lib/browser-space";
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

export function AppSidebar({
  pinned,
  onCreate,
  onToday,
  todayActive,
  loading,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  loading: boolean;
  onToday: (e: React.MouseEvent) => void;
  todayActive: boolean;
  pinned: React.ComponentProps<typeof NavProjects>["projects"];
  onCreate: () => void;
}) {
  const { isMobile, state, setOpenMobile } = useSidebar();
  const mobile = useMobile();
  const native = available.use();
  const keys = useKeysFor();
  const sites = space.use().pinned.length > 0 && native && !mobile;
  useEffect(() => isMobile ? workspaceSearch.subscribe(() => { if (workspaceSearch.get()) setOpenMobile(false); }) : undefined, [isMobile, setOpenMobile]);
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
    <Sidebar
      inert={!isMobile && state === "collapsed"}
      aria-hidden={(!isMobile && state === "collapsed") || undefined}
      variant={mobile ? "sidebar" : "inset"}
      {...props}
    >
      <AppSidebarHeader subtitle="Notes" />
      <SidebarGroup className="pt-0 pb-1">
        <Button aria-label="Search library" disabled={loading} variant="outline" className="h-8 w-full justify-start" onClick={() => search()}>
          <Search className="size-4" />
          Search library<span className="ml-auto text-xs text-muted-foreground">{keys("search")}</span>
        </Button>
      </SidebarGroup>
      <SidebarGroup className="gap-2 pt-0">
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
      <SidebarContent>
        <nav aria-label="Pinned">
          <NavProjects before={native && !mobile && <PinnedSites />} label="Pinned" projects={navigable} />
          {!pinned.length && !sites && <p className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">Pin pages from Search library to keep them here.</p>}
        </nav>
        {!mobile && (native ? <BrowserSidebar /> : (
          <SidebarGroup>
            <SidebarGroupLabel>Browser</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={select(() => openBeside(browserView("")))}>
                  <Globe />
                  <span>Open browser</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        {!mobile && <UsageButton />}
        <div className="flex items-center gap-0.5 pe-0.5 pointer-coarse:gap-4">
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
    </Sidebar>
  );
}
