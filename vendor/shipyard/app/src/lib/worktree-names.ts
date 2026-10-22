import { create } from "zustand";

import { toastError } from "@/components/error-note";
import { toastManager } from "@/components/ui/toast";
import { ApiError, boxApi, type Location, type Worktree } from "@/lib/api";
import { localTitle, localTitles, setLocalTitle } from "@/lib/local-titles";
import { updateBoxes } from "@/lib/outdated";
import { useStore } from "@/lib/store";

// A worktree's display name. Its folder names it, often a slug made from a
// pasted link ("https-linear-app-acme"); a person can give it a title to
// show in its place everywhere it appears. It is a label: the branch and
// the folder keep their names. The box keeps it with the worktree
// (PATCH …/worktrees/{name}), so every laptop, the phone and the CLI see
// it; a box too old for that keeps it on this laptop (lib/local-titles).

export const WORKTREE_TITLES = "worktree.titles";
export const WORKTREE_TITLE_MAX = 80;

type Named = Pick<Worktree, "name" | "title" | "main" | "branch">;

// worktreeLabel is what a worktree is called on screen: its title, else
// its name. A main checkout is its project's, unless it was named.
export function worktreeLabel(wt: Named, loc?: Pick<Location, "name">): string {
  const title = wt.title?.trim();
  if (title) return title;
  return wt.main && loc ? loc.name : wt.name;
}

// renamed says a worktree shows by a title rather than its own name.
export const renamed = (wt: Pick<Worktree, "title">): boolean => !!wt.title?.trim();

// findWorktree is a worktree the store lists, by box and path.
export function findWorktree(box: string, path: string, boxes = useStore.getState().boxes): { loc: Location; wt: Worktree } | undefined {
  for (const loc of boxes[box]?.locations ?? []) {
    const wt = loc.worktrees?.find((w) => w.path === path);
    if (wt) return { loc, wt };
  }
  return undefined;
}

// titleAt is the display name of the worktree at box/path, if it has one.
export function titleAt(box: string, path: string, boxes = useStore.getState().boxes): string | undefined {
  return findWorktree(box, path, boxes)?.wt.title?.trim() || localTitle(box, path);
}

// useTitleAt is titleAt that re-renders when it changes.
export function useTitleAt(box: string | undefined, path: string | undefined): string | undefined {
  return useStore((s) => (box && path ? titleAt(box, path, s.boxes) : undefined));
}

// placeLabel names a worktree reference as the app does elsewhere:
// "shop / Fix checkout" for a worktree, "shop" for a main checkout.
export function placeLabel(ref: { box: string; location: string; worktree: string; path: string; main?: boolean }, boxes = useStore.getState().boxes): string {
  const title = titleAt(ref.box, ref.path, boxes);
  if (ref.main) return title ? `${ref.location} · ${title}` : ref.location;
  return `${ref.location} / ${title ?? ref.worktree}`;
}

// shortLabel is a reference's own name: its title, else its worktree's
// name (a main checkout's project).
export function shortLabel(ref: { box: string; location: string; worktree: string; path: string; main?: boolean }, boxes = useStore.getState().boxes): string {
  return titleAt(ref.box, ref.path, boxes) ?? (ref.main ? ref.location : ref.worktree);
}

// boxNamesWorktrees says whether a box keeps display names itself: false
// for one whose info says it is older, undefined while its info is not in.
export function boxNamesWorktrees(box: string): boolean | undefined {
  const caps = useStore.getState().boxes[box]?.info?.capabilities;
  return caps ? caps.includes(WORKTREE_TITLES) : undefined;
}

// A box's berthd is too old for PATCH on a worktree: it has DELETE there,
// so the answer is 405, or a 404 from its router.
function tooOld(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 405 || (err.status === 404 && /page not found/i.test(err.message)));
}

// useRenamingWorktree is the worktree being renamed in place
// ("box\npath"), when a menu asked for it; the sidebar row shows a field.
export const useRenamingWorktree = create<{ key?: string }>()(() => ({}));
export const renameKey = (box: string, path: string) => `${box}\n${path}`;
export const startRenamingWorktree = (box: string, path: string) => useRenamingWorktree.setState({ key: renameKey(box, path) });
export const stopRenamingWorktree = () => useRenamingWorktree.setState({ key: undefined });

// suggestedTitle offers a name for a worktree from what its agent was asked
// to do: the title its first prompt gave its session, when that reads as
// words rather than a link or the worktree's own name. Nothing is fetched.
export function suggestedTitle(box: string, wt: Pick<Worktree, "path" | "name" | "title">): string | undefined {
  const sessions = useStore.getState().boxes[box]?.sessions ?? [];
  const mine = sessions.filter((s) => s.dir === wt.path && !s.service && s.title?.trim()).sort((a, b) => a.created.localeCompare(b.created));
  for (const s of mine) {
    const t = s.title!.trim();
    if (/^https?:\/\//i.test(t) || /^\S+$/.test(t)) continue;
    if (t === wt.title || t === wt.name) continue;
    return t;
  }
  return undefined;
}

// renameWorktree gives a worktree a display name ("" clears it). On a box
// too old to keep it, the name stays on this laptop, and a toast says so
// with a way to update the box. True when it took.
export async function renameWorktree(box: string, loc: Pick<Location, "name">, wt: Pick<Worktree, "name" | "path" | "title">, title: string): Promise<boolean> {
  const st = useStore.getState();
  const next = title.trim().replace(/\s+/g, " ").slice(0, WORKTREE_TITLE_MAX);
  const value = next === wt.name ? "" : next;
  if ((wt.title ?? "") === value) return true;
  const local = () => {
    const first = !Object.keys(localTitles(box)).length;
    setLocalTitle(box, wt.path, value);
    void st.refreshBox(box, ["locations"]);
    if (value && first)
      toastManager.add({
        type: "info",
        title: "Named on this laptop only",
        description: `${box} runs an older berthd that can't keep worktree names, so your other devices still see ${wt.name}. Update it to share the name.`,
        actionProps: { children: "Update", onClick: () => void updateBoxes([box]) },
      });
    return true;
  };
  if (boxNamesWorktrees(box) === false) return local();
  if (!st.client) return false;
  try {
    await boxApi.renameWorktree(st.client, box, loc.name, wt.name, value);
    // The box has it now; a name kept here before is no longer needed.
    if (localTitle(box, wt.path)) setLocalTitle(box, wt.path, "");
    await st.refreshBox(box, ["locations"]);
    return true;
  } catch (err) {
    if (tooOld(err)) return local();
    toastError(err, { title: "Couldn't rename it", box });
    return false;
  }
}

// moveLocalTitles hands names kept on this laptop to a box that can now
// keep them itself (it was updated), once its info says so.
export async function moveLocalTitles(box: string) {
  const mine = localTitles(box);
  const st = useStore.getState();
  if (!Object.keys(mine).length || boxNamesWorktrees(box) !== true || !st.client) return;
  for (const [path, title] of Object.entries(mine)) {
    const at = findWorktree(box, path);
    if (!at) continue;
    try {
      if (!at.wt.title || at.wt.title === title) await boxApi.renameWorktree(st.client, box, at.loc.name, at.wt.name, title);
      setLocalTitle(box, path, "");
    } catch {
      // Kept here; the next time the box connects tries again.
    }
  }
  void st.refreshBox(box, ["locations"]);
}

// Each box's info arriving is the moment to move names it can now keep.
let infoSeen = new Map<string, unknown>();
useStore.subscribe((s) => {
  for (const [box, d] of Object.entries(s.boxes)) {
    if (d?.info && infoSeen.get(box) !== d.info) {
      infoSeen.set(box, d.info);
      if (d.info.capabilities?.includes(WORKTREE_TITLES) && Object.keys(localTitles(box)).length) void moveLocalTitles(box);
    }
  }
  if (infoSeen.size > 64) infoSeen = new Map();
});
