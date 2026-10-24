import { isNative } from "~/lib/platform";

// The project runtime's API (DECISIONS.md, 18): through the app's runtime commands in the Mac
// app (src-tauri/src/runtime.rs), through the dev server's /__runtime in a browser
// (runtime-dev.ts). Paths are berthd's own routes.

export type RuntimeStatus = { state: "stopped" | "ready" | "failed"; version?: string | null; error?: string | null; home: string };
export type Reply<T> = { status: number; body: T };
export type RuntimeEvent = { seq: number; type: string; time: string; data?: Record<string, unknown>; error?: string };

const invoke = async <T>(cmd: string, args: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);

export async function runtimeStatus(opts: { start?: boolean; restart?: boolean } = {}): Promise<RuntimeStatus> {
  if (await isNative) return invoke("runtime_status", { start: !!opts.start, restart: !!opts.restart });
  const query = opts.restart ? "?restart=1" : opts.start ? "?start=1" : "";
  const res = await fetch(`/__runtime/status${query}`).catch(() => null);
  return res?.ok ? res.json() : { state: "failed", error: "This build has no project runtime.", home: "" };
}

const parse = (text: string) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

export async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  if (await isNative) return invoke("runtime_call", { method, path, body: body ?? null });
  const send = () => fetch(`/__runtime${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let res = await send();
  // Not started yet in this dev server's checkout: started once, as the app does.
  if (res.status === 503 && (await runtimeStatus({ start: true })).state === "ready") res = await send();
  return { status: res.status, body: parse(await res.text()) };
}

// A call whose failure is an error the caller can show: berthd says why in "error".
export async function ask<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T & { error?: string }>(method, path, body);
  if (r.status >= 400) throw new Error((r.body as { error?: string } | null)?.error ?? `The runtime answered ${r.status}`);
  return r.body;
}

// The runtime's events after since, as they come; ended() once the stream stops for any reason.
export function events(since: number | null, on: (e: RuntimeEvent) => void, ended: () => void): () => void {
  const read = (line: string) => {
    if (!line.trim()) return;
    try {
      on(JSON.parse(line));
    } catch {
      // A line that isn't an event is skipped.
    }
  };
  let stop = () => {};
  let done = false;
  const end = () => !done && ((done = true), ended());
  void isNative.then(async (native) => {
    if (native) {
      const { Channel } = await import("@tauri-apps/api/core");
      const channel = new Channel<string>();
      // An empty line is the stream's end (runtime.rs).
      channel.onmessage = (line) => (line ? read(line) : end());
      const id = await invoke<number>("runtime_events", { since, on: channel });
      stop = () => void invoke("runtime_events_stop", { id });
      return;
    }
    const abort = new AbortController();
    stop = () => abort.abort();
    // berthd says something at least every 25 s; silence past that is a lost stream.
    let quiet = window.setTimeout(() => abort.abort(), 40_000);
    try {
      const res = await fetch(`/__runtime/v1/events${since === null ? "" : `?since=${since}`}`, { signal: abort.signal });
      const reader = res.body?.getReader();
      const text = new TextDecoder();
      let rest = "";
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        window.clearTimeout(quiet);
        quiet = window.setTimeout(() => abort.abort(), 40_000);
        const lines = (rest + text.decode(chunk.value, { stream: true })).split("\n");
        rest = lines.pop() ?? "";
        lines.forEach(read);
      }
    } catch {
      // Stopped, or the dev server went away.
    }
    window.clearTimeout(quiet);
    end();
  });
  return () => {
    done = true;
    stop();
  };
}
