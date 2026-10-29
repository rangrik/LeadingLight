import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MousePointer2, RefreshCw } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuTrigger } from "@leadinglight/ui/components/context-menu";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { cn } from "@leadinglight/ui/lib/utils";
import { SHORTCUTS } from "@/lib/shortcuts";
import { accelOf } from "~/lib/keymap";
import { isNative } from "~/lib/platform";
import { ask, stream } from "~/lib/project-runtime/transport";

export type BrowserFrame = { data: string; mime?: string; w: number; h: number; scale?: number; url?: string };
export type BrowserBounds = { x: number; y: number; width: number; height: number };
export type BrowserViewport = { width: number; height: number };
export type BrowserAreaSelection = { bounds: BrowserBounds; viewport: BrowserViewport; url: string };
type Input = {
  type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel" | "keyDown" | "keyUp" | "text";
  x?: number; y?: number; button?: string; buttons?: number; clickCount?: number;
  deltaX?: number; deltaY?: number; key?: string; code?: string; modifiers?: number;
  text?: string; windowsVirtualKeyCode?: number; commands?: string[];
};
type Props = {
  base: string;
  tab: string;
  fit: boolean;
  active?: boolean;
  expectedViewport?: BrowserViewport;
  resizeBusy?: boolean;
  onFrame?: (frame: BrowserFrame) => void;
  onViewport?: (viewport: BrowserViewport) => void;
  onError?: (message: string) => void;
  picking?: boolean;
  onPick?: (point: { x: number; y: number }) => void;
  onArea?: (selection: BrowserAreaSelection) => void;
  highlight?: BrowserBounds;
};
type Connection = "connecting" | "live" | "reconnecting" | "closed";
const buttons = ["left", "middle", "right", "back", "forward"];
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
let menuWork: Promise<unknown> = Promise.resolve();
const nativeMenu = (owner: string, focused: boolean) => (menuWork = menuWork.catch(() => {}).then(async () => {
  if (await isNative) await (await import("@tauri-apps/api/core")).invoke("browser_menu_focus", { owner, focused });
}));

// A new tab gets a new input queue, so a late frame or key can never land in another tab.
export function BrowserSurface(props: Props) {
  return <Surface key={`${props.base}/${props.tab}`} {...props} />;
}

function Surface({ base, tab, fit, active = true, expectedViewport, resizeBusy = false, onFrame, onViewport, onError, picking = false, onPick, onArea, highlight }: Props) {
  const suffix = `?tab=${encodeURIComponent(tab)}`;
  const root = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const callbacks = useRef({ onFrame, onViewport, onError });
  callbacks.current = { onFrame, onViewport, onError };
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const currentFrame = useRef(frame);
  currentFrame.current = frame;
  const [connection, setConnection] = useState<Connection>("connecting");
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState({ x: 0, y: 0 });
  const [failure, setFailure] = useState("");
  const [outlined, setOutlined] = useState<BrowserBounds>();
  const [hovered, setHovered] = useState<BrowserBounds>();
  const [dragged, setDragged] = useState<BrowserBounds>();
  const selection = useRef<{ start: { x: number; y: number }; client: { x: number; y: number }; viewport: BrowserViewport; url: string; dragged: boolean } | null>(null);
  const hover = useRef<{ sequence: number; timer: number; pending?: { x: number; y: number }; inFlight: boolean }>({ sequence: 0, timer: 0, inFlight: false });
  const pickingNow = useRef(picking);
  pickingNow.current = picking;
  const pickingPointer = useRef(false);
  const live = active && visible && foreground;
  const resizing = resizeBusy || (!!expectedViewport && !!frame && (frame.w !== expectedViewport.width || frame.h !== expectedViewport.height));
  const ready = live && connection === "live" && !resizing;
  const inputAllowed = useRef(false);
  inputAllowed.current = ready && !picking;
  const scrollAllowed = useRef(false);
  scrollAllowed.current = ready;
  const channel = useRef<{ send: (input: Input) => void; copy: (cut?: boolean) => void; paste: () => void; release: (discard?: boolean) => void } | null>(null);
  const pressed = useRef(new Map<string, Input>());
  const pointer = useRef<{ x: number; y: number; button: string; clickCount: number } | null>(null);
  const lastPress = useRef({ time: 0, x: 0, y: 0, button: "", count: 0 });
  const composing = useRef(false);
  const compositionDone = useRef<string | null>(null);
  const nativeOwner = useRef<string | null>(null);
  const nativeListening = useRef<Promise<void>>(Promise.resolve());
  const nativeReady = useRef<Promise<unknown>>(Promise.resolve());
  const claimMenu = () => {
    const owner = nativeOwner.current ?? crypto.randomUUID();
    nativeOwner.current = owner;
    nativeReady.current = nativeReady.current.catch(() => {}).then(() => nativeListening.current).then(() => nativeOwner.current === owner && nativeMenu(owner, true));
    void nativeReady.current.catch((error) => callbacks.current.onError?.(message(error)));
  };
  const releaseMenu = () => {
    const owner = nativeOwner.current;
    nativeOwner.current = null;
    if (owner) nativeReady.current = nativeReady.current.catch(() => {}).then(() => nativeMenu(owner, false));
    void nativeReady.current.catch((error) => callbacks.current.onError?.(message(error)));
  };
  const clipboard = async (text?: string) => {
    if (!(await isNative)) return text === undefined ? navigator.clipboard.readText() : navigator.clipboard.writeText(text);
    await nativeReady.current;
    const owner = nativeOwner.current;
    if (!owner) throw new Error("Focus the browser page first.");
    return (await import("@tauri-apps/api/core")).invoke<string>("browser_clipboard", { owner, text: text ?? null });
  };

  useEffect(() => {
    setOutlined(highlight);
    const timer = window.setTimeout(() => setOutlined(undefined), 1400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (picking) { channel.current?.release(true); keyboard.current?.blur(); releaseMenu(); setFocused(false); }
  }, [picking]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    nativeListening.current = isNative.then(async (native) => {
      if (!native || !alive) return;
      unlisten = await (await import("@tauri-apps/api/event")).listen<{ owner: string; action: string }>("ll:browser-edit", ({ payload }) => {
        if (!alive || !inputAllowed.current || payload.owner !== nativeOwner.current || document.activeElement !== keyboard.current) return;
        const control = channel.current;
        if (payload.action === "copy" || payload.action === "cut") control?.copy(payload.action === "cut");
        else if (payload.action === "paste") control?.paste();
        else if (["undo", "redo", "selectAll"].includes(payload.action)) {
          const key = payload.action === "selectAll" ? "a" : "z";
          control?.send({ type: "keyDown", key, commands: [payload.action] });
          control?.send({ type: "keyUp", key });
        }
      });
      if (!alive) unlisten();
    });
    const focus = () => { if (document.activeElement === keyboard.current && !keyboard.current?.disabled) claimMenu(); };
    const blur = () => { releaseMenu(); channel.current?.release(); };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      alive = false; releaseMenu(); unlisten?.();
      window.removeEventListener("focus", focus); window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    resize.observe(element);
    intersection.observe(element);
    const visibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => { resize.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (live && size.width > 0 && size.height > 0) callbacks.current.onViewport?.(size);
  }, [live, size.width, size.height]);

  useEffect(() => { setOutlined(undefined); }, [frame?.w, frame?.h, size.width, size.height]);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    let stop = () => {};
    let timer = 0;
    let failures = 0;
    let generation = 0;
    setConnection("connecting");
    const connect = () => {
      if (!alive) return;
      const current = ++generation;
      stop = stream("GET", `${base}/screencast${suffix}`, undefined, 65, (line) => {
        if (!alive || current !== generation) return;
        try {
          const next = JSON.parse(line) as BrowserFrame;
          if (!next.data || next.w <= 0 || next.h <= 0 || !Number.isFinite(next.w + next.h)) return;
          if (next.mime && !["image/jpeg", "image/png", "image/webp"].includes(next.mime)) return;
          failures = 0;
          setFrame(next);
          setConnection("live");
          setFailure("");
          callbacks.current.onFrame?.(next);
        } catch { /* The runtime also sends stream keepalives. */ }
      }, () => {
        if (!alive || current !== generation) return;
        setConnection("reconnecting");
        void ask<{ running: boolean }>("GET", `${base}/state${suffix}`).then((state) => {
          if (alive && current === generation && !state.running) setConnection("closed");
        }, (error) => { if (alive && current === generation) setFailure(message(error)); });
        timer = window.setTimeout(connect, Math.min(8000, 1000 * 2 ** failures++));
      });
    };
    connect();
    return () => { alive = false; window.clearTimeout(timer); stop(); };
  }, [base, suffix, live, attempt]);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    let running = false;
    let generation = 0;
    let pending: Promise<unknown> = Promise.resolve();
    const queue: (Input | (() => Promise<void>))[] = [];
    const allowed = (event: Input) => ["keyUp", "mouseReleased"].includes(event.type) || (event.type === "mouseWheel" ? scrollAllowed.current : inputAllowed.current);
    const input = (event: Input) => ask("POST", `${base}/input${suffix}`, event);
    const fail = (error: unknown) => {
      if (!alive) return;
      setFailure(message(error));
      callbacks.current.onError?.(message(error));
    };
    const drain = async () => {
      if (running) return;
      running = true;
      while (alive && queue.length) {
        const next = queue.shift()!;
        if (typeof next !== "function" && !allowed(next)) continue;
        try { pending = typeof next === "function" ? next() : input(next); await pending; } catch (error) { fail(error); }
      }
      running = false;
    };
    const send = (event: Input) => {
      if (!alive || !allowed(event)) return;
      const last = queue.at(-1);
      if (last && typeof last !== "function" && last.type === event.type) {
        if (event.type === "mouseMoved") { queue[queue.length - 1] = event; return; }
        if (event.type === "mouseWheel") {
          last.deltaX = (last.deltaX ?? 0) + (event.deltaX ?? 0);
          last.deltaY = (last.deltaY ?? 0) + (event.deltaY ?? 0);
          return;
        }
      }
      queue.push(event);
      void drain();
    };
    const copy = (cut = false) => {
      queue.push(async () => {
        if (!inputAllowed.current) return;
        const current = generation;
        const selected = await ask<{ text: string; truncated?: boolean }>("GET", `${base}/selection${suffix}`);
        if (!alive || current !== generation || !inputAllowed.current || !selected.text) return;
        if (selected.truncated) throw new Error("The selection is too large to copy. Select less text.");
        await clipboard(selected.text);
        if (alive && current === generation && inputAllowed.current && cut) {
          await input({ type: "keyDown", key: "x", code: "KeyX", commands: ["cut"] });
          await input({ type: "keyUp", key: "x", code: "KeyX" });
        }
      });
      void drain();
    };
    const paste = () => {
      queue.push(async () => {
        if (!inputAllowed.current) return;
        const current = generation;
        const text = await clipboard();
        if (alive && current === generation && inputAllowed.current && text) await input({ type: "text", text });
      });
      void drain();
    };
    const release = (discard = false) => {
      if (discard) {
        generation++;
        queue.splice(0, queue.length, ...queue.filter((event) => typeof event !== "function" && ["keyUp", "mouseReleased"].includes(event.type)));
      }
      if (pointer.current) send({ type: "mouseReleased", ...pointer.current, buttons: 0, clickCount: 1 });
      pointer.current = null;
      for (const event of pressed.current.values()) send({ ...event, type: "keyUp", modifiers: 0, text: undefined, commands: undefined });
      pressed.current.clear();
    };
    channel.current = { send, copy, paste, release };
    return () => {
      // Release keys on the old tab; pending input is discarded when its surface is hidden.
      const releases: Input[] = queue.filter((event): event is Input => typeof event !== "function" && (event.type === "keyUp" || event.type === "mouseReleased"));
      releases.push(...[...pressed.current.values()].map((event): Input => ({ ...event, type: "keyUp", modifiers: 0, text: undefined, commands: undefined })));
      if (pointer.current) releases.push({ type: "mouseReleased", ...pointer.current, buttons: 0, clickCount: 1 });
      alive = false;
      queue.length = 0;
      channel.current = null;
      pressed.current.clear();
      pointer.current = null;
      void pending.catch(() => {}).then(async () => {
        for (const event of releases) await input(event).catch(() => {});
      });
    };
  }, [base, suffix, live]);

  const point = (x: number, y: number) => {
    const rect = image.current?.getBoundingClientRect();
    const current = currentFrame.current;
    if (!rect || !current || !rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(current.w - 1, (x - rect.left) * current.w / rect.width)),
      y: Math.max(0, Math.min(current.h - 1, (y - rect.top) * current.h / rect.height)),
    };
  };
  const clearHover = () => {
    hover.current.sequence++; hover.current.pending = undefined;
    window.clearTimeout(hover.current.timer); setHovered(undefined);
  };
  const hoverAt = (at: { x: number; y: number }) => {
    const current = hover.current;
    const sequence = ++current.sequence;
    current.pending = at;
    window.clearTimeout(current.timer);
    const inspect = () => {
      if (current.inFlight || !current.pending || !pickingNow.current) return;
      const point = current.pending; current.pending = undefined; current.inFlight = true;
      const frame = currentFrame.current;
      void ask<{ bounds: BrowserBounds; url: string }>("POST", `${base}/inspect/hover${suffix}`, point).then((result) => {
        if (sequence === current.sequence && pickingNow.current && !selection.current && scrollAllowed.current && frame?.url === currentFrame.current?.url && frame?.w === currentFrame.current?.w && frame?.h === currentFrame.current?.h && result.url === frame?.url && result.bounds && Object.values(result.bounds).every(Number.isFinite)) setHovered(result.bounds);
      }).catch(() => {}).finally(() => {
        current.inFlight = false;
        if (current.pending && pickingNow.current) hoverAt(current.pending);
      });
    };
    current.timer = window.setTimeout(inspect, 80);
  };
  useEffect(() => {
    clearHover(); selection.current = null; setDragged(undefined); pickingPointer.current = false;
    return () => { hover.current.sequence++; hover.current.pending = undefined; window.clearTimeout(hover.current.timer); };
  }, [picking, ready, frame?.w, frame?.h, frame?.url, size.width, size.height]);
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { selection.current = null; setDragged(undefined); pickingPointer.current = false; clearHover(); }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const sendPointer = (event: PointerEvent, type: Input["type"]) => {
    const at = point(event.clientX, event.clientY);
    if (!at || !ready) return;
    const button = buttons[event.button] ?? pointer.current?.button ?? "none";
    let clickCount = pointer.current?.clickCount ?? 1;
    if (type === "mousePressed") {
      const last = lastPress.current;
      const repeated = event.timeStamp - last.time < 500 && last.button === button && Math.hypot(at.x - last.x, at.y - last.y) < 5;
      clickCount = repeated ? last.count % 3 + 1 : 1;
      lastPress.current = { time: event.timeStamp, ...at, button, count: clickCount };
      pointer.current = { ...at, button, clickCount };
    }
    if (type === "mouseMoved" && pointer.current) pointer.current = { ...pointer.current, ...at };
    channel.current?.send({ type, ...at, button, buttons: event.buttons, modifiers: modifiers(event), clickCount });
    if (type === "mouseReleased") pointer.current = null;
  };

  useEffect(() => {
    const element = image.current;
    if (!element || !ready) return;
    const wheel = (event: WheelEvent) => {
      if (!scrollAllowed.current || event.ctrlKey || event.metaKey) return;
      if (selection.current) { event.preventDefault(); return; }
      const at = point(event.clientX, event.clientY);
      if (!at) return;
      event.preventDefault();
      setOutlined(undefined);
      clearHover();
      const rect = element.getBoundingClientRect();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? currentFrame.current!.h : 1;
      channel.current?.send({ type: "mouseWheel", ...at, deltaX: event.deltaX * factor * currentFrame.current!.w / rect.width, deltaY: event.deltaY * factor * currentFrame.current!.h / rect.height, modifiers: modifiers(event) });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [ready]);

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!ready || composing.current || event.nativeEvent.isComposing || ["Dead", "Process"].includes(event.key)) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    // Browser chrome shortcuts belong to the containing pane, even while the page has focus.
    if (command && ["l", "t", "w", "f", "r", "+", "=", "-", "0"].includes(key)) return;
    const accel = accelOf(event.nativeEvent);
    if (accel && SHORTCUTS.some((item) => item.accel === accel || (event.ctrlKey && !event.metaKey && item.accel === accel.replace("Ctrl", "CmdOrCtrl")))) return;
    if (command && key === "v") return;
    event.preventDefault();
    event.stopPropagation();
    if (command && (key === "c" || key === "x")) { channel.current?.copy(key === "x"); return; }
    const commands = command && key === "a" ? ["selectAll"] : command && key === "z" ? [event.shiftKey ? "redo" : "undo"] : undefined;
    const next: Input = { type: "keyDown", key: event.key, code: event.code, modifiers: modifiers(event), windowsVirtualKeyCode: event.keyCode, commands };
    if (!command && event.key.length === 1) next.text = event.key;
    channel.current?.send(next);
    pressed.current.set(event.code, next);
  };
  const keyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const previous = pressed.current.get(event.code);
    if (!previous) return;
    event.preventDefault();
    event.stopPropagation();
    channel.current?.send({ ...previous, type: "keyUp", modifiers: modifiers(event), text: undefined, commands: undefined });
    pressed.current.delete(event.code);
  };
  const width = frame ? Math.max(1, fit ? Math.min(frame.w, size.width, size.height * frame.w / frame.h) : frame.w) : 0;
  useEffect(() => { if (!ready) { channel.current?.release(true); keyboard.current?.blur(); releaseMenu(); setFocused(false); } }, [ready]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="browser-surface" data-tab={tab}>
      <div className="relative min-h-0 flex-1 overflow-auto bg-muted/30" ref={root}>
        {frame && (
          <ContextMenu onOpenChange={(open, event) => { if (open && (!ready || picking || pickingPointer.current)) event.cancel(); }}>
            <ContextMenuTrigger className="relative block" style={{ width, height: width * frame.h / frame.w, marginInline: fit ? "auto" : undefined }}>
              <img
                alt="Live browser page"
                className={cn("block max-w-none select-none", picking && "cursor-crosshair", !ready && "opacity-40")}
                data-testid="browser-frame"
                draggable={false}
                height={width * frame.h / frame.w}
                onContextMenu={(event) => { if (!ready || picking || pickingPointer.current) event.preventDefault(); }}
                onPointerDown={(event) => {
                  if (!ready) return;
                  event.preventDefault();
                  if (picking) {
                    pickingPointer.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const at = point(event.clientX, event.clientY);
                    clearHover();
                    if (at && event.button === 0 && frame) selection.current = { start: at, client: { x: event.clientX, y: event.clientY }, viewport: { width: frame.w, height: frame.h }, url: frame.url ?? "", dragged: false };
                    return;
                  }
                  const bounds = root.current!.getBoundingClientRect();
                  setCaret({ x: event.clientX - bounds.left + root.current!.scrollLeft, y: event.clientY - bounds.top + root.current!.scrollTop });
                  keyboard.current?.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  sendPointer(event, "mousePressed");
                }}
                onPointerMove={(event) => {
                  if (!picking && !pickingPointer.current) { sendPointer(event, "mouseMoved"); return; }
                  if (!picking || !ready) return;
                  const at = point(event.clientX, event.clientY);
                  if (!at) return;
                  const selected = selection.current;
                  if (!selected) { hoverAt(at); return; }
                  selected.dragged ||= Math.hypot(event.clientX - selected.client.x, event.clientY - selected.client.y) > 5;
                  if (selected.dragged) setDragged({ x: Math.min(selected.start.x, at.x), y: Math.min(selected.start.y, at.y), width: Math.abs(at.x - selected.start.x), height: Math.abs(at.y - selected.start.y) });
                }}
                onPointerLeave={() => { if (!selection.current) clearHover(); }}
                onPointerUp={(event) => {
                  const selected = selection.current;
                  const at = point(event.clientX, event.clientY);
                  if (picking && ready && selected && at && event.button === 0 && selected.url === frame?.url && selected.viewport.width === frame?.w && selected.viewport.height === frame?.h) {
                    if (selected.dragged) {
                      const bounds = { x: Math.min(selected.start.x, at.x), y: Math.min(selected.start.y, at.y), width: Math.abs(at.x - selected.start.x), height: Math.abs(at.y - selected.start.y) };
                      if (bounds.width >= 1 && bounds.height >= 1) onArea?.({ bounds, viewport: selected.viewport, url: selected.url });
                    } else onPick?.(at);
                  }
                  selection.current = null; setDragged(undefined);
                  if (!pickingPointer.current && !picking && pointer.current) sendPointer(event, "mouseReleased");
                  pickingPointer.current = false;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  pickingPointer.current = false;
                  selection.current = null; setDragged(undefined); clearHover();
                  channel.current?.release();
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onLostPointerCapture={() => { pickingPointer.current = false; selection.current = null; setDragged(undefined); if (pointer.current) channel.current?.release(); }}
                ref={image}
                src={`data:${frame.mime ?? "image/jpeg"};base64,${frame.data}`}
                style={{ width, height: width * frame.h / frame.w }}
                width={width}
              />
              {outlined && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: outlined.x * width / frame.w, top: outlined.y * width / frame.w, width: outlined.width * width / frame.w, height: outlined.height * width / frame.w }} />}
              {picking && (dragged ?? hovered) && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-primary bg-primary/10" data-testid="browser-annotation-outline" style={{ left: (dragged ?? hovered)!.x * width / frame.w, top: (dragged ?? hovered)!.y * width / frame.w, width: (dragged ?? hovered)!.width * width / frame.w, height: (dragged ?? hovered)!.height * width / frame.w }} />}
            </ContextMenuTrigger>
            <ContextMenuPopup finalFocus={keyboard}>
              <ContextMenuItem disabled={!ready || picking} onClick={() => { keyboard.current?.focus({ preventScroll: true }); channel.current?.copy(); }}>Copy selection</ContextMenuItem>
              <ContextMenuItem disabled={!ready || picking} onClick={() => { keyboard.current?.focus({ preventScroll: true }); channel.current?.copy(true); }}>Cut selection</ContextMenuItem>
              <ContextMenuItem disabled={!ready || picking} onClick={() => { keyboard.current?.focus({ preventScroll: true }); channel.current?.paste(); }}>Paste text</ContextMenuItem>
              <ContextMenuItem disabled={!ready || picking} onClick={() => { channel.current?.send({ type: "keyDown", key: "a", code: "KeyA", commands: ["selectAll"] }); channel.current?.send({ type: "keyUp", key: "a", code: "KeyA" }); }}>Select all</ContextMenuItem>
            </ContextMenuPopup>
          </ContextMenu>
        )}
        {!ready && (
          <div aria-live="polite" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm">
            <p>{!live ? "Browser paused while this pane is hidden." : connection === "closed" ? "This tab is closed." : connection === "connecting" ? "Connecting to the browser…" : resizing ? "Updating page size…" : "Reconnecting to the browser…"}</p>
            {failure && <p className="max-w-sm break-words text-xs">{failure}</p>}
            {live && connection !== "connecting" && connection !== "live" && <Button onClick={() => setAttempt((n) => n + 1)} size="sm" variant="outline"><RefreshCw className="size-4" />Reconnect</Button>}
          </div>
        )}
        <Textarea
          aria-label="Browser page keyboard"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="pointer-events-none absolute top-0 left-0 size-px opacity-0 [&_textarea]:size-px [&_textarea]:min-h-0 [&_textarea]:p-0"
          disabled={!ready || picking}
          onBlur={() => { setFocused(false); releaseMenu(); channel.current?.release(); }}
          onCompositionStart={() => { composing.current = true; compositionDone.current = null; }}
          onCompositionEnd={(event) => {
            composing.current = false;
            compositionDone.current = event.data;
            if (event.data) channel.current?.send({ type: "text", text: event.data });
            event.currentTarget.value = "";
          }}
          onCopy={(event) => { event.preventDefault(); channel.current?.copy(); }}
          onCut={(event) => { event.preventDefault(); channel.current?.copy(true); }}
          onFocus={() => { setFocused(true); claimMenu(); }}
          onInput={(event) => {
            if (composing.current) return;
            const text = event.currentTarget.value;
            if (text && text !== compositionDone.current) channel.current?.send({ type: "text", text });
            compositionDone.current = null;
            event.currentTarget.value = "";
          }}
          onKeyDown={keyDown}
          onKeyUp={keyUp}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            if (text) channel.current?.send({ type: "text", text });
          }}
          ref={keyboard}
          spellCheck={false}
          style={{ transform: `translate(${caret.x}px, ${caret.y}px)` }}
          unstyled
        />
      </div>
      <div className="flex min-h-7 shrink-0 items-center gap-2 border-t px-2 text-muted-foreground text-xs">
        <MousePointer2 aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{failure && ready ? failure : picking ? "Click an element or drag an area to comment" : focused ? "Typing in the page · ⌘L for the address" : "Click the page to browse"}</span>
        <Button className="shrink-0" disabled={!ready || picking} onClick={() => keyboard.current?.focus({ preventScroll: true })} size="xs" variant="ghost">Focus page</Button>
      </div>
    </div>
  );
}
