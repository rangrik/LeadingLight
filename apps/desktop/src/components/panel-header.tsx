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

// The inset panel's top band, from sidebar-08's page.tsx: the sidebar trigger and the crumbs.
// A window drag area, with room for the traffic lights when the sidebar is away.
export function PanelHeader({ sidebarOpen, root, current }: { sidebarOpen: boolean; root: string; current: string | null }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2" data-tauri-drag-region>
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 px-4 transition-[padding] duration-200 ease-linear",
          !sidebarOpen && "ps-[calc(var(--traffic-left)_+_1rem)]",
        )}
      >
        <SidebarTrigger className="-ml-1" />
        {/* COSS's Separator sizes by its own data-orientation, so h-4 instead of data-vertical:h-4. */}
        <Separator className="mr-2 h-4" orientation="vertical" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">{root}</BreadcrumbItem>
            {current !== null && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="max-w-[40ch] truncate">{current}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
