// Tabs in a pane, each with its own history (features/tabs.feature). No imports, so node can test it.

// The pages a tab has shown and where it is in them. "" is a new tab with no page yet.
export type Tab = { id: string; pages: string[]; at: number };
// page is the front tab's, so code that only asks what a pane shows needn't know tabs.
// back: the view it was opened from in its place (the Feed, in a narrow window), which its crumb opens.
export type Leaf = { kind: "leaf"; id: string; page: string; back?: string; tabs: Tab[]; active: string };
export type PaneNode = Leaf | { kind: "split"; id: string; dir: "row" | "col"; ratio: number; a: PaneNode; b: PaneNode };

export const newId = () => Math.random().toString(36).slice(2, 10);
export const tab = (page: string): Tab => ({ id: newId(), pages: [page], at: 0 });
export const pageIn = (t: Tab) => t.pages[t.at];

// As in a browser, opening a page drops the pages ahead. A new tab's blank is replaced, not kept.
export function go(t: Tab, page: string): Tab {
  if (pageIn(t) === page) return t;
  const kept = t.pages.slice(0, pageIn(t) ? t.at + 1 : t.at);
  return { ...t, pages: [...kept, page], at: kept.length };
}

// Back (-1) or forward (1); the same tab when there is nowhere to go.
export const step = (t: Tab, by: number): Tab => (t.pages[t.at + by] === undefined ? t : { ...t, at: t.at + by });

// Drops the pages keep refuses. One in front gives way to the page before it, else after it; with none left, a new tab.
export function prune(t: Tab, keep: (page: string) => boolean): Tab {
  const ok = (p: string) => p === "" || keep(p);
  const here = ok(pageIn(t)) ? [pageIn(t)] : [];
  const before = t.pages.slice(0, t.at).filter(ok);
  const pages = [...before, ...here, ...t.pages.slice(t.at + 1).filter(ok)];
  return pages.length ? { ...t, pages, at: here.length ? before.length : Math.max(0, before.length - 1) } : { ...t, pages: [""], at: 0 };
}

// What storage may hold: anything, so every part is checked as it is read.
type Stored = { kind?: unknown; id?: unknown; dir?: unknown; ratio?: unknown; a?: Stored; b?: Stored; active?: unknown; tabs?: { id?: unknown; pages?: unknown[]; at?: unknown }[] };

// A layout read back from storage, with pages gone since pruned. Damaged, it is null and the app opens a page as before.
export function readLayout(raw: unknown, exists: (page: string) => boolean): { root: PaneNode; focus: string } | null {
  const ids: string[] = [];
  const node = (n: Stored): PaneNode => {
    if (n.kind === "split") return { kind: "split", id: String(n.id), dir: n.dir === "col" ? "col" : "row", ratio: Math.min(0.9, Math.max(0.1, Number(n.ratio) || 0.5)), a: node(n.a!), b: node(n.b!) };
    const tabs = n.tabs!.map((t): Tab => {
      const pages = t.pages!.map(String);
      if (!pages.length) throw new Error("a tab with no pages");
      return prune({ id: String(t.id), pages, at: Math.min(pages.length - 1, Math.max(0, Math.trunc(Number(t.at)) || 0)) }, exists);
    });
    const front = tabs.find((t) => t.id === n.active) ?? tabs[0];
    ids.push(String(n.id));
    return { kind: "leaf", id: String(n.id), page: pageIn(front), tabs, active: front.id };
  };
  try {
    const { root, focus } = raw as { root: Stored; focus: string };
    const tree = node(root);
    return { root: tree, focus: ids.includes(focus) ? focus : ids[0] };
  } catch {
    return null;
  }
}
