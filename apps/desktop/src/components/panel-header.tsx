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
import { useMobile } from "~/lib/platform";
import type { ReactNode } from "react";

// The inset panel's top band, from sidebar-08's page.tsx: the sidebar trigger and the crumbs.
// A window drag area. Each page's card has one; only the first (lead) makes room for the traffic
// lights when the sidebar is away, and holds the sidebar button unless the window does (toggle).
// after sits beside the crumbs (the page's counts), children at the far end, nav before the crumbs.
// under: a tab row is above it and makes the room for the lights instead.
type Props = {
  nav?: ReactNode;
  under?: boolean;
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

export function PanelHeader({ sidebarOpen, root, onRoot, current, icon, lead = true, toggle = true, muted, onGrab, after, children, nav, under }: Props) {
  const mobile = useMobile();
  return (
    <header className="@container/header flex h-(--header-height) shrink-0 items-center gap-2 pe-2" data-tauri-drag-region={!mobile || undefined}>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 overflow-hidden ps-4 pe-1 transition-[padding] duration-200 ease-linear",
          // Past the lights, or past the lights and the window's sidebar button (12 px after it);
          // less what a rail that stayed already puts before the card.
          lead && !sidebarOpen && !under && (toggle ? "ps-[max(1rem,calc(var(--traffic-left)_+_1rem_-_var(--rail-kept,0px)))]" : "ps-[calc(var(--traffic-left)_+_50px_-_var(--rail-kept,0px))]"),
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
        {nav}
        {/* One line in any card: the counts give way first, then the page's title, with an
            ellipsis. On one baseline, so the counts' smaller text sits on the crumbs' line. */}
        <div className="flex min-w-0 flex-1 items-baseline">
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {root && (
                <BreadcrumbItem className="hidden shrink-0 md:@[48rem]/header:block">
                  {onRoot ? <BreadcrumbLink render={<button onClick={onRoot} type="button" />}>{root}</BreadcrumbLink> : root}
                </BreadcrumbItem>
              )}
              {current !== null && (
                <>
                  {root && <BreadcrumbSeparator className="hidden shrink-0 md:@[48rem]/header:block" />}
                  <BreadcrumbItem className="min-w-0">
                    {icon}
                    {/* Its text, not the icon's bottom edge, is the baseline the counts sit on. */}
                    <BreadcrumbPage className={cn("max-w-[40ch] self-baseline truncate", muted && "text-muted-foreground")}>{current}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {after}
        </div>
      </div>
      {children && <div className="ms-auto flex shrink-0 items-center" data-actions>{children}</div>}
    </header>
  );
}
