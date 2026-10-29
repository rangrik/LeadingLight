import { action, conflict, historyTime, type ChangeContext, type HistoryEntry, samePage } from "./history-types";
import { type LLObject, newObject, type ObjectStore, PAGE_TYPE } from "./store";
import { stampDoc } from "@leadinglight/editor/authorship";

// Each writer remembers the revision it opened; another tab can't silently replace it.
export function withHistory(raw: ObjectStore, changed: (entry: HistoryEntry) => void): ObjectStore {
  const seen = new Map<string, LLObject | null>();
  const sessions = new Map<string, { context: ChangeContext; at: number }>();
  let tail = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const work = tail.then(fn);
    tail = work.then(() => {}, () => {});
    return work;
  };
  const contextFor = (id: string) => {
    const last = sessions.get(id);
    const now = Date.now();
    const context = last && now - last.at < 5 * 60_000 ? last.context : action("Edited page");
    sessions.set(id, { context, at: now });
    return context;
  };
  const commit = async (entry: HistoryEntry) => {
    await raw.commit(entry);
    for (const c of entry.changes) {
      seen.set((c.after ?? c.before)!.id, c.after);
      if (entry.milestone || sessions.get((c.after ?? c.before)!.id)?.context.action !== entry.action || entry.author.kind !== "human" || entry.undoOf) sessions.delete((c.after ?? c.before)!.id);
    }
    try { changed(entry); } catch (error) { console.error("History observer failed", error); }
  };
  const entry = (before: LLObject | null, after: LLObject | null, context: ChangeContext): HistoryEntry => {
    const id = crypto.randomUUID();
    return { ...context, id, at: historyTime(), changes: [{ before, after: after && { ...after, revision: id } }] };
  };
  return {
    ...raw,
    async get(id) {
      const obj = await raw.get(id);
      if (!seen.has(id)) seen.set(id, obj);
      return obj;
    },
    create: (init, context) => serial(async () => {
      const obj = newObject(init);
      if (!(await raw.catalog()).types.some((t) => t.id === obj.typeId)) obj.typeId = PAGE_TYPE;
      const origin = context ?? action("Created page");
      if (!origin.preserveOrigin) obj.content = stampDoc(obj.content, origin.author);
      const e = entry(null, obj, origin);
      await commit(e);
      return e.changes[0].after!;
    }),
    update: (id, patch, context) => serial(async () => {
      const before = seen.has(id) ? seen.get(id)! : await raw.get(id);
      if (!before) throw conflict();
      const after = { ...before, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
      if (!samePage(before, after)) await commit(entry(before, after, context ?? contextFor(id)));
    }),
    remove: (id, context) => serial(async () => {
      const before = await raw.get(id);
      if (before) await commit(entry(before, null, context ?? action("Deleted page")));
    }),
    commit: (e) => serial(() => commit(e)),
    deleteType: (id) => serial(async () => {
      const rows = (await raw.list()).filter((p) => p.typeId === id);
      const pages = await Promise.all(rows.map((p) => raw.get(p.id)));
      if (pages.length) {
        const e = entry(null, null, action("Changed deleted type to Page"));
        e.changes = pages.filter((p): p is LLObject => Boolean(p)).map((p) => ({ before: p, after: { ...p, typeId: PAGE_TYPE, revision: e.id } }));
        await commit(e);
      }
      await raw.deleteType(id);
    }),
  };
}
