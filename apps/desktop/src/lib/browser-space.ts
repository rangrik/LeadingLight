// The browser space (features/browser-space.feature): my tabs, pinned sites and what the page area
// shows, kept on this Mac so they come back at launch. Pages are the engine's (lib/native-browser.ts).
import { useEffect, useState } from "react";
import { browserAddress, browserKey, readBrowserData, safeBrowserURL, type BrowserData, type BrowserEntry } from "~/lib/browser-data";
import { spaceKeys } from "~/lib/keymap";
import { localPrefs } from "~/lib/local-prefs";
import { engine, type Opened, type PageState } from "~/lib/native-browser";
import { browserBase, type BrowserTab } from "~/lib/project-runtime/browser";
import { listChats } from "~/lib/project-runtime/chat";
import { ask } from "~/lib/project-runtime/transport";
import { BROWSER_HOME, browserPage, browserTabId, dropPage, focusPane, focusedPage, holder, isPersonalBrowser, lastTabClose, leaves, openBeside, openPage, openTab as openWorkspaceTab, panes, restoreBrowserTab, showIn, tabPosition, type TabPosition } from "~/lib/panes";
import { createStore } from "~/lib/state";

export type SpaceTab = { id: string; url: string; title: string; icon?: string; pin?: string; from?: string };
export type Site = { id: string; url: string; title: string; icon?: string };
export type Live = { loading: boolean; progress: number; back: boolean; forward: boolean; failed: string | null; zoom: number };
export type AgentTab = { base: string; tab: string; name: string; url: string; busy: boolean };
export type Shown = { kind: "tab" } | { kind: "saved" } | { kind: "history" } | { kind: "agent"; base: string; tab: string };
export type Bar = { mode: "new" | "here"; text: string };

type Closed = Omit<SpaceTab, "id"> & { at?: number; time?: number; position?: TabPosition };
// icons: the last sites' icons by host, for history and saved rows, which have no tab.
type Kept = { tabs: SpaceTab[]; selected: string; closed: Closed[]; pinned: Site[]; base: string; icons: Record<string, string> };
const prefs = localPrefs<Kept>("ll.browser.space", { tabs: [], selected: "", closed: [], pinned: [], base: "", icons: {} });

// Damaged storage is dropped piece by piece, never trusted: a bad address must not load.
const ID = /^[a-zA-Z0-9-]{1,64}$/;
const icon = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/") && v.length < 40_000 ? v : undefined);
function entries<T extends { url: string; title: string; icon?: string }>(list: unknown, max: number, id = false, blanks = false): T[] {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && (safeBrowserURL(e.url) || (blanks && e.url === "")) && typeof e.title === "string" && (!id || (typeof e.id === "string" && ID.test(e.id)))).slice(0, max).map((e) => ({ ...e, icon: icon(e.icon) }));
}
{
  const p = prefs.get();
  const tabs = entries<SpaceTab>(p.tabs, 200, true, true);
  const icons = Object.fromEntries(Object.entries(p.icons && typeof p.icons === "object" ? p.icons : {}).filter(([, v]) => icon(v)));
  prefs.set({ tabs, selected: tabs.some((t) => t.id === p.selected) ? p.selected : (tabs[0]?.id ?? ""), closed: entries(p.closed, 20, false, true), pinned: entries<Site>(p.pinned, 40, true), base: typeof p.base === "string" ? p.base : "", icons });
}

export const space = prefs;
export const live = createStore<Record<string, Live>>({});
export const shown = createStore<Shown>({ kind: "tab" });
export const bar = createStore<Bar | null>(null);
// The pill says "Saved" for a moment after ⌘D.
export const savedNote = createStore(0);
// Tabs an Ask turn works in (lib/page-tools.ts): their row's sparkle, the pill and the page's edge.
export const acting = createStore<Record<string, { state: "working" | "waiting"; thread: string; who: string }>>({});
// Each tab's page, once asked for; callers wait on the same opening so none places a view not yet made.
const made = new Map<string, Promise<unknown>>();
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
export const hostOf = (url: string) => (safeBrowserURL(url) ? new URL(url).host.replace(/^www\./, "") : "");
export const listed = (tabs: SpaceTab[]) => tabs.filter((t) => !t.pin);
const DEFAULT_LIVE: Live = { loading: false, progress: 0, back: false, forward: false, failed: null, zoom: 1 };
export const liveOf = (id: string) => live.get()[id] ?? DEFAULT_LIVE;

// The space can be shown in the Mac app, and in the browser build under the QA flag only.
export const available = createStore(false);
void engine.then((e) => available.set(!!e));
export const browserFocused = () => available.get() && isPersonalBrowser(focusedPage());
const tabView = { kind: "tab" } as const;
export const browserView = (selected: string, home: Shown) => selected ? tabView : home;

function showBrowser(page = browserPage(prefs.get().selected), beside = false) {
  void findBase();
  if (beside) return openBeside(page);
  if (holder(page)) return openPage(page);
  const { root } = panes.get();
  if (root && !browserFocused()) {
    const existing = leaves(root).find((l) => isPersonalBrowser(l.page));
    if (existing) focusPane(existing.id);
    else {
      const previous = browserPage(prefs.get().selected);
      if (holder(previous)) openPage(previous);
    }
  }
  openPage(page);
}

export function showBrowserList(view: Shown) { showBrowser(BROWSER_HOME); shown.set(view); }

function setTabs(tabs: SpaceTab[], selected = prefs.get().selected) {
  prefs.set({ tabs, selected: tabs.some((t) => t.id === selected) ? selected : "" });
}
function patchTab(id: string, patch: Partial<SpaceTab>) {
  setTabs(prefs.get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}
function setLive(id: string, patch: Partial<Live>) {
  live.set({ ...live.get(), [id]: { ...liveOf(id), ...patch } });
}

// Makes a restored tab's page the first time it is shown.
export async function ensure(id: string) {
  const e = await engine;
  const tab = prefs.get().tabs.find((t) => t.id === id);
  if (!e || !tab) return;
  if (!made.has(id)) made.set(id, e.open(id, tab.url || undefined).catch(() => {}));
  await made.get(id);
}

// Back to the page in view, as when the command bar is dismissed.
export async function refocus() {
  const id = prefs.get().selected;
  if (id && browserTabId(focusedPage()) === id && made.has(id) && prefs.get().tabs.some((t) => t.id === id && t.url)) await (await engine)?.focus(id).catch(() => {});
}

export function select(id: string, focus = false, beside = false) {
  if (focus) showBrowser(browserPage(id), beside);
  prefs.set({ selected: id });
  void ensure(id).then(async () => focus && focusedPage() === browserPage(id) && (await engine)?.focus(id).catch(() => {}));
}

// Where a new tab goes: at a reopened tab's old place, else after the tab it came from and after
// the ones opened from it before.
function place(tabs: SpaceTab[], tab: SpaceTab, after?: string, back?: number) {
  if (back !== undefined) return [...tabs.slice(0, back), tab, ...tabs.slice(back)];
  let at = tabs.findIndex((t) => t.id === after);
  if (at < 0) return [...tabs, tab];
  while (tabs[at + 1]?.from === after) at++;
  return [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

export async function openTab(url: string, { after = prefs.get().selected, front = true, pin, at, beside = false, position }: { after?: string; front?: boolean; pin?: string; at?: number; beside?: boolean; position?: TabPosition } = {}) {
  const e = await engine;
  if (!e) return;
  const id = newId("t");
  const opening = e.open(id, url || undefined).catch(() => {});
  made.set(id, opening);
  setTabs(place(prefs.get().tabs, { id, url, title: hostOf(url) || "New tab", pin, from: front ? undefined : after }, after, at));
  await opening;
  if (position) restoreBrowserTab(browserPage(id), position);
  else if (front) select(id, true, beside);
}

export function newBrowserTab(beside: boolean) {
  const id = newId("t");
  const { tabs, selected } = prefs.get();
  setTabs(place(tabs, { id, url: "", title: "New tab" }, selected), id);
  (beside ? openBeside : openWorkspaceTab)(browserPage(id));
  bar.set({ mode: "here", text: "" });
}

// What the command bar was given: an address or words to search for, here or in a new tab.
// A refused address throws, and the tab stays as it was.
export async function go(input: string, here: boolean) {
  const url = browserAddress(input);
  const id = prefs.get().selected;
  if (!here || !id || focusedPage() !== browserPage(id)) return openTab(url);
  const e = await engine;
  await ensure(id);
  await e?.navigate(id, "load", url);
  void e?.focus(id).catch(() => {});
}

export async function act(action: "back" | "forward" | "reload" | "stop") {
  const id = prefs.get().selected;
  if (id) await (await engine)?.navigate(id, action).catch(() => {});
}

// Safari's zoom steps.
const ZOOMS = [0.5, 0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3];
export async function zoom(step: 1 | -1 | 0) {
  const id = prefs.get().selected;
  if (!id) return;
  const at = ZOOMS.indexOf(liveOf(id).zoom);
  const next = step === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + step))];
  setLive(id, { zoom: next });
  await (await engine)?.navigate(id, "zoom", undefined, next).catch(() => {});
}

export async function closeTab(id = prefs.get().selected) {
  const { tabs, selected, closed } = prefs.get();
  const at = tabs.findIndex((t) => t.id === id);
  if (at < 0) return;
  const { id: _, from: __, ...gone } = tabs[at];
  const rest = tabs.filter((t) => t.id !== id);
  // The neighbour after it in the list shows, or the one before at the end.
  const order = listed(tabs);
  const i = order.findIndex((t) => t.id === id);
  const next = id !== selected ? selected : (order[i + 1] ?? order[i - 1])?.id ?? "";
  const page = browserPage(id);
  const open = holder(page);
  const entry = { ...gone, at, time: Date.now(), position: open ? tabPosition(open.leaf) : undefined };
  prefs.set({ tabs: rest, selected: next, closed: [entry, ...closed].slice(0, 20) });
  const root = panes.get().root;
  const neighbour = next && !holder(browserPage(next)) ? browserPage(next) : "";
  if (open?.leaf.tabs.length === 1 && (neighbour || root?.kind === "leaf")) showIn(open.leaf.id, neighbour || BROWSER_HOME);
  else dropPage(page, null);
  if (!next) shown.set({ kind: "tab" });
  made.delete(id);
  const { [id]: ___, ...others } = live.get();
  live.set(others);
  await (await engine)?.close(id).catch(() => {});
}

export async function reopen() {
  const [last, ...closed] = prefs.get().closed;
  if (!last) return;
  prefs.set({ closed });
  const at = typeof last.at === "number" ? Math.min(Math.max(0, last.at), prefs.get().tabs.length) : undefined;
  await openTab(last.url, { at, position: last.position, pin: last.pin && prefs.get().pinned.some((p) => p.id === last.pin) ? last.pin : undefined });
}

export function nth(n: number) {
  const tab = listed(prefs.get().tabs)[n - 1];
  if (tab) select(tab.id, true);
}

export function cycle(step: 1 | -1) {
  const order = listed(prefs.get().tabs);
  if (!order.length) return;
  const at = order.findIndex((t) => t.id === prefs.get().selected);
  select(order[(at + step + order.length) % order.length].id, true);
}

export function pin(id: string) {
  const tab = prefs.get().tabs.find((t) => t.id === id);
  if (!tab?.url || tab.pin) return;
  const site: Site = { id: newId("p"), url: tab.url, title: tab.title, icon: tab.icon };
  prefs.set({ pinned: [...prefs.get().pinned, site] });
  patchTab(id, { pin: site.id });
}

export function unpin(siteId: string) {
  prefs.set({ pinned: prefs.get().pinned.filter((p) => p.id !== siteId) });
  setTabs(prefs.get().tabs.map((t) => (t.pin === siteId ? { ...t, pin: undefined } : t)));
}

// A pinned tile shows its tab, or opens it again at the pinned address.
export function openPinned(siteId: string, beside = false) {
  const tab = prefs.get().tabs.find((t) => t.pin === siteId);
  const site = prefs.get().pinned.find((p) => p.id === siteId);
  if (tab) select(tab.id, true, beside);
  else if (site) void openTab(site.url, { pin: site.id, beside });
}

// Where the app would open the personal streamed browser: in the Mac app the browser space takes
// it instead, with the address in a new tab. False where there is no space (the browser build).
export function openInSpace(url?: string) {
  if (!available.get()) return false;
  showBrowser();
  if (!url && !prefs.get().tabs.length) bar.set({ mode: "new", text: "" });
  if (url) {
    bar.set(null);
    void openTab(url);
  }
  return true;
}

// Saved pages and history are the browser's own lists (the streamed pane's bookmarks and history),
// kept under its personal workspace; until the runtime has named it, under the space's own key.
const EARLY = "/v1/browser/space";
export const dataBase = (base = prefs.get().base) => base || EARLY;
const dataKey = (base?: string) => browserKey(dataBase(base));
export const readData = () => readBrowserData(localStorage.getItem(dataKey()));
export function writeData(fn: (d: BrowserData) => BrowserData) {
  const key = dataKey();
  try { localStorage.setItem(key, JSON.stringify(fn(readData()))); } catch { /* Browsing still works when storage is full. */ }
  window.dispatchEvent(new CustomEvent("ll:browser-data", { detail: key }));
}
const merge = (a: BrowserEntry[], b: BrowserEntry[], max: number) => [...a, ...b.filter((e) => !a.some((x) => x.url === e.url))].sort((x, y) => y.time - x.time).slice(0, max);
async function findBase() {
  try {
    const w = await ask<{ location?: string; worktree?: string }>("POST", "/v1/browser/workspace");
    if (!w?.location || !w.worktree) return;
    const base = browserBase(w.location, w.worktree);
    if (base === prefs.get().base) return;
    const early = readBrowserData(localStorage.getItem(dataKey(EARLY)));
    prefs.set({ base });
    if (!early.bookmarks.length && !early.history.length) return;
    writeData((d) => ({ ...d, bookmarks: merge(early.bookmarks, d.bookmarks, 200), history: merge(early.history, d.history, 500) }));
    localStorage.removeItem(dataKey(EARLY));
  } catch { /* No runtime yet: the space's own key holds them until it answers. */ }
}

export function toggleSaved(url: string, title: string) {
  if (!safeBrowserURL(url)) return;
  const saved = readData().bookmarks.some((e) => e.url === url);
  writeData((d) => ({ ...d, bookmarks: saved ? d.bookmarks.filter((e) => e.url !== url) : [{ url, title: title || hostOf(url), time: Date.now() }, ...d.bookmarks].slice(0, 200) }));
  savedNote.set(saved ? 0 : Date.now());
}

function remember(url: string, title: string) {
  const head = readData().history[0];
  if (head?.url === url && head.title === title) return;
  writeData((d) => ({ ...d, history: [{ url, title, time: Date.now() }, ...d.history.filter((e) => e.url !== url)].slice(0, 500) }));
}

function onState(s: PageState) {
  const tab = prefs.get().tabs.find((t) => t.id === s.id);
  if (!tab) return;
  setLive(s.id, { loading: s.loading, progress: s.progress, back: s.back, forward: s.forward, failed: s.failed });
  const url = safeBrowserURL(s.url) ? s.url : tab.url;
  const title = (!s.failed && s.title) || (url === tab.url ? tab.title : hostOf(url));
  if (url !== tab.url || title !== tab.title) patchTab(s.id, { url, title, ...(hostOf(url) !== hostOf(tab.url) ? { icon: undefined } : {}) });
  if (!s.loading && !s.failed && safeBrowserURL(s.url) && s.title) remember(s.url, s.title);
}

function onIcon(id: string, data: string) {
  const tab = prefs.get().tabs.find((t) => t.id === id);
  if (!tab || !icon(data)) return;
  patchTab(id, { icon: data });
  const host = hostOf(tab.url);
  if (host) prefs.set({ icons: Object.fromEntries([...Object.entries(prefs.get().icons).filter(([h]) => h !== host), [host, data]].slice(-60)) });
  if (tab.pin) prefs.set({ pinned: prefs.get().pinned.map((p) => (p.id === tab.pin && !p.icon ? { ...p, icon: data } : p)) });
}

function onOpened(o: Opened) {
  if (!o.id) return void openTab(o.url, { after: o.opener, front: o.front });
  made.set(o.id, Promise.resolve());
  setTabs(place(prefs.get().tabs, { id: o.id, url: safeBrowserURL(o.url) ? o.url : "", title: hostOf(o.url) || "New tab" }, o.opener));
  if (o.front) select(o.id, true);
}

// ⌃⌥B: from another app, the browser comes up ready to type; pressed again in front, it goes away.
async function onKey(front: boolean) {
  if (front && browserFocused()) return bar.set(null), void (await engine)?.away();
  showBrowser();
  bar.set({ mode: "new", text: "" });
}

void engine.then((e) => e?.listen({ state: onState, icon: onIcon, opened: onOpened, key: (front) => void onKey(front), focused: (id) => { const page = browserPage(id); const pane = holder(page); if (pane?.leaf.page === page) focusPane(pane.leaf.id); } }));
const menuKeys = () => spaceKeys(browserFocused());
panes.subscribe(() => {
  const selected = browserTabId(focusedPage());
  if (selected && selected !== prefs.get().selected) prefs.set({ selected });
  menuKeys();
});
available.subscribe(menuKeys);

// Browser keys follow pane focus, even while the sidebar lists notes.
export function spaceKey(id: string): boolean {
  if (!available.get()) return false;
  if (id === "browser") return openInSpace();
  if (id === "browser-anywhere") return void onKey(true), true;
  if (id === "reopen-tab") {
    const last = prefs.get().closed[0];
    if (last && (last.time ?? 0) >= lastTabClose() && (last.position || browserFocused())) { void reopen(); return true; }
    return false;
  }
  if (!browserFocused()) return false;
  const { selected, tabs } = prefs.get();
  const tab = tabs.find((t) => t.id === selected);
  const onPage = !!tab && focusedPage() === browserPage(tab.id);
  if (id.startsWith("tab-")) return nth(Number(id.slice(4))), true;
  switch (id) {
    case "new-page":
    case "new-tab": bar.set({ mode: "new", text: "" }); return true;
    case "open-location": bar.set(onPage ? { mode: "here", text: tab!.url } : { mode: "new", text: "" }); return true;
    case "close-tab": if (onPage) void closeTab(); else { shown.set(tabView); showBrowser(); } return true;
    case "back": case "forward": case "reload": if (onPage) void act(id); return true;
    case "zoom-in": case "zoom-out": case "zoom-reset": if (onPage) void zoom(id === "zoom-in" ? 1 : id === "zoom-out" ? -1 : 0); return true;
    case "next-tab": case "previous-tab": cycle(id === "next-tab" ? 1 : -1); return true;
    case "save-link": if (onPage) toggleSaved(tab!.url, tab!.title); return true;
  }
  return false;
}

// Agents' own browser tabs, from the runtime: every workspace's tabs that are not the person's.
type Loc = { name: string; worktrees?: { name: string }[] };
export function useAgentTabs(active: boolean) {
  const [agents, setAgents] = useState<AgentTab[]>([]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const names = new Map<string, { at: number; titles: Map<string, string> }>();
    const titles = async (location: string) => {
      const known = names.get(location);
      if (known && Date.now() - known.at < 15_000) return known.titles;
      const list = await listChats(location).catch(() => []);
      const next = { at: Date.now(), titles: new Map(list.flatMap((c) => (c.session && c.title ? [[c.session, c.title] as const] : []))) };
      names.set(location, next);
      return next.titles;
    };
    const read = async () => {
      // The list is always in the sidebar now, so a hidden window does not ask.
      if (document.hidden) return;
      const locs = await ask<Loc[]>("GET", "/v1/locations").catch(() => [] as Loc[]);
      const found = await Promise.all(locs.flatMap((l) => (l.worktrees ?? []).map(async (w) => {
        const base = browserBase(l.name, w.name);
        const result = await ask<{ tabs: (BrowserTab & { idle_ms?: number })[] | null }>("GET", `${base}/tabs`).catch(() => null);
        const theirs = (result?.tabs ?? []).filter((t) => t.name && !/^user-/.test(t.name));
        if (!theirs.length) return [];
        const named = await titles(l.name);
        return theirs.map((t) => ({ base, tab: t.name, name: named.get(t.name) || t.title || "Agent", url: t.url ?? "", busy: !!t.busy || (t.idle_ms ?? Infinity) < 3000 }));
      })));
      if (live) setAgents(found.flat());
    };
    void read();
    const timer = window.setInterval(read, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [active]);
  return agents;
}
