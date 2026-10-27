import type { EditorDoc } from "@leadinglight/editor/editor";
import { tailPrefs } from "./ai-prefs";
import type { Seen } from "./ask-prompt";
import { isTask } from "./assign";
import { ensureTag, IDEA, TAG } from "./capture";
import { captureOf } from "./capture-inbox";
import { dayShown, today } from "./daily";
import { linkFirst } from "./doc-links";
import { isoDay } from "./format";
import { pageLabel } from "./labels";
import { editPage, isLive, liveContent, liveEditor, watchLive, whenLive } from "./live";
import { docText, type ObjectSummary, objects } from "./objects";
import { docMarkdown } from "./page-markdown";
import { focusedPage, leaves, openBeside, panes } from "./panes";
import { isNative } from "./platform";
import { createPage, INBOX_VIEW, listed, pageOf, removePage, retype, space, typeOf } from "./space";
import { createStore } from "./state";
import { buildDigest, type Candidate, mayRead, parseAnswer, type Slots, stillTrue, TAIL, type Trigger } from "./tail-prompt";
import { newPage } from "./templates";
import { tailTurn } from "./turn";
import { suggested } from "./writing";

// Tail (docs/TAIL.md, features/tail.feature): reads along and offers one line to nod at. Word
// rules find what might be worth a line; a tail turn picks, or stays silent. Nothing it shows is
// stored; nods go through an open editor, a new page or a property, and each can be undone.

// Design values in the browser build, the real ones in the Mac app (docs/TAIL.md, Timing).
const TIMES = {
  pause: [3_000, 20_000],
  away: [10_000, 15 * 60_000],
  beat: [2 * 60_000, 30 * 60_000],
  chip: [60_000, 10 * 60_000],
  done: [8_000, 8_000],
};
let browser = false;
void isNative.then((native) => (browser = !native));
const ms = (k: keyof typeof TIMES) => TIMES[k][browser ? 0 : 1];

// Words, and names or quoted words shown in the foreground that open their page.
export type Part = string | { text: string; page: string };
// undo: gone after its moment, when a row on Today keeps only its words.
type Done = { words: Part[]; undo?: () => Promise<unknown> };
export type Line = {
  id: string;
  // TODAY, or the page whose row or chip it is.
  where: string;
  words: Part[];
  // A chip's words when the margin has no room and it shows as a row, quoting the line.
  row?: Part[];
  nod: string;
  act: () => Promise<Done | void>;
  // A chip: the top-level block it sits beside.
  block?: number;
  done?: Done;
};
export const TODAY = "today";
export const tail = createStore<Line[]>([]);

// Off, Quiet or Normal (ll.ai's tail). Quiet keeps the chip and the capture guess off.
const mode = () => tailPrefs().mode;
const chips = () => mode() === "normal";
// Reads on, else Writing's Use on; tasks too, since the beat reads open tasks (docs/TAIL.md).
const readsOn = (typeId: string) => tailPrefs().readsOn[typeId] ?? (suggested(typeId) || typeId === "task");
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
// One line per page at a time.
const put = (line: Line) => tail.set([...tail.get().filter((l) => l.where !== line.where), line]);

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
// People, projects and books tail may read whose name is in the words as written.
const namesIn = (text: string, except: string) =>
  space.get().pages.filter((p) => ["person", "project", "book"].includes(p.typeId) && p.id !== except && p.title.trim() && readable(p) && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(p.title.trim())}($|[^\\p{L}\\p{N}])`, "u").test(text));

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

// For the capture box: whether its words read as a task, and the project they seem to be for,
// if the model agrees. One thread per opening of the box, named by when it opened. Not in the
// Mac panel yet, which never starts tail.
export async function readCapture(text: string, opened: number): Promise<{ task: boolean; project: string | null }> {
  const none = { task: false, project: null };
  const words = text.trim();
  if (!started || !chips() || !taskLike(words)) return none;
  const pages = space.get().pages.filter(readable);
  const projects = pages.filter((p) => p.typeId === "project");
  const captures = pages.filter((p) => p.createdAt < opened && captureOf(p)).sort((a, b) => b.createdAt - a.createdAt);
  const guess = (await guessProject(words, projects)) ?? "";
  const found: Found = { id: "capture", kind: "capture", pages: [], facts: { words: words.slice(0, 500) }, guess: { project: guess } };
  const [pick] = await choose("capture", `capture:${opened}`, [found], [...projects, ...captures.slice(0, 5)]);
  return pick ? { task: true, project: pick.slots.project ?? null } : none;
}

// What the word rules found, as sent to the model, and the line it makes with the model's slots
// (none when a slot is wrong). The copy is docs/TAIL.md's, word for word.
type Found = Candidate & { line?: (s: Slots) => Line | undefined };
type Pick = { found: Found; slots: Slots };
const linesOf = (picks: Pick[]) => picks.map((p) => p.found.line?.(p.slots)).filter((l) => l !== undefined);

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
const unfiled = (p: ObjectSummary) =>
  p.typeId === IDEA && !captureOf(p)?.reviewedAt && !Object.values(p.properties).some((v) => Array.isArray(v) && v.some((id) => pageOf(id)?.typeId === "project"));

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
        // The count is a name too: it opens the capture inbox, where the ideas wait.
        words: [{ text: `${ideas.length} ideas`, page: INBOX_VIEW }, ` since ${since}. ${one ? "1 looks like a task" : `${tasks.length} look like tasks`} for `, name(p), "."],
        nod: one ? "File it" : "File them",
        act: async () => {
          const was = tasks.map((t) => pageOf(t.id) ?? t);
          for (const t of was) await retype(t.id, "task", ({ "idea-project": _, ...rest }) => ({ ...rest, "task-project": [p.id] }));
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
        act: async () => {
          await editPage(t.id, { properties: (props) => ({ ...props, due: { start: day.start } }) });
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
              act: async () => {
                await editPage(p.id, { title });
                return { words: ["Named ", { text: title, page: p.id }, "."], undo: () => editPage(p.id, { title: "" }) };
              },
            }
          : undefined,
    };
  }
}

// Tail's threads (docs/TAIL.md, "What it remembers"): the day's for the beat, a page's for four
// hours, a capture box's for ten minutes. Each keeps its session and what it was sent, as ids
// and times, never words.
type Thread = { model: string; session?: string; seen: Seen; at: number };
type Memory = { last: number; threads: Record<string, Thread> };
const KEPT = "ll.tail.threads";
const memory: Memory = (() => {
  try {
    return { last: 0, threads: {}, ...JSON.parse(localStorage.getItem(KEPT) ?? "{}") };
  } catch {
    return { last: 0, threads: {} };
  }
})();
const current = (key: string, t: Thread) => (key.startsWith("beat:") ? key === `beat:${isoDay(new Date())}` : Date.now() - t.at < (key.startsWith("capture:") ? 10 * 60_000 : 4 * 3_600_000));
const threadFor = (key: string, model: string): Thread => {
  const t = memory.threads[key];
  return t?.model === model && current(key, t) ? t : { model, seen: {}, at: Date.now() };
};
function keep(key: string, t: Thread) {
  memory.threads = Object.fromEntries(Object.entries({ ...memory.threads, [key]: t }).filter(([k, x]) => current(k, x)));
  try {
    localStorage.setItem(KEPT, JSON.stringify(memory));
  } catch {
    // Lost, the next turn sends everything again.
  }
}

// A tail turn: the model picks which of what the app found to show, in order, and fills the
// slots; the app writes each line. A failed, empty or wrong answer is silence. One turn per
// thread at a time, so two never resume the same session.
const lanes = new Map<string, Promise<unknown>>();
function choose(trigger: Trigger, key: string, found: Found[], pages: ObjectSummary[], since = 0): Promise<Pick[]> {
  const run = (lanes.get(key) ?? Promise.resolve()).then(() => turnOn(trigger, key, found, pages, since));
  lanes.set(key, run.catch(() => {}));
  return run;
}
async function turnOn(trigger: Trigger, key: string, found: Found[], pages: ObjectSummary[], since: number): Promise<Pick[]> {
  const { model, effort } = tailPrefs();
  const started = Date.now();
  const turn = async (t: Thread) => {
    const text = async (id: string) => markdown((await contentOf(id))?.content ?? []);
    const d = await buildDigest({ trigger, now: started, pages, readsOn, typeName: (id) => typeOf(id).name, since, seen: t.seen, text, candidates: found });
    const got = await tailTurn({ prompt: d.message, system: TAIL, model, effort, resume: t.session });
    return got && { ...d, ...got };
  };
  let thread = threadFor(key, model);
  let got = await turn(thread);
  // A thread the tool no longer has: once more on a new one, sent everything again.
  if (!got && thread.session) got = await turn((thread = { model, seen: {}, at: Date.now() }));
  if (!got) return [];
  if (trigger === "beat") memory.last = started;
  keep(key, { ...thread, session: got.session, seen: got.seen });
  const picks = parseAnswer(got.text, { refs: got.refs, candidates: found, max: trigger === "beat" ? 3 : 1, isProject: (id) => pageOf(id)?.typeId === "project" });
  return picks.flatMap((c) => found.filter((f) => f.id === c.id).map((f) => ({ found: f, slots: c.slots })));
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
const todayFinds = (pages: ObjectSummary[]) => Promise.all([leftMidSentence(pages), ideasToFile(pages), taskWithoutDay(pages), untitled(pages)]).then((f) => f.filter((x) => x !== undefined));
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
  const picks = found.length ? await choose("beat", `beat:${isoDay(new Date())}`, found, space.get().pages, memory.last || midnight() - DAY_MS) : [];
  if (at !== beats) return;
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
  const next = found.filter((l) => !shown.some((s) => s.id === l.id && s.done?.undo));
  shown.forEach((s, i) => s.done?.undo && next.splice(i, 0, s));
  tail.set([...tail.get().filter((l) => l.where !== TODAY), ...next.slice(0, 3)]);
}

// The chip, after a pause in typing: for a line that reads as a task, or names a page.

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
        id: `chip:${page}`,
        where: page,
        block: index,
        words: ["Make this a task?"],
        row: ['Make "', { text: first(text, 5), page }, '" a task?'],
        nod: "Make task",
        act: async () => {
          // The task's body names the same pages, linked.
          const body = named.reduce((b, p) => linkFirst(b, p.title.trim(), p.id), { type: "paragraph", content: [{ type: "text", text: title }] } as EditorDoc);
          const task = await newPage("task", { title, content: { type: "doc", content: [body] }, properties: day ? { due: { start: day.start } } : {} });
          const count = () => liveEditor(page)?.getJSON().content?.length ?? 0;
          const before = count();
          liveEditor(page)?.setBlock(index, { type: "pageLink", attrs: { id: task.id } });
          // A link as the last block gets an empty line after it; Undo takes that away too.
          const added = count() - before;
          return {
            words: [day ? `Made a task, due ${day.word}.` : "Made a task."],
            undo: async () => {
              liveEditor(page)?.setBlock(index, block, 1 + added);
              removePage(task.id);
            },
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
      id: `chip:${page}`,
      where: page,
      block: index,
      words: [name(p), " has a page."],
      row: [name(p), ' has a page: "', { text: first(textOf(block).trim(), 4), page }, '".'],
      nod: "Link",
      act: async () => {
        liveEditor(page)?.setBlock(index, linkFirst(block, p.title.trim(), p.id));
        return { words: ["Linked."], undo: async () => liveEditor(page)?.setBlock(index, block) };
      },
    }),
  };
}

// The page's thread, as for coming back; the model picks one or stays silent.
async function paused(page: string) {
  if (!chips() || !readable(pageOf(page))) return;
  const ed = liveEditor(page);
  const index = ed?.cursorBlock() ?? -1;
  const blocks = ed?.getJSON().content ?? [];
  if (blocks[index]?.type !== "paragraph") return;
  const found = [asTask(page, index, blocks), mention(page, index, blocks)].filter((f) => f !== undefined);
  if (!found.length) return;
  const was = seen.get(page);
  const [line] = linesOf(await choose("pause", `page:${page}`, found, space.get().pages));
  // Typed again, or left, while the model thought: the moment has passed.
  if (!line || seen.get(page) !== was || !isLive(page)) return;
  put(line);
  later(line.id, ms("chip"), () => drop((l) => l.id === line.id));
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
  const lines = linesOf(await choose("page", `page:${page}`, [found], [pageOf(page)!]).finally(() => asking.delete(page)));
  // An edit, or the page left, while the model thought: the moment has passed.
  if (seen.get(page) === was && isLive(page)) lines.forEach(put);
}

// While a page is open. Any edit takes its line away ("you stopped at" leaves on the first edit,
// a chip when its words change), and a pause after it may bring a chip.
const pauses = new Map<string, ReturnType<typeof setTimeout>>();
const closing = new Map<string, ReturnType<typeof setTimeout>>();
export function follow(page: string) {
  // Mounted again at once (React's second mount in dev): it never left.
  const back = closing.has(page);
  clearTimeout(closing.get(page));
  closing.delete(page);
  if (!back) whenLive(page, (live) => void comeBack(page, live.content()));
  const off = watchLive(page, () => {
    if (mode() === "off" || acting) return;
    drop((l) => l.where === page);
    seen.set(page, { at: Date.now(), block: liveEditor(page)?.cursorBlock() });
    clearTimeout(pauses.get(page));
    if (chips()) pauses.set(page, setTimeout(() => void paused(page), ms("pause")));
  });
  return () => {
    off();
    clearTimeout(pauses.get(page));
    closing.set(
      page,
      setTimeout(() => {
        closing.delete(page);
        seen.set(page, { ...seen.get(page), at: Date.now() });
        drop((l) => l.where === page);
      }),
    );
  };
}

export async function nod(line: Line) {
  if (line.done || acting) return;
  acting = true;
  let done: Done | void;
  try {
    done = await line.act();
  } finally {
    acting = false;
  }
  nodded = Date.now();
  if (!done) return;
  const { words } = done;
  update(line.id, { done });
  // A chip in the margin just leaves; a row on Today keeps its words, so the rows under it stay.
  later(line.id, ms("done"), () => (line.where === TODAY && todayShown() ? update(line.id, { done: { words } }) : drop((l) => l.id === line.id)));
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
  update(line.id, { done: undefined });
  if (line.where !== TODAY) later(line.id, ms("chip"), () => drop((l) => l.id === line.id));
}

// ⌃↩: the chip or row on the page in front, or on Today its first row.
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
  if (mode() === "off" || started) return;
  started = true;
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
    // Leaving Today takes a done row's words away.
    if (!todayShown()) drop((l) => l.where === TODAY && !!l.done && !l.done.undo);
    if (!onToday()) void showWaiting();
  });
}

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

// Starts over: no lines, no threads, an empty log.
function reset() {
  for (const t of [...timers.values(), ...pauses.values()]) clearTimeout(t);
  seen.clear();
  waiting = null;
  beats++;
  Object.assign(memory, { last: 0, threads: {} });
  localStorage.removeItem(KEPT);
  log.length = 0;
  tail.set([]);
}

// The stand-in (lib/agent-standin.ts) adds each tail turn's message and answer to log.
const log: object[] = [];
if (import.meta.env.DEV) (window as unknown as { __tail: unknown }).__tail = { seed, beat, reset, log };
