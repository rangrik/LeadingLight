// shadcn sidebar-08 (base-vega) app-sidebar, on COSS primitives.
// Changes: our name and logo, room for the macOS traffic lights, inert while collapsed (so Tab
// skips it), NavProjects as Pinned (while a page is) and Recent under our Types, and the plans'
// usage as the footer (NavUser's place), and a Browser entry. In the browser space its content is
// the browser's (browser-sidebar.tsx) and the header switches back to Notes, as sidebar-07's
// team switcher does; the notes stay mounted under it.
// The header is its own export, so Settings' sidebar wears the same one.
import { CalendarDays, ChevronsUpDown, Globe, Mail, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuShortcut, MenuTrigger } from "@leadinglight/ui/components/menu";
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
import { UsageButton } from "~/components/usage-button";
import { enter, leave, space } from "~/lib/browser-space";
import { useKeysFor } from "~/lib/keymap";
import { openFrom, openBeside } from "~/lib/panes";
import { CALENDAR_VIEW, MAIL_VIEW, browserView } from "~/lib/space";
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

// Notes or Browser, from the browser's header.
function SpaceSwitch() {
  const keys = useKeysFor();
  return (
    <MenuPopup align="start" className="min-w-(--anchor-width)">
      <MenuRadioGroup onValueChange={(v) => (v === "notes" ? leave() : enter())} value={space.get().front ? "browser" : "notes"}>
        <MenuRadioItem value="notes">Notes<MenuShortcut>{keys("browser")}</MenuShortcut></MenuRadioItem>
        <MenuRadioItem value="browser">Browser</MenuRadioItem>
      </MenuRadioGroup>
    </MenuPopup>
  );
}

export function AppSidebarHeader({ subtitle, switcher }: { subtitle: string; switcher?: boolean }) {
  const mobile = useMobile();
  const brand: ReactNode = (
    <>
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <Mark className="size-8" />
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">LeadingLight</span>
        <span className="truncate text-xs">{subtitle}</span>
      </div>
      {switcher && <ChevronsUpDown className="ms-auto size-3.5 text-muted-foreground" />}
    </>
  );
  return (
    <SidebarHeader className="pt-[calc(var(--traffic-top)_+_0.5rem)]" data-tauri-drag-region={!mobile || undefined}>
      <SidebarMenu>
        <SidebarMenuItem>
          {switcher ? (
            <Menu>
              <MenuTrigger render={<SidebarMenuButton aria-label="Switch between Notes and Browser" size="lg" />}>{brand}</MenuTrigger>
              <SpaceSwitch />
            </Menu>
          ) : (
            <SidebarMenuButton render={<a href="#" />} size="lg">
              {brand}
            </SidebarMenuButton>
          )}
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
  browser,
  native,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  browser?: ReactNode;
  native: boolean;
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
    <Sidebar inert={!isMobile && state === "collapsed"} variant={mobile ? "sidebar" : "inset"} {...props}>
      <AppSidebarHeader subtitle={browser ? "Browser" : "Notes"} switcher={!!browser} />
      {browser}
      <div className={browser ? "hidden" : "contents"}>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton aria-current={todayActive ? "page" : undefined} isActive={todayActive} onClick={select(onToday)}>
                <CalendarDays />
                <span>Today</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton onClick={select((e) => openFrom(CALENDAR_VIEW, e))}><CalendarDays /><span>Calendar</span></SidebarMenuButton></SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton onClick={select((e) => openFrom(MAIL_VIEW, e))}><Mail /><span>Mail</span></SidebarMenuButton></SidebarMenuItem>
            {!mobile && <SidebarMenuItem>
              <SidebarMenuButton onClick={select(() => (native ? enter() : openBeside(browserView(""))))}>
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
        {mobile && <MobileAgentsButton />}
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={select(() => openSettings())}><Settings /><span>Settings</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
      {!mobile && <UsageButton />}
      </div>
    </Sidebar>
  );
}
