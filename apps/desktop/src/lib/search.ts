import type { EditorDoc } from "@leadinglight/editor/editor";
import type { TypeDef } from "./catalog";
import { pageId } from "./history-types";
import { pageLabel } from "./labels";
import { type LLObject, type ObjectSummary, objects, onHistory } from "./objects";
import { listed, space, typeOf } from "./space";
import { asDoc } from "./store";
import { relationsOf } from "./work";

// Search (features/search.feature): every page's words in memory, one entry per text block, so a
// match can name its block. Titles come from the space's summaries, which are always fresh.

// A block's words as shown (links read as their titles); raw is only its text, as editor.find sees it.
export type Block = { text: string; raw: string; fold: string; top: number };
type Entry = { blocks: Block[]; fold: string };

const index = new Map<string, Entry>();
let reading: Promise<void> | null = null;

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const titleOf = (id: unknown) => pageLabel(space.get().pages.find((p) => p.id === id)?.title ?? "");

function blocksOf(doc: EditorDoc | null): Block[] {
  const blocks: Block[] = [];
  const push = (text: string, raw: string, top: number) => text.trim() && blocks.push({ text, raw, fold: fold(text), top });
  const walk = (node: EditorDoc, top: number) => {
    const kids = node.content ?? [];
    if (node.type === "pageLink") return push(titleOf(node.attrs?.id), "", top);
    if (!kids.some((k) => k.type === "text" || k.type === "mention")) return kids.forEach((k) => walk(k, top));
    const word = (k: EditorDoc) => (k.type === "text" ? (k.text ?? "") : k.type === "mention" ? `${k.attrs?.tag ? "#" : ""}${titleOf(k.attrs?.id)}` : " ");
    push(kids.map(word).join(""), kids.map((k) => (k.type === "text" ? (k.text ?? "") : "")).join(""), top);
  };
  (doc?.content ?? []).forEach((node, i) => walk(node, i + 1));
  return blocks;
}

const put = (page: LLObject) => {
  const blocks = blocksOf(asDoc(page.content));
  index.set(page.id, { blocks, fold: blocks.map((b) => b.fold).join("\n") });
};

// Every saved change arrives with the page as it now is: that page alone is indexed again, unread.
onHistory((entry) => {
  if (!reading) return;
  for (const change of entry.changes) change.after ? put(change.after) : index.delete(pageId(change));
});

// The first open reads every body once; later opens only pages the index hasn't seen.
export function readIndex(): Promise<void> {
  const missing = space.get().pages.filter((p) => !index.has(p.id));
  const read = Promise.all(missing.map(async (p) => {
    const page = await objects.get(p.id);
    // A change heard while this was reading is newer than what was read.
    if (page && !index.has(p.id)) put(page);
  })).then(() => {});
  reading = (reading ?? Promise.resolve()).then(() => read);
  return reading;
}

// ---- the query ----

const DAY = 86_400_000;
export type Filter = { kind: "type" | "project" | "week"; id: string; label: string; words: string; at?: number; length?: number };
// rest is the words left to find, as typed: what "New page" is called.
export type Query = { text: string; rest: string; terms: string[]; filters: Filter[]; reports: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A filter's words where they stand alone in the field, whatever their case.
const phrase = (words: string) => new RegExp(`(?<=^|\\s)${escape(words).replace(/\s+/g, "\\s+")}(?=\\s|$)`, "i");

// Words that name a filter; the rest are searched for. A type is named by its plural, unless the
// plural is also its name ("Feedback"), which reads as a word to find.
export function filtersFor(): Filter[] {
  const { pages, types } = space.get();
  const projects = pages.filter((p) => p.typeId === "project" && p.title.trim());
  return [
    { kind: "week" as const, id: "week", label: "Edited this week", words: "edited this week" },
    ...projects.map((p) => ({ kind: "project" as const, id: p.id, label: `in ${p.title.trim()}`, words: `in ${p.title.trim()}` })),
    ...types.filter((t) => t.plural.trim() && t.plural.trim().toLowerCase() !== t.name.trim().toLowerCase()).map((t) => ({ kind: "type" as const, id: t.id, label: t.plural, words: t.plural })),
  ].sort((a, b) => b.words.length - a.words.length);
}

// Each filter found is blanked out with spaces, so every match keeps its place in the text.
export function parse(text: string, all = filtersFor()): Query {
  const blank = (s: string, at: number, n: number) => s.slice(0, at) + " ".repeat(n) + s.slice(at + n);
  let rest = text;
  const reports = /(?<=^|\s)in:reports(?=\s|$)/i.exec(rest);
  if (reports) rest = blank(rest, reports.index, reports[0].length);
  const filters: Filter[] = [];
  for (const f of all) {
    if (filters.some((g) => g.kind === f.kind)) continue;
    const found = phrase(f.words).exec(rest) ?? (f.kind === "week" ? phrase("this week").exec(rest) : null);
    if (!found) continue;
    filters.push({ ...f, at: found.index, length: found[0].length });
    rest = blank(rest, found.index, found[0].length);
  }
  return { text, rest: rest.replace(/\s+/g, " ").trim(), terms: fold(rest).split(/[^\p{L}\p{N}]+/u).filter(Boolean), filters, reports: !!reports };
}

// The query with a filter's words taken out of it, or added at its end.
export function toggle(q: Query, f: Filter): string {
  const on = q.filters.find((g) => g.kind === f.kind && g.id === f.id);
  const text = on?.at !== undefined ? q.text.slice(0, on.at) + q.text.slice(on.at + (on.length ?? 0)) : `${q.text.trim()} ${f.words}`;
  const tidy = text.replace(/\s+/g, " ").trim();
  return tidy ? `${tidy} ` : "";
}

// "delays" finds "delay", "boxes" "box": an s at the end is optional, then any word starting so.
const stem = (t: string) => (t.length > 4 && /(s|x|z|ch|sh)es$/.test(t) ? t.slice(0, -2) : t.length > 4 && /[^s]s$/.test(t) ? t.slice(0, -1) : t);
const wordAt = (t: string, flags = "u") => new RegExp(`(?<![\\p{L}\\p{N}])${escape(stem(t))}[\\p{L}\\p{N}]*`, flags);

// ---- results ----

export type Hit = { page: ObjectSummary; title: boolean; block?: Block; more: number; project?: ObjectSummary };
export type Group = { type: TypeDef; hits: Hit[] };

// Who writes these bodies is an agent; their words are found only when asked for.
const AGENTS = new Set(["agent", "report"]);
const ids = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");

// A page's project: one it relates to, or its task's (an agent's, a report's, a subtask's).
export function projectOf(p: ObjectSummary, byId: Map<string, ObjectSummary>, depth = 0): ObjectSummary | undefined {
  const near = relationsOf(p).map((id) => byId.get(id)).filter((x): x is ObjectSummary => !!x);
  const found = near.find((x) => x.typeId === "project");
  if (found || depth) return found;
  for (const id of [...ids(p.properties.parent), ...ids(p.properties["agent-task"]), ...ids(p.properties["subtask-of"])]) {
    const up = byId.get(id);
    const there = up && projectOf(up, byId, 1);
    if (there) return there;
  }
}

const aliases = (p: ObjectSummary) => (typeof p.properties.aliases === "string" ? p.properties.aliases : "");

// Pages matching every word, titles first, then recent first. Nothing to find gives the recent pages.
export function search(q: Query): Hit[] {
  const pages = space.get().pages.filter((p) => !p.properties.templateOf);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const type = q.filters.find((f) => f.kind === "type")?.id;
  const project = q.filters.find((f) => f.kind === "project")?.id;
  const week = q.filters.some((f) => f.kind === "week") ? Date.now() - 7 * DAY : 0;
  const words = q.terms.map((t) => wordAt(t));
  const hits: Hit[] = [];
  for (const page of pages) {
    if ((type && page.typeId !== type) || page.updatedAt < week) continue;
    const near = projectOf(page, byId);
    if (project && page.id !== project && near?.id !== project) continue;
    if (!words.length) {
      // Without a type asked for, not what the app writes for itself.
      if (type || ((listed(page) || page.typeId === "daily") && !typeOf(page.typeId).made)) hits.push({ page, title: false, more: 0, project: near });
      continue;
    }
    const head = fold(`${pageLabel(page.title)} ${aliases(page)}`);
    const body = q.reports || type === "agent" || type === "report" || !AGENTS.has(page.typeId) ? index.get(page.id) : undefined;
    const title = words.every((w) => w.test(head));
    if (!title && !words.every((w) => w.test(head) || (body && w.test(body.fold)))) continue;
    let block: Block | undefined;
    let best = 0;
    let full = 0;
    for (const b of body?.blocks ?? []) {
      const n = words.filter((w) => w.test(b.fold)).length;
      if (n === words.length) full++;
      if (n > best) [block, best] = [b, n];
    }
    if (!title && !block) continue;
    // Under a title match, a line only when it has every word.
    if (title && best < words.length) block = undefined;
    hits.push({ page, title, block, more: block && best === words.length ? full - 1 : 0, project: near });
  }
  // What agents wrote comes after my own pages, unless asked for.
  const rank = (h: Hit) => (h.title ? 0 : 1) + (!q.reports && type !== h.page.typeId && AGENTS.has(h.page.typeId) ? 2 : 0);
  return hits.sort((a, b) => rank(a) - rank(b) || b.page.updatedAt - a.page.updatedAt);
}

// Hits by type, each group where its best hit is.
export function grouped(hits: Hit[]): Group[] {
  const groups = new Map<string, Group>();
  for (const h of hits) {
    const g = groups.get(h.page.typeId) ?? { type: typeOf(h.page.typeId), hits: [] };
    groups.set(h.page.typeId, g);
    g.hits.push(h);
  }
  return [...groups.values()];
}

// Where the words are in text, as whole words, for bold.
export function marks(text: string, terms: string[]): [number, number][] {
  let f = fold(text);
  // Folding can change the length (a decomposed accent); then map each folded letter back.
  let at: number[] | null = null;
  if (f.length !== text.length) {
    [f, at] = ["", []];
    for (let i = 0; i < text.length; i++) {
      const c = fold(text[i]);
      f += c;
      for (let j = 0; j < c.length; j++) at.push(i);
    }
  }
  const back = (i: number) => (at ? (at[i] ?? text.length) : i);
  const spans: [number, number][] = [];
  for (const t of terms) {
    for (const m of f.matchAll(wordAt(t, "gu"))) spans.push([back(m.index), back(m.index + m[0].length - 1) + 1]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  return spans.reduce<[number, number][]>((out, s) => {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
    return out;
  }, []);
}

// A long line starts a little before its first match, so the match shows.
export function snippet(text: string, spans: [number, number][], lead = 32): { text: string; spans: [number, number][] } {
  const first = spans[0]?.[0] ?? 0;
  if (first <= lead) return { text, spans };
  const cut = text.lastIndexOf(" ", first - lead) + 1;
  const from = cut > 0 ? cut : first - lead;
  return { text: `…${text.slice(from)}`, spans: spans.map(([a, b]) => [a - from + 1, b - from + 1]) };
}
