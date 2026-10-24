import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@leadinglight/ui/components/breadcrumb";
import { Separator } from "@leadinglight/ui/components/separator";
import { SidebarTrigger } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import type { ReactNode } from "react";

// The inset panel's top band, from sidebar-08's page.tsx: the sidebar trigger and the crumbs.
// A window drag area. Each page's card has one; only the first (lead) makes room for the traffic
// lights when the sidebar is away, and holds the sidebar button unless the window does (toggle).
// after sits beside the crumbs (the page's counts), children at the far end.
type Props = {
  sidebarOpen: boolean;
  root?: string;
  onRoot?: (e: React.MouseEvent) => void;
  current: string | null;
  icon?: ReactNode;
  lead?: boolean;
  toggle?: boolean;
  muted?: boolean;
  // Pressing the crumbs, not the bar: the bar itself drags the window in the app.
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  after?: ReactNode;
  children?: ReactNode;
};

export function PanelHeader({ sidebarOpen, root, onRoot, current, icon, lead = true, toggle = true, muted, onGrab, after, children }: Props) {
  return (
    <header className="@container/header flex h-(--header-height) shrink-0 items-center gap-2 pe-2" data-tauri-drag-region>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 overflow-hidden px-4 transition-[padding] duration-200 ease-linear",
          // Past the lights, or past the lights and the window's sidebar button (12 px after it).
          lead && !sidebarOpen && (toggle ? "ps-[calc(var(--traffic-left)_+_1rem)]" : "ps-[calc(var(--traffic-left)_+_50px)]"),
        )}
        onPointerDown={onGrab}
      >
        {lead && toggle && (
          <>
            <SidebarTrigger className="-ml-1" />
            {/* COSS's Separator sizes by its own data-orientation, so h-4 instead of data-vertical:h-4. */}
            <Separator className="mr-2 h-4" orientation="vertical" />
          </>
        )}
        {/* One line in any card: the counts give way first, then the page's title, with an
            ellipsis. On one baseline, so the counts' smaller text sits on the crumbs' line. */}
        <div className="flex min-w-0 flex-1 items-baseline">
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {root && (
                <BreadcrumbItem className="hidden shrink-0 md:block">
                  {onRoot ? <BreadcrumbLink render={<button onClick={onRoot} type="button" />}>{root}</BreadcrumbLink> : root}
                </BreadcrumbItem>
              )}
              {current !== null && (
                <>
                  {root && <BreadcrumbSeparator className="hidden shrink-0 md:block" />}
                  <BreadcrumbItem className="min-w-0">
                    {icon}
                    <BreadcrumbPage className={cn("max-w-[40ch] truncate", muted && "text-muted-foreground")}>{current}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {after}
        </div>
      </div>
      {children && <div className="ms-auto flex shrink-0 items-center">{children}</div>}
    </header>
  );
}
