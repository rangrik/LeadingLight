import type { Seen } from "./ask-prompt";
import type { ObjectSummary } from "./store";
import { ABOUT } from "./tail-memory.ts";

// What a tail turn sends and how its answer is read (docs/TAIL.md, "What it sees"). The app finds
// the candidates; the model picks which to show and fills their slots; the app writes the line.
// No app imports, so the never-list and the parser can be tested alone.

export const TAIL = [
  "You are tail, in LeadingLight, a notes app on this Mac. From offers the app found, you choose the few worth one line now; the person takes a line with one press or ignores it. Showing nothing is often right.",
  'Each message is one JSON object: the trigger ("beat" for the lines on Today, "page" for the line above a page the person came back to, "pause" for a line beside the line they just wrote, "capture" for the box where they type an idea), the time now, pages (a summary of each, by ref), text (a page\'s words, only when new to you or changed), and candidates.',
  "A candidate has an id, a kind, the refs of the pages it is about, its facts, and the app's guess at its slots. Kinds: left (a page left mid-sentence), ideas (ideas not filed; the pages are those that read as tasks), day (a task whose title names a day but has no due date), untitled (a page with words and no title), stopped (where the person stopped on this page), task (the line just written, with the blocks around it, reads as a task; the pages are its page and those it names), mention (a word in the line is a page's title and not linked), capture (an idea typed in the box, worth showing only when a project fits it).",
  "Two more, when they hold anything: about, the page about how the person works, dated sentences they read and edit, which you follow; and ledger, how many lines of each kind they took and ignored lately.",
  "Choose the candidates worth showing, most useful first: at most three for a beat, at most one otherwise. Leave out any the pages make untrue or pointless, and any line that only looks like a task: about the past, a thing, or a day, not something to do.",
  'Keep or change each slot in the guess, and fill one left empty: project is the ref of a project page; day is a weekday or "tomorrow", as the task\'s words name it; title is a short title, at most six words, from the page\'s own words; task is true when the words are something to do, else false.',
  'Answer with JSON only, no other words: {"show":[{"id":"c1","project":"p2"}]}, with only the slots its guess has, or {"show":[]}. After a beat you may add "note": one plain sentence for the page about the person, at most twelve words, a habit the records show that the page does not say yet.',
].join("\n");

export type Trigger = "beat" | "page" | "pause" | "capture";
export type Slots = { project?: string; day?: string; title?: string; task?: boolean };
// Something worth a line: the pages it is about, words from them, and the app's guess at its slots.
export type Candidate = { id: string; kind: string; pages: string[]; facts?: Record<string, string | number>; guess?: Slots };

// About 8k tokens for a beat, 4k for a page, 2k for a pause and 1k for a capture, at four
// characters a token, and one body's most. A pause and a capture send no bodies.
const BUDGET = { beat: { all: 32_000, body: 3_000 }, page: { all: 16_000, body: 12_000 }, pause: { all: 8_000, body: 0 }, capture: { all: 4_000, body: 0 } };

// Never sent: templates, Thoughts pages (sidenotes; one sent as feedback is a page of its own) and
// the page about the person, which goes as about. Reads on governs a page's summary and words.
export const named = (p: ObjectSummary) => !p.properties.templateOf && p.properties.role !== "thoughts" && p.typeId !== ABOUT;
export const mayRead = (p: ObjectSummary, readsOn: (typeId: string) => boolean) => named(p) && readsOn(p.typeId);

const two = (n: number) => String(n).padStart(2, "0");
const when = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const size = (x: unknown) => JSON.stringify(x).length;

export type DigestInput = {
  trigger: Trigger;
  now: number;
  pages: ObjectSummary[];
  readsOn: (typeId: string) => boolean;
  typeName: (typeId: string) => string;
  // A body goes only if its page was updated after this and the thread hasn't seen it so.
  since: number;
  seen: Seen;
  text: (id: string) => Promise<string>;
  candidates: Candidate[];
  // The page about how the person works, and the ledger in a few words.
  about?: string[];
  ledger?: string;
};

// Summaries from memory, candidates' pages and projects first, then the newest; bodies only of
// pages that changed, read only then. Pages are sent by short refs, which the answer uses.
export async function buildDigest(o: DigestInput): Promise<{ message: string; seen: Seen; refs: Record<string, string> }> {
  const budget = BUDGET[o.trigger];
  const reads = (p?: ObjectSummary) => !!p && mayRead(p, o.readsOn);
  // A pause's index is every page, since a title is what one types to link.
  const byId = new Map(o.pages.filter(o.trigger === "pause" ? named : reads).map((p) => [p.id, p]));
  const about = (c: Candidate) => [...c.pages, ...(c.guess?.project ? [c.guess.project] : [])];
  // A candidate about a page tail may not read is not sent, words and all; a pause's first page
  // is the one written on, and the rest it only names.
  const candidates = o.candidates.filter((c) => about(c).every((id) => byId.has(id)) && (o.trigger !== "pause" || reads(byId.get(c.pages[0]))));
  const first = new Set(candidates.flatMap(about));
  const rank = (p: ObjectSummary) => (first.has(p.id) ? 0 : p.typeId === "project" ? 1 : 2);
  const order = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const ref = new Map(order.map((p, i) => [p.id, `p${i + 1}`]));

  const sent = candidates.map((c, i) => ({
    id: `c${i + 1}`,
    kind: c.kind,
    pages: c.pages.map((id) => ref.get(id)),
    ...c.facts,
    ...(c.guess && { guess: { ...c.guess, ...(c.guess.project && { project: ref.get(c.guess.project) }) } }),
  }));
  // The index is titles, types and aliases; a page tail may read, and in a pause a candidate's,
  // gets the rest too.
  const summary = (p: ObjectSummary) => {
    const aliases = typeof p.properties.aliases === "string" ? p.properties.aliases.trim().slice(0, 120) : "";
    const base = { ref: ref.get(p.id), title: p.title.trim() || "Untitled", type: o.typeName(p.typeId), ...(aliases && { aliases }) };
    if (!reads(p) || (o.trigger === "pause" && !first.has(p.id))) return base;
    const line = typeof p.properties.description === "string" ? p.properties.description.trim().slice(0, 160) : "";
    const due = (p.properties.due as { start?: string } | undefined)?.start;
    const project = Object.values(p.properties).flatMap((v) => (Array.isArray(v) ? v : [])).filter((id) => byId.get(id)?.typeId === "project").map((id) => ref.get(id));
    return { ...base, updated: when(p.updatedAt), ...(line && { line }), ...(typeof p.properties.done === "boolean" && { done: p.properties.done }), ...(due && { due }), ...(project.length && { project }) };
  };
  const extra = { ...(o.about?.length && { about: o.about }), ...(o.ledger && { ledger: o.ledger }) };
  const pages: ReturnType<typeof summary>[] = [];
  let room = budget.all * 0.6 - size(sent) - size(extra);
  for (const p of order) {
    const s = summary(p);
    if (rank(p) > 0 && size(s) > room) break;
    pages.push(s);
    room -= size(s);
  }
  room = budget.all - size({ sent, pages });
  const seen = { ...o.seen };
  const text: { ref?: string; text: string }[] = [];
  for (const p of order.slice(0, pages.length).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const at = String(p.updatedAt);
    if (!budget.body || p.updatedAt <= o.since || seen[p.id] === at) continue;
    const words = (await o.text(p.id)).slice(0, budget.body);
    if (words.trim() && size(words) > room) continue;
    if (words.trim()) text.push({ ref: ref.get(p.id), text: words });
    room -= size(words);
    seen[p.id] = at;
  }
  const now = new Date(o.now);
  const message = JSON.stringify({ trigger: o.trigger, now: `${WEEKDAYS[now.getDay()]} ${when(o.now)}`, ...extra, pages, ...(text.length && { text }), candidates: sent });
  const refs = Object.fromEntries([...[...ref].map(([id, r]) => [r, id]), ...candidates.map((c, i) => [`c${i + 1}`, c.id])]);
  return { message, seen, refs };
}

// Tail's threads (docs/TAIL.md, "What it remembers"): a session and what it was sent, as ids and
// times, never words. The day's for the beat, a page's for four hours, a box's for ten minutes.
export type Thread = { model: string; session?: string; seen: Seen; at: number };
export const current = (key: string, t: Thread, now: number) => (key.startsWith("beat:") ? key === `beat:${when(now).slice(0, 10)}` : now - t.at < (key.startsWith("capture:") ? 10 * 60_000 : 4 * 3_600_000));
// A beat starts a new session each time, so the day's never grows, but keeps the day's seen map.
export function threadFor(threads: Record<string, Thread>, key: string, model: string, now: number): Thread {
  const t = threads[key];
  if (t?.model !== model || !current(key, t, now)) return { model, seen: {}, at: now };
  return key.startsWith("beat:") ? { ...t, session: undefined } : t;
}

const DAY = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)$/i;

// The JSON object in an answer, if there is one.
export function answerOf(text: string): { show?: unknown; note?: unknown } | undefined {
  try {
    const v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

// The sentence the model adds to the page about the person: one plain sentence of at most twelve
// words, else none.
export function noteIn(text: string): string | undefined {
  const note = answerOf(text)?.note;
  if (typeof note !== "string") return;
  const s = note.trim();
  return /^\p{Lu}[^\n!?*_#`[\]{}<>|]*[\p{L}\p{N}]\.$/u.test(s) && !/[.;:]\s/.test(s) && s.split(/\s+/).length <= 12 ? s : undefined;
}

// The model's choice, kept only where it checks out: a candidate sent, its slots of the right
// kind (a slot left out keeps the guess). Anything else is dropped; an answer not JSON is silence.
export function parseAnswer(text: string, o: { refs: Record<string, string>; candidates: Candidate[]; max: number; isProject: (id: string) => boolean }): { id: string; slots: Slots }[] {
  const answer = answerOf(text);
  const out: { id: string; slots: Slots }[] = [];
  for (const item of Array.isArray(answer?.show) ? (answer.show as Record<string, unknown>[]) : []) {
    const c = o.candidates.find((x) => x.id === o.refs[String(item?.id)]);
    if (!c || out.some((x) => x.id === c.id)) continue;
    if (out.length >= o.max) break;
    const slots: Slots = { ...c.guess };
    const word = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    if (c.guess?.project !== undefined && item.project !== undefined) slots.project = o.isProject(o.refs[word(item.project)] ?? "") ? o.refs[word(item.project)] : undefined;
    if (c.guess?.day !== undefined && item.day !== undefined) slots.day = DAY.test(word(item.day)) ? word(item.day)[0].toUpperCase() + word(item.day).slice(1).toLowerCase() : undefined;
    if (c.guess?.title !== undefined && item.title !== undefined) {
      const t = word(item.title).replace(/[.!?…:;,]+$/, "");
      slots.title = t && !t.includes("\n") && t.length <= 80 && t.split(/\s+/).length <= 8 ? t : undefined;
    }
    if (c.guess?.task !== undefined && item.task !== undefined) slots.task = typeof item.task === "boolean" ? item.task : undefined;
    // A slot the model got wrong: no line rather than a guess. A task of false is an answer.
    if (Object.keys(c.guess ?? {}).some((k) => !slots[k as keyof Slots] && slots[k as keyof Slots] !== false)) continue;
    out.push({ id: c.id, slots });
  }
  return out;
}

// A choice held for later, made again from what the app finds now: a candidate gone or changed
// since (an idea filed, a page edited) is dropped.
export function stillTrue<C extends Candidate>(held: { found: C; slots: Slots }[], now: C[]) {
  const key = (c: Candidate) => JSON.stringify([c.id, c.pages, c.facts]);
  return held.flatMap(({ found, slots }) => now.filter((c) => key(c) === key(found)).map((c) => ({ found: c, slots })));
}
