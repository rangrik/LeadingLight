import { events, type RuntimeEvent } from "~/lib/project-runtime/transport";

// One stream of the runtime's events for the whole app. After a drop it picks up from the last
// event seen, so nothing is lost or told twice; each (re)connect is told as "runtime.connected",
// when views read their state afresh.

const listeners = new Set<(e: RuntimeEvent) => void>();
let last: number | null = null;
let stop: (() => void) | null = null;
// A runtime that isn't there is asked again less and less often, up to every 30 s.
let wait = 1000;

function tell(e: RuntimeEvent) {
  for (const fn of listeners) fn(e);
}

function connect() {
  tell({ seq: last ?? 0, type: "runtime.connected", time: new Date().toISOString() });
  const began = Date.now();
  stop = events(
    last,
    (e) => {
      wait = 1000;
      if (last !== null && e.seq <= last) return;
      last = e.seq;
      tell(e);
    },
    () => {
      stop = null;
      wait = Date.now() - began < 2000 ? Math.min(wait * 2, 30_000) : 1000;
      if (listeners.size) window.setTimeout(() => listeners.size && !stop && connect(), wait);
    },
  );
}

export function onRuntimeEvent(fn: (e: RuntimeEvent) => void): () => void {
  listeners.add(fn);
  if (!stop) connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      stop?.();
      stop = null;
    }
  };
}
