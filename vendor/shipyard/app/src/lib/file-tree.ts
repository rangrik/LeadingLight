import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { agentOf, sessionState } from "@/lib/derive";
import { explain } from "@/lib/errors";
import { filesApi, loadTouched, useFiles } from "@/lib/files";
import { usePrefs } from "@/lib/prefs";
import { load, save } from "@/lib/storage";
import { useStore } from "@/lib/store";
import { poll } from "@/lib/poll";
import { allRows, changedRows, defaultFilter, type Filter, type Listing, type Touch, type TreeRow } from "@/lib/tree-model";
import type { WorktreeRef } from "@/lib/workspaces";

// The Files panel's state (components/files/tree-dock.tsx): a worktree's
// folders, a level at a time from the box (GET …/files?dir=), and what its
// agents touched this turn (GET …/touched). Whether the docked panel shows
// is a pref (one for the app, kept across restarts); below a 1100px window
// it floats instead, opened for a moment and gone once used, which leaves
// the pref alone. All or Changed is remembered per worktree once picked.

export type { Filter, TreeRow };

interface DirState extends Listing {
  state: "loading" | "ready" | "error";
  error?: string;
  at: number;
}

interface State {
  // All or Changed, as the person picked it, by worktree key.
  picked: Record<string, Filter>;
  // Folders opened in All, by worktree key.
  expanded: Record<string, string[]>;
  // Folders closed in Changed (they start open), by worktree key.
  closed: Record<string, string[]>;
  // Folder listings, by worktree key and folder ("" is the top).
  dirs: Record<string, DirState>;
  // New file, while its name is being typed: the folder it goes in.
  creating?: { ws: string; dir: string };
  // The floating panel (a narrow window) is open.
  floating: boolean;
}

const PICKED_KEY = "berth.files.filter";

export const useTree = create<State>()(() => ({ picked: load<Record<string, Filter>>(PICKED_KEY, {}), expanded: {}, closed: {}, dirs: {}, floating: false }));

// Below this window width the panel floats over the tabs.
export const NARROW = "(max-width: 1099px)";
const narrow = () => typeof matchMedia !== "undefined" && matchMedia(NARROW).matches;

// setTreeOpen shows or hides the panel: the docked one's pref, or in a
// narrow window the floating one.
export function setTreeOpen(open: boolean) {
  if (narrow()) useTree.setState({ floating: open });
  else usePrefs.setState({ filesPanel: open });
}
export const toggleTree = () => setTreeOpen(!(narrow() ? useTree.getState().floating : usePrefs.getState().filesPanel));

export function pickFilter(ws: string, f: Filter) {
  useTree.setState((s) => {
    const picked = { ...s.picked, [ws]: f };
    save(PICKED_KEY, picked);
    return { picked };
  });
}

export const setCreating = (c: State["creating"]) => useTree.setState({ creating: c });

const dkey = (ws: string, dir: string) => `${ws}\0${dir}`;
// A listing is reused this long, as the box reuses its own.
const FRESH = 10_000;

export async function loadDir(ws: string, ref: WorktreeRef, dir: string, force = false) {
  const k = dkey(ws, dir);
  const have = useTree.getState().dirs[k];
  // A listing that failed is asked for again next time, not kept as fresh.
  if (have && !force && (have.state === "loading" || (have.state !== "error" && Date.now() - have.at < FRESH))) return;
  const c = useStore.getState().client;
  if (!c) return;
  if (!have) useTree.setState((s) => ({ dirs: { ...s.dirs, [k]: { state: "loading", dirs: [], files: [], at: Date.now() } } }));
  try {
    const r = await filesApi.dir(c, ref, dir);
    // A box from before files.dir answers ?dir= with ⌘P's list.
    if (!("entries" in r)) throw new Error("This box's berthd is too old to list its files here. Update it, and they show.");
    const dirs: Listing["dirs"] = [];
    const files: string[] = [];
    for (const e of r.entries ?? []) {
      if (e.dir) dirs.push({ name: e.name, children: !!e.children });
      else files.push(e.name);
    }
    useTree.setState((s) => ({ dirs: { ...s.dirs, [k]: { state: "ready", dirs, files, truncated: r.truncated, at: Date.now() } } }));
  } catch (err) {
    // In words (a box away, one not answering), not the transport's.
    const e = explain(err, { box: ref.box });
    useTree.setState((s) => ({ dirs: { ...s.dirs, [k]: { state: "error", dirs: [], files: [], error: `${e.title}. ${e.message}`, at: Date.now() } } }));
  }
}

export function toggleDir(ws: string, dir: string, open?: boolean) {
  useTree.setState((s) => {
    const cur = s.expanded[ws] ?? [];
    const is = cur.includes(dir);
    const want = open ?? !is;
    if (want === is) return s;
    return { expanded: { ...s.expanded, [ws]: want ? [...cur, dir] : cur.filter((d) => d !== dir && !d.startsWith(`${dir}/`)) } };
  });
}

export function toggleChangedDir(ws: string, dir: string, open?: boolean) {
  useTree.setState((s) => {
    const cur = s.closed[ws] ?? [];
    const isOpen = !cur.includes(dir);
    const want = open ?? !isOpen;
    if (want === isOpen) return s;
    return { closed: { ...s.closed, [ws]: want ? cur.filter((d) => d !== dir) : [...cur, dir] } };
  });
}

// reveal opens every folder above path (the File tab's file, say).
export function reveal(ws: string, path: string) {
  const parts = path.split("/").slice(0, -1);
  useTree.setState((s) => {
    const cur = new Set(s.expanded[ws] ?? []);
    const before = cur.size;
    let d = "";
    for (const p of parts) {
      d = d ? `${d}/${p}` : p;
      cur.add(d);
    }
    return cur.size === before ? s : { expanded: { ...s.expanded, [ws]: [...cur] } };
  });
}

// ---- Who is working ----

// useWorkingSessions is the agent sessions in the worktree that are
// working now, by name.
export function useWorkingSessions(ref: WorktreeRef | undefined): Set<string> {
  const names = useStore((s) => {
    if (!ref) return "";
    const d = s.boxes[ref.box];
    return (d?.sessions ?? [])
      .filter((x) => x.dir === ref.path && !x.service && agentOf(x) && sessionState(x, d?.stats) === "running")
      .map((x) => x.name)
      .join("\n");
  });
  return useMemo(() => new Set(names ? names.split("\n") : []), [names]);
}

// The filter in use: the person's pick for the worktree, else Changed
// while its agent works and All otherwise.
export function useFilter(ws: string, working: boolean): Filter {
  const picked = useTree((s) => s.picked[ws]);
  return defaultFilter(picked, working);
}

// useTouchedLive keeps what the agents touched fresh: every 2.5s while the
// panel shows and they write (so the live marker comes and goes as they
// do), backing off to 20s while nothing changes; every 10s up to 30s while
// it is closed and an agent works (for the button's dot); at once when an
// agent starts or stops; and never while the window is hidden.
export function useTouchedLive(ws: string | undefined, ref: WorktreeRef | undefined, showing: boolean, working: boolean) {
  useEffect(() => {
    if (!ws || !ref) return;
    if (!showing && !working) {
      void loadTouched(ws, ref);
      return;
    }
    const p = poll(
      async () => {
        const was = useFiles.getState().touched[ws];
        await loadTouched(ws, ref);
        return useFiles.getState().touched[ws] !== was;
      },
      showing ? { every: 2500, max: 20_000 } : { every: 10_000, max: 30_000 },
    );
    return () => p.stop();
  }, [ws, ref, showing, working]);
}

// useTreeRows is what the panel lists: the worktree's folders a level at a
// time (All), or only what the agents touched (Changed).
export function useTreeRows(ws: string, ref: WorktreeRef, filter: Filter, working: Set<string>) {
  const expanded = useTree((s) => s.expanded[ws]);
  const closed = useTree((s) => s.closed[ws]);
  const dirs = useTree((s) => s.dirs);
  const touchedList = useFiles((s) => s.touched[ws]?.files);
  // Listed again when the box comes back, so an error from while it was
  // away doesn't stay.
  const online = useStore((s) => s.status?.boxes.find((b) => b.name === ref.box)?.state === "online");
  const touched = useMemo<Touch[]>(() => touchedList ?? [], [touchedList]);

  // The top and every open folder; again when the agents make or delete a
  // file, so the listing catches up with them.
  const made = useMemo(() => touched.filter((t) => t.created || t.deleted).map((t) => t.path).sort().join("\n"), [touched]);
  useEffect(() => {
    if (filter !== "all") return;
    for (const d of ["", ...(expanded ?? [])]) void loadDir(ws, ref, d);
  }, [ws, ref, filter, expanded, online]);
  useEffect(() => {
    if (filter !== "all" || !made) return;
    const t = window.setTimeout(() => {
      for (const d of ["", ...(useTree.getState().expanded[ws] ?? [])]) void loadDir(ws, ref, d, true);
    }, 400);
    return () => window.clearTimeout(t);
    // Only a change in what was made or deleted reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made]);

  return useMemo(() => {
    const isWorking = (s: string) => working.has(s);
    if (filter === "changed") return { rows: changedRows(touched, new Set(closed ?? []), isWorking), loading: false, truncated: false };
    const top = dirs[dkey(ws, "")];
    const listing = (d: string) => {
      const l = dirs[dkey(ws, d)];
      return l && { ...l, loading: l.state === "loading" };
    };
    const open = new Set(expanded ?? []);
    const rows = allRows(listing, open, touched, isWorking);
    const truncated = [...open, ""].some((d) => dirs[dkey(ws, d)]?.truncated);
    return { rows, loading: !top || top.state === "loading", truncated, error: top?.state === "error" ? top.error : undefined };
  }, [ws, filter, expanded, closed, dirs, touched, working]);
}
