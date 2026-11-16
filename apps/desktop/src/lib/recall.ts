import type { EditorDoc } from "@leadinglight/editor/editor";
import { childOf, createChild, roleOf } from "./linked";
import { editPage, liveContent } from "./live";
import { localPrefs } from "./local-prefs";
import { docText, type ObjectSummary, objects } from "./objects";
import { flushAll } from "./saving";
import { listed, pageOf, space } from "./space";
import { createStore } from "./state";

// Recall (features/recall.feature): a page's noted things, its sidenotes and highlights, gone
// through once in your own words. Tail offers it (lib/tail.ts); the card is components/recall.tsx.

const DAY = 86_400_000;
// Away this long before Tail offers it, and quiet this long after a recall.
const AWAY = 3 * DAY;
const QUIET = 7 * DAY;

// When each page was last open here, on this Mac; after ninety days it is forgotten.
const opened = localPrefs<{ at: Record<string, number> }>("ll.recall.opened", { at: {} });
export function markOpen(id: string, now = Date.now()) {
  const kept = Object.entries(opened.get().at).filter(([, t]) => now - t < 90 * DAY);
  opened.set({ at: Object.fromEntries([...kept, [id, now]]) });
}

const thoughtsOf = (p: ObjectSummary) => pageOf(childOf(p, "thoughts") ?? "");
// What a recall left on the Thoughts page, a plain property: each sidenote's id, or a highlight's words, and when.
export type Recalled = { thought?: string; quote?: string; at: number };
const recalledOf = (p: ObjectSummary) => {
  const r = thoughtsOf(p)?.properties.recalled;
  return Array.isArray(r) ? (r as Recalled[]) : [];
};

// When its noted things were last in front of the person: open here, or it or its Thoughts page edited.
export const metAt = (p: ObjectSummary) => Math.max(opened.get().at[p.id] ?? 0, p.updatedAt, thoughtsOf(p)?.updatedAt ?? 0);
// Worth a line by the clock: away three days, and no recall this week. Never a Thoughts page, essay or report.
export const away = (p: ObjectSummary, met = metAt(p), now = Date.now()) =>
  listed(p) && !roleOf(p) && p.typeId !== "report" && now - met >= AWAY && now - Math.max(0, ...recalledOf(p).map((r) => r.at)) >= QUIET;

const weekday = new Intl.DateTimeFormat("en", { weekday: "long" });
const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);
// When they were noted, as a line says it: the Thoughts page's last edit, else the page's.
export function whenNoted(p: ObjectSummary, now = Date.now()) {
  const at = thoughtsOf(p)?.updatedAt ?? p.updatedAt;
  const days = Math.round((midnight(now) - midnight(at)) / DAY);
  return days < 7 ? `on ${weekday.format(at)}` : days < 14 ? "last week" : "weeks ago";
}

// One noted thing: a sidenote (note, its id) with the words it is on, or a highlight read as its sentence.
export type Noted = { key: string; note?: string; quote: string; text: string; block: number };
const marked = (n: EditorDoc, type: string, id?: string) => !!n.marks?.some((m) => m.type === type && (id === undefined || m.attrs?.id === id));

// The sentence around words at from–to in a block's text.
function sentence(whole: string, from: number, to: number) {
  const start = Math.max(0, ...[...whole.slice(0, from).matchAll(/[.!?…]\s+/g)].map((m) => (m.index ?? 0) + m[0].length));
  const end = whole.slice(to).search(/[.!?…](\s|$)/);
  return whole.slice(start, end < 0 ? undefined : to + end + 1).trim();
}

// A page's sidenotes whose thought exists, and its highlighted runs, in reading order.
export function notedIn(doc: EditorDoc | null | undefined, hasThought: (id: string) => boolean): Noted[] {
  const out: (Noted & { from?: number })[] = [];
  const notes = new Map<string, Noted>();
  (doc?.content ?? []).forEach((top, block) => {
    let runs = 0;
    const walk = (n: EditorDoc) => {
      const kids = n.content ?? [];
      const whole = kids.map((k) => k.text ?? "").join("");
      let run: (Noted & { from: number }) | null = null;
      let at = 0;
      const end = () => {
        if (run) run.text = sentence(whole, run.from, run.from + run.quote.length);
        run = null;
      };
      for (const k of kids) {
        if (k.type !== "text") {
          end();
          walk(k);
          continue;
        }
        const t = k.text ?? "";
        for (const m of k.marks ?? []) {
          const id = m.type === "note" ? String(m.attrs?.id ?? "") : "";
          if (!id || !hasThought(id)) continue;
          const had = notes.get(id);
          if (had) had.quote += t;
          else notes.set(id, out[out.push({ key: id, note: id, quote: t, text: "", block }) - 1]);
        }
        if (!marked(k, "highlight")) end();
        else if (run) run.quote += t;
        else out.push((run = { key: `h${block}.${runs++}`, quote: t, text: "", block, from: at }));
        at += t.length;
      }
      end();
    };
    walk(top);
  });
  return out.map(({ key, note, quote, text, block }) => ({ key, note, quote, text, block }));
}

// The thoughts on a page's Thoughts page, by id, with their words.
export async function thoughtsIn(p: ObjectSummary) {
  const id = childOf(p, "thoughts");
  const doc = id ? (liveContent(id) ?? (await objects.get(id))?.content) : null;
  const found = new Map<string, string>();
  const walk = (nodes: EditorDoc[] = []) => nodes.forEach((n) => (n.type === "thought" ? found.set(String(n.attrs?.id), docText({ type: "doc", content: n.content })) : walk(n.content)));
  walk(doc?.content);
  return found;
}
export async function countNoted(p: ObjectSummary, doc?: EditorDoc | null) {
  const body = doc ?? liveContent(p.id) ?? (await objects.get(p.id))?.content;
  const thoughts = await thoughtsIn(p);
  return notedIn(body, (id) => thoughts.has(id)).length;
}

// Pages for Today's line, met most lately first: away by the clock, with two or more noted things.
export async function dueToRecall(pages: ObjectSummary[], now = Date.now()) {
  const due: { page: ObjectSummary; noted: number }[] = [];
  const near = pages.filter((p) => away(p, metAt(p), now) && now - metAt(p) < 30 * DAY).sort((a, b) => metAt(b) - metAt(a));
  for (const page of near.slice(0, 20)) {
    const noted = await countNoted(page);
    if (noted >= 2) due.push({ page, noted });
  }
  return due;
}

// Pages whose Recall card is open. A note saved from it makes no room for itself (lib/notes-for.ts).
export const recalling = createStore<string[]>([]);
export const openRecall = (id: string) => recalling.set([...recalling.get().filter((x) => x !== id), id]);
export const closeRecall = (id: string) => recalling.set(recalling.get().filter((x) => x !== id));

const mapText = (n: EditorDoc, fn: (t: EditorDoc) => EditorDoc): EditorDoc => (n.type === "text" ? fn(n) : n.content ? { ...n, content: n.content.map((k) => mapText(k, fn)) } : n);
// The text nodes in a block holding a noted thing's words: its note's, or a highlighted run with its words.
function wordsIn(block: EditorDoc, item: Noted) {
  const found = new Set<EditorDoc>();
  const walk = (n: EditorDoc) => {
    let run: EditorDoc[] = [];
    const end = () => {
      if (!found.size && run.length && run.map((k) => k.text).join("") === item.quote) run.forEach((k) => found.add(k));
      run = [];
    };
    for (const k of n.content ?? []) {
      if (k.type === "text" && item.note && marked(k, "note", item.note)) found.add(k);
      else if (k.type === "text" && !item.note && marked(k, "highlight")) run.push(k);
      else {
        end();
        if (k.type !== "text") walk(k);
      }
    }
    end();
  };
  walk(block);
  return found;
}
// A new note on the same words: the nearest block holding them, marked; null once they are gone.
export function anchored(doc: EditorDoc, item: Noted, id: string) {
  const blocks = doc.content ?? [];
  const order = blocks.map((_, i) => i).sort((a, b) => Math.abs(a - item.block) - Math.abs(b - item.block));
  for (const block of order) {
    const words = wordsIn(blocks[block], item);
    if (words.size) return { block, next: mapText(blocks[block], (t) => (words.has(t) ? { ...t, marks: [...(t.marks ?? []), { type: "note", attrs: { id } }] } : t)) };
  }
  return null;
}
// The block holding a note, with its mark taken off.
export function unanchored(doc: EditorDoc, id: string) {
  const has = (n: EditorDoc): boolean => marked(n, "note", id) || !!n.content?.some(has);
  const block = (doc.content ?? []).findIndex(has);
  return block < 0 ? null : { block, next: mapText(doc.content![block], (t) => ({ ...t, marks: t.marks?.filter((m) => !(m.type === "note" && m.attrs?.id === id)) })) };
}

// What was recalled, added to the Thoughts page; one made now if the page has none and no note is making one.
export async function keepRecalled(page: string, entries: Recalled[], making: boolean) {
  if (!entries.length) return;
  await flushAll();
  const linked = () => childOf(pageOf(page) ?? ({ properties: {} } as ObjectSummary), "thoughts");
  if (!linked() && making)
    await new Promise<void>((done) => {
      const off = space.subscribe(() => linked() && (off(), done()));
      setTimeout(() => (off(), done()), 5000);
    });
  let id = linked();
  if (!id) {
    id = (await createChild(page, "thoughts")).id;
    await editPage(page, { properties: (p) => ({ ...p, thoughts: id }) });
  }
  await editPage(id, { properties: (p) => ({ ...p, recalled: [...(Array.isArray(p.recalled) ? p.recalled : []), ...entries] }) });
}
