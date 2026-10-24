import { useSyncExternalStore } from "react";

// A value React components can follow, readable outside React too.
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => void subs.delete(fn);
  };
  return {
    subscribe,
    get: () => value,
    set(next: T) {
      value = next;
      for (const fn of subs) fn();
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}
