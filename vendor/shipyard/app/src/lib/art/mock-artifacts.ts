import type { BerthEvent } from "@/lib/api";
import type { BerthChart } from "@/lib/art/chart-spec";
import type { Art } from "@/lib/art/model";
import { keyOf, useConversations } from "@/lib/conversation-store";

// Mock mode's artifacts: the search-perf agent on devl (shop/search-perf)
// speeds up acme's product search and shows its work. The box's routes
// (internal/box/artifactsapi.go) answer from here; window.__art.bump()
// plays a live update (a new version of the p95 chart and the reindex page,
// as when the agent rewrites the files).

import { ART_BOX, ART_SESSION } from "@/lib/art/mock-chat";
import { VD_ID, VD_SEEDS, VD_V2_BODY, vdiffImage, vdiffShotsCall } from "@/lib/art/mock-vdiff";
const LOC = "shop";
const WT = "search-perf";
const PATH = "/home/me/work/shop-search-perf";

const j = (c: Omit<BerthChart, "$schema">) => JSON.stringify({ $schema: "berth.chart/v1", ...c }, null, 2);

const perf = (after: number[], note: string) =>
  j({
    type: "bar",
    title: "p95 latency, before and after",
    subtitle: note,
    x: "endpoint",
    y: [
      { key: "before", label: "Before", color: "muted" },
      { key: "after", label: "After", color: "1" },
    ],
    units: "ms",
    better: "lower",
    data: [
      { endpoint: "/search", before: 1240, after: after[0] },
      { endpoint: "/search/suggest", before: 610, after: after[1] },
      { endpoint: "/products/:id", before: 220, after: after[2] },
      { endpoint: "/cart", before: 180, after: after[3] },
      { endpoint: "/api/recs", before: 890, after: after[4] },
    ],
  });

const PERF_V1 = perf([410, 190, 205, 176, 620], "acme-shop staging, 2,000 requests each · trigram index only");
const PERF_V2 = perf([180, 64, 198, 171, 240], "acme-shop staging, 2,000 requests each · trigram index + suggest cache");

const days = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
const searchP95 = [1180, 1210, 1260, 1190, 1240, 1320, 1290, 1250, 1270, 1230, 1190, 640, 420, 410];
const suggestP95 = [580, 600, 640, 590, 610, 650, 630, 620, 640, 600, 590, 330, 200, 190];

const TREND = j({
  type: "line",
  title: "Search p95 over two weeks",
  subtitle: "Production, daily p95 · the index shipped to 10% on Oct 5",
  x: "day",
  y: [
    { key: "search", label: "/search", color: "1" },
    { key: "suggest", label: "/search/suggest", color: "2" },
  ],
  units: "ms",
  better: "lower",
  data: days.map((d, i) => ({ day: d, search: searchP95[i], suggest: suggestP95[i] })),
});

const hours = ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"];
const TRAFFIC = j({
  type: "area",
  title: "Search traffic by hour",
  subtitle: "Requests per minute, yesterday (UTC)",
  x: "hour",
  y: [
    { key: "search", label: "/search", color: "1" },
    { key: "suggest", label: "/search/suggest", color: "3" },
  ],
  units: "req/min",
  data: hours.map((h, i) => ({ hour: `${h}:00`, search: [120, 90, 70, 140, 520, 760, 820, 780, 800, 910, 640, 260][i], suggest: [310, 240, 180, 360, 1320, 1910, 2080, 1960, 2010, 2290, 1610, 660][i] })),
});

const FLOW = j({
  type: "sankey",
  title: "Where a search request goes",
  subtitle: "One hour of acme-shop traffic, 48,200 requests",
  nodes: [{ name: "Edge" }, { name: "Suggest cache" }, { name: "Search API" }, { name: "Trigram index" }, { name: "Postgres LIKE" }, { name: "200 OK", color: "good" }, { name: "Timeout", color: "bad" }],
  links: [
    { source: "Edge", target: "Suggest cache", value: 21400 },
    { source: "Edge", target: "Search API", value: 26800 },
    { source: "Suggest cache", target: "200 OK", value: 21400 },
    { source: "Search API", target: "Trigram index", value: 24100 },
    { source: "Search API", target: "Postgres LIKE", value: 2700 },
    { source: "Trigram index", target: "200 OK", value: 24050 },
    { source: "Trigram index", target: "Timeout", value: 50 },
    { source: "Postgres LIKE", target: "200 OK", value: 2310 },
    { source: "Postgres LIKE", target: "Timeout", value: 390 },
  ],
});

const GAUGE = j({ type: "gauge", title: "Suggest cache hit rate", subtitle: "Last hour, staging", value: 82, max: 100, units: "%", label: "Hit rate", better: "higher" });

const FUNNEL = j({
  type: "funnel",
  title: "From search to checkout",
  subtitle: "Yesterday's sessions that searched",
  data: [
    { label: "Searched", value: 48200 },
    { label: "Clicked a result", value: 26800 },
    { label: "Added to cart", value: 7400 },
    { label: "Checked out", value: 1900 },
  ],
});

const PIE = j({
  type: "pie",
  title: "Where /search spends its time",
  subtitle: "p95 request, after the index",
  units: "ms",
  data: [
    { label: "Index lookup", value: 120 },
    { label: "Ranking", value: 140 },
    { label: "Recs join", value: 90 },
    { label: "Serialise", value: 60 },
  ],
});

const RING = j({
  type: "ring",
  title: "Searches by source",
  subtitle: "Yesterday, 48,200 searches",
  data: [
    { label: "Search box", value: 28900 },
    { label: "Suggest", value: 12100 },
    { label: "Category pages", value: 5200 },
    { label: "API", value: 2000 },
  ],
});

const endpoints: [string, number[]][] = [
  ["/search", [380, 340, 300, 420, 980, 1240, 1310, 1190, 1280, 1420, 1100, 640]],
  ["/api/recs", [260, 240, 230, 300, 720, 890, 940, 880, 910, 990, 760, 420]],
  ["/search/suggest", [180, 160, 150, 210, 480, 610, 650, 600, 640, 700, 520, 300]],
  ["/products/:id", [90, 85, 80, 110, 190, 220, 240, 210, 230, 260, 200, 130]],
  ["/cart", [70, 70, 65, 90, 150, 180, 190, 175, 185, 200, 160, 100]],
  ["/checkout/quote", [120, 110, 100, 140, 260, 300, 310, 290, 300, 330, 270, 160]],
];
const HEAT = j({
  type: "heatmap",
  title: "Slow endpoints by hour",
  subtitle: "p95 latency, production, Mon Oct 6 (UTC)",
  x: "hour",
  row: "endpoint",
  z: "p95",
  units: "ms",
  better: "lower",
  data: endpoints.flatMap(([e, v]) => v.map((p, i) => ({ endpoint: e, hour: hours[i], p95: p }))),
});

const TESTS = `suite,test,status,duration_ms,note
search,returns exact SKU first,pass,42,
search,matches typos within 2 edits,pass,61,
search,ranks in-stock above out-of-stock,fail,58,expected 'acme-kettle-2l' at 1 got 3
search,paginates past 1000 results,pass,240,
search,handles empty query,pass,8,
suggest,serves from cache when warm,pass,4,
suggest,invalidates on product rename,fail,1203,timed out after 1200 ms
suggest,limits to 8 suggestions,pass,5,
suggest,strips HTML from titles,pass,6,
index,builds trigram index for 1.2M products,pass,8840,
index,updates on product import,pass,412,
index,survives a restart mid-build,skip,0,needs a real Postgres
recs,falls back when index is cold,pass,77,
recs,respects region catalogue,fail,95,eu-west returned a us-only SKU
api,returns 429 over the rate limit,pass,31,
api,keeps p95 under 300 ms (bench),pass,2210,`;

const MAP = `graph LR
  web[acme-shop web] --> edge(Edge / CDN)
  edge --> suggest[Suggest API]
  edge --> search[Search API]
  suggest --> cache[(Suggest cache)]
  search --> trigram[(Trigram index)]
  search -. fallback .-> pg[(Postgres)]
  search --> recs[Recs service]
  recs --> pg
  importer[Catalogue importer] --> pg
  importer --> trigram`;

const NOTES = `## Search speed-up: the plan

1. **Trigram index** on \`products.title\` and \`products.sku\` (\`pg_trgm\`), built concurrently.
2. **Suggest cache**: 30 s TTL, invalidated by the importer on rename.
3. **Recs** read the index instead of \`LIKE '%q%'\`.

| Step | Risk | Rollback |
|---|---|---|
| Index build | 25 min of extra load | drop index |
| Cache | stale suggestions | flag \`search.suggest_cache\` |
| Recs | region filter | revert one commit |

OK to ship the index to 10% first?`;

function progressPage(done: number[]): string {
  const shards = ["eu-west-1", "eu-west-2", "us-east-1", "us-east-2", "us-west-1", "ap-south-1", "ap-east-1", "sa-east-1"];
  const rows = shards.map((s, i) => ({ s, pct: done[i] }));
  const total = Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length);
  const slow = rows.filter((r) => r.pct < 40).length;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Reindex progress</title>
<meta name="berth:summary" content="${total}% reindexed · ${slow} slow ${slow === 1 ? "shard" : "shards"}">
<style>
  body { margin: 0; padding: 18px 20px; font: 13px/1.45 var(--berth-font, system-ui); background: var(--berth-bg); color: var(--berth-fg); }
  h1 { font-size: 15px; margin: 0 0 2px; font-weight: 600; }
  .sub { color: var(--berth-muted-fg); margin: 0 0 14px; }
  .big { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  .big b { font-size: 30px; font-variant-numeric: tabular-nums; }
  .bar { height: 8px; border-radius: 99px; background: var(--berth-muted); overflow: hidden; }
  .bar > i { display: block; height: 100%; border-radius: 99px; background: var(--chart-1); transition: width .6s cubic-bezier(.2,.8,.2,1); }
  .row.stuck .bar > i { background: var(--berth-warn); }
  .row.done .bar > i { background: var(--berth-good); }
  .controls { display: flex; gap: 6px; align-items: center; margin: 14px 0 10px; flex-wrap: wrap; }
  button { font: inherit; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--berth-border); background: var(--berth-card); color: var(--berth-fg); cursor: pointer; }
  button[aria-pressed=true] { background: var(--berth-accent); color: var(--berth-accent-fg); border-color: transparent; }
  label { margin-left: auto; color: var(--berth-muted-fg); display: flex; gap: 8px; align-items: center; }
  input[type=range] { accent-color: var(--chart-1); }
  .row { display: grid; grid-template-columns: 92px 1fr 46px 118px; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid var(--berth-border); }
  .row span { font-variant-numeric: tabular-nums; }
  .eta { color: var(--berth-muted-fg); text-align: right; }
  .tag { color: var(--berth-warn); }
  @media (prefers-reduced-motion: reduce) { .bar > i { transition: none; } }
</style></head>
<body>
  <h1>Reindex acme catalogue into the trigram index</h1>
  <p class="sub">8 shards · 1.2M products · started 09:40 UTC</p>
  <div class="big"><b>${total}%</b><span class="sub" style="margin:0">across all shards</span></div>
  <div class="bar"><i style="width:${total}%"></i></div>
  <div class="controls">
    <button aria-pressed="true" data-f="all">All</button>
    <button aria-pressed="false" data-f="stuck">Slow</button>
    <button aria-pressed="false" data-f="done">Done</button>
    <label>Batch size <input type="range" min="500" max="5000" step="500" value="2000" id="batch"> <span id="bv">2,000</span></label>
  </div>
  <div id="rows">${rows.map((r) => `<div class="row ${r.pct >= 100 ? "done" : r.pct < 40 ? "stuck" : ""}" data-pct="${r.pct}"><span>${r.s}</span><div class="bar"><i style="width:${r.pct}%"></i></div><span>${r.pct}%</span><span class="eta"></span></div>`).join("")}</div>
<script>
  const rows = [...document.querySelectorAll('.row')];
  const eta = () => {
    const b = +document.getElementById('batch').value;
    document.getElementById('bv').textContent = b.toLocaleString('en-US');
    for (const r of rows) {
      const left = 100 - +r.dataset.pct;
      const m = Math.round(left * 1.6 * (2000 / b));
      r.querySelector('.eta').textContent = left <= 0 ? 'done' : (r.classList.contains('stuck') ? 'slow · ' : '') + '~' + m + ' min';
    }
  };
  document.getElementById('batch').addEventListener('input', eta);
  for (const btn of document.querySelectorAll('button')) btn.addEventListener('click', () => {
    for (const x of document.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === btn));
    const f = btn.dataset.f;
    for (const r of rows) r.style.display = f === 'all' || r.classList.contains(f) ? '' : 'none';
  });
  eta();
</script>
</body></html>`;
}

const PROGRESS_V0 = progressPage([100, 64, 40, 20, 31, 8, 22, 4]);
const PROGRESS_V1 = progressPage([100, 100, 82, 64, 71, 33, 58, 22]);
const PROGRESS_V2 = progressPage([100, 100, 100, 88, 94, 61, 83, 47]);

interface Seed {
  id: string;
  title: string;
  kind: string;
  format: string;
  file: string;
  versions: { body: string; ago: number; note?: string }[];
  helper?: string;
}

const SEEDS: Seed[] = [
  { id: "a1f3c0d2e4", title: "How acme search is wired", kind: "diagram", format: "mermaid", file: "notes/search-map.mmd", versions: [{ body: MAP, ago: 41 }], helper: "Explore: map search" },
  { id: "b7c2a9e1f0", title: "Slow endpoints by hour", kind: "chart", format: "chart", file: "perf/slow-endpoints.json", versions: [{ body: HEAT, ago: 37 }] },
  { id: "c4d9e2b7a1", title: "Search speed-up plan", kind: "notes", format: "markdown", file: "notes/plan.md", versions: [{ body: NOTES, ago: 33 }] },
  { id: "d2e8f1a0b3", title: "p95 before and after", kind: "chart", format: "chart", file: "perf/p95.json", versions: [{ body: PERF_V1, ago: 14, note: "trigram index only" }] },
  { id: "e5a1b2c3d4", title: "Search test results", kind: "table", format: "csv", file: "perf/tests.csv", versions: [{ body: TESTS, ago: 12 }] },
  { id: "f9b4c8d7e6", title: "Reindex progress", kind: "page", format: "html", file: "perf/reindex.html", versions: [{ body: PROGRESS_V0, ago: 26 }, { body: PROGRESS_V1, ago: 9 }] },
  { id: "a3c7d9e1b2", title: "Search p95 over two weeks", kind: "chart", format: "chart", file: "perf/trend.json", versions: [{ body: TREND, ago: 8 }] },
  { id: "b8d6e4f2a0", title: "Where a search request goes", kind: "chart", format: "chart", file: "perf/flow.json", versions: [{ body: FLOW, ago: 7 }] },
  { id: "c1e2f3a4b5", title: "Suggest cache hit rate", kind: "chart", format: "chart", file: "perf/cache.json", versions: [{ body: GAUGE, ago: 6 }] },
  { id: "d6f7a8b9c0", title: "From search to checkout", kind: "chart", format: "chart", file: "perf/funnel.json", versions: [{ body: FUNNEL, ago: 5 }] },
  { id: "e0a9b8c7d6", title: "Search traffic by hour", kind: "chart", format: "chart", file: "perf/traffic.json", versions: [{ body: TRAFFIC, ago: 5 }] },
  { id: "f5e4d3c2b1", title: "Where /search spends its time", kind: "chart", format: "chart", file: "perf/stages.json", versions: [{ body: PIE, ago: 4 }] },
  { id: "a0b1c2d3e5", title: "Searches by source", kind: "chart", format: "chart", file: "perf/sources.json", versions: [{ body: RING, ago: 4 }] },
];

// What the box keeps: the artifacts and each version's content.
const kept: Omit<Art, "box">[] = [];
const bodies = new Map<string, string>();
let seeded = false;

function seed() {
  if (seeded) return;
  seeded = true;
  const now = Date.now();
  const iso = (ago: number) => new Date(now - ago * 60_000).toISOString();
  for (const s of SEEDS) {
    const versions = s.versions.map((v, i) => {
      bodies.set(`${s.id}/${i + 1}`, v.body);
      return { n: i + 1, at: iso(v.ago), size: new TextEncoder().encode(v.body).length, sha256: `mock${i}`, note: v.note };
    });
    kept.push({
      id: s.id,
      title: s.title,
      kind: s.kind,
      format: s.format,
      location: LOC,
      worktree: WT,
      path: PATH,
      source: `${PATH}/${s.file}`,
      file: s.file,
      by: { session: ART_SESSION, agent: "claude", helper: s.helper },
      created: versions[0].at,
      updated: versions[versions.length - 1].at,
      watched: true,
      versions,
    });
  }
  // Visual diffs: made by berthd shots compare, so no file and no watch.
  for (const s of VD_SEEDS) {
    const versions = s.versions.map((v, i) => {
      bodies.set(`${s.id}/${i + 1}`, v.body);
      return { n: i + 1, at: iso(v.ago), size: new TextEncoder().encode(v.body).length, sha256: `mockvd${i}`, note: v.note };
    });
    kept.push({ id: s.id, title: s.title, kind: "visualdiff", format: "visualdiff", location: LOC, worktree: WT, path: PATH, by: { session: ART_SESSION, agent: "claude" }, created: versions[0].at, updated: versions[versions.length - 1].at, versions });
  }
}

// The box's shots routes: the baselines, and Accept as baseline.
export function shotsMockCall(method: string, path: string, body: unknown): unknown | undefined {
  seed();
  return vdiffShotsCall(method, path, body, (id) => kept.find((a) => a.id === id && a.kind === "visualdiff")?.versions.at(-1)?.n);
}

export function artifactImage(path: string): Promise<Blob | undefined> {
  return vdiffImage(path);
}

// bumpVdiff: the agent compares again; a new version lands live.
export function bumpVdiff() {
  addVersion(VD_ID, VD_V2_BODY, "compared again");
}

const base = `locations/${LOC}/worktrees/${WT}/artifacts`;

// artifactsMockCall answers the box's artifact routes; undefined for any
// other.
export function artifactsMockCall(box: string, method: string, path: string): unknown | undefined {
  if (box !== ART_BOX || method !== "GET") {
    if (method === "GET" && /^locations\/[^/]+\/worktrees\/[^/]+\/artifacts$/.test(path)) return [];
    return undefined;
  }
  seed();
  if (path === base) return [...kept].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  const one = /^locations\/[^/]+\/worktrees\/[^/]+\/artifacts\/([0-9a-f]{10})$/.exec(path);
  if (one) return kept.find((a) => a.id === one[1]);
  if (/^locations\/[^/]+\/worktrees\/[^/]+\/artifacts/.test(path)) return [];
  return undefined;
}

export function artifactBlob(path: string): Blob | undefined {
  const m = /artifacts\/([0-9a-f]{10})\/v\/(\d+)$/.exec(path);
  if (!m) return undefined;
  seed();
  const body = bodies.get(`${m[1]}/${m[2]}`);
  return body === undefined ? undefined : new Blob([body], { type: "text/plain" });
}

let emit: ((e: Omit<BerthEvent, "time">) => void) | undefined;
export function wireArtifactsMock(fn: (e: Omit<BerthEvent, "time">) => void) {
  emit = fn;
}

// addVersion is the agent rewriting an artifact's file.
function addVersion(id: string, body: string, note?: string) {
  seed();
  const a = kept.find((x) => x.id === id);
  if (!a) return;
  const n = a.versions[a.versions.length - 1].n + 1;
  bodies.set(`${id}/${n}`, body);
  const at = new Date().toISOString();
  a.versions = [...a.versions, { n, at, size: new TextEncoder().encode(body).length, sha256: `mock${n}`, note }];
  a.updated = at;
  emit?.({ type: "artifact.updated", box: ART_BOX, origin: "watch", data: { id, title: a.title, kind: a.kind, location: LOC, name: WT, path: PATH, version: n } });
}

let n = 0;
const id = () => `mock-art-${++n}`;

// bump: the agent adds the suggest cache, re-runs the bench and keeps the
// reindex page going: new versions, live.
export function bumpArtifacts() {
  addVersion("d2e8f1a0b3", PERF_V2, "trigram index + suggest cache");
  addVersion("f9b4c8d7e6", PROGRESS_V2);
  const key = keyOf(ART_BOX, ART_SESSION);
  useConversations.setState((s) => ({
    items: {
      ...s.items,
      [key]: [
        ...(s.items[key] ?? []),
        { kind: "user", id: id(), text: "Nice. Add the suggest cache too, and keep the reindex page going." },
        { kind: "edit", id: id(), file: "apps/search/suggest-cache.ts", added: 64, removed: 0 },
        { kind: "tools", id: id(), verb: "Run", done: true, items: [{ verb: "Run", target: 'pnpm bench:search --requests 2000 && berthd artifact add perf/p95.json --note "trigram index + suggest cache"' }] },
        { kind: "artifact", id: id(), tool: "art-d2e8-2", text: "p95 before and after", local: "d2e8f1a0b3", version: 2, done: true, updated: true },
        { kind: "text", id: id(), text: "With the cache, /search/suggest is at **64 ms** and /search at **180 ms** (from 1,240). The reindex is at 84%; its page updates as shards finish." },
      ],
    },
  }));
}
