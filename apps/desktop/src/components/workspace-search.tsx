// COSS p-command-1, with workspace groups, recent pages, type creation and page actions.
// Changes: shared shortcut state, asynchronous body search, and split-aware navigation.
import { ArrowLeft, FolderOpen, Layers, Pin, PinOff, Plus, SquareSplitHorizontal } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Command, CommandCollection, CommandDialog, CommandDialogPopup, CommandEmpty, CommandFooter, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList, CommandPanel } from "@leadinglight/ui/components/command";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { RowIcon } from "~/components/page-icon";
import { SiteIcon } from "~/components/browser-sidebar";
import { available, enter, hostOf, leave, refocus, select, space as browser } from "~/lib/browser-space";
import { pageLabel } from "~/lib/labels";
import { editPage, liveContent } from "~/lib/live";
import { docText, objects, type ObjectSummary } from "~/lib/objects";
import { focusedPage, openFrom } from "~/lib/panes";
import { iconFor, space, typeOf, typeView } from "~/lib/space";
import { ABOUT } from "~/lib/tail-memory";
import { createNote, workspaceSearch, type SearchView } from "~/lib/workspace-search";

type Modifiers = { shiftKey: boolean; metaKey: boolean };
type Item = { value: string; label: string; sub?: string; icon: ReactNode; page?: ObjectSummary; beside?: boolean; run(e: Modifiers): void | Promise<void> };
type Group = { value: string; items: Item[] };
const countPages = (count: number) => `${count} ${count === 1 ? "page" : "pages"}`;
const plain: Modifiers = { shiftKey: false, metaKey: false };
const names: Record<SearchView, string> = { search: "Search library", pages: "All pages", types: "Types", create: "Create page" };

export function WorkspaceSearch() {
  const state = workspaceSearch.use();
  const navigated = useRef(false);
  const previous = useRef(state);
  if (previous.current !== state) { previous.current = state; if (state) navigated.current = false; }
  const close = () => { workspaceSearch.set(null); void refocus(); };
  const navigate = (fn: () => void) => {
    navigated.current = true;
    workspaceSearch.set(null);
    fn();
  };
  return (
    <CommandDialog open={!!state} onOpenChange={(open) => { if (!open) close(); }}>
      <CommandDialogPopup aria-label="Search library" className="max-h-[min(38rem,85svh)]" finalFocus={() => !navigated.current}>
        {state && <SearchContents initial={state.view} navigate={navigate} />}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function SearchContents({ initial, navigate }: { initial: SearchView; navigate(fn: () => void): void }) {
  const { pages, types } = space.use();
  const { tabs } = browser.use();
  const canBrowse = available.use();
  const [view, setView] = useState(initial);
  const [query, setQuery] = useState("");
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
  useEffect(() => {
    if (!q || !searchPages) return;
    let current = true;
    const timer = setTimeout(() => {
      void Promise.all(tokens.map((token) => objects.containing(token))).then((found) => {
        if (!current) return;
        const hits = new Map(found.flat().map((p) => [p.id, docText(liveContent(p.id) ?? p.content)]));
        // An open editor can be newer than its last committed save.
        for (const p of pages) { const doc = liveContent(p.id); if (doc) hits.set(p.id, docText(doc)); }
        setBody({ query: q, hits });
      }, () => current && setBody({ query: q, hits: new Map(), error: true }));
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [q, searchPages, tokens, pages, retry]);
  const changeView = (next: SearchView) => { setView(next); setQuery(""); setError(""); input.current?.focus(); };
  const open = (id: string, e: Modifiers) => navigate(() => { leave(); openFrom(id, e); });
  const create = async (id: string) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try { await createNote(id, navigate); }
    catch { setError("Could not create this page. Try again."); }
    finally { working.current = false; setBusy(false); }
  };
  const pageItems = pages.filter((p) => !p.properties.templateOf && (p.typeId !== ABOUT || q)).filter((p) => !q || matches(pageLabel(p.title), typeOf(p.typeId).name, typeOf(p.typeId).plural, body.query === q ? body.hits.get(p.id) ?? "" : ""))
    .sort((a, b) => Number(!!q && b.title.toLocaleLowerCase().startsWith(q)) - Number(!!q && a.title.toLocaleLowerCase().startsWith(q)) || b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  const results: Group[] = [];
  const add = (value: string, items: Item[]) => { if (items.length) results.push({ value, items }); };
  if (searchPages) {
    add(!q && view === "search" ? "Recent pages" : "Pages", (view === "search" && !q ? pageItems.slice(0, 8) : pageItems).map((p) => ({
      value: `page:${p.id}`, label: pageLabel(p.title), sub: typeOf(p.typeId).name, icon: <RowIcon icon={iconFor(p)} />, page: p, beside: true, run: (e) => open(p.id, e),
    })));
  }
  if (view === "search" && !q) add("Library", [
    { value: "create", label: "Create page…", sub: "Choose any type", icon: <Plus />, run: () => changeView("create") },
    { value: "pages", label: "Browse all pages", sub: countPages(pageItems.length), icon: <FolderOpen />, run: () => changeView("pages") },
    { value: "types", label: "Browse types", icon: <Layers />, run: () => changeView("types") },
  ]);
  if (view === "search" && canBrowse) add("Browser tabs", tabs.filter((t) => matches(t.title, t.url)).map((t) => ({
    value: `tab:${t.id}`, label: t.title || hostOf(t.url), sub: hostOf(t.url), icon: <SiteIcon tab={t} />, beside: true, run: (e) => navigate(() => { enter(); select(t.id, true, e.shiftKey); }),
  })));
  if (view === "types" || (view === "search" && q)) add("Types", types.filter((t) => (!t.made || (t.id !== ABOUT && pages.some((p) => p.typeId === t.id))) && matches(t.name, t.plural)).map((t) => ({
    value: `type:${t.id}`, label: t.plural, sub: countPages(pages.filter((p) => p.typeId === t.id && !p.properties.templateOf).length), icon: <RowIcon icon={t.icon} />, beside: true, run: (e) => open(typeView(t.id), e),
  })));
  if (view === "create" || (view === "search" && q)) {
    const wanted = q.replace(/^(?:new|create)\b\s*/, "").split(/\s+/).filter(Boolean);
    add("Create", types.filter((t) => !t.made && wanted.every((word) => `${t.name} ${t.plural}`.toLocaleLowerCase().includes(word))).sort((a, b) => Number(b.name.toLocaleLowerCase() === wanted.join(" ")) - Number(a.name.toLocaleLowerCase() === wanted.join(" "))).map((t) => ({
      value: `new:${t.id}`, label: `New ${t.name.toLocaleLowerCase()}`, sub: t.id === "daily" ? "Today" : "New tab", icon: <Plus />, run: () => create(t.id),
    })));
  }
  const active = results.flatMap((g) => g.items).find((i) => i.value === highlight) ?? results[0]?.items[0];
  const pin = async () => {
    if (!active?.page || working.current) return;
    try { await editPage(active.page.id, { properties: ({ pinned, ...rest }) => pinned ? rest : { ...rest, pinned: true } }); }
    catch { setError("Could not change this pin. Try again."); }
  };
  const searching = searchPages && !!q && body.query !== q;
  return (
    <Command filter={null} items={results} value={query} onValueChange={setQuery} onItemHighlighted={(value) => { if (value !== undefined) setHighlight(typeof value === "string" ? value : (value as Item)?.value ?? ""); }}>
      {view !== "search" && <div className="relative flex items-center gap-2 px-3 pt-2 text-sm"><Button aria-label="Back to search" size="icon-sm" variant="ghost" onClick={() => changeView("search")}><ArrowLeft /></Button><span>{names[view]}</span></div>}
      <CommandInput ref={input} aria-label={view === "create" ? "Choose page type" : "Search library"} placeholder={view === "create" ? "Choose a type…" : "Search pages, types, tabs…"} readOnly={busy} onKeyDownCapture={(e) => {
        modifiers.current = e.key === "Enter" ? { shiftKey: e.shiftKey, metaKey: e.metaKey } : plain;
        if (e.key === "Enter" && (e.shiftKey || e.metaKey) && active && !busy) {
          e.preventDefault(); e.stopPropagation(); void active.run(modifiers.current); modifiers.current = plain;
        }
      }} />
      <CommandPanel>
        <CommandEmpty>{searching ? "Searching page text…" : "No matches. Try a page title, words from a page, or a type."}</CommandEmpty>
        <CommandList>
          {(group: Group) => <Fragment key={group.value}><CommandGroup items={group.items}>
            <CommandGroupLabel>{group.value}</CommandGroupLabel>
            <CommandCollection>{(item: Item) => <CommandItem className="gap-2" key={item.value} aria-label={item.label} aria-current={item.page?.id === focusedPage() ? "page" : undefined} value={item.value} disabled={busy} onClick={(e) => {
              const keys = e.detail === 0 ? modifiers.current : e;
              modifiers.current = plain;
              void item.run(keys);
            }}>
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">{item.icon}</span><span className="min-w-0 flex-1 truncate">{item.label}</span><span className="max-w-[35%] shrink-0 truncate text-xs text-muted-foreground">{item.sub}</span>
            </CommandItem>}</CommandCollection>
          </CommandGroup></Fragment>}
        </CommandList>
      </CommandPanel>
      {(error || (body.query === q && body.error)) && <div role="status" className="relative px-4 py-2 text-sm text-destructive-foreground">{error || "Page text could not be searched. Title and type results are still available."}{!error && <Button size="sm" variant="ghost" onClick={() => setRetry((n) => n + 1)}>Retry</Button>}</div>}
      <CommandFooter className="relative flex-wrap px-3 py-2">
        {active?.beside ? <Button disabled={busy} size="sm" variant="ghost" onClick={() => void active.run({ shiftKey: true, metaKey: false })}><SquareSplitHorizontal /><span>Open beside</span><Kbd>⇧↩</Kbd></Button> : <span className="px-2"><Kbd>↩</Kbd> {view === "create" ? "Create" : "Open"}</span>}
        {active?.page && <Button disabled={busy} size="sm" variant="ghost" onClick={() => void pin()}>{active.page.properties.pinned ? <PinOff /> : <Pin />}{active.page.properties.pinned ? "Unpin" : "Pin"}</Button>}
        <span className="ms-auto flex items-center gap-1.5"><Kbd>esc</Kbd>Close</span>
      </CommandFooter>
    </Command>
  );
}
