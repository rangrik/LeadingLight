// The fold is shadcn sidebar-02's (base-vega) collapsible group, on COSS's Collapsible. Changes: one
// group, our xs label, open state kept on this Mac, the chevron turning in 200 ms ease-out and in
// line with the rows' + and ⋯.
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { localPrefs } from "~/lib/local-prefs";

const fold = localPrefs("ll.sidebar.types", { open: true });

// One row per type, opening its list of pages. Built like NavProjects, without a menu.
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
  }[];
}) {
  const { open } = fold.use();
  return (
    <Collapsible className="group/collapsible" onOpenChange={(open) => fold.set({ open })} open={open}>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="w-full pe-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" render={<CollapsibleTrigger />}>
          Types
          <ChevronRight className="ml-auto transition-transform duration-200 ease-out group-data-open/collapsible:rotate-90" />
        </SidebarGroupLabel>
        <CollapsibleContent className="ease-out">
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
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
