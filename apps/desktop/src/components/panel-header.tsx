import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@leadinglight/ui/components/breadcrumb";
import { Separator } from "@leadinglight/ui/components/separator";
import { SidebarTrigger } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import type { ReactNode } from "react";

// The inset panel's top band, from sidebar-08's page.tsx: the sidebar trigger and the crumbs.
// A window drag area. Each page's card has one; only the first (lead) holds the sidebar button
// and makes room for the traffic lights when the sidebar is away.
type Props = {
  sidebarOpen: boolean;
  root: string;
  current: string | null;
  icon?: ReactNode;
  lead?: boolean;
  muted?: boolean;
  // Pressing the crumbs, not the bar: the bar itself drags the window in the app.
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  children?: ReactNode;
};

export function PanelHeader({ sidebarOpen, root, current, icon, lead = true, muted, onGrab, children }: Props) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 pe-2" data-tauri-drag-region>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 overflow-hidden px-4 transition-[padding] duration-200 ease-linear",
          lead && !sidebarOpen && "ps-[calc(var(--traffic-left)_+_1rem)]",
        )}
        onPointerDown={onGrab}
      >
        {lead && (
          <>
            <SidebarTrigger className="-ml-1" />
            {/* COSS's Separator sizes by its own data-orientation, so h-4 instead of data-vertical:h-4. */}
            <Separator className="mr-2 h-4" orientation="vertical" />
          </>
        )}
        {/* One line in any card: only the page's title gives way, with an ellipsis. */}
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="hidden shrink-0 md:block">{root}</BreadcrumbItem>
            {current !== null && (
              <>
                <BreadcrumbSeparator className="hidden shrink-0 md:block" />
                <BreadcrumbItem className="min-w-0">
                  {icon}
                  <BreadcrumbPage className={cn("max-w-[40ch] truncate", muted && "text-muted-foreground")}>{current}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {children && <div className="ms-auto flex shrink-0 items-center">{children}</div>}
    </header>
  );
}
