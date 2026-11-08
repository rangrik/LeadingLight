import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { type Child, RESULT, Tree } from "./nav-projects";

// One row per type, opening its list of pages. Built like NavProjects, without a menu. While the
// sidebar is filtered a row counts its matching pages and lists the first of them under it; the
// rest are a row that opens the type's list (its view).
export function NavTypes({
  types,
}: {
  types: {
    id: string;
    name: string;
    icon: React.ReactNode;
    isActive: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onDrag: (e: React.PointerEvent<HTMLElement>) => void;
    found?: { count: number; pages: Child[]; view: string };
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
            {item.found && (
              <>
                <SidebarMenuBadge className="text-muted-foreground">{item.found.count}</SidebarMenuBadge>
                <Tree items={item.found.pages} />
                {item.found.count > item.found.pages.length && (
                  <SidebarMenuSub className="border-l-0 pl-4">
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton className={cn("w-full text-muted-foreground", RESULT)} data-filter-result={item.found.view} onClick={item.onSelect} render={<button type="button" />}>
                        <span>{item.found.count - item.found.pages.length} more</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
