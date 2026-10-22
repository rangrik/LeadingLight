import type { Gist } from "./gist.ts";

// Visual diffs: what a change did to a web app's pages, as `berthd shots
// compare` keeps it (internal/box/shots.go): an artifact of kind
// visualdiff whose versions are berth.visualdiff/v1 manifests, with images
// named by their content hash in the artifact's img/ folder (read with the
// box's credentials and drawn from blob: URLs, lib/art/vdiff-img.ts).
// Pure functions only, so node --test can run them.

export interface VdRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  // The element the region is in: `button "Shop now" in section.hero`.
  el?: string;
}

export interface VdImage {
  img?: string;
  w?: number;
  h?: number;
  status?: number;
  errors?: string[];
  ms?: number;
  cut?: boolean;
  overflow_x?: number;
}

export type Verdict = "changed" | "unchanged" | "new" | "removed" | "error";
export type Scheme = "light" | "dark";

export interface VdShot {
  size: number;
  scheme?: Scheme;
  viewport: [number, number];
  verdict: Verdict;
  why?: string;
  before?: VdImage;
  after?: VdImage;
  heat?: string;
  changed_px: number;
  changed_pct: number;
  aa_px?: number;
  extra_px?: number;
  regions?: VdRegion[];
  regions_total?: number;
  checks?: string[];
  crops?: string[];
  masks?: [number, number, number, number][];
  shift?: { y: number; h: number; dy: number };
  diff_ms: number;
}

export interface VdPage {
  path: string;
  title?: string;
  shots: VdShot[];
  max_pct: number;
}

export interface VisualDiff {
  $schema: "berth.visualdiff/v1";
  title: string;
  created: string;
  base: { kind: "main" | "baseline" | "worktree"; label: string; url?: string; commit?: string; dirty?: number; taken?: string };
  head: { kind: string; label: string; url?: string; commit?: string; dirty?: number };
  settings: { sizes: number[]; scale: number; threshold: number; unchanged_below: number; max_height: number; color_scheme: string; color_schemes?: Scheme[]; reduced_motion: boolean; mask?: string[]; chromium?: string };
  summary: { shots: number; changed: number; unchanged: number; new: number; removed: number; errors: number; regions: number; layout?: number; max_pct: number; text: string };
  pages: VdPage[];
  timing: { total_ms: number; browser_start_ms: number; shoot_ms: number; diff_ms: number; bytes: number; all_bytes: number };
  note?: string;
  notice?: string;
}

export function parseVdiff(body: string): VisualDiff | undefined {
  try {
    const v = JSON.parse(body) as VisualDiff;
    return v && v.$schema === "berth.visualdiff/v1" && Array.isArray(v.pages) && v.pages.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export const IMG_NAME = /^[0-9a-f]{16}\.png$/;

export const sizeName = (w: number) => (w < 600 ? "Mobile" : w < 1024 ? "Tablet" : "Desktop");
export const schemeOf = (s: VdShot): Scheme => s.scheme ?? "light";
export const schemes = (v: VisualDiff): Scheme[] => (v.settings.color_schemes?.length ? v.settings.color_schemes : [v.settings.color_scheme === "dark" ? "dark" : "light"]);
// shotKey names a shot within its page: "375", or "375 dark" when both
// schemes were shot.
export const shotKey = (s: VdShot) => `${s.size}${schemeOf(s) === "dark" ? " dark" : ""}`;

export function pct(p: number): string {
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p > 0) return `${p.toFixed(2)}%`;
  return "0%";
}

export const overflow = (s: VdShot): number | undefined => {
  const c = s.checks?.find((x) => x.startsWith("overflow_x:"));
  return c ? Number(c.split(":")[1]) : undefined;
};

// rank orders shots: errors, then a sideways scroll, then how much
// changed, then new and gone pages (expected more often than not); an
// unchanged shot last.
export const rank = (s: VdShot) => (s.verdict === "error" ? 1000 : s.verdict === "changed" ? 200 + s.changed_pct + (overflow(s) ? 400 : 0) : s.verdict === "removed" ? 160 : s.verdict === "new" ? 150 : -1);

export const pageRank = (p: VdPage) => Math.max(...p.shots.map(rank));
export const sortedPages = (v: VisualDiff) => [...v.pages].sort((x, y) => pageRank(y) - pageRank(x));
// firstPage is where the tab opens: the most changed page, else the
// first that needs a look.
export const firstPage = (pages: VdPage[]) => pages.find((p) => p.shots.some((s) => s.verdict === "changed")) ?? pages[0];
export const worstShot = (p: VdPage, scheme?: Scheme) => [...p.shots].filter((s) => !scheme || schemeOf(s) === scheme).sort((x, y) => rank(y) - rank(x))[0] ?? p.shots[0];

export function allClear(v: VisualDiff): boolean {
  const s = v.summary;
  return s.changed === 0 && s.new === 0 && s.removed === 0 && s.errors === 0;
}

export const baseName = (v: VisualDiff) => (v.base.kind === "baseline" ? `the ${v.base.label} baseline` : v.base.label);

export const verdictWord: Record<Verdict, string> = { changed: "Changed", unchanged: "Unchanged", new: "New page", removed: "Gone", error: "Error" };

// A change to step through: a numbered region of a shot, or a shot that
// failed, is new or is gone (once per page).
export interface Change {
  page: VdPage;
  shot: VdShot;
  region?: VdRegion;
  n: number; // the region's number within its shot, from 1; 0 for a shot
  kind: "region" | "new" | "error" | "removed";
}

// changes are every change worth stepping to, in the order to look at
// them: errors, then sideways scrolls' regions, then the biggest regions,
// then gone and new pages, once each. A region under 120 changed pixels (a
// re-wrapped word) is still drawn but not stepped to.
export function changes(v: VisualDiff): Change[] {
  const out: Change[] = [];
  for (const page of v.pages)
    for (const shot of page.shots) {
      if (shot.verdict === "changed") (shot.regions ?? []).forEach((region, i) => out.push({ page, shot, region, n: i + 1, kind: "region" }));
      else if (shot.verdict === "error" || shot.verdict === "new" || shot.verdict === "removed") out.push({ page, shot, n: 0, kind: shot.verdict });
    }
  const seen = new Set<string>();
  return out
    .filter((it) => {
      if (it.kind === "region") return it.region!.px >= 120 || it.n === 1;
      const k = `${it.kind}:${it.page.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => score(b) - score(a));
}

// Errors first, then a sideways scroll's regions, then regions by size;
// gone and new pages last (usually meant).
const score = (it: Change) => (it.kind === "error" ? 1e12 : it.kind === "region" ? (overflow(it.shot) ? 1e9 : 2) + it.region!.px : it.kind === "removed" ? 1 : 0);

// The card's and tab's headline, toned: an all clear is good; an error or
// a sideways scroll is bad.
export function vdiffGist(v: VisualDiff): Gist {
  if (allClear(v)) return { text: v.summary.text, tone: "good" };
  const bad = v.summary.errors > 0 || v.pages.some((p) => p.shots.some((s) => overflow(s)));
  const text = v.summary.text.replace(/ · \d+ layout warnings?/, "").replace(/ · \d+ new shots?/, "").replace(/ · \d+ errors?/, "").replace(/ · \d+ pages? gone/, "");
  return { text, tone: bad ? "bad" : "plain" };
}

// What needs a look, page by page: a sideways scroll, a failure, a new or
// gone page; and how many pages didn't change.
export interface Flags {
  sideways: { path: string; size: number; px: number }[];
  fails: string[];
  fresh: string[];
  gone: string[];
  same: number;
}

export function flags(v: VisualDiff): Flags {
  const f: Flags = { sideways: [], fails: [], fresh: [], gone: [], same: 0 };
  for (const p of v.pages) {
    for (const s of p.shots) {
      const o = overflow(s);
      if (o) f.sideways.push({ path: p.path, size: s.size, px: o });
    }
    if (p.shots.some((s) => s.verdict === "error")) f.fails.push(p.path);
    if (p.shots.some((s) => s.verdict === "new")) f.fresh.push(p.path);
    if (p.shots.some((s) => s.verdict === "removed")) f.gone.push(p.path);
    if (p.shots.every((s) => s.verdict === "unchanged")) f.same++;
  }
  return f;
}

// frame is a box grown to an aspect ratio and kept on the page.
export function frame(r: { x: number; y: number; w: number; h: number }, W: number, H: number, aspect: number) {
  let w = Math.max(r.w + 48, 120);
  let h = Math.max(r.h + 48, 80);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  w = Math.min(w, W);
  h = w / aspect;
  const x = Math.max(0, Math.min(W - w, r.x + r.w / 2 - w / 2));
  const y = Math.max(0, Math.min(Math.max(0, H - h), r.y + r.h / 2 - h / 2));
  return { x, y, w, h };
}

// thumbShot is the shot a thumbnail shows: the most changed tablet or
// desktop shot (a landscape thumbnail reads a wide page best), else the
// most changed of any size.
export function thumbShot(v: VisualDiff): { page: VdPage; shot: VdShot } | undefined {
  let best: { page: VdPage; shot: VdShot } | undefined;
  const better = (s: VdShot, b?: VdShot) => !b || (s.size >= 768 ? 1 : 0) - (b.size >= 768 ? 1 : 0) > 0 || ((s.size >= 768) === (b.size >= 768) && s.changed_pct > b.changed_pct);
  for (const page of v.pages) for (const shot of page.shots) if (shot.verdict === "changed" && shot.after?.img && shot.before?.img && better(shot, best?.shot)) best = { page, shot };
  return best;
}
