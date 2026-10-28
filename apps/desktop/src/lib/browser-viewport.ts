import { useCallback, useEffect, useId, useSyncExternalStore } from "react";

type Size = { width: number; height: number };
type ResizeResult = { viewport?: Size; error?: unknown };
type ResizeState = { busy: boolean; unresolved: boolean; revision: number; settledAt: number; target?: Size };
const idle: ResizeState = { busy: false, unresolved: false, revision: 0, settledAt: 0 };
type Group = { owner: string; members: Set<string>; pending: number; tail: Promise<void>; resize: ResizeState; autoRevision: number; failedAuto?: string };
const groups = new Map<string, Group>();
let revision = 0;
// Keep the 256 most recent explicit mode choices for this app session.
const modes = new Map<string, boolean>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const groupFor = (key: string) => {
  let group = groups.get(key);
  if (!group) {
    group = { owner: "", members: new Set(), pending: 0, tail: Promise.resolve(), resize: idle, autoRevision: 0 };
    groups.set(key, group);
  }
  return group;
};

// Several panes can show one tab, but only one can set its Chromium viewport.
export function useBrowserViewportOwner(key: string, active: boolean, defaultAuto = true) {
  const id = useId();
  const snapshot = useCallback(() => groups.get(key)?.owner ?? "", [key]);
  const owner = useSyncExternalStore(subscribe, snapshot, () => "");
  const mode = useCallback(() => modes.get(key) ?? defaultAuto, [key, defaultAuto]);
  const auto = useSyncExternalStore(subscribe, mode, () => defaultAuto);
  const resizing = useCallback(() => groups.get(key)?.resize ?? idle, [key]);
  const resizeState = useSyncExternalStore(subscribe, resizing, () => idle);

  useEffect(() => {
    if (!key || !active) return;
    const group = groupFor(key);
    group.members.add(id);
    if (!group.owner) { group.owner = id; group.autoRevision++; }
    notify();
    return () => {
      group.members.delete(id);
      if (group.owner === id) { group.owner = group.members.values().next().value ?? ""; group.autoRevision++; }
      if (!group.members.size && !group.pending) groups.delete(key);
      notify();
    };
  }, [key, active, id]);

  const claim = useCallback(() => {
    const group = groups.get(key);
    if (!active || !group?.members.has(id) || group.owner === id) return;
    group.owner = id;
    group.autoRevision++;
    notify();
  }, [key, active, id]);

  const setAuto = useCallback((value: boolean) => {
    if (!key) return;
    modes.delete(key);
    modes.set(key, value);
    if (modes.size > 256) modes.delete(modes.keys().next().value!);
    const group = groups.get(key);
    if (group) { group.autoRevision++; group.failedAuto = undefined; group.resize = { ...group.resize }; }
    notify();
  }, [key]);

  const canAutoResize = useCallback((size: Size) => {
    const group = groups.get(key);
    return !!group && group.owner === id && group.members.has(id) && (modes.get(key) ?? defaultAuto) && !group.pending && !group.resize.unresolved && group.failedAuto !== `${id}/${group.autoRevision}/${size.width}/${size.height}`;
  }, [key, id, defaultAuto]);

  const resize = useCallback((size: Size, run: () => Promise<ResizeResult>, automatic = false) => {
    if (automatic && !canAutoResize(size)) return Promise.resolve();
    const group = groupFor(key);
    const intent = `${id}/${group.autoRevision}/${size.width}/${size.height}`;
    const current = ++revision;
    group.pending++;
    group.resize = { busy: true, unresolved: false, revision: current, settledAt: 0, target: size };
    notify();
    const result = group.tail.then(run).catch((error): ResizeResult => ({ error })).then((outcome) => {
      group.pending--;
      if (automatic && (outcome.error !== undefined || !outcome.viewport)) group.failedAuto = intent;
      group.resize = group.resize.revision === current
        ? { busy: !!group.pending, unresolved: !outcome.viewport, revision: current, settledAt: group.pending ? 0 : performance.now(), target: outcome.viewport }
        : { ...group.resize, busy: !!group.pending };
      if (!group.members.size && !group.pending) groups.delete(key);
      notify();
      if (outcome.error !== undefined) throw outcome.error;
    });
    group.tail = result.catch(() => {});
    return result;
  }, [key, id, canAutoResize]);

  return { owns: active && owner === id, claim, auto, setAuto, resizeState, resize, canAutoResize };
}
