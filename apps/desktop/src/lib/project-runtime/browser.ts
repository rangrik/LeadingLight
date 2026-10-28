import { useCallback, useEffect, useRef, useState } from "react";
import { browserKey, readBrowserData, type BrowserData } from "~/lib/browser-data";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask } from "~/lib/project-runtime/transport";

export type BrowserTab = { name: string; url?: string; title?: string; busy?: boolean };
export type BrowserState = {
  running: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; zoom: number;
  error?: string; viewport?: { width: number; height: number; scale: number };
  refusedHosts?: string[];
  dialog?: { type: string; message: string; defaultPrompt?: string };
  fileChooser?: { multiple: boolean; id: string };
};
export const browserBase = (location: string, worktree: string) => `/v1/worktrees/${encodeURIComponent(location)}/${encodeURIComponent(worktree)}/browser`;
export const tabRoute = (base: string, action: string, tab: string) => `${base}/${action}?tab=${encodeURIComponent(tab)}`;
export const browserError = (e: unknown) => e instanceof Error ? e.message : String(e);

export function useBrowserData(base: string) {
  const key = browserKey(base);
  const [data, setData] = useState(() => readBrowserData(localStorage.getItem(key)));
  const current = useRef(data);
  const update = useCallback((fn: (d: BrowserData) => BrowserData) => {
    const next = fn(current.current);
    if (next === current.current) return;
    current.current = next;
    setData(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Browsing still works when storage is full. */ }
    window.dispatchEvent(new CustomEvent("ll:browser-data", { detail: key }));
  }, [key]);
  useEffect(() => {
    const read = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== key) return;
      const next = readBrowserData(localStorage.getItem(key));
      current.current = next;
      setData(next);
    };
    window.addEventListener("ll:browser-data", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("ll:browser-data", read);
      window.removeEventListener("storage", read);
    };
  }, [key]);
  return [data, update] as const;
}

export function useBrowserTabs(location?: string, worktree?: string | null, active = true) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!location || !worktree || !active) return;
    let live = true;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await ask<{ tabs: BrowserTab[] | null }>("GET", `${browserBase(location, worktree)}/tabs`);
        if (live) { setTabs((result.tabs ?? []).filter((t) => t.name)); setError(""); setLoaded(true); }
      } catch (e) { if (live) { setError(browserError(e)); setLoaded(true); } }
      finally { pending = false; }
    };
    void read();
    const timer = window.setInterval(read, 2000);
    const stop = onRuntimeEvent((e) => { if (e.type.startsWith("browser.") || e.type === "runtime.connected") void read(); });
    return () => { live = false; window.clearInterval(timer); stop(); };
  }, [location, worktree, active, revision]);
  return { tabs, error, loaded, refresh: () => refresh((n) => n + 1) };
}

export function useBrowserState(base: string, tab: string, active: boolean) {
  const key = `${base}/${tab}`;
  const [result, setResult] = useState<{ key: string; state: BrowserState | null; error: string; readStartedAt: number }>({ key: "", state: null, error: "", readStartedAt: 0 });
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!tab || !active) return;
    let live = true;
    let timer = 0;
    const read = async () => {
      const readStartedAt = performance.now();
      try {
        const next = await ask<BrowserState>("GET", tabRoute(base, "state", tab));
        if (live) setResult({ key, state: next, error: "", readStartedAt });
      } catch (e) { if (live) setResult((r) => ({ key, state: r.key === key ? r.state : null, error: browserError(e), readStartedAt: r.key === key ? r.readStartedAt : 0 })); }
      if (live) timer = window.setTimeout(read, 750);
    };
    void read();
    return () => { live = false; window.clearTimeout(timer); };
  }, [base, tab, active, revision]);
  return { state: result.key === key ? result.state : null, error: result.key === key ? result.error : "", readStartedAt: result.key === key ? result.readStartedAt : 0, refresh: () => refresh((n) => n + 1) };
}
