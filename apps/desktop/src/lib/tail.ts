import type { EditorDoc } from "@leadinglight/editor/editor";
import { onAiPrefs, tailPrefs } from "./ai-prefs";
import { isTask } from "./assign";
import { ensureTag, type Guess, IDEA, TAG } from "./capture";
import { captureOf } from "./capture-inbox";
import { dayShown, today } from "./daily";
import { linkFirst } from "./doc-links";
import { isoDay } from "./format";
import { pageLabel } from "./labels";
import { editPage, isLive, liveContent, liveEditor, watchLive, whenLive } from "./live";
import { localPrefs } from "./local-prefs";
import { docText, type ObjectSummary, objects } from "./objects";
import { docMarkdown } from "./page-markdown";
import { focusedPage, leaves, openBeside, openPage, panes } from "./panes";
import { isNative } from "./platform";
import { createPage, INBOX_VIEW, listed, pageOf, retype, space, typeOf } from "./space";
import { createStore } from "./state";
import { ABOUT, appLine, counts, dated, edited, type Entry, factOf, isOut, isQuiet, lineAt, MAX_LINES, type Place, quietForm, quietLine, record, seenOn, sentenceOf, type Shown, TODAY, upgraded } from "./tail-memory";
import { answerOf, buildDigest, type Candidate, current, mayRead, named, noteIn, parseAnswer, type Slots, stillTrue, TAIL, type Thread, threadFor, type Trigger } from "./tail-prompt";
import { fingerprint, nextRead, reader } from "./tail-read";
import { tailTurn } from "./turn";
import { suggested } from "./writing";
import { authored, stampDoc } from "@leadinglight/editor/authorship";
import { action, type ChangeContext } from "./history-types";
import { commitAction, undoAction } from "./history";
import { flushAll } from "./saving";
import { newObject } from "./store";
import { pageInit } from "./templates";

// Tail (docs/TAIL.md, features/tail.feature): reads along and offers one line to nod at. Word
// rules find what might be worth a line; a tail turn picks, or stays silent. Nothing it shows is
// stored; nods go through an open editor, a new page or a property, and each can be undone.

// Design values in the browser build, the real ones in the Mac app (docs/TAIL.md, Timing).
const TIMES = {
  away: [10_000, 15 * 60_000],
  beat: [2 * 60_000, 30 * 60_000],
  done: [8_000, 8_000],
};
let browser = false;
void isNative.then((native) => (browser = !native));
const ms = (k: keyof typeof TIMES) => TIMES[k][browser ? 0 : 1];
// Seconds of quiet before a block is read: after a full stop, and in any case (Settings › AI › Tail).
export const readAfter = () => ({ stop: tailPrefs().stop ?? (browser ? 3 : 10), quiet: tailPrefs().quiet ?? (browser ? 5 : 20) });

// Words, and names or quoted words shown in the foreground that open their page.
export type Part = string | { text: string; page: string };
// undo: gone after its moment, when a row on Today keeps only its words.
type Done = { words: Part[]; undo?: () => Promise<unknown> };
export type Line = {
  id: string;
  // TODAY, or the page whose row or suggestion it is.
  where: string;
  words: Part[];
  // A suggestion's words under Elsewhere, quoting its block.
  row?: Part[];
  nod: string;
  // block: where a suggestion's block is now, which edits above it move.
  act: (block?: number, context?: ChangeContext) => Promise<Done | void>;
  // A suggestion: the top-level block it is about, that block's words, which it stays for, when it
  // came, the pages it is about, and the model's slots, so it can be made again at the next start.
  block?: number;
  pages?: string[];
  text?: string;
  at?: number;
  slots?: Slots;
  done?: Done;
  // Where it was, for the nod ledger; when the person first had it in front of them, and whether
  // leaving its page counted as a no; on Today, its pages as they were, so a row shown day after
  // day can stay out until they change.
  place?: Place;
  seen?: number;
  ignored?: boolean;
  state?: string;
};
export { TODAY };
export const tail = createStore<Line[]>([]);
// The last beat, for Settings › AI › Tail: when, how many lines it gave, or why it didn't go.
export const lastBeat = createStore<{ at: number; lines: number; error?: string } | null>(null);

// Off, Quiet or Normal (Settings › AI › Tail). Quiet keeps suggestions and the capture guess off.
const mode = () => tailPrefs().mode;
const normal = () => mode() === "normal";
// Reads on, else Writing's Use on; tasks too, since the beat reads open tasks (docs/TAIL.md).
export const readsOnByDefault = (typeId: string) => suggested(typeId) || typeId === "task";
export const readsOn = (typeId: string) => tailPrefs().readsOn[typeId] ?? readsOnByDefault(typeId);
const readable = (p?: ObjectSummary) => !!p && mayRead(p, readsOn);
// The edits a nod makes are not the person typing.
let acting = false;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const later = (id: string, wait: number, fn: () => void) => {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(fn, wait));
};
const update = (id: string, patch: Partial<Line>) => tail.set(tail.get().map((l) => (l.id === id ? { ...l, ...patch } : l)));
function drop(test: (l: Line) => boolean) {
  const next = tail.get().filter((l) => !test(l));
  if (next.length < tail.get().length) tail.set(next);
}
const put = (line: Line) => tail.set([...tail.get().filter((l) => l.id !== line.id), line]);

// The bar's Suggestions (features/suggestions.feature): suggestions about blocks, and the day's
// rows. The "you stopped at" row stays above its page's title.
export const inPanel = (l: Line) => l.where === TODAY || l.block !== undefined;
export const suggestionsOn = (page?: string) => tail.get().filter((l) => l.where === page && l.block !== undefined && !l.done);
// Shown in the open panel: seen, so the count on its icon goes.
export function saw(ids: string[]) {
  const at = Date.now();
  if (tail.get().some((l) => ids.includes(l.id) && !l.seen)) tail.set(tail.get().map((l) => (ids.includes(l.id) && !l.seen ? { ...l, seen: at } : l)));
}

// The word rules.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY = new RegExp(`\\b(${WEEKDAYS.join("|")}|tomorrow)\\b`, "i");
// A verb first; a day alone is not a task.
const taskLike = (text: string) => /^(need to|call|email|ask|fix|buy|book|send|remember to)\b/i.test(text.trim());
// Words that stop before a sentence ends.
const unfinished = (text: string) => text.split(/\s+/).length >= 3 && !/[.!?…:;)"”’]$/.test(text);
const STOP = new Set("about after also and any are before but can for from has have into its just like more not now off our out over some than that the then them they this was what when will with your".split(" "));
const wordsOf = (text: string) => new Set((text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whether the words name a page, as a whole word.
const says = (text: string, p: ObjectSummary) => !!p.title.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(p.title.trim())}($|[^\\p{L}\\p{N}])`, "u").test(text);
// People, projects and books whose name is in the words as written: any of them, since Reads on
// governs words, not names.
const namesIn = (text: string, except: string) => space.get().pages.filter((p) => ["person", "project", "book"].includes(p.typeId) && p.id !== except && named(p) && says(text, p));

const DAY_MS = 86_400_000;
const midnight = (at = Date.now()) => new Date(at).setHours(0, 0, 0, 0);
const recent = (at: number) => at >= midnight() - 7 * DAY_MS;
const weekday = new Intl.DateTimeFormat("en", { weekday: "long" });
const dayOf = (at: number) => {
  const ago = Math.round((midnight() - midnight(at)) / DAY_MS);
  return ago <= 0 ? "today" : ago === 1 ? "yesterday" : weekday.format(at);
};
// The day a line names: the next one, today included.
function dayIn(text: string) {
  const word = DAY.exec(text)?.[1].toLowerCase();
  if (!word) return;
  const d = new Date();
  d.setDate(d.getDate() + (word === "tomorrow" ? 1 : (WEEKDAYS.indexOf(word) - d.getDay() + 7) % 7));
  return { word: word === "tomorrow" ? word : word[0].toUpperCase() + word.slice(1), start: isoDay(d) };
}
const first = (text: string, n: number) => {
  const w = text.split(/\s+/);
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : text;
};
// A line's words, mentions as their pages' names or left out.
const textOf = (block: EditorDoc, names = true) =>
  (block.content ?? []).map((n) => (n.type === "text" ? n.text : names && n.type === "mention" ? pageLabel(pageOf(n.attrs?.id)?.title ?? "") : " ")).join("");
const contentOf = async (id: string) => liveContent(id) ?? (await objects.get(id))?.content ?? null;
// Words as sent to the model: Markdown, mentions as their pages' titles, as Ask sends them.
const markdown = (blocks: EditorDoc[]) => docMarkdown({ type: "doc", content: blocks }, (id) => pageOf(id)?.title ?? "");
const name = (p: ObjectSummary): Part => ({ text: pageLabel(p.title), page: p.id });

// The project, of those given, whose title or page shares the most words with the text.
async function guessProject(text: string, pages: ObjectSummary[]): Promise<string | null> {
  const mine = wordsOf(text);
  let best: { id: string; n: number } | null = null;
  for (const p of pages.filter((p) => p.typeId === "project")) {
    const theirs = wordsOf(`${p.title} ${docText(await contentOf(p.id))}`);
    const n = [...mine].filter((w) => theirs.has(w)).length;
    if (n > (best?.n ?? 0)) best = { id: p.id, n };
  }
  return best?.id ?? null;
}

// For the capture box: the project an idea of three words or more seems to be for, if the model
// names one, and whether it reads as a task. One thread per opening of the box, named by when it
// opened. The Mac panel asks here too (lib/capture.ts, hostCapture).
export async function readCapture(text: string, opened: number): Promise<Guess> {
  const none = { task: false, project: null };
  const words = text.trim();
  if (!started || !normal() || words.split(/\s+/).length < 3) return none;
  const pages = space.get().pages.filter(readable);
  const projects = pages.filter((p) => p.typeId === "project");
  const captures = pages.filter((p) => p.createdAt < opened && captureOf(p)).sort((a, b) => b.createdAt - a.createdAt);
  const guess = (await guessProject(words, projects)) ?? "";
  const found: Found = { id: "capture", kind: "capture", pages: [], facts: { words: words.slice(0, 500) }, guess: { project: guess, task: taskLike(words) } };
  const {
    picks: [pick],
  } = await choose("capture", `capture:${opened}`, [found], [...projects, ...captures.slice(0, 5)]);
  return pick ? { task: !!pick.slots.task, project: pick.slots.project ?? null } : none;
}
// The capture box's ⌃↩ is a nod at its guess, a task or an idea, as a capture's place has it.
export const tookCapture = (project: string) => remember({ kind: "capture", type: "", project }, true);

// What the word rules found, as sent to the model, and the line it makes with the model's slots
// (none when a slot is wrong). The copy is docs/TAIL.md's, word for word.
type Found = Candidate & { line?: (s: Slots) => Line | undefined };
type Pick = { found: Found; slots: Slots };
type Turned = { picks: Pick[]; error?: string };
const projectOf = (p?: ObjectSummary) => Object.values(p?.properties ?? {}).flatMap((v) => (Array.isArray(v) ? v : [])).find((id) => pageOf(id)?.typeId === "project") as string | undefined;
// A line's place: its page's type and project, or for ideas the project they would go to.
function placeOf(f: Found, slots: Slots = {}): Place {
  const project = slots.project || f.guess?.project || projectOf(pageOf(f.pages[0]));
  return { kind: f.kind, type: pageOf(f.pages[0])?.typeId ?? "", ...(project && { project }) };
}
// Its pages as they are: an edit, a filing or a day set changes it.
const stateOf = (f: Found) => JSON.stringify(f.pages.map((id) => [id, pageOf(id)?.updatedAt]));
const linesOf = (picks: Pick[]) =>
  picks.flatMap((p) => {
    const line = p.found.line?.(p.slots);
    return line ? [{ ...line, slots: p.slots, pages: p.found.pages, place: placeOf(p.found, p.slots), state: stateOf(p.found) }] : [];
  });

// Today's candidates, in this order; the model shows at most three.

async function leftMidSentence(pages: ObjectSummary[]): Promise<Found | undefined> {
  const before = pages.filter((p) => listed(p) && p.title.trim() && p.updatedAt < midnight() && recent(p.updatedAt));
  for (const p of before.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)) {
    const last = docText(await contentOf(p.id)).split("\n").at(-1)!.trim();
    if (!unfinished(last)) continue;
    const when = dayOf(p.updatedAt);
    const id = `left:${p.id}`;
    return {
      id,
      kind: "left",
      pages: [p.id],
      facts: { last: last.slice(-200), when },
      line: () => ({ id, where: TODAY, words: ["You left ", name(p), ` mid-sentence ${when === "yesterday" ? when : `on ${when}`}.`], nod: "Open", act: async () => openBeside(p.id) }),
    };
  }
}

// Not yet filed, as the capture inbox has it: no project and not reviewed (DECISIONS 28).
const unfiled = (p: ObjectSummary) => p.typeId === IDEA && !captureOf(p)?.reviewedAt && !projectOf(p);

async function ideasToFile(pages: ObjectSummary[]): Promise<Found | undefined> {
  const ideas = pages.filter((p) => unfiled(p) && recent(p.createdAt)).sort((a, b) => a.createdAt - b.createdAt);
  if (ideas.length < 2) return;
  const guesses = await Promise.all(ideas.map((i) => (taskLike(i.title) ? guessProject(i.title, pages) : null)));
  const by = new Map<string, ObjectSummary[]>();
  ideas.forEach((idea, i) => {
    const g = guesses[i];
    if (g) by.set(g, [...(by.get(g) ?? []), idea]);
  });
  const top = [...by].sort((a, b) => b[1].length - a[1].length)[0];
  if (!top) return;
  const [guess, tasks] = top;
  const one = tasks.length === 1;
  const since = dayOf(ideas[0].createdAt);
  const id = `ideas:${guess}`;
  return {
    id,
    kind: "ideas",
    pages: tasks.map((t) => t.id),
    facts: { ideas: ideas.length, since },
    guess: { project: guess },
    line: ({ project }) => {
      const p = project ? pageOf(project) : undefined;
      if (!p) return;
      return {
        id,
        where: TODAY,
        // The count is a name too: it opens Captures in the bar, where the ideas wait.
        words: [{ text: `${ideas.length} ideas`, page: INBOX_VIEW }, ` since ${since}. ${one ? "1 looks like a task" : `${tasks.length} look like tasks`} for `, name(p), "."],
        nod: one ? "File it" : "File them",
        act: async (_block, context) => {
          const was = tasks.map((t) => pageOf(t.id) ?? t);
          for (const t of was) await retype(t.id, "task", ({ "idea-project": _, ...rest }) => ({ ...rest, "task-project": [p.id] }), context);
          return {
            words: [`Filed ${one ? "1 as a task" : `${tasks.length} as tasks`} in `, name(p), "."],
            undo: async () => {
              for (const t of was) await retype(t.id, t.typeId, () => t.properties);
            },
          };
        },
      };
    },
  };
}

function taskWithoutDay(pages: ObjectSummary[]): Found | undefined {
  const t = pages.filter((p) => isTask(p) && p.properties.done !== true && !p.properties.due && DAY.test(p.title)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const guess = t && dayIn(t.title);
  if (!t || !guess) return;
  // Named without its day: "Call Sam about the invoice before Friday" has no day.
  const short = pageLabel(t.title).replace(new RegExp(`\\s+((before|by|on|until|this|next)\\s+)?${DAY.source}.*$`, "i"), "");
  const id = `day:${t.id}`;
  return {
    id,
    kind: "day",
    pages: [t.id],
    guess: { day: guess.word },
    line: ({ day: word }) => {
      const day = word ? dayIn(word) : undefined;
      if (!day) return;
      return {
        id,
        where: TODAY,
        words: [{ text: short, page: t.id }, " has no day."],
        nod: `Set ${day.word}`,
        act: async (_block, context) => {
          await editPage(t.id, { properties: (props) => ({ ...props, due: { start: day.start } }) }, context);
          return { words: [`Due ${day.word}.`], undo: () => editPage(t.id, { properties: ({ due: _, ...rest }) => rest }) };
        },
      };
    },
  };
}

async function untitled(pages: ObjectSummary[]): Promise<Found | undefined> {
  const old = pages.filter((p) => listed(p) && !p.title.trim() && p.createdAt < midnight() && recent(p.createdAt));
  for (const p of old.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)) {
    const text = docText(await contentOf(p.id)).split("\n")[0].trim();
    if (!text) continue;
    const start = text.split(/\s+/).slice(0, 5).join(" ").replace(/[^\p{L}\p{N}]+$/u, "");
    const id = `untitled:${p.id}`;
    return {
      id,
      kind: "untitled",
      pages: [p.id],
      facts: { first: text.slice(0, 200), from: dayOf(p.createdAt) },
      guess: { title: start },
      line: ({ title }) =>
        title
          ? {
              id,
              where: TODAY,
              words: [`An untitled page from ${dayOf(p.createdAt)} starts "`, { text: text.split(/\s+/).length > 5 ? `${start}…` : start, page: p.id }, '".'],
              nod: "Name it",
              act: async (_block, context) => {
                await editPage(p.id, { title }, context);
                return { words: ["Named ", { text: title, page: p.id }, "."], undo: () => editPage(p.id, { title: "" }) };
              },
            }
          : undefined,
    };
  }
}

// Tail's threads (lib/tail-prompt.ts), kept on this Mac, and the wordings sent from each page,
// which outlive its thread so that none goes twice.
type Memory = { last: number; threads: Record<string, Thread>; sent: Record<string, string[]> };
const KEPT = "ll.tail.threads";
const memory: Memory = (() => {
  try {
    return { last: 0, threads: {}, sent: {}, ...JSON.parse(localStorage.getItem(KEPT) ?? "{}") };
  } catch {
    return { last: 0, threads: {}, sent: {} };
  }
})();
function save() {
  try {
    localStorage.setItem(KEPT, JSON.stringify(memory));
  } catch {
    // Lost, the next turn sends everything again.
  }
}
function keep(key: string, t: Thread) {
  memory.threads = Object.fromEntries(Object.entries({ ...memory.threads, [key]: t }).filter(([k, x]) => current(k, x, Date.now())));
  save();
}
function sent(page: string, fp: string) {
  memory.sent = { ...memory.sent, [page]: [...(memory.sent[page] ?? []), fp].slice(-500) };
  save();
}

// The nod ledger (docs/TAIL.md, "What it remembers"): what was taken and ignored, by kind and
// place, for thirty days, on this Mac, and Today's rows seen. Its effect shows as sentences on the
// page about you.
const ledger = localPrefs<{ v?: number; entries: Entry[]; shown: Record<string, Shown> }>("ll.tail.ledger", { entries: [], shown: {} });

// The page about how you work: one per space, of the app's own type, found by its id.
const aboutPage = () => space.get().pages.find((p) => p.typeId === ABOUT);
let making: Promise<string> | undefined;
const aboutId = async () => aboutPage()?.id ?? (making ??= createPage({ typeId: ABOUT, title: "How you work" }, action("Created Tail memory", { kind: "agent", name: "Tail" })).then((p) => p.id).finally(() => (making = undefined)));
export const openAbout = async () => openPage(await aboutId());
const aboutLines = async () => {
  const p = aboutPage();
  return p ? docText(await contentOf(p.id)).split("\n").filter(Boolean) : [];
};
const textIn = (b: EditorDoc) => docText({ type: "doc", content: [b] });
// A dated sentence added, unless the page says it already, or those matching gone; through
// editPage, so an open pane follows. The oldest go past forty. One at a time, so none is lost.
let writing = Promise.resolve();
function rewrite(add?: string, gone: (sentence: string) => boolean = () => false) {
  const content = (doc: EditorDoc): EditorDoc => {
    const kept = (doc.content ?? []).filter((b) => textIn(b).trim() && !gone(sentenceOf(textIn(b))));
    if (add && kept.some((b) => sentenceOf(textIn(b)) === add)) return doc;
    const line = add ? [{ type: "paragraph", content: [{ type: "text", text: dated(isoDay(new Date()), add) }] }] : [];
    return { ...doc, content: [...kept, ...line].slice(-MAX_LINES) };
  };
  writing = writing.then(async () => editPage(await aboutId(), { content: (doc) => stampDoc(content(doc), { kind: "agent", name: "Tail" })! }, action("Updated Tail memory", { kind: "agent", name: "Tail" }))).catch(console.error);
  return writing;
}
// A place as its quiet sentence names it.
const spoken = (p: Place) => [p.kind, typeOf(p.type).name, p.project ? pageLabel(pageOf(p.project)?.title ?? "") : undefined] as const;

// A line taken or let go, and what the ledger can now say: a kind quiet there, or lifted by a nod,
// or a habit such as where ideas go.
function remember(place: Place | undefined, took: boolean) {
  if (!place || mode() === "off") return;
  const entry = { ...place, took, at: Date.now() };
  const { entries, change } = record(ledger.get().entries, entry);
  ledger.set({ entries });
  const quiet = quietLine(...spoken(place));
  if (change === "quiet") void rewrite(quiet);
  if (change === "lift") void rewrite(undefined, (s) => s === quiet);
  const fact = factOf(entries, entry, (id) => pageLabel(pageOf(id)?.title ?? ""));
  if (fact) void rewrite(fact);
}
// A page's lines after an edit, or once it is left (lib/tail-memory.ts, edited).
function settle(page: string, texts?: string[]) {
  const { gone, ignored, moved } = edited(tail.get(), page, texts);
  for (const l of ignored) remember(l.place, false);
  for (const l of ignored) if (l.block !== undefined) update(l.id, { ignored: true });
  for (const [l, block] of moved) update(l.id, { block });
  drop((l) => gone.some((g) => g.id === l.id));
}

// A tail turn: the model picks which of what the app found to show, in order, and fills the
// slots; the app writes each line. A failed, empty or wrong answer is silence, and says why. One
// turn per thread at a time, so two never resume the same session.
const lanes = new Map<string, Promise<unknown>>();
function choose(trigger: Trigger, key: string, found: Found[], pages: ObjectSummary[], since = 0): Promise<Turned> {
  const run = (lanes.get(key) ?? Promise.resolve()).then(() => turnOn(trigger, key, found, pages, since));
  lanes.set(key, run.catch(() => {}));
  return run;
}
async function turnOn(trigger: Trigger, key: string, all: Found[], pages: ObjectSummary[], since: number): Promise<Turned> {
  const { model, effort: chosen } = tailPrefs();
  // A suggestion's or the box's choice is small, so it runs at low whatever the setting.
  const effort = trigger === "pause" || trigger === "capture" ? "low" : chosen;
  const started = Date.now();
  // The page about you, read at the start of every turn. A kind quiet there spends no turn.
  const about = await aboutLines();
  const found = all.filter((f) => !isQuiet(about, ...spoken(placeOf(f))));
  if (!found.length) return { picks: [] };
  // A capture's guess stays small and quick: only the lines that name a project, ten at most.
  const told = trigger === "capture" ? about.filter((l) => pages.some((p) => p.typeId === "project" && says(sentenceOf(l), p))).slice(-10) : about;
  const turn = async (t: Thread) => {
    const text = async (id: string) => markdown((await contentOf(id))?.content ?? []);
    const d = await buildDigest({ trigger, now: started, pages, readsOn, typeName: (id) => typeOf(id).name, since, seen: t.seen, index: t.index, text, candidates: found, about: told, ledger: counts(ledger.get().entries) });
    return { ...d, ...(await tailTurn({ prompt: d.message, system: TAIL, model, effort, resume: t.session })) };
  };
  let thread = threadFor(memory.threads, key, model, started, trigger === "beat");
  let got = await turn(thread);
  // A thread the tool no longer has: once more on a new one, sent everything again.
  if (got.error && thread.session) got = await turn((thread = { model, seen: {}, at: Date.now() }));
  if (got.error) return { picks: [], error: got.error };
  if (trigger === "beat") memory.last = started;
  keep(key, { ...thread, session: got.session, seen: got.seen, index: got.index });
  if (!answerOf(got.text)) return { picks: [], error: "the answer wasn't JSON" };
  const note = trigger === "beat" && noteIn(got.text);
  if (note) void rewrite(note);
  const picks = parseAnswer(got.text, { refs: got.refs, candidates: found, max: trigger === "beat" ? 3 : 1, isProject: (id) => pageOf(id)?.typeId === "project" });
  return { picks: picks.flatMap((c) => found.filter((f) => f.id === c.id).map((f) => ({ found: f, slots: c.slots }))) };
}

// Today's lines are made again from the records: what is no longer true goes, nothing piles up.
// A quiet beat never redraws Today in front of the person: it waits for them to look away. One
// beat at a time, so two turns never share a thread; one asked for meanwhile runs after.
let beats = 0;
let waiting: { at: number; picks: Pick[] } | null = null;
// When the person last nodded or undid: a beat held from before then is out of date.
let nodded = 0;
let queue = Promise.resolve();
let queued: boolean | null = null;
const onToday = () => document.hasFocus() && focusedPage() === dayShown(today());
const todayShown = () => {
  const root = panes.get().root;
  return !!root && leaves(root).some((l) => l.page === dayShown(today()));
};
// What the records find for Today, less the rows that stay out (seenOn). The rest are forgotten,
// their sentence with them, once their pages change or the records no longer find them.
async function todayFinds(pages: ObjectSummary[]) {
  const found = (await Promise.all([leftMidSentence(pages), ideasToFile(pages), taskWithoutDay(pages), untitled(pages)])).filter((x) => x !== undefined);
  await writing;
  const about = await aboutLines();
  const { shown } = ledger.get();
  const kept: Record<string, Shown> = {};
  for (const f of found) {
    const s = shown[f.id];
    if (s?.state === stateOf(f) && (!s.said || isOut(s, s.state, about))) kept[f.id] = s;
  }
  for (const [id, s] of Object.entries(shown)) if (s.said && !kept[id]) void rewrite(undefined, (x) => x === s.said);
  ledger.set({ shown: kept });
  return found.filter((f) => !isOut(kept[f.id], stateOf(f), about));
}
export function beat(quiet = false): Promise<void> {
  if (queued !== null) {
    queued &&= quiet;
    return queue;
  }
  queued = quiet;
  return (queue = queue.then(() => {
    const q = queued!;
    queued = null;
    return beatNow(q).catch(console.error);
  }));
}
async function beatNow(quiet: boolean) {
  if (mode() === "off") return;
  const at = ++beats;
  const started = Date.now();
  const found = await todayFinds(space.get().pages.filter(readable));
  // Bodies changed since the last beat, or since yesterday began when there was none.
  const { picks, error }: Turned = found.length ? await choose("beat", `beat:${isoDay(new Date())}`, found, space.get().pages, memory.last || midnight() - DAY_MS) : { picks: [] };
  if (at !== beats) return;
  lastBeat.set({ at: started, lines: linesOf(picks).length, ...(error && { error }) });
  waiting = null;
  if (quiet && onToday()) waiting = { at: started, picks };
  else showToday(linesOf(picks));
}
// A held beat shows once, never after a nod, and only what the records still find.
async function showWaiting() {
  const held = waiting;
  waiting = null;
  if (!held || nodded > held.at) return;
  const at = beats;
  const now = await todayFinds(space.get().pages.filter(readable));
  if (at === beats) showToday(linesOf(stillTrue(held.picks, now)));
}
function showToday(found: Line[]) {
  // A done row keeps its moment, where it was; once its Undo has gone, the beat takes it away.
  const shown = tail.get().filter((l) => l.where === TODAY);
  // A row the person saw that this beat doesn't show again was ignored, unless only it stays out.
  for (const s of shown) if (s.seen && !s.done && !found.some((l) => l.id === s.id) && !ledger.get().shown[s.id]?.said) remember(s.place, false);
  const next: Line[] = found.filter((l) => !shown.some((s) => s.id === l.id && s.done?.undo)).map((l) => ({ ...l, seen: shown.find((s) => s.id === l.id)?.seen }));
  shown.forEach((s, i) => s.done?.undo && next.splice(i, 0, s));
  tail.set([...tail.get().filter((l) => l.where !== TODAY), ...next.slice(0, 3)]);
  sawToday();
}
// Today's rows count as seen once Today is open in a pane, and the day each was seen is kept: one
// seen again on a later day is said to be out.
function sawToday() {
  if (!todayShown()) return;
  const { shown } = ledger.get();
  let next = shown;
  saw(tail.get().filter((l) => l.where === TODAY).map((l) => l.id));
  for (const l of tail.get()) {
    if (l.where !== TODAY || l.done || !l.state) continue;
    const called = l.words.find((w) => typeof w !== "string")?.text ?? "";
    const s = seenOn(shown[l.id], isoDay(new Date()), l.state, called);
    if (s === shown[l.id]) continue;
    next = { ...next, [l.id]: s };
    if (s.said && !shown[l.id]?.said) void rewrite(s.said);
  }
  if (next !== shown) ledger.set({ shown: next });
}

// A suggestion about a finished block: one that reads as a task, or names a page.

function asTask(page: string, index: number, blocks: EditorDoc[]): Found | undefined {
  const block = blocks[index];
  const text = textOf(block).trim();
  if (!taskLike(text)) return;
  const words = text.replace(/^(need to|remember to)\s+/i, "").replace(/[.!?…]+$/, "");
  const title = words[0].toUpperCase() + words.slice(1);
  const named = namesIn(title, page);
  const guess = dayIn(text);
  return {
    id: `task:${page}`,
    kind: "task",
    pages: [page, ...named.map((p) => p.id)],
    // The line and a few blocks around it, never the page's body.
    facts: { line: markdown([block]).slice(0, 500), around: markdown(blocks.slice(Math.max(0, index - 2), index + 2)).slice(0, 1500) },
    ...(guess && { guess: { day: guess.word } }),
    line: ({ day: word }) => {
      const day = word ? dayIn(word) : undefined;
      return {
        id: `offer:${page}:${fingerprint(text)}`,
        where: page,
        block: index,
        words: ["Make this a task?"],
        row: ['Make "', { text: first(text, 5), page }, '" a task?'],
        nod: "Make task",
        act: async (i = index, given) => {
          const context = given ?? action("Made task", { kind: "agent", name: "Tail" });
          await flushAll();
          const before = await objects.get(page);
          if (!before) throw new Error("Save the page before making a task.");
          if (textOf(before.content?.content?.[i] ?? {}, false) !== text) throw new Error("This line changed. Ask Tail again before making it a task.");
          // The task's body names the same pages, linked.
          const body = named.reduce((b, p) => linkFirst(b, p.title.trim(), p.id), { type: "paragraph", content: [{ type: "text", text: title }] } as EditorDoc);
          const task = newObject(await pageInit("task", { title, content: stampDoc({ type: "doc", content: [body] }, context.author), properties: day ? { due: { start: day.start } } : {} }));
          const content = { ...before.content, type: "doc", content: [...(before.content?.content ?? [])] };
          content.content.splice(i, 1, { type: "pageLink", attrs: { id: task.id } });
          await commitAction([{ before: null, after: task }, { before, after: { ...before, content } }], context);
          return {
            words: [day ? `Made a task, due ${day.word}.` : "Made a task."],
            undo: () => undoAction(context.action),
          };
        },
      };
    },
  };
}

function mention(page: string, index: number, blocks: EditorDoc[]): Found | undefined {
  const block = blocks[index];
  const linked = new Set((block.content ?? []).filter((n) => n.type === "mention").map((n) => n.attrs?.id));
  const p = namesIn(textOf(block, false), page).find((p) => !linked.has(p.id));
  if (!p) return;
  return {
    id: `mention:${page}`,
    kind: "mention",
    pages: [page, p.id],
    facts: { line: markdown([block]).slice(0, 500), name: p.title.trim() },
    line: () => ({
      id: `offer:${page}:${fingerprint(textOf(block))}`,
      where: page,
      block: index,
      words: [name(p), " has a page."],
      row: [name(p), ' has a page: "', { text: first(textOf(block).trim(), 4), page }, '".'],
      nod: "Link",
      act: async (i = index, context = action("Linked page", { kind: "agent", name: "Tail" })) => {
        authored(context, () => liveEditor(page)?.setBlock(i, linkFirst(liveEditor(page)?.getJSON().content?.[i] ?? block, p.title.trim(), p.id)));
        // Back to the name's words, keeping any typed on the line since.
        const unlink = (b: EditorDoc) => ({ ...b, content: b.content?.map((n) => (n.type === "mention" && n.attrs?.id === p.id ?{ type: "text", text: p.title.trim() } : n)) });
        return { words: ["Linked."], undo: async () => liveEditor(page)?.setBlock(i, unlink(liveEditor(page)?.getJSON().content?.[i] ?? block)) };
      },
    }),
  };
}

// A finished block, sent once per wording, one turn per page at a time (lib/tail-read.ts), on the
// page's thread. The word rules say whether it is worth a turn; the model picks, or stays silent.
const readers = new Map<string, (fp: string) => void>();
function read(page: string, index: number) {
  const block = liveEditor(page)?.blockAt(index);
  const fp = block?.type === "paragraph" ? fingerprint(textOf(block)) : "";
  if (!fp || !normal() || !readable(pageOf(page))) return;
  if (!readers.has(page)) readers.set(page, reader({ sent: (f) => !!memory.sent[page]?.includes(f), go: (f) => suggest(page, f) }));
  readers.get(page)!(fp);
}
async function suggest(page: string, fp: string) {
  const blocks = (await contentOf(page))?.content ?? [];
  const texts = blocks.map((b) => textOf(b));
  // Changed or gone while it waited: not new any more.
  const index = blocks.findIndex((b, i) => b.type === "paragraph" && fingerprint(texts[i]) === fp);
  const found = index < 0 || !normal() ? [] : [asTask(page, index, blocks), mention(page, index, blocks)].filter((f) => f !== undefined);
  if (!found.length) return;
  sent(page, fp);
  // The page written on, even while it is a draft not yet stored (a new day's note).
  const { pages } = space.get();
  const [line] = linesOf((await choose("pause", `page:${page}`, found, pages.some((p) => p.id === page) ? pages : [...pages, pageOf(page)!])).picks);
  // Where its block is now, unless its words changed while the model thought.
  const at = line ? lineAt(((await contentOf(page))?.content ?? []).map((b) => textOf(b)), texts[index], index) : -1;
  if (line && at >= 0 && normal()) put({ ...line, block: at, text: texts[index], at: Date.now() });
}

// Suggestions stay until nodded or their words change, so they are kept on this Mac and made again
// from their pages at the next start; the daily card counts yesterday's.
type Kept = Omit<Line, "words" | "row" | "nod" | "act" | "pages" | "done" | "state">;
export const kept = localPrefs<{ offers: Kept[] }>("ll.tail.offers", { offers: [] });
let revived = false;
async function revive() {
  if (revived) return;
  revived = true;
  const lines: Line[] = [];
  for (const k of kept.get().offers.filter((k) => readable(pageOf(k.where)))) {
    const blocks = (await contentOf(k.where))?.content ?? [];
    const index = lineAt(blocks.map((b) => textOf(b)), k.text, k.block ?? 0);
    const found = index < 0 ? undefined : (k.place?.kind === "task" ? asTask : mention)(k.where, index, blocks);
    const line = found?.line?.(k.slots ?? {});
    if (line && found) lines.push({ ...line, ...k, block: index, pages: found.pages });
  }
  tail.set([...tail.get(), ...lines.filter((l) => !tail.get().some((x) => x.id === l.id))]);
  tail.subscribe(() => {
    const offers = tail.get().flatMap(({ id, where, block, text, at, slots, place, seen, ignored, done }) => (block === undefined || done ? [] : [{ id, where, block, text, at, slots, place, seen, ignored }]));
    if (JSON.stringify(offers) !== JSON.stringify(kept.get().offers)) kept.set({ offers });
  });
}

// Back on a page after a while: where you stopped, when that was mid-sentence, if the model,
// sent the page, thinks it worth saying.
type Visit = { at: number; block?: number };
const seen = new Map<string, Visit>();
const asking = new Set<string>();
async function comeBack(page: string, doc: EditorDoc) {
  const was = seen.get(page);
  if (mode() === "off" || asking.has(page) || !readable(pageOf(page)) || Date.now() - (was?.at ?? pageOf(page)?.updatedAt ?? Date.now()) < ms("away")) return;
  const blocks = doc.content ?? [];
  const lineOf = (b?: EditorDoc) => (b ? docText({ type: "doc", content: [b] }).split("\n").at(-1)!.trim() : "");
  // The block, not its words, which an earlier paragraph may share.
  const at = was?.block ?? blocks.reduce((k, b, i) => (lineOf(b) ? i : k), -1);
  const text = lineOf(blocks[at]);
  if (!unfinished(text)) return;
  const quote = text.split(/\s+/).slice(-4).join(" ");
  const id = `stopped:${page}`;
  const found: Found = { id, kind: "stopped", pages: [page], facts: { line: text.slice(-200), quote }, line: () => ({ id, where: page, words: ['You stopped at "', { text: quote, page }, '".'], nod: "Show", act: async () => liveEditor(page)?.reveal(`b${at + 1}`) }) };
  asking.add(page);
  const lines = linesOf((await choose("page", `page:${page}`, [found], [pageOf(page)!]).finally(() => asking.delete(page))).picks);
  // An edit, or the page left, while the model thought: the moment has passed.
  if (seen.get(page) === was && isLive(page)) lines.forEach(put);
}

// While a page is open. An edit takes "you stopped at" away, and a suggestion once its block's
// words change; a finished block is read. Leaving takes the first; suggestions stay, for Elsewhere.
const pauses = new Map<string, ReturnType<typeof setTimeout>>();
const closing = new Map<string, ReturnType<typeof setTimeout>>();
// The block each page's last edit was in, so an Enter at a block's end is known.
const edits = new Map<string, number>();
export function follow(page: string) {
  // Mounted again at once (React's second mount in dev): it never left.
  const back = closing.has(page);
  clearTimeout(closing.get(page));
  closing.delete(page);
  if (!back) whenLive(page, (live) => void comeBack(page, live.content()));
  const off = watchLive(page, () => {
    if (mode() === "off" || acting) return;
    const ed = liveEditor(page);
    const at = ed?.cursorBlock() ?? -1;
    // Every block's words are read only while a suggestion stands, since that costs on a long page.
    const offers = suggestionsOn(page).length > 0;
    settle(page, offers ? (ed?.getJSON().content ?? []).map((b) => textOf(b)) : []);
    seen.set(page, { at: Date.now(), block: at });
    clearTimeout(pauses.get(page));
    const was = edits.get(page);
    edits.set(page, at);
    const block = ed?.blockAt(at);
    const { stop, quiet } = readAfter();
    const next = normal() && block ? nextRead(was, at, textOf(block), !block.content?.length, { stop: stop * 1000, quiet: quiet * 1000 }) : null;
    // An Enter's read goes now: the next key would clear a timer before it fired.
    if (next) next.wait ? pauses.set(page, setTimeout(() => read(page, next.block), next.wait)) : read(page, next.block);
  });
  return () => {
    off();
    clearTimeout(pauses.get(page));
    closing.set(
      page,
      setTimeout(() => {
        closing.delete(page);
        edits.delete(page);
        seen.set(page, { ...seen.get(page), at: Date.now() });
        settle(page);
      }),
    );
  };
}

export async function nod(line: Line) {
  if (line.done || acting) return;
  // A suggestion about a page not open: it opens beside, and the nod acts there once it has drawn.
  if (line.block !== undefined && !isLive(line.where)) {
    openBeside(line.where);
    await new Promise<void>((r) => whenLive(line.where, () => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  acting = true;
  let done: Done | void;
  const context = action(line.nod, { kind: "agent", name: "Tail" });
  try {
    await flushAll();
    done = await line.act(tail.get().find((l) => l.id === line.id)?.block ?? line.block, context);
    await flushAll();
    if (done && (await objects.history()).some((e) => e.action === context.action)) done.undo = () => undoAction(context.action);
  } finally {
    acting = false;
  }
  nodded = Date.now();
  // A nod on Today starts its days seen again.
  const { [line.id]: _, ...shown } = ledger.get().shown;
  ledger.set({ shown });
  if (!done) return;
  const { words } = done;
  update(line.id, { done });
  // Taken once Undo has gone. A suggestion just leaves; a row on Today keeps its words, so the
  // rows under it stay.
  later(line.id, ms("done"), () => {
    remember(line.place, true);
    if (line.where === TODAY && todayShown()) update(line.id, { done: { words } });
    else drop((l) => l.id === line.id);
  });
}

// The line reads as it first did.
export async function undo(line: Line) {
  if (!line.done?.undo || acting) return;
  clearTimeout(timers.get(line.id));
  acting = true;
  try {
    await line.done.undo();
  } finally {
    acting = false;
  }
  nodded = Date.now();
  if (line.where === TODAY) return update(line.id, { done: undefined });
  // An undone suggestion is a no for its block until its words change, as they were sent.
  drop((l) => l.id === line.id);
}

// ⌃↩: the first suggestion or row on the page in front, or on Today its first row.
export function nodFront() {
  const page = focusedPage();
  const open = tail.get().filter((l) => !l.done);
  const line = open.find((l) => l.where === page) ?? (page && page === dayShown(today()) ? open.find((l) => l.where === TODAY) : undefined);
  if (line) void nod(line);
}

// A beat at app open, then every while, and when the window comes back after being away.
let started = false;
export async function startTail() {
  await isNative;
  // An older ledger's ignores go, and the quiet sentences they set with them.
  const old = ledger.get();
  if (upgraded(old) !== old) {
    ledger.set(upgraded(old));
    if (aboutPage()) void rewrite(undefined, quietForm);
  }
  if (mode() === "off" || started) return;
  started = true;
  if (normal()) void revive();
  void beat();
  setInterval(() => void beat(true), ms("beat"));
  let away = 0;
  window.addEventListener("blur", () => (away = Date.now()));
  // A waiting beat shows as the window comes back, or once Today is no longer in front.
  window.addEventListener("focus", () => {
    void showWaiting();
    if (away && Date.now() - away >= ms("away")) void beat(true);
    away = 0;
  });
  panes.subscribe(() => {
    sawToday();
    // Leaving Today takes a done row's words away.
    if (!todayShown()) drop((l) => l.where === TODAY && !!l.done && !l.done.undo);
    if (!onToday()) void showWaiting();
  });
}

// A change in Settings takes effect at once: Off takes every line away, Quiet the suggestions, and
// on again tail starts or beats.
let was = mode();
onAiPrefs(() => {
  const now = mode();
  if (now === was) return;
  was = now;
  if (now === "off") drop(() => true);
  if (now === "quiet") drop((l) => l.block !== undefined);
  if (now === "normal" && started) void revive();
  if (now !== "off") void (started ? beat() : startTail());
});

// The pages the scenes use (features/tail.feature, "seeded"), dated as they say.
const doc = (...lines: string[]): EditorDoc => ({ type: "doc", content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
// The last such weekday before today, at noon.
function lastDay(day: string) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (((d.getDay() - WEEKDAYS.indexOf(day) + 6) % 7) + 1));
  return d.getTime();
}
async function seed() {
  if (space.get().pages.some((p) => p.title === "Garden plan")) return;
  const at = (when: number) => ({ createdAt: when, updatedAt: when });
  const old = at(Date.now() - 6 * DAY_MS);
  const tag = await ensureTag(TAG);
  await createPage({ typeId: "project", title: "Garden", content: doc("The back beds, the gate and the shed. Sam sends the invoice for the soil."), ...old });
  await createPage({ typeId: "person", title: "Sam", ...old });
  await createPage({
    title: "Garden plan",
    content: doc("The beans go along the south fence this year, where the wind is kinder.", "Compost first, then the stakes, two rows a foot apart.", "Before they go in, ask Sam whether the"),
    ...old,
    updatedAt: midnight() - DAY_MS / 2,
  });
  const ideas = [["fix the gate latch before the weekend", "tuesday"], ["ask Sam about the invoice", "wednesday"], ["a book about soil microbes", "thursday"]];
  for (const [title, day] of ideas) await createPage({ typeId: IDEA, title, properties: { tags: [tag] }, ...at(lastDay(day)) });
  await createPage({ typeId: "task", title: "Call Sam about the invoice before Friday", ...old });
  await createPage({ content: doc("Soil for the back bed: two bags of compost and one of grit."), ...at(lastDay("friday")) });
  await beat();
}

// Starts over: no lines, no threads, an empty log and ledger, and none of tail's own sentences.
function reset() {
  for (const t of [...timers.values(), ...pauses.values()]) clearTimeout(t);
  seen.clear();
  readers.clear();
  edits.clear();
  waiting = null;
  beats++;
  Object.assign(memory, { last: 0, threads: {}, sent: {} });
  localStorage.removeItem(KEPT);
  ledger.set({ entries: [], shown: {} });
  lastBeat.set(null);
  if (aboutPage()) void rewrite(undefined, appLine);
  log.length = 0;
  tail.set([]);
  kept.set({ offers: [] });
}

// The stand-in (lib/agent-standin.ts) adds each tail turn's message and answer to log.
const log: object[] = [];
if (import.meta.env.DEV) (window as unknown as { __tail: unknown }).__tail = { seed, beat, reset, log };
