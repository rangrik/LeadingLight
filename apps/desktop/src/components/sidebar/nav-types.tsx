import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";

// One row per type, opening its list of pages. Built like NavProjects, without a menu.
export function NavTypes({
  types,
}: {
  types: {
    name: string;
    icon: React.ReactNode;
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
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              aria-current={item.isActive ? "page" : undefined}
              isActive={item.isActive}
              onClick={item.onSelect}
              onPointerDown={item.onDrag}
            >
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
