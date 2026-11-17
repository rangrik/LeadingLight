// The sidebar while the browser space is in front: the app sidebar's frame (sidebar-08 on COSS),
// with the search field, pinned sites, my tabs and agents' browsers, then Saved, History and
// Settings over the usage line. Rows are 32 px, 2 px apart, as in the design.
import { Bookmark, Bot, Columns2, Ellipsis, History, Link, Pin, PinOff, Plus, Search, Sparkles, X } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuSeparator, ContextMenuTrigger } from "@leadinglight/ui/components/context-menu";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Kbd } from "@leadinglight/ui/components/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@leadinglight/ui/components/sidebar";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { acting, bar, closeTab, dataBase, hostOf, listed, live, openPinned, pin, select, showBrowserList, shown, space, unpin, useAgentTabs, type AgentTab, type Site, type SpaceTab } from "~/lib/browser-space";
import { useKeysFor } from "~/lib/keymap";
import { useBrowserData } from "~/lib/project-runtime/browser";

// The site's icon, or the one kept for its host, else a letter tile in the site's own colour, as
// the design draws them. The letter is the site's name: W for en.wikipedia.org.
const TILES = ["bg-teal-600", "bg-indigo-500", "bg-violet-500", "bg-orange-600", "bg-blue-600", "bg-green-600", "bg-amber-600", "bg-pink-600", "bg-slate-500"];
export function SiteIcon({ tab, large }: { tab: Pick<SpaceTab, "url" | "title" | "icon">; large?: boolean }) {
  const size = large ? "size-5 rounded-md" : "size-4 rounded-[4px]";
  const kept = space.use().icons[hostOf(tab.url)];
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
  const page = live.use()[tab.id];
  const claude = acting.use()[tab.id];
  const title = tab.title || hostOf(tab.url) || "New tab";
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger render={<SidebarMenuButton aria-current={active ? "page" : undefined} className="pe-7" isActive={active} onClick={(e) => select(tab.id, true, e.shiftKey)} />}>
          {page?.loading ? <Spinner className="size-4 text-muted-foreground" /> : <SiteIcon tab={tab} />}
          <span>{title}</span>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem onClick={() => select(tab.id, true, true)}><Columns2 />Open beside</ContextMenuItem>
          <ContextMenuItem onClick={() => pin(tab.id)}><Pin />Pin</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(tab.url)}><Link />Copy link</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {claude ? (
        <SidebarMenuBadge aria-label={`${claude.who} is working in this tab`}><Sparkles className="size-3.5 text-info" /></SidebarMenuBadge>
      ) : (
        <Menu>
          <MenuTrigger render={<SidebarMenuAction aria-label={`More for ${title}`} showOnHover />}><Ellipsis /></MenuTrigger>
          <MenuPopup side="right" align="start">
            <MenuItem onClick={() => select(tab.id, true, true)}><Columns2 />Open beside</MenuItem>
            <MenuItem onClick={() => pin(tab.id)}><Pin />Pin</MenuItem>
            <MenuItem onClick={() => copy(tab.url)}><Link />Copy link</MenuItem>
            <MenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </SidebarMenuItem>
  );
}

function Tile({ site, tab, active }: { site: Site; tab?: SpaceTab; active: boolean }) {
  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <ContextMenuTrigger
              render={<SidebarMenuButton aria-current={active ? "page" : undefined} aria-label={site.title} className="h-10 justify-center bg-sidebar-accent/70 p-0 data-[active=true]:inset-ring data-[active=true]:inset-ring-border" isActive={active} onClick={(e) => openPinned(site.id, e.shiftKey)} />}
            />
          }
        >
          <SiteIcon large tab={tab ?? site} />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{site.title || hostOf(site.url)}</TooltipPopup>
      </Tooltip>
      <ContextMenuPopup>
        <ContextMenuItem onClick={() => openPinned(site.id, true)}><Columns2 />Open beside</ContextMenuItem>
        <ContextMenuItem onClick={() => unpin(site.id)}><PinOff />Unpin</ContextMenuItem>
        <ContextMenuItem onClick={() => copy(tab?.url ?? site.url)}><Link />Copy link</ContextMenuItem>
        {tab && <><ContextMenuSeparator /><ContextMenuItem onClick={() => void closeTab(tab.id)}><X />Close tab</ContextMenuItem></>}
      </ContextMenuPopup>
    </ContextMenu>
  );
}

function AgentRow({ agent, active }: { agent: AgentTab; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-current={active ? "page" : undefined} isActive={active} onClick={() => showBrowserList({ kind: "agent", base: agent.base, tab: agent.tab })}>
        <Bot />
        <span>{agent.name}</span>
      </SidebarMenuButton>
      {agent.busy && <SidebarMenuBadge aria-label="Working"><span className="size-1.5 rounded-full bg-success" /></SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

export function BrowserSidebar() {
  const { tabs, selected, pinned, base } = space.use();
  const view = shown.use();
  const [data] = useBrowserData(dataBase(base));
  const agents = useAgentTabs(true);
  const keys = useKeysFor();
  const onTab = (id: string) => view.kind === "tab" && selected === id;
  return (
    <>
      <SidebarContent className="gap-0">
        <SidebarGroup className="pt-0 pb-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="bg-sidebar-accent/70 pe-1.5 text-[0.8125rem] text-muted-foreground" onClick={() => bar.set({ mode: "new", text: "" })}>
                <Search />
                <span className="flex-1">Search or enter address</span>
                <Kbd className="bg-accent">{keys("new-tab")}</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {pinned.length > 0 && (
          <SidebarGroup className="py-0">
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <div className="grid grid-cols-4 gap-2" role="list" aria-label="Pinned">
              {pinned.map((site) => {
                const tab = tabs.find((t) => t.pin === site.id);
                return <div key={site.id} role="listitem"><Tile active={!!tab && onTab(tab.id)} site={site} tab={tab} /></div>;
              })}
            </div>
          </SidebarGroup>
        )}
        <SidebarGroup className="pt-2">
          <SidebarGroupLabel>Tabs</SidebarGroupLabel>
          <Tooltip>
            <TooltipTrigger render={<SidebarGroupAction aria-label="New tab" onClick={() => bar.set({ mode: "new", text: "" })} />}><Plus /></TooltipTrigger>
            <TooltipPopup side="bottom">New tab {keys("new-tab")}</TooltipPopup>
          </Tooltip>
          <SidebarMenu aria-label="Tabs" className="gap-0.5">
            {listed(tabs).map((tab) => <TabRow active={onTab(tab.id)} key={tab.id} tab={tab} />)}
          </SidebarMenu>
        </SidebarGroup>
        {agents.length > 0 && (
          <SidebarGroup className="pt-2">
            <SidebarGroupLabel>Agents</SidebarGroupLabel>
            <SidebarMenu aria-label="Agents" className="gap-0.5">
              {agents.map((a) => <AgentRow active={view.kind === "agent" && view.base === a.base && view.tab === a.tab} agent={a} key={`${a.base}/${a.tab}`} />)}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton isActive={view.kind === "saved"} onClick={() => showBrowserList(view.kind === "saved" ? { kind: "tab" } : { kind: "saved" })}><Bookmark /><span>Saved</span></SidebarMenuButton>
            {data.bookmarks.length > 0 && <SidebarMenuBadge className="font-normal text-muted-foreground">{data.bookmarks.length}</SidebarMenuBadge>}
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={view.kind === "history"} onClick={() => showBrowserList(view.kind === "history" ? { kind: "tab" } : { kind: "history" })}><History /><span>History</span></SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
