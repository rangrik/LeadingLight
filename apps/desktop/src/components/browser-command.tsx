// The browser space's command bar (features/browser-space.feature): ⌘T opens anything in a new tab,
// ⌘L or the pill goes somewhere in this one. COSS's command palette (p-command-1), sized to the design.
import { Bookmark, Globe, History, Link, Search, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@leadinglight/ui/components/command";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { cn } from "@leadinglight/ui/lib/utils";
import { SiteIcon } from "~/components/browser-sidebar";
import { browserAddress, type BrowserEntry } from "~/lib/browser-data";
import { bar, dataBase, go, hostOf, listed, refocus, select, space, type SpaceTab } from "~/lib/browser-space";
import { engine } from "~/lib/native-browser";
import { useBrowserData } from "~/lib/project-runtime/browser";

type Item = { value: string; label: string; sub?: string; icon: ReactNode; right?: ReactNode; disabled?: boolean; run(): void };
type Group = { value: string; items: Item[] };

// An address as the pill writes it: the host and path, without the scheme or www.
export const shortURL = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname === "/" && !u.search ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
};
const day = (time: number) => {
  const d = new Date(time);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : days === 1 ? "Yesterday" : days < 7 ? d.toLocaleDateString([], { weekday: "long" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const has = (q: string, ...texts: string[]) => texts.some((t) => t.toLowerCase().includes(q));
const Right = ({ children }: { children: ReactNode }) => <span className="shrink-0 text-[13px] text-muted-foreground">{children}</span>;

function groups(query: string, here: boolean, tabs: SpaceTab[], saved: BrowserEntry[], history: BrowserEntry[], copied: string | null, current: string): Group[] {
  const q = query.trim().toLowerCase();
  const close = () => bar.set(null);
  const run = (fn: () => unknown) => () => { close(); void Promise.resolve(fn()).catch(() => {}); };
  // An open tab is shown, never opened twice.
  const open = (url: string) => run(() => {
    const tab = tabs.find((t) => t.url === url);
    return tab ? select(tab.id, true) : go(url, here);
  });
  const order = listed(tabs);
  const tabItems = tabs.filter((t) => !(here && t.id === current) && (!q || has(q, t.title, t.url))).map((t): Item => {
    const n = order.indexOf(t) + 1;
    return { value: `tab:${t.id}`, label: t.title || hostOf(t.url), sub: hostOf(t.url), icon: <SiteIcon tab={t} />, right: n > 0 && n < 10 ? <Kbd>⌘{n}</Kbd> : undefined, run: run(() => select(t.id, true)) };
  });
  const entry = (kind: string, e: BrowserEntry, icon: ReactNode): Item => ({ value: `${kind}:${e.url}`, label: e.title || hostOf(e.url), sub: hostOf(e.url), icon, right: <Right>{day(e.time)}</Right>, run: open(e.url) });
  const openNow = new Set(tabs.map((t) => t.url));
  const savedItems = saved.filter((e) => !openNow.has(e.url) && (!q || has(q, e.title, e.url))).slice(0, q ? 4 : 3).map((e) => entry("saved", e, <Bookmark className="size-4 text-muted-foreground" />));
  const shownURLs = new Set(saved.map((e) => e.url));
  const historyItems = history.filter((e) => !openNow.has(e.url) && !shownURLs.has(e.url) && (!q || has(q, e.title, e.url))).slice(0, q ? 6 : 5).map((e) => entry("history", e, <History className="size-4 text-muted-foreground" />));
  const result: Group[] = [];
  if (q) {
    let typed: Item;
    try {
      const url = browserAddress(query);
      const search = url.startsWith("https://duckduckgo.com/?q=") && !/^https?:\/\//i.test(query.trim());
      typed = { value: `go:${url}`, label: search ? `Search for “${query.trim()}”` : shortURL(url), sub: search ? "DuckDuckGo" : here ? "In this tab" : "In a new tab", icon: search ? <Search className="size-4 text-muted-foreground" /> : <Globe className="size-4 text-muted-foreground" />, run: run(() => go(url, here)) };
    } catch (e) {
      typed = { value: "refused", label: e instanceof Error ? e.message : "That address can't be opened.", icon: <TriangleAlert className="size-4 text-warning-foreground" />, disabled: true, run() {} };
    }
    // ⌘T offers a matching open tab first; ⌘L loads what was typed in this tab first.
    const open: Group[] = tabItems.length ? [{ value: "Open tabs", items: tabItems.slice(0, 5) }] : [];
    const asked: Group = { value: here ? "Go to" : "Open", items: [typed] };
    result.push(...(here ? [asked, ...open] : [...open, asked]));
  } else {
    if (copied !== null && !here) {
      const read = async () => copied || (await (await engine)?.copiedLink(true)) || "";
      result.push({ value: "Copied link", items: [{ value: "copied", label: "Open copied link", sub: copied ? shortURL(copied) : "From the clipboard", icon: <Link className="size-4 text-muted-foreground" />, run: run(async () => { const url = await read(); if (url) await go(url, false); }) }] });
    }
    if (tabItems.length) result.push({ value: "Open tabs", items: tabItems });
  }
  if (savedItems.length) result.push({ value: q ? "Saved" : "Saved lately", items: savedItems });
  if (historyItems.length) result.push({ value: "History", items: historyItems });
  return result;
}

export function BrowserCommand() {
  const state = bar.use();
  const { tabs, base, selected } = space.use();
  const [data] = useBrowserData(dataBase(base));
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const here = state?.mode === "here";
  // Each opening starts from its own text, set before it paints so ⌘L's address is selected.
  const [opened, setOpened] = useState(state);
  if (opened !== state) {
    setOpened(state);
    if (state) { setQuery(state.text); setCopied(null); }
  }
  useEffect(() => {
    if (state?.mode !== "new") return;
    let live = true;
    void engine.then((e) => e?.copiedLink(false)).then((link) => live && setCopied(link ?? null), () => {});
    return () => { live = false; };
  }, [state]);
  const items = useMemo(() => groups(query, here, tabs, data.bookmarks, data.history, copied, selected), [query, here, tabs, data, copied, selected]);
  return (
    <CommandDialog onOpenChange={(open) => { if (!open) { bar.set(null); void refocus(); } }} open={!!state}>
      <CommandDialogPopup data-browser-command aria-label={here ? "Go somewhere in this tab" : "Open"} backdropClassName="bg-black/16 backdrop-blur-none dark:bg-black/34" className="max-h-[min(34rem,80vh)] max-w-[40rem] rounded-[0.875rem] before:hidden sm:mt-8">
        <Command filter={null} items={items} onValueChange={setQuery} value={query}>
          <div className="border-b">
            <CommandInput aria-label="Search or enter address" className="text-base sm:h-10 sm:text-base" onFocus={(e) => e.currentTarget.select()} placeholder="Search or enter address" />
          </div>
          <CommandList className="not-empty:px-0 not-empty:pt-0 not-empty:pb-2">
            {(group: Group) => (
              <Fragment key={group.value}>
                <CommandGroup items={group.items}>
                  <CommandGroupLabel className="px-4 pt-2.5 pb-1 leading-4">{group.value}</CommandGroupLabel>
                  <CommandCollection>
                    {(item: Item) => (
                      <CommandItem className="mx-2 h-10 gap-2.5 rounded-lg px-2 sm:min-h-10" disabled={item.disabled} key={item.value} onClick={item.run} value={item.value}>
                        {item.icon}
                        <span className="min-w-0 shrink truncate">{item.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{item.sub}</span>
                        {item.right ?? <Kbd className={cn("invisible", !item.disabled && "in-data-highlighted:visible")}>↩</Kbd>}
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </Fragment>
            )}
          </CommandList>
          <CommandFooter className="relative h-[38px] justify-start gap-4 px-4 py-0">
            <span className="flex items-center gap-1.5"><Kbd>↩</Kbd>Open</span>
            <span className="ms-auto flex items-center gap-1.5"><Kbd>esc</Kbd>Close</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
