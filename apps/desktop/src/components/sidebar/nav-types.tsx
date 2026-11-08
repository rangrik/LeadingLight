import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { localPrefs } from "~/lib/local-prefs";
import { space } from "~/lib/space";
import { isProject } from "./nav-work";

// The Library (features/sidebar-work-first.feature): the given rows, then one per type, opening
// its list of pages; folded as shadcn's collapsible group is. Until the person folds or unfolds
// it, it starts folded in a space with a project, decided once per launch so it never moves.
const library = localPrefs<{ open?: boolean }>("ll.sidebar.library", {});
let firstOpen: boolean | undefined;

export function NavTypes({
  types,
  children,
}: {
  types: {
    id: string;
    name: string;
    icon: React.ReactNode;
    isActive: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onDrag: (e: React.PointerEvent<HTMLElement>) => void;
  }[];
  children?: React.ReactNode;
}) {
  const { pages, types: loaded } = space.use();
  if (firstOpen === undefined && loaded.length) firstOpen = !pages.some(isProject);
  const open = library.use().open ?? firstOpen ?? true;
  return (
    <Collapsible onOpenChange={(open) => library.set({ open })} open={open}>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="pe-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" render={<CollapsibleTrigger />}>
          Library
          <ChevronRight className={cn("ms-auto transition-transform duration-150 ease-out", open && "rotate-90")} />
        </SidebarGroupLabel>
        <CollapsiblePanel className="ease-out">
          <SidebarMenu>
            {children}
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
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
