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

// A streamed answer, line by line, as it comes; ended() once it stops for any reason. Stopping
// closes it, so berthd stops the work too (a clone). Silence past quiet seconds is a lost stream.
export function stream(method: string, path: string, body: unknown, quiet: number, on: (line: string) => void, ended: () => void): () => void {
  let stop = () => {};
  let done = false;
  const end = () => !done && ((done = true), ended());
  const read = (line: string) => line.trim() && on(line);
  void isNative.then(async (native) => {
    if (done) return;
    if (native) {
      const { Channel } = await import("@tauri-apps/api/core");
      const channel = new Channel<string>();
      // An empty line is the stream's end (runtime.rs).
      channel.onmessage = (line) => !done && (line ? read(line) : end());
      const id = await invoke<number>("runtime_stream", { method, path, body: body ?? null, quiet, on: channel }).catch(() => null);
      if (id === null) return end();
      stop = () => void invoke("runtime_stream_stop", { id });
      if (done) stop();
      return;
    }
    const abort = new AbortController();
    stop = () => abort.abort();
    let silent = window.setTimeout(() => abort.abort(), quiet * 1000);
    try {
      const res = await fetch(`/__runtime${path}`, { method, signal: abort.signal, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) throw new Error(`The runtime answered ${res.status}`);
      const reader = res.body?.getReader();
      const text = new TextDecoder();
      let rest = "";
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        window.clearTimeout(silent);
        silent = window.setTimeout(() => abort.abort(), quiet * 1000);
        const lines = (rest + text.decode(chunk.value, { stream: true })).split("\n");
        rest = lines.pop() ?? "";
        if (!done) lines.forEach(read);
      }
      if (!done) read(rest);
    } catch {
      // Stopped, or the dev server went away.
    }
    window.clearTimeout(silent);
    end();
  });
  return () => {
    done = true;
    stop();
  };
}

// The runtime's events after since, as they come; berthd says something at least every 25 s.
export const events = (since: number | null, on: (e: RuntimeEvent) => void, ended: () => void) =>
  stream("GET", `/v1/events${since === null ? "" : `?since=${since}`}`, undefined, 40, (line) => {
    try {
      on(JSON.parse(line));
    } catch {
      // A line that isn't an event is skipped.
    }
  }, ended);
