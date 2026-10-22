import { createContext, useContext, useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/format";

// What a Home widget knows about where it is drawn: whether it can be seen
// (on screen, Home in front, the window showing) and how many times its
// card's "Refresh now" was pressed. The grid provides it; outside a widget
// it reads as always visible.
export interface WidgetEnv {
  visible: boolean;
  refresh: number;
}

export const WidgetEnvContext = createContext<WidgetEnv>({ visible: true, refresh: 0 });

export const useWidgetEnv = () => useContext(WidgetEnvContext);

export interface WidgetData<T> {
  data?: T;
  error?: string;
  // A read is under way (data may still show the last one).
  loading: boolean;
  // When data was read, in ms since the epoch.
  updated?: number;
  refresh(): void;
}

interface Store {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

// Reads already made this launch, so a widget scrolled back to, or Home
// opened again, shows them at once.
const memory = new Map<string, { data: unknown; at: number }>();
// Reads under way, so two parts of a widget (its body and its count) that
// ask for the same key share one.
const inflight = new Map<string, Promise<unknown>>();
// Who shows each key, told when a read lands.
const watchers = new Map<string, Set<() => void>>();

// useWidgetDataIn is useWidgetData with the storage it keeps reads in:
// a plugin's own, or the app's. The last read shows at once (from this
// launch, else from storage); a new one starts when it is older than every
// and only while the widget is visible, again every `every` after that,
// and at once on Refresh. key names what is read: a new key reads anew.
export function useWidgetDataIn<T>(store: Store, scope: string, key: string, load: () => Promise<T>, opts: { every: number }): WidgetData<T> {
  const env = useWidgetEnv();
  const id = `${scope}:${key}`;
  const saved = () => (memory.get(id) as { data: T; at: number } | undefined) ?? store.get<{ data: T; at: number } | undefined>(`widget.${key}`, undefined);
  const [state, setState] = useState<{ id: string; data?: T; at?: number; error?: string; loading: boolean }>(() => ({ id, ...pick(saved()), loading: false }));
  const latest = useRef(load);
  latest.current = load;
  const [asked, setAsked] = useState(0);
  // The refresh count already answered: a new one reads at once.
  const done = useRef(env.refresh + asked);
  // A new key starts from what is kept for it.
  if (state.id !== id) setState({ id, ...pick(saved()), loading: false });

  // A read by another part showing the same key lands here too.
  useEffect(() => {
    const w = () => {
      const m = memory.get(id) as { data: T; at: number } | undefined;
      if (m) setState((s) => (s.at === m.at ? s : { id, data: m.data, at: m.at, loading: s.loading }));
    };
    const set = watchers.get(id) ?? new Set();
    set.add(w);
    watchers.set(id, set);
    return () => {
      set.delete(w);
    };
  }, [id]);

  useEffect(() => {
    if (!env.visible) return;
    let alive = true;
    let timer = 0;
    const read = async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        let p = inflight.get(id) as Promise<T> | undefined;
        if (!p) {
          p = latest.current().then((data) => {
            const at = Date.now();
            memory.set(id, { data, at });
            store.set(`widget.${key}`, { data, at });
            for (const w of watchers.get(id) ?? []) w();
            return data;
          });
          inflight.set(id, p);
          void p.finally(() => inflight.delete(id)).catch(() => {});
        }
        const data = await p;
        if (alive) setState({ id, data, at: memory.get(id)?.at ?? Date.now(), loading: false });
      } catch (err) {
        if (alive) setState((s) => ({ ...s, loading: false, error: errorMessage(err) }));
      }
      if (alive) timer = window.setTimeout(() => void read(), opts.every);
    };
    const forced = done.current !== env.refresh + asked;
    done.current = env.refresh + asked;
    const at = memory.get(id)?.at ?? state.at ?? 0;
    timer = window.setTimeout(() => void read(), forced ? 0 : Math.max(0, opts.every - (Date.now() - at)));
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // state.at is read once, for how stale the kept read is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.visible, env.refresh, asked, id, opts.every]);

  return { data: state.data, error: state.error, loading: state.loading || (state.data === undefined && !state.error), updated: state.at, refresh: () => setAsked((n) => n + 1) };
}

function pick<T>(v: { data: T; at: number } | undefined): { data?: T; at?: number } {
  return v && typeof v === "object" && "at" in v ? { data: v.data, at: v.at } : {};
}

// The app's own widgets keep their reads like a plugin named "app" would.
const appStore: Store = {
  get<T>(k: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`berth.home.${k}`);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(k: string, value: unknown) {
    try {
      localStorage.setItem(`berth.home.${k}`, JSON.stringify(value));
    } catch {
      // Kept for this launch only.
    }
  },
};

export const useAppWidgetData = <T,>(key: string, load: () => Promise<T>, opts: { every: number }) => useWidgetDataIn(appStore, "app", key, load, opts);
