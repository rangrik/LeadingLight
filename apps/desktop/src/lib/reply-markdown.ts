import { useEffect, useMemo, useSyncExternalStore } from "react";
import { markdownHtml, type TexRender } from "@/lib/markdown-html";

// Shipyard's lazy math loading, shared by note replies and project replies.
let render: TexRender | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
const snapshot = () => render;
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
function loadMath() {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([{ default: katex }]) => {
      render = (text, displayMode) => katex.renderToString(text, {
        displayMode, throwOnError: false, errorColor: "var(--destructive-foreground)",
      }).replace(/(<span class="katex-error") title="[^"]*"/g, "$1");
      listeners.forEach((f) => f());
    })
    .catch(() => { loading = undefined; });
}

export function useReplyMarkdown(text: string) {
  const tex = useSyncExternalStore(subscribe, snapshot);
  const result = useMemo(() => markdownHtml(text, tex), [text, tex]);
  useEffect(() => { if (result.math && !tex) loadMath(); }, [text, result.math, tex]);
  return result.html;
}
