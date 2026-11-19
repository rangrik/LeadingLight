// The browser's part of the app sidebar: pinned sites (shown under Pinned), then my tabs with
// Saved and History beside the label, then agents' browsers.
import { Bookmark, Bot, Columns2, Ellipsis, Globe, History, Link, Pin, PinOff, Plus, Sparkles, X } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuSeparator, ContextMenuTrigger } from "@leadinglight/ui/components/context-menu";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { acting, bar, browserFocused, browserView, closeTab, hostOf, listed, live, openPinned, pin, select, showBrowserList, shown, space, unpin, useAgentTabs, type AgentTab, type Site, type SpaceTab } from "~/lib/browser-space";
import { browserTabId, focusedPage, panes } from "~/lib/panes";
import { useKeysFor } from "~/lib/keymap";

// The site's icon, or the one kept for its host, else a letter tile in the site's own colour, as
// the design draws them. The letter is the site's name: W for en.wikipedia.org.
const TILES = ["bg-teal-600", "bg-indigo-500", "bg-violet-500", "bg-orange-600", "bg-blue-600", "bg-green-600", "bg-amber-600", "bg-pink-600", "bg-slate-500"];
export function SiteIcon({ tab, large }: { tab: Pick<SpaceTab, "url" | "title" | "icon">; large?: boolean }) {
  const size = large ? "size-5 rounded-md" : "size-4 rounded-[4px]";
  const kept = space.use().icons[hostOf(tab.url)];
  if (!tab.url) return <Globe className={size} />;
  if (tab.icon || kept) return <img alt="" className={cn("shrink-0 object-contain", size)} src={tab.icon || kept} />;
  const bare = hostOf(tab.url).replace(/:\d+$/, "");
  const labels = bare.split(".");
  const host = (/^[\d.]+$|^\[/.test(bare) || labels.length < 2 ? labels[0] : labels.at(-2)) || tab.title;
  const hash = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center font-semibold text-white leading-none", size, large ? "text-xs" : "text-[10px]", TILES[hash % TILES.length])}>
      {(host[0] ?? "?").toUpperCase()}
    </span>
  );
}

function copy(url: string) {
  void navigator.clipboard?.writeText(url).catch(() => {});
}

function TabRow({ tab, active }: { tab: SpaceTab; active: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const pick = (beside = false) => { select(tab.id, true, beside); if (isMobile) setOpenMobile(false); };
  const page = live.use()[tab.id];
  const claude = acting.use()[tab.id];
  const title = tab.title || hostOf(tab.url) || "New tab";
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger render={<SidebarMenuButton aria-current={active ? "page" : undefined} className="group-has-data-[sidebar=menu-action]/menu-item:pe-14" isActive={active} onClick={(e) => pick(e.shiftKey)} />}>
          {page?.loading ? <Spinner className="size-4 text-muted-foreground" /> : <SiteIcon tab={tab} />}
          <span>{title}</span>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem onClick={() => pick(true)}><Columns2 />Open beside</ContextMenuItem>
          <ContextMenuItem onClick={() => pin(tab.id)}><Pin />Pin</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(tab.url)}><Link />Copy link</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {claude ? (
        <SidebarMenuBadge aria-label={`${claude.who} is working in this tab`}><Sparkles className="size-3.5 text-info" /></SidebarMenuBadge>
      ) : (
        <>
        <Menu>
          <MenuTrigger render={<SidebarMenuAction aria-label={`More for ${title}`} className="right-8" showOnHover />}><Ellipsis /></MenuTrigger>
          <MenuPopup side="right" align="start">
            <MenuItem onClick={() => pick(true)}><Columns2 />Open beside</MenuItem>
            <MenuItem onClick={() => pin(tab.id)}><Pin />Pin</MenuItem>
            <MenuItem onClick={() => copy(tab.url)}><Link />Copy link</MenuItem>
            <MenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</MenuItem>
          </MenuPopup>
        </Menu>
        <SidebarMenuAction aria-label={`Close ${title}`} onClick={() => void closeTab(tab.id)} showOnHover><X /></SidebarMenuAction>
        </>
      )}
    </SidebarMenuItem>
  );
}

function usePick() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (fn: () => void) => { if (isMobile) setOpenMobile(false); fn(); };
}

function Tile({ site, tab, active }: { site: Site; tab?: SpaceTab; active: boolean }) {
  const pick = usePick();
  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <ContextMenuTrigger
              render={<SidebarMenuButton aria-current={active ? "page" : undefined} aria-label={site.title} className="h-10 justify-center bg-sidebar-accent/70 p-0 data-[active=true]:inset-ring data-[active=true]:inset-ring-border" isActive={active} onClick={(e) => pick(() => openPinned(site.id, e.shiftKey))} />}
            />
          }
        >
          <SiteIcon large tab={tab ?? site} />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{site.title || hostOf(site.url)}</TooltipPopup>
      </Tooltip>
      <ContextMenuPopup>
        <ContextMenuItem onClick={() => pick(() => openPinned(site.id, true))}><Columns2 />Open beside</ContextMenuItem>
        <ContextMenuItem onClick={() => unpin(site.id)}><PinOff />Unpin</ContextMenuItem>
        <ContextMenuItem onClick={() => copy(tab?.url ?? site.url)}><Link />Copy link</ContextMenuItem>
        {tab && <><ContextMenuSeparator /><ContextMenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</ContextMenuItem></>}
      </ContextMenuPopup>
    </ContextMenu>
  );
}

function AgentRow({ agent, active }: { agent: AgentTab; active: boolean }) {
  const pick = usePick();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-current={active ? "page" : undefined} isActive={active} onClick={() => pick(() => showBrowserList({ kind: "agent", base: agent.base, tab: agent.tab }))}>
        <Bot />
        <span>{agent.name}</span>
      </SidebarMenuButton>
      {agent.busy && <SidebarMenuBadge aria-label="Working"><span className="size-1.5 rounded-full bg-success" /></SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

// What the browser pane shows: a tab, Saved, History or an agent's browser.
function useView() {
  panes.use();
  return browserView(browserTabId(focusedPage()), shown.use());
}

export function PinnedSites() {
  const { tabs, selected, pinned } = space.use();
  const view = useView();
  if (!pinned.length) return null;
  return (
    <div className="mb-1 grid grid-cols-4 gap-2" role="list" aria-label="Pinned sites">
      {pinned.map((site) => {
        const tab = tabs.find((t) => t.pin === site.id);
        return <div key={site.id} role="listitem"><Tile active={!!tab && view.kind === "tab" && selected === tab.id} site={site} tab={tab} /></div>;
      })}
    </div>
  );
}

const LISTS = [["saved", "Saved", Bookmark, "right-9"], ["history", "History", History, ""]] as const;

export function BrowserSidebar() {
  const view = useView();
  const pick = usePick();
  const { tabs, selected } = space.use();
  const open = listed(tabs);
  const agents = useAgentTabs(true);
  const keys = useKeysFor();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Tabs</SidebarGroupLabel>
        {LISTS.map(([kind, name, Icon, place]) => (
          <Tooltip key={kind}>
            <TooltipTrigger render={<SidebarGroupAction aria-label={name} aria-pressed={view.kind === kind} className={cn("aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground", place)} onClick={() => pick(() => view.kind !== kind ? showBrowserList({ kind }) : selected ? select(selected, true) : showBrowserList({ kind: "tab" }))} />}><Icon /></TooltipTrigger>
            <TooltipPopup side="bottom">{name}</TooltipPopup>
          </Tooltip>
        ))}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton aria-label="New tab" onClick={() => pick(() => bar.set({ mode: "new", text: "" }))}>
              <Plus />
              <span className="flex-1">New tab</span>
              {browserFocused() && <span className="text-xs text-muted-foreground">{keys("new-tab")}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {open.length > 0 && (
          <SidebarMenu aria-label="Tabs" className="mt-1">
            {open.map((tab) => <TabRow active={view.kind === "tab" && selected === tab.id} key={tab.id} tab={tab} />)}
          </SidebarMenu>
        )}
      </SidebarGroup>
      {agents.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarMenu aria-label="Agents">
            {agents.map((a) => <AgentRow active={view.kind === "agent" && view.base === a.base && view.tab === a.tab} agent={a} key={`${a.base}/${a.tab}`} />)}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </>
  );
}
