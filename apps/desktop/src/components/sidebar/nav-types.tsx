import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";

// One row per type, opening its list of pages. Built like NavProjects, without a menu. Narrowed
// to a project, each says how many of its pages it holds.
export function NavTypes({
  types,
}: {
  types: {
    id: string;
    name: string;
    icon: React.ReactNode;
    count?: number;
    isActive: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onDrag: (e: React.PointerEvent<HTMLElement>) => void;
  }[];
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Types</SidebarGroupLabel>
      <SidebarMenu>
        {types.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              aria-current={item.isActive ? "page" : undefined}
              isActive={item.isActive}
              onClick={item.onSelect}
              onPointerDown={item.onDrag}
            >
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
            {item.count !== undefined && <SidebarMenuBadge className="font-normal text-muted-foreground">{item.count}</SidebarMenuBadge>}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
