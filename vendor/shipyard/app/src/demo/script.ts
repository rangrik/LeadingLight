import { mockDemo } from "@/lib/mock";
import { route } from "@/lib/notifications";
import { overlayOpen } from "@/lib/overlays";
import { useStore } from "@/lib/store";

// The live demo's script: a few things happen on their own soon after it
// opens, so the board is seen moving. An agent on gpu finishes, Codex on
// qa-deck stops to ask something you can answer, and finished work lands
// in the review inbox. Every box, repository and agent is invented.

let started = false;

export function startDemoScript(still = false) {
  if (started) return;
  started = true;
  // The demo opens where the poster on the website left off.
  useStore.getState().setView({ kind: "dashboard" });
  if (still) return;
  const at = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

  at(6000, () => mockDemo.setAgent("gpu", "judge-v2-claude", "finished"));
  at(13000, () => mockDemo.setAgent("devl", "qa-deck-codex", "waiting"));
  at(21000, () =>
    route({
      category: "review",
      title: "Claude Code left changes to review",
      detail: "4 files · +128 −31 · me/search-perf",
      tone: "success",
      box: "devl",
      path: "/home/me/work/shop-search-perf",
      action: { kind: "review", box: "devl", path: "/home/me/work/shop-search-perf" },
      key: "review|devl|/home/me/work/shop-search-perf",
    }),
  );

  // Inside the website's page, Escape with nothing open to close hands the
  // keyboard back to the page around the demo.
  if (window.parent !== window) {
    let held = false;
    window.addEventListener("keydown", (e) => e.key === "Escape" && (held = overlayOpen()), true);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !held && !e.defaultPrevented) window.parent.postMessage({ type: "berth-demo:escape" }, location.origin);
    });
  }
}

// resetDemo starts it again from the beginning: the page clears what the
// app remembered as it loads (vite.config.ts, demoPage).
export function resetDemo() {
  location.reload();
}
