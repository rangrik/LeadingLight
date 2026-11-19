// COSS p-command-1, with workspace groups, recent pages, type creation and page actions.
// Changes: shared shortcut state, asynchronous body search, and split-aware navigation.
import { ArrowLeft, ArrowRight, Pin, PinOff, Plus, SquareSplitHorizontal, X } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AutocompleteRow } from "@leadinglight/ui/components/autocomplete";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { useIsMobile } from "@leadinglight/ui/hooks/use-media-query";
import { Button } from "@leadinglight/ui/components/button";
import { Command, CommandCollection, CommandDialog, CommandDialogPopup, CommandEmpty, CommandFooter, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList, CommandPanel } from "@leadinglight/ui/components/command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { RowIcon } from "~/components/page-icon";
import { SiteIcon } from "~/components/browser-sidebar";
import { available, browserFocused, enter, hostOf, leave, refocus, select, space as browser } from "~/lib/browser-space";
import { pageLabel } from "~/lib/labels";
import { phone, useMobile } from "~/lib/platform";
import { editPage, liveContent, liveEditor, whenLive } from "~/lib/live";
import { docText, pageTexts, type ObjectSummary } from "~/lib/objects";
import { focusedPage, openFresh, openFrom } from "~/lib/panes";
import { iconFor, isPageView, space, typeOf, typeView } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { ABOUT } from "~/lib/tail-memory";
import { closeSearch, createNote, openSearch, searchScopes, searchViews, workspaceSearch, type SearchView } from "~/lib/workspace-search";

type Modifiers = { shiftKey: boolean; metaKey: boolean };
type Item = { value: string; label: string; sub?: string; icon: ReactNode; page?: ObjectSummary; beside?: boolean; run(e: Modifiers): void | Promise<void> };
type Group = { value: string; items: Item[] };
const countPages = (count: number) => `${count} ${count === 1 ? "page" : "pages"}`;
const plain: Modifiers = { shiftKey: false, metaKey: false };
const PAGE_SIZE = 100;
const placeholders: Record<SearchView, string> = { search: "Search your workspace…", pages: "Find a page…", types: "Find a type…", tabs: "Find a browser tab…", create: "Find a type or name a page…" };
const typeGroups = [
  { name: "Writing", ids: ["page", "daily", "idea", "notebook"] },
  { name: "Planning", ids: ["task", "meeting", "project"] },
  { name: "Reference", ids: ["person", "book", "collection", "tag"] },
];

export function WorkspaceSearch({ returnFocus, onNavigate }: { returnFocus: RefObject<HTMLElement | null>; onNavigate?: () => void }) {
  const state = workspaceSearch.use();
  const navigated = useRef(false);
  const previous = useRef(state);
  if (previous.current !== state) { previous.current = state; if (state) navigated.current = false; }
  const close = () => { workspaceSearch.set(null); void refocus(); };
  const navigate = (fn: () => void) => {
    navigated.current = true;
    workspaceSearch.set(null);
    fn();
    onNavigate?.();
  };
  const restoreFocus = () => {
    const target = returnFocus.current;
    if (navigated.current || browserFocused() || !target?.isConnected || !target.getClientRects().length) return false;
    const id = focusedPage();
    const editor = id && target.matches('.ProseMirror[aria-label="Page body"]') ? liveEditor(id) : null;
    if (editor) { editor.refocus(); return false; }
    return target;
  };
  return (
    <CommandDialog open={!!state} onOpenChange={(open) => { if (!open) close(); }}>
      <CommandDialogPopup aria-label="Search library" className="ll-workspace-search max-h-[min(38rem,85svh)]" finalFocus={restoreFocus}>
        {state && <SearchContents view={state.view} navigate={navigate} />}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function SearchContents({ view, navigate }: { view: SearchView; navigate(fn: () => void): void }) {
  const { pages, types } = space.use();
  const { tabs } = browser.use();
  const canBrowse = available.use();
  const mobile = useMobile();
  const narrow = useIsMobile();
  const compact = mobile && narrow;
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [highlight, setHighlight] = useState("");
  const [body, setBody] = useState<{ query: string; hits: Map<string, string>; error?: boolean }>({ query: "", hits: new Map() });
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const modifiers = useRef(plain);
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLocaleLowerCase();
  const tokens = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);
  const matches = (...words: string[]) => tokens.every((token) => words.some((word) => word.toLocaleLowerCase().includes(token)));
  const searchPages = view === "search" || view === "pages";
  const createGrid = view === "create" && !q;
  useLayoutEffect(() => { setOffset(0); setError(""); }, [view]);
  useEffect(() => {
    if (!q || !searchPages) return;
    let current = true;
    const timer = setTimeout(() => {
      void pageTexts.read(pages).then((hits) => {
        if (!current) return;
        // An open editor can be newer than its last committed save.
        for (const p of pages) { const doc = liveContent(p.id); if (doc) hits.set(p.id, docText(doc)); }
        setBody({ query: q, hits });
      }, () => current && setBody({ query: q, hits: new Map(), error: true }));
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [q, searchPages, tokens, pages, retry]);
  const changeQuery = (next: string) => { setQuery(next); setOffset(0); setError(""); };
  const open = (id: string, e: Modifiers) => navigate(() => {
    leave();
    if (phone) openFresh(id); else openFrom(id, e);
    if (isPageView(id)) requestAnimationFrame(() => whenLive(id, (page) => page.focus()));
  });
  const create = async (id: string, title?: string) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try { await createNote(id, (show) => navigate(() => { leave(); show(); }), title); }
    catch { setError("Could not create this page. Try again."); }
    finally { working.current = false; setBusy(false); }
  };
  const titleRank = (title: string) => {
    const name = title.trim().toLocaleLowerCase();
    return name === q ? 2 : Number(name.startsWith(q));
  };
  const pageItems = useMemo(() => !searchPages ? [] : pages.filter((p) => !p.properties.templateOf && (p.typeId !== ABOUT || q)).filter((p) => !q || matches(pageLabel(p.title), typeOf(p.typeId).name, typeOf(p.typeId).plural, body.hits.get(p.id) ?? ""))
    .sort((a, b) => (q ? titleRank(b.title) - titleRank(a.title) : 0) || b.updatedAt - a.updatedAt || b.createdAt - a.createdAt), [searchPages, pages, types, q, tokens, body.hits]);
  const recent = view === "search" && !q;
  const start = Math.min(offset, Math.max(0, Math.ceil(pageItems.length / PAGE_SIZE) - 1) * PAGE_SIZE);
  const range = `${(start + 1).toLocaleString()}–${Math.min(start + PAGE_SIZE, pageItems.length).toLocaleString()} of ${pageItems.length.toLocaleString()}`;
  const results: Group[] = [];
  const add = (value: string, items: Item[]) => { if (items.length) results.push({ value, items }); };
  if (searchPages) {
    add(recent ? "Recent pages" : pageItems.length > PAGE_SIZE ? `Pages · ${range}` : "Pages", (recent ? pageItems.slice(0, 8) : pageItems.slice(start, start + PAGE_SIZE)).map((p) => ({
      value: `page:${p.id}`, label: pageLabel(p.title), sub: typeOf(p.typeId).name, icon: <RowIcon icon={iconFor(p)} />, page: p, beside: true, run: (e) => open(p.id, e),
    })));
    if (!recent && pageItems.length > PAGE_SIZE) add("More pages", [
      ...(start ? [{ value: "previous", label: "Previous 100 pages", icon: <ArrowLeft />, run: () => setOffset(start - PAGE_SIZE) }] : []),
      ...(start + PAGE_SIZE < pageItems.length ? [{ value: "next", label: "Next pages", sub: `${Math.min(PAGE_SIZE, pageItems.length - start - PAGE_SIZE)} more`, icon: <ArrowRight />, run: () => setOffset(start + PAGE_SIZE) }] : []),
    ]);
  }
  if ((view === "search" || view === "tabs") && canBrowse) add("Browser tabs", tabs.filter((t) => matches(t.title, t.url)).map((t) => ({
    value: `tab:${t.id}`, label: t.title || hostOf(t.url), sub: hostOf(t.url), icon: <SiteIcon tab={t} />, beside: true, run: (e) => navigate(() => { enter(); select(t.id, true, e.shiftKey); }),
  })));
  if (view === "types" || (view === "search" && q)) add("Types", types.filter((t) => (!t.made || (t.id !== ABOUT && pages.some((p) => p.typeId === t.id))) && matches(t.name, t.plural)).sort((a, b) => Number([b.name, b.plural].some((name) => name.toLocaleLowerCase() === q)) - Number([a.name, a.plural].some((name) => name.toLocaleLowerCase() === q))).map((t) => ({
    value: `type:${t.id}`, label: t.plural, sub: countPages(pages.filter((p) => p.typeId === t.id && !p.properties.templateOf).length), icon: <RowIcon icon={t.icon} />, beside: true, run: (e) => open(typeView(t.id), e),
  })));
  if (view === "create" || (view === "search" && q)) {
    const explicit = /^(?:new|create)(?:\s+|$)/i.exec(query.trim());
    const words = query.trim().slice(explicit?.[0].length ?? 0).trim();
    const needle = words.toLocaleLowerCase();
    const actions = types.filter((t) => !t.made).flatMap((t) => {
      const names = [t.name, t.plural].map((name) => name.toLocaleLowerCase());
      const prefix = names.sort((a, b) => b.length - a.length).find((name) => needle === name || needle.startsWith(name + " "));
      const title = explicit && prefix ? words.slice(prefix.length).trim() : "";
      if (title && t.id === "daily") return [];
      if (!title && !needle.split(/\s+/).every((word) => names.some((name) => name.includes(word)))) return [];
      const label = view === "create" ? t.name : `New ${t.name.toLocaleLowerCase()}`;
      return [{ id: t.id, rank: prefix?.length ?? 0, value: `new:${t.id}`, label: title ? `${label} “${title}”` : label,
        sub: !createGrid && t.id === "daily" ? "Today" : undefined, icon: <RowIcon icon={t.icon} />, run: () => create(t.id, title) }];
    }).sort((a, b) => b.rank - a.rank);
    if (createGrid) {
      for (const group of typeGroups) add(group.name, group.ids.flatMap((id) => actions.filter((a) => a.id === id)));
      add("My types", actions.filter((a) => !typeGroups.some((group) => group.ids.includes(a.id))));
    } else if (explicit && view === "search" && actions.some((action) => action.rank > 0)) {
      results.unshift({ value: "Create", items: actions });
    } else add("Create", actions);
  }
  const canNamePage = view === "create" || (view === "search" && body.query === q && !body.error);
  if (q && !results.length && canNamePage) {
    const title = query.trim();
    add("Create", [{ value: "new:title", label: `New page “${title}”`, icon: <Plus />, run: () => create(PAGE_TYPE, title) }]);
  }
  const active = results.flatMap((g) => g.items).find((i) => i.value === highlight) ?? results[0]?.items[0];
  const pin = async () => {
    if (!active?.page || working.current) return;
    setError("");
    try { await editPage(active.page.id, { properties: ({ pinned, ...rest }) => pinned ? rest : { ...rest, pinned: true } }); }
    catch { setError("Could not change this pin. Try again."); }
  };
  const searching = searchPages && !!q && body.query !== q;
  const renderItem = (item: Item) => (
    <CommandItem className="min-w-0 gap-2" key={item.value} aria-label={item.label} aria-current={item.page && item.page.id === focusedPage() ? "page" : undefined} value={item.value} disabled={busy} onPointerDownCapture={(event) => {
      // WebKit sends the tap's click only if the touch pointerdown keeps its default.
      if (event.pointerType === "touch") event.preventBaseUIHandler();
    }} onClick={(e) => {
      const keys = e.detail === 0 ? modifiers.current : e;
      modifiers.current = plain;
      void item.run(keys);
    }}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">{item.icon}</span><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.sub && <span className="max-w-[35%] shrink-0 truncate text-xs text-muted-foreground">{item.sub}</span>}
    </CommandItem>
  );
  return (
    <Command key={`${view}:${start}`} grid={createGrid} filter={null} items={results} value={query} onValueChange={changeQuery} onItemHighlighted={(value) => { if (value !== undefined) setHighlight(typeof value === "string" ? value : (value as Item)?.value ?? ""); }}>
      <div className="ll-search-controls">
        <div className="relative flex items-center gap-1 pe-3">
          <div className="min-w-0 flex-1"><CommandInput ref={input} aria-label={view === "create" ? "Choose page type" : "Search library"} placeholder={compact && view === "search" ? "Search…" : placeholders[view]} readOnly={busy} onKeyDownCapture={(e) => {
            modifiers.current = e.key === "Enter" ? { shiftKey: e.shiftKey, metaKey: e.metaKey } : plain;
            if (e.key === "Enter" && (e.shiftKey || e.metaKey) && active && !busy) {
              e.preventDefault(); e.stopPropagation(); void active.run(modifiers.current); modifiers.current = plain;
            }
          }} /></div>
          {view !== "create" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void create(PAGE_TYPE)}><Plus />New page</Button>}
          {mobile && <Button size="icon" variant="ghost" aria-label="Close search" onClick={closeSearch}><X /></Button>}
        </div>
        <div className="relative px-3 pb-2">
          <SegmentedControl size="sm" aria-label="Search category" render={<RadioGroupPrimitive value={view} disabled={busy} onValueChange={(v) => openSearch(v as SearchView)} />}>
            {searchViews.filter((v) => v !== "tabs" || canBrowse).map((v, i) => (
              <Tooltip key={v}>
                <TooltipTrigger render={<SegmentedControlItem className="max-[360px]:px-1" aria-keyshortcuts={`Meta+${i + 1} Control+${i + 1}`} render={<RadioPrimitive.Root value={v} />} onClick={() => input.current?.focus()} />}>{searchScopes[v]}</TooltipTrigger>
                <TooltipPopup>{searchScopes[v]} <Kbd>⌘{i + 1}</Kbd></TooltipPopup>
              </Tooltip>
            ))}
          </SegmentedControl>
        </div>
      </div>
      <CommandPanel>
        <CommandEmpty>{searching ? "Searching page text…" : view === "create" || view === "types" ? "No matching types." : view === "tabs" ? "No matching browser tabs." : q ? "No matches." : view === "search" ? "No recent pages yet." : "No pages yet."}</CommandEmpty>
        <CommandList>
          {(group: Group) => <Fragment key={group.value}><CommandGroup items={group.items}>
            <CommandGroupLabel>{group.value}</CommandGroupLabel>
            {createGrid ? group.items.map((item, i) => i % 2 === 0 && (
              <AutocompleteRow className="grid grid-cols-2 gap-x-2" key={item.value}>{group.items.slice(i, i + 2).map(renderItem)}</AutocompleteRow>
            )) : <CommandCollection>{renderItem}</CommandCollection>}
          </CommandGroup></Fragment>}
        </CommandList>
      </CommandPanel>
      {(error || (searchPages && body.query === q && body.error)) && <div role="status" className="relative px-4 py-2 text-sm text-destructive-foreground">{error || "Page text could not be searched. Title and type results are still available."}{!error && <Button size="sm" variant="ghost" onClick={() => setRetry((n) => n + 1)}>Retry</Button>}</div>}
      {(!mobile || (!phone && active?.beside)) && <CommandFooter className="relative flex-wrap px-3 py-2">
        {active?.beside ? <Button disabled={busy} size="sm" variant="ghost" onClick={() => void active.run({ shiftKey: true, metaKey: false })}><SquareSplitHorizontal /><span>{compact ? "Open in new pane" : "Open beside"}</span>{!mobile && <Kbd>⇧↩</Kbd>}</Button> : active && <span className="px-2"><Kbd>↩</Kbd> {active.value.startsWith("new:") ? "Create" : "Open"}</span>}
        {active?.page && <Button disabled={busy} size="sm" variant="ghost" onClick={() => void pin()}>{active.page.properties.pinned ? <PinOff /> : <Pin />}{active.page.properties.pinned ? "Unpin" : "Pin"}</Button>}
        {createGrid && <span className="hidden text-muted-foreground sm:inline">Try “new book Dune”</span>}
        {!mobile && <span className="ms-auto flex items-center gap-1.5"><Kbd>esc</Kbd>Close</span>}
      </CommandFooter>}
    </Command>
  );
}
