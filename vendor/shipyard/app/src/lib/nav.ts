import { create } from "zustand";

import { plainError } from "@/lib/errors";
import { useStore } from "@/lib/store";

// The app's places, arranged by the person: a few pinned at the top, the
// rest under More, and some hidden (still in ⌘K). The sidebar, its folded
// rail and zen's switcher all show this one arrangement. Stored on the
// laptop agent (/v1/app/sidebar). Anything new, such as a plugin's screen,
// lands in More, never in Pinned.

export type NavList = "pinned" | "more" | "hidden";

export interface NavLayout {
  // 2 since Home took the Agent Dashboard's place (see migrate).
  version?: number;
  pinned: string[];
  more: string[];
  hidden: string[];
  // Version 1 opened More in place in the sidebar. More is a menu now; the
  // field is kept as it was for older apps and otherwise ignored.
  moreOpen?: boolean;
}

export const DEFAULT_PINNED = ["home", "review", "worktrees", "automations"];
const DEFAULT: NavLayout = { version: 2, pinned: DEFAULT_PINNED, more: [], hidden: [] };

// migrate brings a stored arrangement up to date. Version 1 had no Home: its
// first place was the Agent Dashboard, which Home now stands for (and opens,
// without Labs), so "dashboard" becomes "home" wherever the person put it.
// With Labs the dashboard is a place of its own again and, new to the
// arrangement, lands in More. Everything else the person arranged stays.
export function migrate(doc: Partial<NavLayout> | null | undefined): NavLayout {
  if (!doc) return DEFAULT;
  let lists = { pinned: doc.pinned ?? DEFAULT.pinned, more: doc.more ?? [], hidden: doc.hidden ?? [] };
  if ((doc.version ?? 1) < 2) {
    const rename = (l: string[]) => l.map((id) => (id === "dashboard" ? "home" : id));
    lists = { pinned: rename(lists.pinned), more: rename(lists.more), hidden: rename(lists.hidden) };
  }
  return { ...doc, ...lists, version: 2 };
}

export const useNav = create<{ layout: NavLayout; loaded: boolean; error?: string }>()(() => ({ layout: DEFAULT, loaded: false }));

export async function loadNav() {
  const client = useStore.getState().client;
  if (!client) return;
  try {
    const doc = await client.laptop<Partial<NavLayout> | null>("GET", "/v1/app/sidebar");
    useNav.setState({ layout: migrate(doc), loaded: true });
  } catch (err) {
    useNav.setState({ loaded: true, error: plainError(err) });
  }
}

async function save(fn: (l: NavLayout) => NavLayout) {
  const before = useNav.getState().layout;
  const next = fn(structuredClone(before));
  useNav.setState({ layout: next });
  const client = useStore.getState().client;
  if (!client) return;
  try {
    await client.laptop("PUT", "/v1/app/sidebar", next);
  } catch (err) {
    useNav.setState({ layout: before, error: plainError(err) });
  }
}

// arrange places the available ids into the three lists, in the stored
// order; ids the layout does not know yet go to More.
export function arrange(layout: NavLayout, ids: string[]): Record<NavList, string[]> {
  const have = new Set(ids);
  const seen = new Set<string>();
  const take = (list: string[]) =>
    list.filter((id) => {
      if (!have.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const pinned = take(layout.pinned);
  const hidden = take(layout.hidden);
  const more = take(layout.more);
  for (const id of ids) if (!seen.has(id)) more.push(id);
  return { pinned, more, hidden };
}

function where(l: NavLayout, id: string): NavList | undefined {
  return (["pinned", "more", "hidden"] as NavList[]).find((k) => l[k].includes(id));
}

export const navActions = {
  // place puts id into list at index (the end when omitted). ids is every
  // item available now, so items still unplaced keep their place in More.
  place: (id: string, list: NavList, index: number | undefined, ids: string[]) =>
    save((l) => {
      const a = arrange(l, ids);
      for (const k of Object.keys(a) as NavList[]) a[k] = a[k].filter((x) => x !== id);
      const i = index === undefined ? a[list].length : Math.max(0, Math.min(index, a[list].length));
      a[list].splice(i, 0, id);
      return { ...l, ...a };
    }),
  move: (id: string, dir: -1 | 1, ids: string[]) =>
    save((l) => {
      const a = arrange(l, ids);
      const k = where({ ...l, ...a }, id);
      if (!k) return l;
      const i = a[k].indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= a[k].length) return { ...l, ...a };
      [a[k][i], a[k][j]] = [a[k][j], a[k][i]];
      return { ...l, ...a };
    }),
  reset: () => save(() => DEFAULT),
};
