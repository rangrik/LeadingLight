// The Files panel's rows, worked out from plain data so they can be tested
// alone (tree-model.test.ts): a worktree's folders a level at a time (All),
// or only what the agents touched this turn (Changed), with folder chains
// compacted ("apps/web/lib"). components/files/file-tree.tsx draws them;
// lib/file-tree.ts keeps the state.

export type Filter = "all" | "changed";

// What the rows need of a file an agent touched (lib/files.ts TouchedFile).
export interface Touch {
  path: string;
  added: number;
  removed: number;
  created?: boolean;
  deleted?: boolean;
  at?: number;
  session: string;
  agent: string;
  live?: boolean;
}

// One folder's children, as the box lists them (GET …/files?dir=).
export interface Listing {
  dirs: { name: string; children: boolean }[];
  files: string[];
  truncated?: boolean;
}

export interface TreeRow {
  kind: "dir" | "file";
  path: string;
  // What the row shows: a file's name, or a folder's ("lib/payments" for a
  // chain of folders with one child each, in Changed).
  name: string;
  depth: number;
  open?: boolean;
  loading?: boolean;
  // A folder with nothing to open (a submodule).
  empty?: boolean;
  touched?: Touch;
  // Folders: how many touched files are inside, and whether one is live.
  inside?: number;
  liveInside?: boolean;
  live?: boolean;
}

// byName orders names as a person reads them: case aside, numbers by value
// (analytics-2 before analytics-10).
export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

// LIVE_MS is how recent a write must be for the file to count as being
// written (the box's liveFor).
export const LIVE_MS = 20_000;

// isLive: the box says the agent is writing the file (it wrote it in the
// last 20s and its session works), and its session is working here too, so
// the marker goes the moment the agent stops.
export const isLive = (t: Touch | undefined, working: (session: string) => boolean) => !!t && !t.deleted && !!t.live && working(t.session);

function insideOf(touched: Touch[], dir: string, live: (t: Touch) => boolean) {
  const pre = dir ? `${dir}/` : "";
  let inside = 0;
  let liveInside = false;
  for (const t of touched) {
    if (!t.path.startsWith(pre)) continue;
    inside++;
    if (live(t)) liveInside = true;
  }
  return { inside, liveInside };
}

interface Node {
  dirs: Map<string, Node>;
  files: string[];
}

function build(paths: string[]): Node {
  const root: Node = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let n = root;
    for (const d of parts.slice(0, -1)) {
      let next = n.dirs.get(d);
      if (!next) n.dirs.set(d, (next = { dirs: new Map(), files: [] }));
      n = next;
    }
    n.files.push(p);
  }
  return root;
}

// changedRows is the Changed view: the touched files as a tree, a chain of
// folders with one folder in each (and no files) shown as one row, every
// folder open unless closed.
export function changedRows(touched: Touch[], closed: Set<string>, working: (session: string) => boolean): TreeRow[] {
  const byPath = new Map(touched.map((t) => [t.path, t]));
  const live = (t: Touch) => isLive(t, working);
  const out: TreeRow[] = [];
  const walk = (n: Node, prefix: string, depth: number) => {
    for (const name of [...n.dirs.keys()].sort(byName)) {
      let child = n.dirs.get(name)!;
      let label = name;
      let path = prefix ? `${prefix}/${name}` : name;
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [k, v] = [...child.dirs.entries()][0];
        label = `${label}/${k}`;
        path = `${path}/${k}`;
        child = v;
      }
      const open = !closed.has(path);
      out.push({ kind: "dir", path, name: label, depth, open, ...insideOf(touched, path, live) });
      if (open) walk(child, path, depth + 1);
    }
    for (const p of [...n.files].sort((a, b) => byName(baseName(a), baseName(b)))) {
      const t = byPath.get(p);
      out.push({ kind: "file", path: p, name: baseName(p), depth, touched: t, live: live(t!) });
    }
  };
  walk(build(touched.map((t) => t.path)), "", 0);
  return out;
}

// allRows is the All view: the top folder's listing, and each open folder's
// below it. A file an agent made that a listing doesn't have yet (the box
// reuses a listing for a few seconds) joins its folder from touched; one it
// deleted leaves.
export function allRows(listings: (dir: string) => (Listing & { loading?: boolean }) | undefined, expanded: Set<string>, touched: Touch[], working: (session: string) => boolean): TreeRow[] {
  const byPath = new Map(touched.map((t) => [t.path, t]));
  const live = (t: Touch) => isLive(t, working);
  const out: TreeRow[] = [];
  const add = (dir: string, depth: number) => {
    const l = listings(dir);
    if (!l) return;
    const pre = dir ? `${dir}/` : "";
    const dirs = new Map(l.dirs.map((d) => [d.name, d.children]));
    const files = new Set(l.files);
    for (const t of touched) {
      if (!t.path.startsWith(pre)) continue;
      const rest = t.path.slice(pre.length);
      const slash = rest.indexOf("/");
      if (t.deleted) {
        if (slash < 0) files.delete(rest);
        continue;
      }
      if (slash < 0) files.add(rest);
      else if (!dirs.has(rest.slice(0, slash))) dirs.set(rest.slice(0, slash), true);
    }
    for (const name of [...dirs.keys()].sort(byName)) {
      const path = pre + name;
      const children = dirs.get(name);
      const open = children !== false && expanded.has(path);
      const sub = open ? listings(path) : undefined;
      out.push({ kind: "dir", path, name, depth, open, empty: children === false || undefined, loading: open && (!sub || !!sub.loading), ...insideOf(touched, path, live) });
      if (open) add(path, depth + 1);
    }
    for (const name of [...files].sort(byName)) {
      const path = pre + name;
      const t = byPath.get(path);
      out.push({ kind: "file", path, name, depth, touched: t, live: live(t!) });
    }
  };
  add("", 0);
  return out;
}

// defaultFilter is what the panel shows until the person picks: Changed
// while the worktree's agent works, so what it writes is in view; All
// otherwise.
export const defaultFilter = (picked: Filter | undefined, working: boolean): Filter => picked ?? (working ? "changed" : "all");

// newFilePath is where New file puts a typed name: in the folder you are
// on, or from the top with a leading "/". Undefined for no name, a folder
// ("x/"), or a path out of the worktree.
export function newFilePath(dir: string, typed: string): string | undefined {
  const name = typed.trim();
  if (!name || name.endsWith("/")) return undefined;
  const raw = name.startsWith("/") ? name.replace(/^\/+/, "") : dir ? `${dir}/${name}` : name;
  const parts = raw.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === ".." || p.toLowerCase() === ".git")) return undefined;
  return parts.join("/");
}

// folderOf is the folder New file starts in for the row you are on.
export const folderOf = (row: Pick<TreeRow, "kind" | "path"> | undefined) => (!row ? "" : row.kind === "dir" ? row.path : parentOf(row.path));
