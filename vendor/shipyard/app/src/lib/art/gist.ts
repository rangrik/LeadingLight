import { type BerthChart, fmt, parseChart, series } from "./chart-spec.ts";
import { parseTable, verdict } from "./table-data.ts";

// gist is an artifact's headline in one line, worked out from its data, so
// a card says what it found before it's opened: "/search 1,240 → 410 ms
// (−67%)", "3 failed of 16", "Worst: /search at 18:00, 1,420 ms". tone
// says how to colour it. A page says its own (<meta name="berth:summary">).

export interface Gist {
  text: string;
  tone?: "good" | "bad" | "plain";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// day is an ISO date as a person says it ("Sep 24"); anything else as is.
const day = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : String(v ?? "");
};

const pct = (d: number) => `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}%`;

function judged(c: BerthChart, d: number): Gist["tone"] {
  if (!c.better || d === 0) return "plain";
  return (c.better === "higher" ? d > 0 : d < 0) ? "good" : "bad";
}

export function chartGist(c: BerthChart): Gist | undefined {
  const rows = c.data ?? [];
  const x = c.x ?? "x";
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v));
  switch (c.type) {
    case "bar": {
      if (!rows.length) return undefined;
      const ss = series(c);
      if (ss.length === 2) {
        // Before and after: the biggest change, in its own units.
        const [b, a] = ss;
        const best = [...rows].sort((p, q) => Math.abs(n(q[a.key]) - n(q[b.key])) - Math.abs(n(p[a.key]) - n(p[b.key])))[0];
        const from = n(best[b.key]);
        const to = n(best[a.key]);
        const d = from ? (to - from) / from : 0;
        return { text: `${best[x]} ${fmt(from)} → ${fmt(to, c.units)} (${pct(d)})`, tone: judged(c, d) };
      }
      if (ss.length === 1) {
        const s = ss[0];
        const top = [...rows].sort((p, q) => (c.better === "lower" ? n(p[s.key]) - n(q[s.key]) : n(q[s.key]) - n(p[s.key])))[0];
        return { text: `${c.better === "lower" ? "Lowest" : "Top"}: ${top[x]}, ${fmt(n(top[s.key]), c.units)}` };
      }
      return { text: `${rows.length} ${rows.length === 1 ? "group" : "groups"} · ${ss.length} series` };
    }
    case "line":
    case "area": {
      if (rows.length < 2) return undefined;
      const s = series(c)[0];
      if (!s) return undefined;
      const first = n(rows[0][s.key]);
      const last = n(rows[rows.length - 1][s.key]);
      const d = first ? (last - first) / first : 0;
      return { text: `${s.label} ${fmt(last, c.units)} now, ${pct(d)} since ${day(rows[0][x])}`, tone: judged(c, d) };
    }
    case "gauge": {
      const max = c.max && c.max > 0 ? c.max : 100;
      const v = n(c.value ?? 0);
      const share = v / max;
      const tone = c.better === "higher" ? (share >= 0.75 ? "good" : share < 0.5 ? "bad" : "plain") : c.better === "lower" ? (share <= 0.25 ? "good" : share > 0.5 ? "bad" : "plain") : "plain";
      const of = c.units === "%" && max === 100 ? "" : ` of ${fmt(max, c.units)}`;
      return { text: `${c.label ?? c.title ?? "Value"}: ${fmt(v, c.units)}${of}`, tone };
    }
    case "funnel": {
      if (rows.length < 2) return undefined;
      const l = c.x ?? "label";
      const v = c.z ?? "value";
      const first = n(rows[0][v]);
      const last = n(rows[rows.length - 1][v]);
      return { text: `${fmt(first)} ${rows[0][l]} → ${fmt(last)} ${rows[rows.length - 1][l]} (${((last / (first || 1)) * 100).toFixed(1)}%)` };
    }
    case "pie":
    case "ring": {
      if (!rows.length) return undefined;
      const l = c.x ?? "label";
      const v = c.z ?? "value";
      const total = rows.reduce((s, r) => s + n(r[v]), 0);
      const top = [...rows].sort((p, q) => n(q[v]) - n(p[v]))[0];
      return { text: `${top[l]} ${Math.round((n(top[v]) / (total || 1)) * 100)}% of ${fmt(total, c.units)}` };
    }
    case "sankey": {
      const nodes = c.nodes ?? [];
      const links = c.links ?? [];
      const targets = new Set(links.map((k) => k.target));
      const total = links.filter((k) => !targets.has(k.source)).reduce((s, k) => s + k.value, 0);
      const bad = nodes.filter((nd) => nd.color === "bad").map((nd) => nd.name);
      if (bad.length) {
        const lost = links.filter((k) => bad.includes(k.target)).reduce((s, k) => s + k.value, 0);
        return { text: `${fmt(total)} in · ${fmt(lost)} ${bad[0].toLowerCase()} (${((lost / (total || 1)) * 100).toFixed(1)}%)`, tone: lost ? "bad" : "good" };
      }
      return { text: `${fmt(total)} through ${nodes.length} steps` };
    }
    case "heatmap": {
      if (!rows.length) return undefined;
      const z = c.z ?? "value";
      const top = [...rows].sort((p, q) => (c.better === "higher" ? n(p[z]) - n(q[z]) : n(q[z]) - n(p[z])))[0];
      const at = String(top[x] ?? "");
      return { text: `${c.better === "higher" ? "Lowest" : "Worst"}: ${top[c.row ?? "row"]} at ${/^\d{1,2}$/.test(at) ? `${at.padStart(2, "0")}:00` : at}, ${fmt(n(top[z]), c.units)}`, tone: c.better ? "bad" : "plain" };
    }
  }
  return undefined;
}

// gist is the headline for any kind; kinds.ts calls it with the version's
// content.
export function gist(kind: string, format: string, body: string): Gist | undefined {
  switch (kind) {
    case "chart": {
      const c = parseChart(body);
      return c ? chartGist(c) : undefined;
    }
    case "table": {
      const t = parseTable(body, format);
      if (!t.head.length) return undefined;
      if (t.status < 0) return { text: `${t.rows.length.toLocaleString("en-US")} ${t.rows.length === 1 ? "row" : "rows"} · ${t.head.length} ${t.head.length === 1 ? "column" : "columns"}` };
      const v = t.rows.map((r) => verdict(r[t.status] ?? ""));
      const failed = v.filter((x) => x === "fail").length;
      const skipped = v.filter((x) => x === "skip").length;
      const skip = skipped ? ` · ${skipped} skipped` : "";
      return failed ? { text: `${failed} failed of ${t.rows.length}${skip}`, tone: "bad" } : { text: `All ${t.rows.length - skipped} passed${skip}`, tone: "good" };
    }
    case "diagram": {
      const lines = body.split("\n");
      const edges = lines.filter((l) => /--|==|-\.|~~~/.test(l) && !/^\s*%%/.test(l)).length;
      const nodes = new Set<string>();
      for (const l of lines) for (const m of l.matchAll(/(?:^|\s|>|-)([A-Za-z_][\w-]*)\s*[[({]/g)) nodes.add(m[1]);
      return { text: edges ? `${nodes.size ? `${nodes.size} parts, ` : ""}${edges} ${edges === 1 ? "connection" : "connections"}` : "Diagram" };
    }
    case "notes": {
      const steps = body.split("\n").filter((l) => /^\s*\d+[.)]\s/.test(l)).length;
      const heading = /^#{1,3}\s+(.+)$/m.exec(body)?.[1]?.trim();
      const ask = /\b(approve|sign[- ]off|ok to|go ahead)\b|\?\s*$/im.test(body);
      const lead = steps ? `${steps} steps` : (heading ?? "Notes");
      return { text: `${lead}${ask ? " · waits for your approval" : ""}`, tone: ask ? "plain" : undefined };
    }
    case "page": {
      const said = /<meta\s+name=["']berth:summary["']\s+content=["']([^"']{1,140})["']/i.exec(body)?.[1];
      const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(body)?.[1];
      return { text: entities(said ?? title ?? "Interactive page").trim() };
    }
  }
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", middot: "·", nbsp: " " };
const entities = (s: string) => s.replace(/&(#39|[a-z]+);/g, (m, k: string) => ENTITIES[k] ?? m);
