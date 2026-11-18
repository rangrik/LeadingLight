import type { Day, MailState } from "./mail-rules";

export type Progress = Pick<MailState, "start" | "days" | "kinds" | "kept" | "today">;
export type RemoteProgress = { revision: number; state: Progress | null };

export function progressOf({ start, days, kinds, kept, today }: MailState): Progress {
  return { start, days, kinds, kept, today };
}

function changedEntries<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>) {
  const merged = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (base[key] === local[key]) continue;
    if (Object.hasOwn(local, key)) merged[key] = local[key];
    else delete merged[key];
  }
  return merged;
}

function mergeDay(base: Day | undefined, local: Day, remote: Day): Day {
  if (local.day !== remote.day) return local.day > remote.day ? local : remote;
  if (base?.day !== local.day) base = undefined;
  const starts = [local.started, remote.started].filter((at) => at > 0);
  const set = remote.set.length && !base?.set.length ? remote.set :
    [...new Set([...remote.set, ...local.set.filter((k) => !base?.set.includes(k))])];
  const clearedKeys = changedEntries(base?.clearedKeys ?? {}, local.clearedKeys ?? {}, remote.clearedKeys ?? {});
  const legacyCount = (day: Day) => day.cleared - Object.keys(day.clearedKeys ?? {}).length;
  const endChanged = local.ended !== (base?.ended ?? 0) || local.closed !== (base?.closed ?? false);
  return {
    ...remote,
    started: starts.length ? Math.min(...starts) : 0,
    set,
    handled: changedEntries(base?.handled ?? {}, local.handled, remote.handled),
    dues: changedEntries(base?.dues ?? {}, local.dues, remote.dues),
    cleared: Math.max(legacyCount(local), legacyCount(remote)) + Object.keys(clearedKeys).length,
    clearedKeys,
    ...(endChanged && { closed: local.closed, ended: local.ended, left: local.left }),
  };
}

export function mergeProgress(base: Progress | null, local: Progress, remote: Progress | null): Progress {
  if (!remote) return local;
  if (!local.start && !Object.keys(local.kinds).length) return remote;
  if (JSON.stringify(local) === JSON.stringify(remote)) return remote;
  // An upgraded Mac can have an older import window and decisions that never reached the service.
  const earlier = local.start > 0 && (!remote.start || local.start < remote.start);
  return {
    start: earlier ? local.start : remote.start,
    days: earlier ? local.days : remote.days,
    kinds: changedEntries(base?.kinds ?? {}, local.kinds, remote.kinds),
    kept: changedEntries(base?.kept ?? {}, local.kept, remote.kept),
    today: mergeDay(base?.today, local.today, remote.today),
  };
}
