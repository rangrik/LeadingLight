import type { Command, EventHandler, HomeWidget, Screen, SidebarItem, StatusBarItem, WorktreePanel, WorktreeSection } from "@berth/plugin";
import { create } from "zustand";

import type { BerthEvent, Theme } from "@/lib/api";
import { load, save } from "@/lib/storage";

// Everything plugins have added, tagged with the plugin that added it so a
// plugin's contributions can all be removed together.

export interface Contribution<T> {
  plugin: string;
  item: T;
}

export interface PluginStatus {
  id: string;
  name: string;
  version?: string;
  // review: a plugin from ~/.berth/plugins that changed since the user
  // allowed it, so it is not loaded until they allow it again.
  state: "loading" | "active" | "failed" | "review";
  error?: string;
  builtin?: boolean;
}

interface Registry {
  sidebarItems: Contribution<SidebarItem>[];
  screens: Contribution<Screen>[];
  worktreePanels: Contribution<WorktreePanel>[];
  worktreeSections: Contribution<WorktreeSection>[];
  homeWidgets: Contribution<HomeWidget>[];
  commands: Contribution<Command>[];
  statusBarItems: Contribution<StatusBarItem>[];
  themes: Contribution<Theme>[];
  handlers: Contribution<{ type: string; handler: EventHandler }>[];
  plugins: PluginStatus[];
}

type ListKey = Exclude<keyof Registry, "plugins">;

export const useRegistry = create<Registry>()(() => ({
  sidebarItems: [],
  screens: [],
  worktreePanels: [],
  worktreeSections: [],
  homeWidgets: [],
  commands: [],
  statusBarItems: [],
  themes: [],
  handlers: [],
  plugins: [],
}));

// Plugins load in parallel and finish in any order, so contributions are
// kept in the order the plugins were listed, not the order they arrived in:
// the sidebar, palette and status bar then look the same on every load.
let order: string[] = [];

export function setPluginOrder(ids: string[]) {
  order = ids;
}

function rank(plugin: string): number {
  const i = order.indexOf(plugin);
  return i < 0 ? order.length : i;
}

// insertRanked puts entry after every entry from a plugin listed before or
// with its own, so one plugin's items keep the order it added them in.
function insertRanked<T extends { plugin: string }>(list: T[], entry: T): T[] {
  const r = rank(entry.plugin);
  let at = list.length;
  while (at > 0 && rank(list[at - 1].plugin) > r) at--;
  return [...list.slice(0, at), entry, ...list.slice(at)];
}

// contribute adds item to a list and returns how to take it out again.
export function contribute<K extends ListKey>(key: K, entry: Registry[K][number]): () => void {
  useRegistry.setState((s) => ({ [key]: insertRanked(s[key] as Contribution<unknown>[], entry) }) as Partial<Registry>);
  return () => useRegistry.setState((s) => ({ [key]: (s[key] as unknown[]).filter((e) => e !== entry) }) as Partial<Registry>);
}

// removePlugin drops everything a plugin added, for unloading or reloading it.
export function removePlugin(plugin: string) {
  useRegistry.setState((s) => {
    const next: Partial<Registry> = {};
    for (const key of Object.keys(s) as (keyof Registry)[]) {
      if (key === "plugins") continue;
      (next as Record<string, unknown>)[key] = (s[key] as Contribution<unknown>[]).filter((c) => c.plugin !== plugin);
    }
    return next;
  });
}

// Whether plugins are still loading: until they are, a plugin's screen is
// not missing, only not there yet.
export const usePluginsLoading = create<boolean>()(() => true);

// Which plugin added each screen, remembered across launches so a screen
// whose plugin is now off can say which plugin to turn back on.
const OWNERS_KEY = "berth.pluginScreens";

export function rememberScreenOwner(screen: string, plugin: string) {
  const owners = load<Record<string, string>>(OWNERS_KEY, {});
  if (owners[screen] === plugin) return;
  save(OWNERS_KEY, { ...owners, [screen]: plugin });
}

export function screenOwner(screen: string): string | undefined {
  return load<Record<string, string>>(OWNERS_KEY, {})[screen];
}

export function setPluginStatus(status: PluginStatus) {
  useRegistry.setState((s) => {
    const i = s.plugins.findIndex((p) => p.id === status.id);
    if (i >= 0) return { plugins: s.plugins.map((p, j) => (j === i ? status : p)) };
    // A new plugin goes in listed order, like its contributions.
    const r = rank(status.id);
    let at = s.plugins.length;
    while (at > 0 && rank(s.plugins[at - 1].id) > r) at--;
    return { plugins: [...s.plugins.slice(0, at), status, ...s.plugins.slice(at)] };
  });
}

export function matchesEvent(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

// dispatch hands an event to every plugin listening for it. A handler that
// throws is reported and skipped; it never stops the others.
export function dispatch(e: BerthEvent) {
  for (const { plugin, item } of useRegistry.getState().handlers) {
    if (!matchesEvent(item.type, e.type)) continue;
    try {
      item.handler(e);
    } catch (err) {
      console.error(`plugin ${plugin}: handler for ${e.type} failed`, err);
    }
  }
}
