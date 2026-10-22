import { useEffect, useState } from "react";

import type * as Diffs from "@/components/diff/diffs";

// The diff renderer (diffs.tsx, @pierre/diffs) loads on first use, never
// with the app: a chat with a hundred folded edits pays nothing for it.
// A failed load is tried again next time.
export type DiffsModule = typeof Diffs;

let loading: Promise<DiffsModule> | undefined;
let loaded: DiffsModule | undefined;

export function loadDiffs(): Promise<DiffsModule> {
  loading ??= import("@/components/diff/diffs").then(
    (m) => (loaded = m),
    (err) => {
      loading = undefined;
      throw err;
    },
  );
  return loading;
}

// useDiffs loads the renderer once want is true: the module, an error, or
// undefined while it loads. Loaded once, it is there at once.
export function useDiffs(want = true): { mod: DiffsModule } | { error: string } | undefined {
  const [state, setState] = useState<{ mod: DiffsModule } | { error: string } | undefined>(() => (loaded ? { mod: loaded } : undefined));
  useEffect(() => {
    if (!want || state) return;
    let live = true;
    loadDiffs().then(
      (mod) => live && setState({ mod }),
      (err) => live && setState({ error: String(err?.message ?? err) }),
    );
    return () => {
      live = false;
    };
  }, [want, state]);
  return state;
}

// useDark follows the app's light or dark look (.dark on <html>).
export function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}
