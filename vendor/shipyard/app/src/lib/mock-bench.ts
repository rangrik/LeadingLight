import type { Location, Session, Stats, Status } from "@/lib/api";
import { keyOf, useConversations } from "@/lib/conversation-store";
import { useHistory } from "@/lib/history";
import type { AgentMessage, CrewMember, ToolDetail, TranscriptItem } from "@/lib/transcript";

// The demo's benchmarks (?mock=1&bench=…), for measuring the app with far
// more than the fixtures hold (app/perf, pnpm perf). Everything is made up
// and about one invented company, acme; it is made from its index, so the
// same flags always give the same chat.
//
//   bench=chat&turns=N  two long, busy chats, devl/search-perf and
//                       gpu/ci-flake: N turns each of prompts, folded tool
//                       calls with large outputs, helpers, edits with diffs,
//                       long Markdown replies with big highlighted code
//                       blocks and tables, messages from other agents,
//                       pings, reports and notices. All N turns are loaded,
//                       as if the person had scrolled to the top.
//   bench=fleet&worktrees=N  N more worktrees over four more boxes, each
//                       with an agent in some state (the sidebar, Home).
//   bench=term&lines=N  every terminal starts with N lines of output, and
//                       the wheel scrolls through them as tmux would.
//   bench=noisy&rate=N  every terminal prints N lines a second, as a build
//                       or a log tail does, and echoes what is typed at
//                       once (perf/terminals.mjs, perf/soak.mjs).

const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
export const BENCH = q.get("bench") ?? "";
const num = (k: string, d: number) => Math.max(0, Math.floor(Number(q.get(k) ?? d) || d));

// ---- Long chats ------------------------------------------------------------

// The chats the bench fills: the first is the one measured, the second is
// switched to and back.
export const BENCH_CHATS = [
  { box: "devl", session: "search-perf-claude", worktree: "devl/search-perf" },
  { box: "gpu", session: "ci-flake-claude", worktree: "gpu/ci-flake" },
];

const AREAS = ["billing", "checkout", "search", "ledger", "exports", "webhooks", "auth", "inventory", "notifications", "reports"];
const VERBS = ["retry", "settle", "index", "reconcile", "export", "verify", "refund", "throttle", "cache", "migrate"];
const LANGS = ["ts", "go", "python", "sql", "bash"] as const;
const EDITS = [
  { tool: "mock-edit-1", file: "apps/web/lib/payments/webhook.ts", added: 9, removed: 2 },
  { tool: "mock-edit-go", file: "services/payments/retry.go", added: 14, removed: 3 },
  { tool: "mock-multi-1", file: "apps/web/lib/checkout/createOrder.ts", added: 3, removed: 2 },
  { tool: "mock-write-1", file: "apps/web/lib/payments/webhook.test.ts", added: 45, removed: 0 },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// code is a block of n lines in lang, about acme's area.
function code(lang: (typeof LANGS)[number], area: string, verb: string, n: number, t: number): string {
  const out: string[] = [];
  switch (lang) {
    case "ts":
      out.push(`import { db } from "@acme/db";`, `import { log } from "@acme/log";`, "", `export interface ${cap(area)}Job {`, "  id: string;", "  attempts: number;", "  payload: Record<string, unknown>;", "}", "");
      for (let i = 0; out.length < n - 2; i++)
        out.push(`export async function ${verb}${cap(area)}${i}(job: ${cap(area)}Job): Promise<number> {`, `  const rows = await db.${area}.findMany({ where: { id: job.id, step: ${i + t} } });`, `  log.info("${verb} ${area}", { id: job.id, rows: rows.length, attempt: job.attempts });`, `  return rows.reduce((n, r) => n + (r.amount ?? 0) * ${(i % 7) + 1}, 0);`, "}", "");
      out.push(`// ${verb} ${area}: turn ${t + 1}`);
      break;
    case "go":
      out.push(`package ${area}`, "", "import (", '\t"context"', '\t"fmt"', '\t"time"', ")", "");
      for (let i = 0; out.length < n - 1; i++)
        out.push(`// ${cap(verb)}${i} ${verb}s one acme ${area} batch.`, `func ${cap(verb)}${i}(ctx context.Context, id string) error {`, `\tdeadline := time.Now().Add(${(i % 9) + 1} * time.Second)`, "\tfor time.Now().Before(deadline) {", `\t\tif err := step(ctx, id, ${i + t}); err != nil {`, `\t\t\treturn fmt.Errorf("${verb} %s: %w", id, err)`, "\t\t}", "\t}", "\treturn nil", "}", "");
      break;
    case "python":
      out.push("from dataclasses import dataclass", `from acme.${area} import client`, "", "@dataclass", `class ${cap(area)}Row:`, "    id: str", "    amount: int", "");
      for (let i = 0; out.length < n - 1; i++) out.push(`def ${verb}_${area}_${i}(rows: list[${cap(area)}Row]) -> int:`, `    """${cap(verb)} acme ${area} rows, batch ${i}."""`, `    total = sum(r.amount for r in rows if r.amount > ${i * 10 + t})`, `    client.record("${verb}", total=total, step=${i})`, "    return total", "");
      break;
    case "sql":
      out.push(`-- ${cap(verb)} acme ${area}: turn ${t + 1}`, "BEGIN;");
      for (let i = 0; out.length < n - 1; i++) out.push(`ALTER TABLE ${area}_${i} ADD COLUMN IF NOT EXISTS idempotency_key text;`, `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${area}_${i}_key ON ${area}_${i} (idempotency_key) WHERE idempotency_key IS NOT NULL;`, `UPDATE ${area}_${i} SET idempotency_key = id::text WHERE created_at < now() - interval '${i + 1} days';`);
      out.push("COMMIT;");
      break;
    case "bash":
      out.push("#!/usr/bin/env bash", "set -euo pipefail");
      for (let i = 0; out.length < n; i++) out.push(`pnpm --filter @acme/${area} test -- --grep "${verb} ${i}"`, `curl -fsS "https://api.acme.test/${area}/${verb}?batch=${i + t}" | jq '.items | length'`);
      break;
  }
  return out.slice(0, n).join("\n");
}

// answer is a turn's reply: long Markdown, most with a big code block, some
// with a table.
function answer(t: number, area: string, verb: string): string {
  const lang = LANGS[t % LANGS.length];
  const parts = [
    `## ${cap(verb)} acme ${area}, turn ${t + 1}`,
    `The ${area} worker ${verb}s each batch twice when a request times out: the first try commits, the retry finds no key and writes again. Over the last week that is **${(t * 37) % 900} duplicate rows** in \`acme_${area}\`, all from the same path, and none from the nightly job.`,
    `- \`${area}/${verb}.ts\` takes the key from the request and stores it with the row.\n- A retry looks the key up first and returns the row it finds.\n- The worker stops after **five** tries over ten minutes, with backoff.\n- The dashboard counts retries per batch, so a spike shows the same day.`,
  ];
  if (t % 3 !== 2) parts.push(`Here is the change in ${lang === "ts" ? "TypeScript" : lang === "go" ? "Go" : lang === "python" ? "Python" : lang === "sql" ? "the migration" : "the check script"}:`, "```" + lang + "\n" + code(lang, area, verb, 24 + ((t * 7) % 48), t) + "\n```");
  if (t % 4 === 0)
    parts.push(
      `| Path | Before | After | Notes |\n|---|---|---|---|\n| ${area}/${verb} | ${2 + (t % 5)} writes | 1 write | keyed on the request |\n| ${area}/refund | unkeyed | keyed | same lookup |\n| nightly job | 1 write | 1 write | unchanged |\n| p95 latency | ${120 + (t % 80)} ms | ${90 + (t % 40)} ms | one query fewer |\n| retries | unlimited | 5 | over ten minutes |`,
    );
  parts.push(`I ran \`pnpm test ${area}\` and the ${area} suite passes; [the runbook](https://docs.acme.test/${area}/${verb}) has the rollback.`);
  return parts.join("\n\n");
}

const harness = (task: string) => ({ id: task, name: "Background command", kind: "harness" as const });
const teammate = (name: string, color: string) => ({ id: name, name, kind: "teammate" as const, color });

// turnItems is turn t of a bench chat: about ten items.
function turnItems(t: number, tag: string): TranscriptItem[] {
  const area = AREAS[t % AREAS.length];
  const verb = VERBS[(t * 3) % VERBS.length];
  const at = 1_700_000_000_000 + t * 60_000;
  const id = (k: string) => `${tag}${t}-${k}`;
  const items: TranscriptItem[] = [];
  items.push({
    kind: "user",
    id: id("u"),
    text: t % 7 === 3 ? `Turn ${t + 1}: the ${area} worker double-writes again.\n\nLook at ${verb} in acme/${area}, find where a retry writes a second row, fix it with a key, and add a test that sends the same request twice. Keep the nightly job as it is.` : `Turn ${t + 1}: ${verb} acme ${area} and tell me what you changed.`,
  });
  items.push({ kind: "text", id: id("n1"), text: `I'll read the ${area} worker and its tests first, then run them.` });
  items.push({
    kind: "tools",
    id: id("r"),
    verb: "Read",
    done: true,
    items: [0, 1, 2].map((k) => ({ verb: "Read", target: `${area}/${[verb, "worker", "types"][k]}.ts`, file: true, id: `bench-read-${tag}${t}-${k}`, at })),
  });
  items.push({ kind: "tools", id: id("s"), verb: "Search", done: true, items: [{ verb: "Search", target: `idempotency ${area}`, id: `bench-search-${tag}${t}`, at }] });
  if (t % 3 === 0) items.push({ kind: "crew", id: id("c"), names: [`Explore: ${area} retries`, `Explore: ${area} tests`] });
  items.push({ kind: "tools", id: id("x"), verb: "Run", done: true, items: [{ verb: "Run", target: `pnpm test ${area}`, id: `bench-run-${tag}${t}`, at }, { verb: "Run", target: `pnpm lint --filter @acme/${area}`, id: `bench-lint-${tag}${t}`, at }] });
  items.push({ kind: "text", id: id("n2"), text: `The retry path in \`${area}/${verb}.ts\` writes without a key. Fixing that now.` });
  if (t % 2 === 0) {
    const e = EDITS[(t / 2) % EDITS.length];
    items.push({ kind: "edit", id: id("e"), file: e.file, added: e.added, removed: e.removed, tool: e.tool });
  }
  if (t % 5 === 1) {
    items.push({ kind: "ping", id: id("p1"), msg: { from: harness(`b${t}t`), status: "done", summary: `pnpm test ${area} completed (exit code 0)`, task: `b${t}t`, at } });
    items.push({ kind: "ping", id: id("p2"), msg: { from: harness(`b${t}l`), status: t % 10 === 1 ? "failed" : "done", summary: `Lint acme/${area} completed (exit code ${t % 10 === 1 ? 1 : 0})`, task: `b${t}l`, at } });
  }
  items.push({ kind: "text", id: id("a"), text: answer(t, area, verb) });
  if (t % 6 === 2) {
    const msg: AgentMessage =
      t % 12 === 2
        ? { from: { id: `h${t}`, name: `Map ${area} writes`, kind: "helper" }, intent: "report", status: "finished", title: `${cap(area)} writes in acme/${area}`, summary: `Every write to acme_${area} goes through three paths; two have no idempotency key.`, body: `## ${cap(area)} writes\n\n1. \`${area}/${verb}.ts:41\` writes with the request's key.\n2. \`${area}/refund.ts:88\` writes **without** a key.\n3. \`${area}/retry.ts:17\` writes **without** a key.\n\nThe last two explain the duplicates.`, at }
        : { from: teammate(`${area}-review`, ["blue", "green", "yellow"][t % 3]), intent: t % 4 ? "update" : "question", summary: `Schema for ${area} looks right; one nit on the down migration`, body: `Schema for acme ${area} looks right. One nit: the down migration drops the index before the column, so a rollback under load locks \`acme_${area}\` longer than it needs to.`, at };
    items.push({ kind: "agent-message", id: id("m"), msg });
  }
  if (t % 11 === 5) items.push({ kind: "report", id: id("b"), report: { kind: "task", session: `${area}-docs-claude`, worktree: `acme/${area}-docs`, status: "finished", duration: "6m40s", files: 2, added: 31, removed: 4, summary: `acme/${area}-docs finished its turn.`, answer: `The ${area} runbook now covers the idempotency key, with a rollback section.` } });
  if (t % 13 === 7) items.push({ kind: "notice", id: id("w"), notice: "rate_limit", level: "warning", text: "Rate limited: retrying in 20s." });
  return items;
}

// benchChat is a whole bench chat, each item placed in the agent's record
// (off) so older pages and the live window agree.
const chats = new Map<string, TranscriptItem[]>();
function benchChat(key: string, turns: number, tag: string): TranscriptItem[] {
  let list = chats.get(key);
  if (!list) {
    list = [];
    for (let t = 0; t < turns; t++) for (const it of turnItems(t, tag)) list.push({ ...it, off: (list.length + 1) * 1000 } as unknown as TranscriptItem);
    chats.set(key, list);
  }
  return list;
}

// The live window the chat follows (lib/conversation-store keeps 300).
const LIVE = 300;

// seedBenchChats fills the bench's chats before the app draws: the last
// items live, the rest as older turns already read.
export function seedBenchChats() {
  const turns = num("turns", 500);
  const live: Record<string, TranscriptItem[]> = {};
  const older: Record<string, { items: TranscriptItem[]; more: boolean; loading: boolean }> = {};
  BENCH_CHATS.forEach((c, i) => {
    const key = keyOf(c.box, c.session);
    const all = benchChat(key, turns, i ? "b" : "a");
    live[key] = all.slice(-LIVE);
    older[key] = { items: all.slice(0, -LIVE), more: false, loading: false };
  });
  const crew = Object.fromEntries(Object.keys(live).map((k) => [k, benchCrew()]));
  useConversations.setState((s) => ({ items: { ...s.items, ...live }, crew: { ...s.crew, ...crew } }));
  useHistory.setState((s) => ({ older: { ...s.older, ...older } }));
}

// benchOlder is a page of a bench chat before an item, for the history
// endpoint (a hidden chat that let its older turns go reads them again).
export function benchOlder(key: string, before: number, limit: number) {
  const all = chats.get(key);
  if (!all) return undefined;
  const end = all.findIndex((it) => ((it as { off?: number }).off ?? 0) >= before);
  const stop = end < 0 ? all.length : end;
  const start = Math.max(0, stop - limit);
  return { source: "claude", items: all.slice(start, stop), next: all.length, more: start > 0 };
}

// What a bench chat's tool calls show opened: long outputs.
export function benchToolDetail(id: string): ToolDetail | undefined {
  const m = /^bench-(read|search|run|lint)-(.+)$/.exec(id);
  if (!m) return undefined;
  const [, what, rest] = m;
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("\n");
  switch (what) {
    case "read":
      return { id, name: "Read", file: `acme/${rest}.ts`, output: lines(400, (i) => `${String(i + 1).padStart(6)}\texport const acmeValue${i} = compute(${i}, "${rest}"); // line ${i + 1}`) };
    case "search":
      return { id, name: "Grep", pattern: "idempotency", output: lines(120, (i) => `acme/src/module${i % 17}/file${i}.ts:${i * 3 + 1}:  idempotencyKey: request.headers["idempotency-key"], // ${rest}`) };
    default:
      return { id, name: "Bash", command: what === "run" ? "pnpm test" : "pnpm lint", output: lines(600, (i) => ` ✓ acme ${rest} › case ${i + 1} passes with the key set (${(i * 7) % 40} ms)`) + "\n\n Test Files  12 passed (12)\n      Tests  600 passed (600)" };
  }
}

// The crew a bench chat shows (its badge), a few helpers.
export function benchCrew(): CrewMember[] {
  const t = Date.now();
  return [
    { id: "bench-c1", name: "Explore: billing retries", kind: "subagent", agent: "claude", state: "finished", doing: "Found 3 retry paths", since: t - 600_000, until: t - 300_000 },
    { id: "bench-c2", name: "Explore: billing tests", kind: "subagent", agent: "claude", state: "running", doing: "Reading billing.test.ts", since: t - 200_000 },
  ];
}

// ---- Many worktrees --------------------------------------------------------

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const GB = 1024 ** 3;

// benchFleet adds N worktrees, each with an agent, over four more boxes.
export function benchFleet({ status, locations, sessions, stats }: { status: Status; locations: Record<string, Location[]>; sessions: Record<string, Session[]>; stats: Record<string, Stats> }) {
  const n = num("worktrees", 300);
  const boxes = ["acme-build", "acme-gpu", "acme-ci", "acme-edge"];
  const states = ["running", "waiting", "finished", "idle", "running", "finished"] as const;
  boxes.forEach((box, b) => {
    status.boxes.push({ name: box, address: `100.64.1.${10 + b}:7444`, fingerprint: `sha256:acme${b}…`, state: "online", latency_ms: 20 + b * 7, since: ago(300) });
    stats[box] = { hostname: box, cpus: 16, load: [1.1, 1, 0.9], memory: { total: 64 * GB, used: 20 * GB }, swap: { total: 0, used: 0 }, disks: [{ mount: "/", total: 1000 * GB, used: 300 * GB }], agents: [], hooks: true };
    const repos = ["acme-web", "acme-api", "acme-infra"];
    locations[box] = [];
    sessions[box] = [];
    repos.forEach((r, ri) => {
      const path = `/home/me/${r}`;
      const loc: Location = { name: r, path, repo: true, slug: `acme/${r}`, remote: `git@github.com:acme/${r}.git`, default_branch: "main", scripts: {}, worktrees: [{ name: r, path, branch: "main", main: true }] };
      const per = Math.ceil(n / boxes.length / repos.length);
      for (let i = 0; i < per; i++) {
        const k = (b * repos.length + ri) * per + i;
        if (k >= n) break;
        const wt = `${AREAS[k % AREAS.length]}-${VERBS[(k * 3) % VERBS.length]}-${k}`;
        loc.worktrees!.push({ name: wt, path: `${path}-${wt}`, branch: `me/${wt}` });
        const state = states[k % states.length];
        sessions[box].push({
          name: `${wt}-claude`,
          title: `${cap(VERBS[(k * 3) % VERBS.length])} acme ${AREAS[k % AREAS.length]} (${k})`,
          location: `${r}/${wt}`,
          dir: `${path}-${wt}`,
          command: "claude",
          created: ago(30 + (k % 400)),
          attached: 0,
          exited: false,
          agent: "claude",
          agent_state: state,
          state_since: ago(1 + (k % 90)),
          ...(state === "waiting" ? { ask: { tool: "Bash", input: `pnpm test ${AREAS[k % AREAS.length]}`, why: "Run the tests" } } : {}),
        } as Session);
      }
      locations[box].push(loc);
    });
  });
}

// ---- A terminal with a long history ---------------------------------------

const SYNC = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

// benchTermLine is line i of a bench terminal's output, coloured as a test
// run's would be.
const termLine = (i: number) => `\x1b[2m${String(i + 1).padStart(7)}\x1b[0m \x1b[32m✓\x1b[0m acme › \x1b[1m${AREAS[i % AREAS.length]}\x1b[0m › ${VERBS[i % VERBS.length]} case ${i} \x1b[2m(${(i * 7) % 40} ms)\x1b[0m`;

// benchTerm writes N lines (the history the terminal keeps), then answers
// the wheel's reports as tmux's copy mode does: a redraw of the screen at
// the new place, one per report batch.
export function benchTerm(h: { onOpen(): void; onData(d: string): void; onClose(byUs: boolean): void }) {
  const total = num("lines", 50_000);
  let rows = 40;
  let top = Math.max(0, total - rows);
  let open = true;
  const t = window.setTimeout(() => {
    h.onOpen();
    // In chunks, as a box sends a long output.
    let i = 0;
    const chunk = () => {
      if (!open) return;
      const end = Math.min(total, i + 2000);
      const out: string[] = [];
      for (; i < end; i++) out.push(termLine(i));
      h.onData(out.join("\r\n") + (i < total ? "\r\n" : ""));
      if (i < total) window.setTimeout(chunk, 0);
      else (window as unknown as { __benchTermDone?: boolean }).__benchTermDone = true;
    };
    chunk();
  }, 100);
  const redraw = () => {
    const out = [SYNC, "\x1b[H"];
    for (let r = 0; r < rows; r++) out.push(`\x1b[${r + 1};1H\x1b[2K${termLine(top + r)}`);
    out.push(SYNC_END);
    h.onData(out.join(""));
  };
  return {
    send(data: Uint8Array | string) {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      // SGR wheel reports: 64 up, 65 down, three lines each.
      let moved = false;
      for (const m of text.matchAll(/\x1b\[<(64|65);\d+;\d+M/g)) {
        top = Math.max(0, Math.min(total - rows, top + (m[1] === "64" ? -3 : 3)));
        moved = true;
      }
      if (moved) redraw();
    },
    resize(_cols: number, r: number) {
      rows = Math.max(1, r);
    },
    close() {
      open = false;
      window.clearTimeout(t);
      h.onClose(true);
    },
  };
}

// noisyTerm prints rate lines a second, in batches every 50ms as a box
// sends them, and echoes typing straight away, as a shell would between
// lines of output: what perf/terminals.mjs types into while others stream.
// window.__berthNoise.quietLatest() stops the newest one printing (the
// terminal a test types into while the others stream).
const noisy: { quiet: boolean }[] = [];
if (typeof window !== "undefined" && BENCH === "noisy")
  (window as unknown as { __berthNoise: unknown }).__berthNoise = {
    quietLatest: () => noisy.length && (noisy[noisy.length - 1].quiet = true),
    count: () => noisy.length,
  };

export function noisyTerm(h: { onOpen(): void; onData(d: string): void; onClose(byUs: boolean): void }) {
  const rate = num("rate", 20);
  const me = { quiet: false };
  noisy.push(me);
  let open = true;
  let i = 0;
  let owed = 0;
  let tick = 0;
  const t = window.setTimeout(() => {
    h.onOpen();
    h.onData("\x1b[2J\x1b[H");
    tick = window.setInterval(() => {
      if (!open || me.quiet) return;
      owed += rate / 20;
      const out: string[] = [];
      for (; owed >= 1; owed--) out.push(`${termLine(i++)}\r\n`);
      if (out.length) h.onData(out.join(""));
    }, 50);
  }, 100);
  return {
    send(data: Uint8Array | string) {
      h.onData(typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    resize() {},
    close() {
      open = false;
      window.clearTimeout(t);
      window.clearInterval(tick);
      noisy.splice(noisy.indexOf(me), 1);
      h.onClose(true);
    },
  };
}
