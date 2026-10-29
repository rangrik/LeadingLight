import { reportOf } from "~/lib/work";
import { action, historyTime, inverse, type ChangeContext, type HistoryEntry, type PageChange, samePage, sameRevision } from "./history-types";
import { objects } from "./objects";
import { dirtyLive, restoreLive } from "./live";
import { flushAll } from "./saving";
import { loadSpace } from "./space";
import { type LLObject, PAGE_TYPE } from "./store";
import { dropPage } from "./panes";

export async function commitAction(changes: PageChange[], context: ChangeContext, extra: Partial<Pick<HistoryEntry, "milestone" | "undoOf">> = {}) {
  if (changes.some((c) => c.before && dirtyLive(c.before.id))) throw new Error("The page changed while this action was being prepared. Try again.");
  const id = crypto.randomUUID(), at = historyTime();
  const entry: HistoryEntry = { ...context, ...extra, id, at, changes: changes.map((c) => ({ ...c, after: c.after && { ...c.after, revision: id, updatedAt: at } })) };
  await objects.commit(entry);
  for (const c of entry.changes) {
    if (c.after) { if (!samePage(c.before, c.after)) restoreLive(c.after); }
    else if (c.before) dropPage(c.before.id, null);
  }
  await loadSpace();
  return entry;
}

export async function milestone(page: string, name: string) {
  const label = name.trim();
  if (!label || label.length > 120) throw new Error("Give this milestone a name of up to 120 characters.");
  await flushAll();
  const before = await objects.get(page);
  if (!before) throw new Error("Save this page before adding a milestone.");
  return commitAction([{ before, after: before }], action("Saved milestone"), { milestone: label });
}

export async function restoreVersion(page: LLObject) {
  await flushAll();
  if (reportOf(page)) throw new Error("Reports stay as published. Keep a copy to edit this version.");
  const before = await objects.get(page.id);
  if (!(await objects.catalog()).types.some((t) => t.id === page.typeId)) page = { ...page, typeId: PAGE_TYPE };
  return commitAction([{ before, after: page }], { ...action("Restored version"), preserveOrigin: true });
}

export async function undoAction(actionId: string) {
  await flushAll();
  const entries = await objects.history();
  if (entries.some((e) => e.undoOf === actionId)) throw new Error("This action has already been undone.");
  const changes = inverse(entries, actionId);
  if (!changes.length) throw new Error("There are no changes to undo.");
  for (const c of changes) {
    const current = await objects.get((c.before ?? c.after)!.id);
    if (!sameRevision(current, c.before) && !samePage(current, c.before)) {
      throw new Error("There are newer changes on a page in this action. Nothing was changed. Restore a version or keep a copy instead.");
    }
    c.before = current;
    if (c.after && !(await objects.catalog()).types.some((t) => t.id === c.after!.typeId)) c.after = { ...c.after, typeId: PAGE_TYPE };
  }
  return commitAction(changes, { ...action("Undid action"), preserveOrigin: true }, { undoOf: actionId });
}
