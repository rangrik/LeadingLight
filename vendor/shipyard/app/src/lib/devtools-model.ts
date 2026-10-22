// The Browser tab's Console and Network drawer: what a page said and asked
// for, as the app keeps it. Pure, so it is tested on its own
// (devtools-model.test.ts); lib/devtools.ts keeps it per pane.
//
// Console entries come from devtools.js (internal/proxy/devtools.js) in the
// page: the native webview's watcher sends its reports as events
// (src-tauri/src/browser.rs), a frame posts them. Network entries are the
// laptop proxy's log of the requests it relayed for the page's host
// (internal/proxy/requestlog.go).

export type ConsoleLevel = "error" | "warn" | "info" | "log" | "debug";

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
  stack?: string;
  // console, uncaught, rejection or resource (a failed image or script).
  source: string;
  // Where an uncaught error was thrown, as url:line:col.
  at?: string;
  time: number;
  count: number;
}

// Report is one batch from the page's script. doc changes with every new
// document (a reload, a navigation); t0 is when its navigation started.
export interface Report {
  doc: string;
  t0: number;
  href: string;
  entries: ConsoleEntry[];
  dropped: number;
}

export interface NetEntry {
  seq: number;
  start: number;
  method: string;
  host: string;
  path: string;
  status: number;
  type: string;
  mime?: string;
  ms: number;
  size: number;
  error?: string;
  body?: string;
}

const LEVELS = new Set<ConsoleLevel>(["error", "warn", "info", "log", "debug"]);
const TEXT = 4000;
const STACK = 4000;
// What a pane keeps: the newest, once a page logs more.
export const CONSOLE_LIMIT = 1000;
export const NETWORK_LIMIT = 500;

const str = (v: unknown, cap: number) => (typeof v === "string" ? (v.length > cap ? `${v.slice(0, cap)}…` : v) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// parseReport reads a report from the page: the JSON string the native
// watcher sends, or the object a frame posts. Anything else is undefined,
// and every field is checked, since the page wrote it.
export function parseReport(raw: unknown): Report | undefined {
  let r: unknown = raw;
  if (typeof raw === "string") {
    try {
      r = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  if (typeof o.doc !== "string" || !o.doc || !Array.isArray(o.entries)) return undefined;
  const entries: ConsoleEntry[] = [];
  for (const e of o.entries.slice(-CONSOLE_LIMIT)) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const level = LEVELS.has(x.level as ConsoleLevel) ? (x.level as ConsoleLevel) : "log";
    const entry: ConsoleEntry = { level, text: str(x.text, TEXT), source: str(x.source, 20) || "console", time: num(x.time), count: Math.max(1, Math.floor(num(x.count))) };
    const stack = str(x.stack, STACK);
    if (stack) entry.stack = stack;
    const at = str(x.at, 500);
    if (at) entry.at = at;
    entries.push(entry);
  }
  return { doc: o.doc.slice(0, 64), t0: num(o.t0), href: str(o.href, 4096), entries, dropped: Math.max(0, Math.floor(num(o.dropped))) };
}

const same = (a: ConsoleEntry, b: ConsoleEntry) => a.level === b.level && a.text === b.text && a.stack === b.stack && a.source === b.source && a.at === b.at;

// appendConsole adds new entries to a pane's list: the same entry as the
// last one counts up, as a console shows a repeat, and the list keeps the
// newest CONSOLE_LIMIT.
export function appendConsole(list: ConsoleEntry[], add: ConsoleEntry[]): ConsoleEntry[] {
  if (!add.length) return list;
  const out = list.slice();
  for (const e of add) {
    const last = out[out.length - 1];
    if (last && same(last, e)) out[out.length - 1] = { ...last, count: last.count + e.count, time: e.time };
    else out.push(e);
  }
  return out.length > CONSOLE_LIMIT ? out.slice(-CONSOLE_LIMIT) : out;
}

// appendNetwork adds the proxy's newer entries, in order, without repeats.
export function appendNetwork(list: NetEntry[], add: NetEntry[], since: number): NetEntry[] {
  const seen = new Set(list.map((n) => n.seq));
  const fresh = add.filter((n) => !seen.has(n.seq) && n.start >= since);
  if (!fresh.length) return list;
  const out = [...list, ...fresh].sort((a, b) => a.start - b.start || a.seq - b.seq);
  return out.length > NETWORK_LIMIT ? out.slice(-NETWORK_LIMIT) : out;
}

// failed is a request that went wrong: an error status, or no answer at
// all. One the page gave up on itself (canceled) is not.
export const failed = (n: NetEntry) => n.error !== "canceled" && (n.status >= 400 || (n.status === 0 && !!n.error));

export const isError = (e: ConsoleEntry) => e.level === "error";

// errorCount is the badge: console errors (a repeat counts each time) and
// failed requests since the page loaded.
export function errorCount(console: ConsoleEntry[], network: NetEntry[]): number {
  let n = 0;
  for (const e of console) if (isError(e)) n += e.count;
  for (const r of network) if (failed(r)) n++;
  return n;
}

export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

// statusText is what a request's status column says.
export function statusText(n: NetEntry): string {
  if (n.error === "canceled") return "canceled";
  if (n.status === 0) return n.error ? "failed" : "pending";
  return String(n.status);
}

// shortAt is an error's place as a file name and line, for the row.
export function shortAt(at: string): string {
  const m = /([^/?#]+)(?:\?[^:]*)?:(\d+)(?::\d+)?$/.exec(at);
  return m ? `${m[1]}:${m[2]}` : at;
}

// requestUrl is a request's full address, from the page's own scheme and
// port when it went to the page's host.
export function requestUrl(n: NetEntry, pageUrl: string): string {
  try {
    const page = new URL(pageUrl);
    return `${page.protocol}//${n.host}${page.port ? `:${page.port}` : ""}${n.path}`;
  } catch {
    return `http://${n.host}${n.path}`;
  }
}

const quoteNote = (note?: string) => (note?.trim() ? `\n\n${note.trim()}` : "");

// consoleMessage is what the agent is sent about a console entry: what the
// page said, where, its stack, and the page.
export function consoleMessage(e: ConsoleEntry, pageUrl: string, note?: string): string {
  const what = e.source === "uncaught" ? "threw an uncaught error" : e.source === "rejection" ? "had an unhandled promise rejection" : e.source === "resource" ? "failed to load a resource" : e.level === "error" ? "logged an error" : e.level === "warn" ? "logged a warning" : "logged this";
  const lines = [`In my browser, the page ${pageUrl} ${what}${e.count > 1 ? ` (${e.count} times)` : ""}:`, "", "```", e.text];
  if (e.at) lines.push(`    at ${e.at}`);
  if (e.stack) lines.push(...e.stack.split("\n").slice(0, 30).map((l) => `    ${l}`));
  lines.push("```");
  return lines.join("\n") + quoteNote(note) + (note?.trim() ? "" : "\n\nPlease find the cause and fix it.");
}

// requestMessage is what the agent is sent about a request: the request,
// its answer, the start of what the answer said, and the page.
export function requestMessage(n: NetEntry, pageUrl: string, note?: string): string {
  const answer = n.error === "canceled" ? "canceled by the page" : n.status ? `${n.status}${n.error ? ` (${n.error})` : ""}` : `no answer (${n.error ?? "failed"})`;
  const lines = [
    `In my browser, on ${pageUrl}, a request failed:`,
    "",
    `${n.method} ${requestUrl(n, pageUrl)}`,
    `→ ${answer} · ${n.type}${n.mime ? ` · ${n.mime}` : ""} · ${formatMs(n.ms)} · ${formatSize(n.size)}`,
  ];
  if (n.body?.trim()) lines.push("", "The response began:", "```", n.body.trim(), "```");
  return lines.join("\n") + quoteNote(note) + (note?.trim() ? "" : "\n\nPlease find the cause and fix it.");
}

// The agent's own browser on the box: the console lines and failed
// requests the box keeps (GET …/browser/devtools).
export interface AgentDevtools {
  running: boolean;
  url?: string;
  console: { seq: number; level: string; text: string; count: number }[];
  failures: { seq: number; text: string }[];
}

// fromAgent turns the box's lines into the drawer's: its levels are error,
// warning and log; a failure is "404 GET http://…", or the network's error
// and the request.
export function fromAgent(d: AgentDevtools): { console: ConsoleEntry[]; network: NetEntry[] } {
  const console = (d.console ?? []).map<ConsoleEntry>((l) => ({ level: l.level === "error" ? "error" : l.level === "warning" ? "warn" : "log", text: l.text, source: "console", time: 0, count: Math.max(1, l.count) }));
  const network = (d.failures ?? []).map<NetEntry>((f) => {
    const m = /^(\d{3}) (\S+) (\S+)$/.exec(f.text);
    let host = "";
    let path = f.text;
    const url = m ? m[3] : /\s(\S+:\/\/\S+)$/.exec(f.text)?.[1];
    if (url) {
      try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname + u.search;
      } catch {
        path = url;
      }
    }
    if (m) return { seq: f.seq, start: 0, method: m[2], host, path, status: Number(m[1]), type: "", ms: 0, size: 0 };
    const req = /\s(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.exec(f.text);
    const why = f.text.split(/\s(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/)[0].trim();
    return { seq: f.seq, start: 0, method: req?.[1] ?? "", host, path, status: 0, type: "", ms: 0, size: 0, error: why || "failed" };
  });
  return { console, network };
}
