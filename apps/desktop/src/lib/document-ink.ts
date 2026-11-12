import { useEffect, type RefObject } from "react";
import { isNative, platformReady } from "./platform";
import { liveEditor } from "./live";
import { toastManager } from "@leadinglight/ui/components/toast";

type PencilEvent = { kind: "input"; phase: string; points: { x: number; y: number; pressure: number }[]; width: number; height: number } | { kind: "action"; action: string };
let owner: symbol | undefined;
let pending = Promise.resolve();

export function useInlinePencil(marker: RefObject<HTMLElement | null>, enabled: boolean, pageId: string) {
  useEffect(() => {
    if (!enabled) return;
    const token = Symbol(pageId);
    owner = token;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([isNative, platformReady]).then(async ([native, os]) => {
      if (!native || os !== "ios" || disposed || owner !== token) return;
      const { invoke, Channel } = await import("@tauri-apps/api/core");
      if (disposed || owner !== token) return;
      const pane = marker.current?.closest<HTMLElement>("[data-pane-page]");
      const editor = pane?.querySelector<HTMLElement>('.ll-editor[aria-label="Page body"]');
      const scroller = pane?.querySelector<HTMLElement>("[data-page-scroller]");
      if (!editor || !scroller) return;
      let accepting = false;
      const cancel = () => window.dispatchEvent(new CustomEvent("ll:pencil-input", { detail: { phase: "cancelled", points: [], width: window.innerWidth, height: window.innerHeight } }));
      const channel = new Channel<PencilEvent>();
      channel.onmessage = (event) => {
        if (disposed || owner !== token || !accepting) return;
        if (event.kind === "action") {
          if (event.action === "palette") pane?.querySelector<HTMLButtonElement>('button[aria-label="Writing tools"]')?.click();
          else window.dispatchEvent(new CustomEvent("ll:pencil-action", { detail: event.action }));
        }
        else window.dispatchEvent(new CustomEvent("ll:pencil-input", { detail: { ...event, points: event.points.map((point) => ({ ...point, x: point.x * window.innerWidth / event.width, y: point.y * window.innerHeight / event.height })), width: window.innerWidth, height: window.innerHeight } }));
      };
      let frame = 0, last = "";
      const send = (active: boolean, bounds?: { x: number; y: number; width: number; height: number }) => {
        const signature = JSON.stringify([active, bounds]);
        if (signature === last) return;
        if (accepting) cancel();
        accepting = active;
        if (!active) editor.removeAttribute("data-native-ink");
        last = signature;
        pending = pending.catch(() => {}).then(async () => {
          if (owner !== token || (disposed && active)) return;
          await invoke("plugin:leadinglight-preview|document_ink", { enabled: active, bounds, onEvent: channel });
          if (!disposed && owner === token && signature === last) {
            if (active) editor.dataset.nativeInk = "true";
            else editor.removeAttribute("data-native-ink");
          }
        }).catch(() => {
          if (owner !== token || signature !== last) return;
          last = ""; accepting = false; cancel(); editor.removeAttribute("data-native-ink");
        });
      };
      const update = () => {
        frame = 0;
        if (editor.getClientRects().length === 0) { liveEditor(pageId)?.inkAction("finish"); return; }
        if (Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01) {
          send(false); liveEditor(pageId)?.inkAction("finish");
          toastManager.add({ type: "info", title: "Return to normal zoom to write on this page" });
          return;
        }
        const blocked = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]')].some((el) => !el.closest('[aria-hidden="true"], [inert], [data-closed]') && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden");
        const a = editor.getBoundingClientRect(), b = scroller.getBoundingClientRect();
        const left = Math.max(0, a.left, b.left), top = Math.max(0, a.top, b.top);
        const right = Math.min(window.innerWidth, a.right, b.right), bottom = Math.min(window.innerHeight, a.bottom, b.bottom);
        const active = !blocked && !document.hidden && !document.documentElement.hasAttribute("data-keyboard") && right > left && bottom > top;
        send(active, active ? { x: left / window.innerWidth, y: top / window.innerHeight, width: (right - left) / window.innerWidth, height: (bottom - top) / window.innerHeight } : undefined);
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
      const resize = new ResizeObserver(schedule);
      resize.observe(editor); resize.observe(scroller);
      const surfaces = new MutationObserver(schedule);
      surfaces.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-hidden", "inert", "data-open", "data-closed"] });
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      window.visualViewport?.addEventListener("resize", schedule);
      window.visualViewport?.addEventListener("scroll", schedule);
      document.addEventListener("visibilitychange", schedule);
      update();
      cleanup = () => {
        cancelAnimationFrame(frame); resize.disconnect(); surfaces.disconnect();
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        window.visualViewport?.removeEventListener("resize", schedule);
        window.visualViewport?.removeEventListener("scroll", schedule);
        document.removeEventListener("visibilitychange", schedule);
        editor.removeAttribute("data-native-ink");
        send(false);
      };
    });
    return () => { disposed = true; cleanup(); };
  }, [enabled, pageId, marker]);
}
