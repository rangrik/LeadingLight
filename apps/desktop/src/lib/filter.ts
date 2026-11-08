import { pageLabel } from "./labels.ts";
import type { ObjectSummary } from "./store.ts";

// The sidebar's filter and the page text search (features/search.feature).
export type Span = [number, number];
export type Hit = { spans: Span[]; starts: boolean; alias?: string };

// The typed words, any case; a page must have every one, in any order.
export const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export const aliasesOf = (p: ObjectSummary) =>
  String(p.properties.aliases ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

const letter = /[\p{L}\p{N}]/u;
// Where each word is in text, at the start of a word if it is at one anywhere.
export function find(text: string, words: string[]): Omit<Hit, "alias"> | undefined {
  const low = text.toLowerCase();
  const spans: Span[] = [];
  let starts = true;
  for (const w of words) {
    const first = low.indexOf(w);
    if (first < 0) return;
    let at = first;
    while (at > 0 && letter.test(low[at - 1])) at = low.indexOf(w, at + 1);
    if (at < 0) [at, starts] = [first, false];
    spans.push([at, at + w.length]);
  }
  return { spans, starts };
}

// A page's match by its title, else by one of its aliases.
export function match(p: ObjectSummary, words: string[]): Hit | undefined {
  const title = find(pageLabel(p.title), words);
  if (title) return title;
  for (const alias of aliasesOf(p)) {
    const hit = find(alias, words);
    if (hit) return { ...hit, alias };
  }
}

// The items whose page matches, word starts first, each part kept in the list's own order.
export function narrow<T>(items: T[], page: (item: T) => ObjectSummary | undefined, words: string[]) {
  const hits = items.flatMap((item) => {
    const p = page(item);
    const hit = p && match(p, words);
    return hit ? [{ item, hit }] : [];
  });
  return [...hits.filter((h) => h.hit.starts), ...hits.filter((h) => !h.hit.starts)];
}

// Every place the words are in text, overlaps joined.
export function everySpan(text: string, words: string[]): Span[] {
  const low = text.toLowerCase();
  const spans: Span[] = [];
  for (const w of words) for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, at + w.length)) spans.push([at, at + w.length]);
  spans.sort((a, b) => a[0] - b[0]);
  return spans.reduce<Span[]>((all, s) => {
    const last = all[all.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else all.push([...s]);
    return all;
  }, []);
}

export type Found = { page: ObjectSummary; line: string; spans: Span[] };

// The line with most of the words, cut so the first one shows in a narrow row.
function lineFor(text: string, words: string[]) {
  let best = "";
  let most = -1;
  for (const line of text.split("\n")) {
    const low = line.toLowerCase();
    const n = words.filter((w) => low.includes(w)).length;
    if (n > most) [best, most] = [line, n];
    if (n === words.length) break;
  }
  const first = everySpan(best, words)[0]?.[0] ?? 0;
  const cut = best.lastIndexOf(" ", first - 24);
  const line = first > 48 && cut > 0 ? `…${best.slice(cut + 1)}` : best;
  return { line, spans: everySpan(line, words) };
}

// Searches pages' text, newest first. Each page is read once per save: kept by id and updatedAt.
export function textSearch(read: (id: string) => Promise<string>) {
  const kept = new Map<string, { at: number; text: Promise<string> }>();
  const textOf = (p: ObjectSummary) => {
    const hit = kept.get(p.id);
    if (hit?.at === p.updatedAt) return hit.text;
    const text = read(p.id);
    kept.set(p.id, { at: p.updatedAt, text });
    text.catch(() => kept.delete(p.id));
    return text;
  };
  return async (words: string[], pages: ObjectSummary[]): Promise<Found[]> => {
    const texts = await Promise.all(pages.map((p) => textOf(p).catch(() => "")));
    return pages
      .flatMap((page, i) => (words.length && words.every((w) => texts[i].toLowerCase().includes(w)) ? [{ page, ...lineFor(texts[i], words) }] : []))
      .sort((a, b) => b.page.updatedAt - a.page.updatedAt);
  };
}
