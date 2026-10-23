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
// A window drag area, with room for the traffic lights when the sidebar is away. after sits
// beside the crumbs (the page's counts), actions at the far end.
export function PanelHeader({ sidebarOpen, root, current, icon, after, actions }: { sidebarOpen: boolean; root: string; current: string | null; icon?: ReactNode; after?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="@container/header flex h-(--header-height) shrink-0 items-center gap-2" data-tauri-drag-region>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 px-4 transition-[padding] duration-200 ease-linear",
          !sidebarOpen && "ps-[calc(var(--traffic-left)_+_1rem)]",
        )}
      >
        <SidebarTrigger className="-ml-1" />
        {/* COSS's Separator sizes by its own data-orientation, so h-4 instead of data-vertical:h-4. */}
        <Separator className="mr-2 h-4" orientation="vertical" />
        {/* On one baseline, so the counts' smaller text sits on the crumbs' line. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <Breadcrumb className="shrink-0">
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">{root}</BreadcrumbItem>
              {current !== null && (
                <>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem className="min-w-0">
                    {icon}
                    <BreadcrumbPage className="max-w-[40ch] truncate">{current}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {after}
        </div>
      </div>
      {actions && <div className="ms-auto flex shrink-0 items-center pe-3">{actions}</div>}
    </header>
  );
}
