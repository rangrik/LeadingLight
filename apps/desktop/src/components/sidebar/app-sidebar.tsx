// shadcn sidebar-08 (base-vega) app-sidebar, on COSS primitives.
// Changes: our name and logo, room for the macOS traffic lights, inert while collapsed (so Tab
// skips it), NavProjects as Pinned (while a page is) and Recent under our Types, and the plans'
// usage as the footer (NavUser's place), and a Browser entry.
// The header is its own export, so Settings' sidebar wears the same one.
import { CalendarDays, Globe, Settings } from "lucide-react";
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
import { UsageButton } from "~/components/usage-button";
import { openBeside } from "~/lib/panes";
import { browserView } from "~/lib/space";
import { NavProjects } from "./nav-projects";
import { NavTypes } from "./nav-types";

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
  onCreate: () => void;
}) {
  const { isMobile, state, setOpenMobile } = useSidebar();
  const mobile = useMobile();
  const select = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    fn(e);
    if (isMobile) setOpenMobile(false);
  };
  const navigable = (items: typeof pages) => items.map((p) => ({ ...p, onSelect: select(p.onSelect), children: p.children.map((c) => ({ ...c, onSelect: select(c.onSelect) })) }));
  return (
    <Sidebar inert={!isMobile && state === "collapsed"} variant="inset" {...props}>
      <AppSidebarHeader subtitle="Notes" />
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton aria-current={todayActive ? "page" : undefined} isActive={todayActive} onClick={select(onToday)}>
                <CalendarDays />
                <span>Today</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {!mobile && <SidebarMenuItem>
              <SidebarMenuButton onClick={select(() => openBeside(browserView("")))}>
                <Globe className="size-4" />
                <span>Browser</span>
              </SidebarMenuButton>
            </SidebarMenuItem>}
          </SidebarMenu>
        </SidebarGroup>
        <nav aria-label="Types">
          <NavTypes types={types.map((t) => ({ ...t, onSelect: select(t.onSelect) }))} />
        </nav>
        {pinned.length > 0 && (
          <nav aria-label="Pinned">
            <NavProjects label="Pinned" projects={navigable(pinned)} />
          </nav>
        )}
        <nav aria-label="Recent">
          <NavProjects label="Recent" onCreate={() => { onCreate(); if (isMobile) setOpenMobile(false); }} projects={navigable(pages)} sortable />
        </nav>
      </SidebarContent>
      <CloudButton />
      <SidebarFooter>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={select(() => openSettings())}><Settings /><span>Settings</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
      {!mobile && <UsageButton />}
    </Sidebar>
  );
}
