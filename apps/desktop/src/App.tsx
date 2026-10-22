import { citesIn, type PageStyle, type QuoteTarget } from "@leadinglight/editor/editor";
import { Ellipsis, FileText, PenLine, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@leadinglight/ui/components/breadcrumb";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@leadinglight/ui/components/menu";
import { Separator } from "@leadinglight/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@leadinglight/ui/components/sidebar";
import { ToastProvider, toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { DeletePageDialog } from "@/components/delete-page-dialog";
import { type PageHandle, PageView } from "@/components/page-view";
import { Pane } from "@/components/pane";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { pageLabel, pageStyle } from "@/lib/labels";
import { childOf, createChild, parentOf, parseHref, type Role, roleOf } from "@/lib/linked";
import { openLink } from "@/lib/links";
import { type LLObject, type ObjectPatch, type ObjectSummary, objects } from "@/lib/objects";
import { isNative } from "@/lib/platform";
import { flushAll, reportSaveError } from "@/lib/saving";

const SIDEBAR_KEY = "ll.sidebar.open";

// Both sides open need room for the source with its sidenote margin and for the essay; with less,
// the side not being worked in folds (see Pane). The panes' basis-[…] classes match.
const SOURCE_MIN = 832;
const ESSAY_MIN = 520;

type Quote = Parameters<PageHandle["insertQuote"]>[0];

// Room for the macOS traffic lights, which tauri.conf.json centres on the panel header's
// middle line (y 26; they span x 18-78). Measured from AppKit's frames: centre = position.y - 2.
// The app's header is 36 px, level with the lights; a browser keeps sidebar-08's 64 px, level
// with the sidebar's logo row.
const chrome = (native: boolean) =>
  ({
    "--traffic-top": native ? "24px" : "0px",
    "--traffic-left": native ? "72px" : "0px",
    "--header-height": native ? "36px" : "64px",
  }) as React.CSSProperties;

function useSystemTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

const essayLabel = (title: string) => title.trim() || "Essay";

export default function App() {
  useSystemTheme();
  const [pages, setPages] = useState<ObjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<LLObject | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "false");
  const [native, setNative] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ObjectSummary | null>(null);
  // The essay beside the active page, and which side is being worked in.
  const [essayOpen, setEssayOpen] = useState(false);
  const [essay, setEssay] = useState<LLObject | null>(null);
  const [focus, setFocus] = useState<"source" | "essay">("source");
  const [room, setRoom] = useState(true);
  const [reveal, setReveal] = useState<{ page: string; anchor: string } | null>(null);
  // Which quotes a page's essay still holds, so its quoted words follow the essay.
  const [liveQuotes, setLiveQuotes] = useState<{ page: string; ids: string[] } | null>(null);
  const essayRef = useRef<PageHandle>(null);
  const sourceRef = useRef<PageHandle>(null);
  const quotes = useRef<Quote[]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => void isNative.then(setNative), []);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen)), [sidebarOpen]);

  useEffect(() => {
    objects
      .list()
      .then((list) => {
        setPages(list);
        setActiveId((list.find((p) => !parentOf(p)) ?? list[0])?.id ?? null);
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

  const essayId = essayOpen && active ? childOf(active, "essay") : undefined;
  useEffect(() => {
    if (!essayId) return setEssay(null);
    let stale = false;
    objects
      .get(essayId)
      .then((obj) => !stale && setEssay((prev) => (prev?.id === essayId ? prev : obj)))
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [essayId]);

  // An open essay reports its quotes itself; otherwise they're read from the stored essay. A page
  // with no essay keeps no quotes.
  const essayLink = active ? childOf(active, "essay") : undefined;
  const essayOpenRef = useRef(essayOpen);
  essayOpenRef.current = essayOpen;
  useEffect(() => {
    if (!active) return;
    if (!essayLink) return setLiveQuotes({ page: active.id, ids: [] });
    if (essayOpenRef.current) return;
    let stale = false;
    objects
      .get(essayLink)
      .then((obj) => !stale && setLiveQuotes({ page: active.id, ids: citesIn(obj?.content) }))
      .catch(console.error);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, essayLink]);

  // Quotes made while the essay was closed land once it has opened.
  useEffect(() => {
    if (essay && essayRef.current) for (const q of quotes.current.splice(0)) essayRef.current.insertQuote(q);
  }, [essay]);

  const areaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.offsetWidth >= SOURCE_MIN + ESSAY_MIN));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // An essay opens beside its page; any other page opens on its own. The open page keeps its essay.
  const select = (id: string) => {
    const page = pages.find((p) => p.id === id);
    const parent = page && roleOf(page) === "essay" ? parentOf(page) : undefined;
    setReveal(null);
    if (parent && pages.some((p) => p.id === parent)) {
      setActiveId(parent);
      setEssayOpen(true);
      setFocus("essay");
      return;
    }
    if (id !== activeId) setEssayOpen(false);
    setActiveId(id);
    setFocus("source");
  };

  const create = useCallback(() => {
    objects
      .create()
      .then((obj) => {
        setPages((prev) => [obj, ...prev]);
        setActive(obj);
        setActiveId(obj.id);
        setEssayOpen(false);
      })
      .catch(console.error);
  }, []);

  // A deleted Thoughts page or essay is unlinked from its page, which can then make a new one.
  const remove = (id: string) => {
    const page = pages.find((p) => p.id === id);
    const parent = page && parentOf(page);
    const role = page && roleOf(page);
    objects.remove(id).catch(console.error);
    if (parent && role) setProps(parent, { [role]: undefined });
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (id === activeId) setActiveId(pages.find((p) => p.id !== id && !parentOf(p))?.id ?? null);
    if (id === essay?.id) setEssayOpen(false);
  };

  // The sidebar and the breadcrumb follow the title as it is typed; saving is debounced.
  const rename = useCallback((id: string, title: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, title } : p)));
  }, []);

  const save = useCallback((id: string, patch: ObjectPatch) => objects.update(id, patch).catch(reportSaveError), []);

  // Properties are saved whole, so they're always merged into the page's latest copy.
  const setProps = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const page = pagesRef.current.find((p) => p.id === id);
      if (!page) return;
      const properties = { ...page.properties, ...patch };
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, properties } : p)));
      setActive((prev) => (prev?.id === id ? { ...prev, properties } : prev));
      void save(id, { properties });
    },
    [save],
  );

  const link = useCallback(
    (parent: string, role: Role, child: LLObject) => {
      setPages((prev) => [child, ...prev]);
      setProps(parent, { [role]: child.id });
    },
    [setProps],
  );

  // `focus` is the side that stays open when there's no room for both.
  const openEssay = async (focus: "source" | "essay" = "essay") => {
    if (!active) return;
    if (!childOf(active, "essay")) {
      const made = await createChild(active, "essay");
      link(active.id, "essay", made);
      setEssay(made);
    }
    setEssayOpen(true);
    setFocus(focus);
    setSidebarOpen(false);
  };

  // In-app links open their page (an essay beside its source) and scroll to the anchor.
  const open = (href: string) => {
    const target = parseHref(href);
    if (!target) return openLink(href);
    if (target.page === essay?.id && essayOpen) {
      setFocus("essay");
      return target.anchor && essayRef.current?.reveal(target.anchor);
    }
    if (target.page === active?.id) {
      setFocus("source");
      return target.anchor && sourceRef.current?.reveal(target.anchor);
    }
    if (!pagesRef.current.some((p) => p.id === target.page)) return;
    select(target.page);
    if (target.anchor) setReveal({ page: target.page, anchor: target.anchor });
  };

  const quoteTo: QuoteTarget | undefined =
    active && childOf(active, "essay")
      ? {
          essay: childOf(active, "essay")!,
          // Quoting keeps the reader in the source; a folded essay says where the quote went.
          add: (text, id) => {
            const quote = { text, id, href: `ll:${active.id}#${id}`, label: pageLabel(pages.find((p) => p.id === active.id)?.title ?? "") };
            if (essayOpen && essay && essayRef.current) essayRef.current.insertQuote(quote);
            else {
              quotes.current.push(quote);
              void openEssay("source");
            }
            if (!room) toastManager.add({ type: "success", title: "Added to the essay", description: `Quoted in “${essayLabel(titleOf(childOf(active, "essay")!))}”.` });
          },
        }
      : undefined;

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

  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? "";
  const title = active ? titleOf(active.id) : null;
  const shown = (p: ObjectSummary) => !parentOf(p) || !pages.some((q) => q.id === parentOf(p));
  const navPages = pages.filter(shown).map((p) => {
    const kids = pages.filter((c) => parentOf(c) === p.id).sort((a, b) => (roleOf(a) === "thoughts" ? -1 : roleOf(b) === "thoughts" ? 1 : 0));
    const isOn = (c: ObjectSummary) => c.id === activeId || (roleOf(c) === "essay" && essayOpen && activeId === p.id);
    return {
      name: pageLabel(p.title),
      icon: <FileText />,
      isActive: p.id === activeId,
      onSelect: () => select(p.id),
      onDelete: () => setPendingDelete(p),
      open: p.id === activeId || kids.some(isOn),
      children: kids.map((c) => ({
        name: roleOf(c) === "thoughts" ? "Thoughts" : essayLabel(c.title),
        isActive: isOn(c),
        onSelect: () => select(c.id),
        onDelete: () => setPendingDelete(c),
      })),
    };
  });

  const canEssay = active && !roleOf(active);
  const sourceFolded = essayOpen && !room && focus === "essay";
  const essayFolded = !room && focus === "source";
  const page = (p: LLObject, ref: React.Ref<PageHandle>, quote?: QuoteTarget, onCites?: (ids: string[]) => void) => (
    <PageView
      key={p.id}
      onCites={onCites}
      onOpen={open}
      onRename={rename}
      onSave={save}
      onNote={(thoughts) => {
        if (thoughts) link(p.id, "thoughts", thoughts);
        setSidebarOpen(false);
        setFocus("source");
      }}
      page={p}
      quoteTo={quote}
      quotes={liveQuotes?.page === p.id ? liveQuotes.ids : null}
      ref={ref}
      reveal={reveal?.page === p.id ? reveal.anchor : undefined}
    />
  );

  // Layout from shadcn's sidebar-08 page.tsx. Changes: the panel scrolls inside itself, the header
  // is 36 px in the app (see chrome) and a window drag area with room for the traffic lights, and
  // the crumbs are Pages and the title.
  return (
    <ToastProvider>
    <SidebarProvider className="isolate h-svh overflow-hidden" onOpenChange={setSidebarOpen} open={sidebarOpen} style={chrome(native)}>
      <AppSidebar onCreate={create} pages={navPages} />
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh_-_1rem)]">
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
                <BreadcrumbItem className="hidden md:block">Pages</BreadcrumbItem>
                {active && parentOf(active) && pages.some((p) => p.id === parentOf(active)) && (
                  <>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem className="hidden min-w-0 md:block">
                      <BreadcrumbLink className="max-w-[24ch] truncate" render={<button onClick={() => select(parentOf(active)!)} type="button" />}>
                        {pageLabel(titleOf(parentOf(active)!))}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </>
                )}
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
          {active && (
            <Menu>
              <MenuTrigger render={<Button aria-label="Page options" className="mr-3 ml-auto size-7" size="icon" variant="ghost" />}>
                <Ellipsis />
              </MenuTrigger>
              <MenuPopup align="end" className="w-44">
                {canEssay && (
                  <>
                    <MenuItem disabled={essayOpen} onClick={() => void openEssay()}>
                      <PenLine className="text-muted-foreground" />
                      {childOf(active, "essay") ? "Open essay" : "Write essay"}
                    </MenuItem>
                    <MenuSeparator />
                  </>
                )}
                <MenuGroup>
                  <MenuGroupLabel>Style</MenuGroupLabel>
                  <MenuRadioGroup onValueChange={(value) => setProps(active.id, { style: value as PageStyle })} value={pageStyle(active)}>
                    <MenuRadioItem closeOnClick value="plain">
                      Plain
                    </MenuRadioItem>
                    <MenuRadioItem closeOnClick value="playful">
                      Playful
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          )}
        </header>
        {active ? (
          <div className="flex min-h-0 flex-1" ref={areaRef}>
            <Pane
              className={cn(essayOpen && !sourceFolded && "basis-[832px]")}
              folded={sourceFolded}
              label={pageLabel(title ?? "")}
              onFocus={() => setFocus("source")}
              onUnfold={() => setFocus("source")}
            >
              {page(active, sourceRef, quoteTo)}
            </Pane>
            {essayOpen && essay && (
              <Pane
                className={cn("border-l", !essayFolded && "basis-[520px]")}
                folded={essayFolded}
                header={
                  // Over the page's top padding, so both titles share a line.
                  <div className="absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-between pr-3 pl-4 text-muted-foreground text-sm">
                    Essay
                    <Button aria-label="Close essay" className="size-7" onClick={() => setEssayOpen(false)} size="icon" variant="ghost">
                      <X />
                    </Button>
                  </div>
                }
                label={essayLabel(titleOf(essay.id))}
                onFocus={() => setFocus("essay")}
                onUnfold={() => setFocus("essay")}
              >
                {page(essay, essayRef, undefined, (ids) => setLiveQuotes({ page: active.id, ids }))}
              </Pane>
            )}
          </div>
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
