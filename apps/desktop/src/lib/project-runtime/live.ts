import { events, type RuntimeEvent } from "~/lib/project-runtime/transport";

// One stream of the runtime's events for the whole app. After a drop it picks up from the last
// event seen, so nothing is lost or told twice; each (re)connect is told as "runtime.connected",
// when views read their state afresh.

const listeners = new Set<(e: RuntimeEvent) => void>();
let last: number | null = null;
let stop: (() => void) | null = null;

function tell(e: RuntimeEvent) {
  for (const fn of listeners) fn(e);
}

function connect() {
  tell({ seq: last ?? 0, type: "runtime.connected", time: new Date().toISOString() });
  stop = events(
    last,
    (e) => {
      if (last !== null && e.seq <= last) return;
      last = e.seq;
      tell(e);
    },
    () => {
      stop = null;
      if (listeners.size) window.setTimeout(() => listeners.size && !stop && connect(), 1000);
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
