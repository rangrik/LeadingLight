import { samePage, sameRevision, type HistoryEntry, type PageChange } from "./history-types.ts";
import type { LLObject } from "./store";

export const ownsSyncLibrary = (owner: string | null | undefined, bound: string | null) => Boolean(owner && owner === bound);

// A local baseline records an existing page; another device must be able to create it on retry.
export const portableHistoryEntry = (entry: HistoryEntry): HistoryEntry => entry.id.startsWith("baseline:")
  ? { ...entry, changes: entry.changes.map((change) => ({ ...change, before: null })) }
  : entry;

// Equivalent bytes can have different paths and revisions after another device imports them.
export function alignSyncChange(current: LLObject | null, change: PageChange, canonical: { current: LLObject | null; before: LLObject | null; after: LLObject | null }) {
  const afterMatches = samePage(canonical.current, canonical.after);
  const beforeMatches = samePage(canonical.current, canonical.before);
  return {
    change: { ...change, before: beforeMatches || afterMatches ? current : change.before },
    unchanged: afterMatches && sameRevision(current, change.after),
  };
}
