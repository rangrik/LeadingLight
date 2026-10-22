import { FileText, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@leadinglight/ui/components/empty";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@leadinglight/ui/components/breadcrumb";
import { Separator } from "@leadinglight/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@leadinglight/ui/components/sidebar";
import { ToastProvider } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { DeletePageDialog } from "@/components/delete-page-dialog";
import { PageView } from "@/components/page-view";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { pageLabel } from "@/lib/labels";
import { type LLObject, type ObjectPatch, type ObjectSummary, objects } from "@/lib/objects";
import { isNative } from "@/lib/platform";
import { flushAll, reportSaveError } from "@/lib/saving";

const SIDEBAR_KEY = "ll.sidebar.open";

// Room for the macOS traffic lights, which tauri.conf.json centres on the panel header's
// middle line (y 40; they span x 18-78). Measured from AppKit's frames: centre = position.y - 2.
const chrome = (native: boolean) =>
  ({ "--traffic-top": native ? "40px" : "0px", "--traffic-left": native ? "72px" : "0px" }) as React.CSSProperties;

function useSystemTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

export default function App() {
  useSystemTheme();
  const [pages, setPages] = useState<ObjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<LLObject | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "false");
  const [native, setNative] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ObjectSummary | null>(null);

  useEffect(() => void isNative.then(setNative), []);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen)), [sidebarOpen]);

  useEffect(() => {
    objects
      .list()
      .then((list) => {
        setPages(list);
        setActiveId(list[0]?.id ?? null);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let stale = false;
    objects
      .get(activeId)
      .then((obj) => !stale && setActive(obj))
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [activeId]);

  const create = useCallback(() => {
    objects
      .create()
      .then((obj) => {
        setPages((prev) => [obj, ...prev]);
        setActive(obj);
        setActiveId(obj.id);
      })
      .catch(console.error);
  }, []);

  const remove = useCallback(
    (id: string) => {
      objects.remove(id).catch(console.error);
      setPages((prev) => prev.filter((p) => p.id !== id));
      if (id === activeId) setActiveId(pages.find((p) => p.id !== id)?.id ?? null);
    },
    [activeId, pages],
  );

  // The sidebar and the breadcrumb follow the title as it is typed; saving is debounced.
  const rename = useCallback((id: string, title: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, title } : p)));
  }, []);

  const save = useCallback((id: string, patch: ObjectPatch) => objects.update(id, patch).catch(reportSaveError), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        create();
      }
      // Saving is automatic; ⌘S just saves now instead of opening the browser's save dialog.
      if (key === "s") {
        e.preventDefault();
        void flushAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [create]);

  // Save pending edits whenever the app might be about to go away.
  useEffect(() => {
    const save = () => void flushAll();
    const onHidden = () => document.visibilityState === "hidden" && save();
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    let unlisten: (() => void) | undefined;
    void isNative.then(async (native) => {
      if (!native) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      // Tauri waits for this before closing the window (⌘W, the close button and ⌘Q). A
      // throw here would leave the window unable to close, so errors are only logged.
      unlisten = await getCurrentWindow().onCloseRequested(async () => {
        await flushAll().catch(console.error);
      });
    });
    return () => {
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      unlisten?.();
    };
  }, []);

  const title = active ? (pages.find((p) => p.id === active.id)?.title ?? active.title) : null;
  const navPages = pages.map((p) => ({
    name: pageLabel(p.title),
    icon: <FileText />,
    isActive: p.id === activeId,
    onSelect: () => setActiveId(p.id),
    onDelete: () => setPendingDelete(p),
  }));

  // Layout from shadcn's sidebar-08 page.tsx. Changes: the panel scrolls inside itself, the header
  // is a window drag area with room for the traffic lights, and the crumbs are Pages and the title.
  return (
    <ToastProvider>
    <SidebarProvider className="isolate h-svh overflow-hidden" onOpenChange={setSidebarOpen} open={sidebarOpen} style={chrome(native)}>
      <AppSidebar onCreate={create} pages={navPages} />
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh_-_1rem)]">
        <header className="flex h-16 shrink-0 items-center gap-2" data-tauri-drag-region>
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
                <BreadcrumbItem className="hidden md:block">Pages</BreadcrumbItem>
                {title !== null && (
                  <>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbPage className="max-w-[40ch] truncate">{pageLabel(title)}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {active ? (
            <PageView key={active.id} onRename={rename} onSave={save} page={active} />
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>No page open</EmptyTitle>
                <EmptyDescription>Create a page to start writing.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={create}>
                  <Plus />
                  New page
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
      </SidebarInset>
      <DeletePageDialog
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => {
          remove(id);
          setPendingDelete(null);
        }}
        page={pendingDelete}
      />
    </SidebarProvider>
    </ToastProvider>
  );
}
