// shadcn sidebar-08 (base-vega) app-sidebar, on COSS primitives.
// Changes: our name and logo, room for the macOS traffic lights, inert while collapsed (so Tab
// skips it), and only NavProjects (as Pages); NavMain, NavSecondary and NavUser wait for content.
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
                <Mark className="size-8" />
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
