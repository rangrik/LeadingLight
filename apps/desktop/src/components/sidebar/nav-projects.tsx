// shadcn sidebar-08 (base-vega) nav-projects, on COSS primitives (DropdownMenu* is COSS Menu*).
// Changes: pages instead of projects, a New page action and empty text, rows select instead of
// linking, Delete wired; View/Share and the trailing "More" row dropped (nothing behind them yet);
// rows can be dragged beside the open page.
import { Ellipsis, Plus, Trash } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";

export function NavProjects({
  projects,
  onCreate,
}: {
  projects: {
    name: string;
    icon: React.ReactNode;
    isActive: boolean;
    onSelect: () => void;
    onDrag: (e: React.PointerEvent<HTMLElement>) => void;
    onDelete: () => void;
  }[];
  onCreate: () => void;
}) {
  const { isMobile } = useSidebar();
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Pages</SidebarGroupLabel>
      <SidebarGroupAction aria-label="New page" onClick={onCreate}>
        <Plus />
      </SidebarGroupAction>
      {projects.length === 0 && <p className="px-2 py-1.5 text-sm">No pages yet</p>}
      <SidebarMenu>
        {projects.map((item, i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuButton
              aria-current={item.isActive ? "page" : undefined}
              isActive={item.isActive}
              onClick={item.onSelect}
              onPointerDown={item.onDrag}
            >
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
            <Menu>
              <MenuTrigger
                render={
                  // COSS's showOnHover keys off Radix's data-state; Base UI sets aria-expanded.
                  <SidebarMenuAction className="aria-expanded:bg-muted aria-expanded:opacity-100" showOnHover />
                }
              >
                <Ellipsis />
                <span className="sr-only">More</span>
              </MenuTrigger>
              <MenuPopup align={isMobile ? "end" : "start"} className="w-48" side={isMobile ? "bottom" : "right"}>
                <MenuItem onClick={item.onDelete}>
                  <Trash className="text-muted-foreground" />
                  <span>Delete</span>
                </MenuItem>
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
