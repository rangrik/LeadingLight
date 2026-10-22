// shadcn sidebar-08 (base-vega) app-sidebar, on COSS primitives.
// Changes: our name and logo, room for the macOS traffic lights, inert while collapsed (so Tab
// skips it), and only NavProjects (as Pages); NavMain, NavSecondary and NavUser wait for content.
import { Lightbulb } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@leadinglight/ui/components/sidebar";
import { NavProjects } from "./nav-projects";

export function AppSidebar({
  pages,
  onCreate,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  pages: React.ComponentProps<typeof NavProjects>["projects"];
  onCreate: () => void;
}) {
  const { isMobile, state } = useSidebar();
  return (
    <Sidebar inert={!isMobile && state === "collapsed"} variant="inset" {...props}>
      <SidebarHeader className="pt-[calc(var(--traffic-top)_+_0.5rem)]" data-tauri-drag-region>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#" />} size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Lightbulb className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">LeadingLight</span>
                <span className="truncate text-xs">Notes</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Pages">
          <NavProjects onCreate={onCreate} projects={pages} />
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
