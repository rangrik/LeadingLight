// What tail remembers (docs/TAIL.md): the nod ledger, and the sentences it writes on the page about
// how you work. No app imports, so the quiet rule can be tested alone.

// The page's type, a system type the app makes (lib/starter.ts).
export const ABOUT = "how-you-work";
export const MAX_LINES = 40;

// Where a line was: its kind, its page's type, and the project when there is one.
export type Place = { kind: string; type: string; project?: string };
// spent: an ignore that has gone into a quiet sentence already.
export type Entry = Place & { took: boolean; at: number; spent?: boolean };

const MONTH = 30 * 86_400_000;
const here = (a: Place, b: Place) => a.kind === b.kind && a.type === b.type && (a.project ?? "") === (b.project ?? "");

// A line taken or ignored, kept thirty days. Three ignores of a kind in one place with no nod
// between quiet it and are spent, so a deleted quiet sentence takes three more; a nod lifts it.
export function record(entries: Entry[], e: Entry): { entries: Entry[]; change?: "quiet" | "lift" } {
  const kept = [...entries.filter((x) => x.at > e.at - MONTH), e];
  const there = kept.filter((x) => x !== e && here(x, e));
  const since = there.slice(there.reduce((k, x, i) => (x.took ? i + 1 : k), 0));
  if (e.took) return { entries: kept, ...(since.some((x) => x.spent) && { change: "lift" as const }) };
  const ignored = [...since.filter((x) => !x.spent), e];
  if (ignored.length < 3) return { entries: kept };
  return { entries: kept.map((x) => (ignored.includes(x) ? { ...x, spent: true } : x)), change: "quiet" };
}

// The app's sentences keep one form, so it knows them again on the page; one the person edited is
// theirs, and tail keeps it.
const LABEL: Record<string, string> = {
  left: "Lines about pages left mid-sentence",
  ideas: "Offers to file ideas",
  day: "Offers to set a day",
  untitled: "Offers to name a page",
  stopped: "Lines about where you stopped",
  task: "Offers to make a task",
  mention: "Links",
};
export const quietLine = (kind: string, type: string, project?: string) => `${LABEL[kind] ?? kind} on ${type === "Page" ? "" : `${type} `}pages${project ? ` in ${project}` : ""} are quiet.`;
export const notAgain = (name: string) => `Not asking again about ${name} for now.`;
export const quietForm = (s: string) => / pages( in .+)? are quiet\.$/.test(s);
export const appLine = (s: string) => quietForm(s) || /^Most ideas go to |^Tasks get their day on |^Not asking again about .+ for now\.$/.test(s);

// The ledger's version. An older build's ignores came partly from its bugs, so they go, and with
// them the quiet they set (tail.ts takes those sentences off the page).
export const LEDGER = 2;
export const upgraded = <L extends { v?: number; entries: Entry[] }>(l: L): L => (l.v === LEDGER ? l : { ...l, v: LEDGER, entries: [] });

// One paragraph per sentence, dated.
export const dated = (day: string, sentence: string) => `${day} · ${sentence}`;
export const sentenceOf = (line: string) => line.replace(/^\d{4}-\d{2}-\d{2} · /, "").trim();
// Quiet while the page says so, so deleting the sentence lifts it.
export const isQuiet = (lines: string[], kind: string, type: string, project?: string) => lines.some((l) => sentenceOf(l) === quietLine(kind, type, project));

// Where Today's rows are; they change only on a nod, a beat, or leaving Today.
export const TODAY = "today";

// The block nearest where a suggestion was that still holds its block's words, else -1.
export const lineAt = (texts: string[], text: string | undefined, was: number) => texts.reduce((k, t, i) => (t === text && (k < 0 || Math.abs(i - was) < Math.abs(k - was)) ? i : k), -1);

// How long the panel must have shown a suggestion before leaving its page counts as a no.
export const LOOKED = 30_000;

// A page's lines after an edit (texts: its blocks' words now) or once it is left (none). The row
// above the title leaves at either, a no only on an edit; a suggestion once its block's words change,
// which is not one. Left, a suggestion stays for Elsewhere, a no once if the panel showed it 30 s.
export function edited<L extends { where: string; block?: number; text?: string; done?: object; seen?: number; ignored?: boolean }>(lines: L[], page: string, texts?: string[], now = Date.now()) {
  const gone: L[] = [];
  const ignored: L[] = [];
  const moved: [L, number][] = [];
  for (const l of lines) {
    if (l.where !== page || l.where === TODAY) continue;
    if (l.block === undefined) {
      gone.push(l);
      if (!l.done && texts) ignored.push(l);
    } else if (!texts) {
      if (!l.done && !l.ignored && now - (l.seen ?? now) >= LOOKED) ignored.push(l);
    } else if (!l.done) {
      const at = lineAt(texts, l.text, l.block);
      if (at < 0) gone.push(l);
      else if (at !== l.block) moved.push([l, at]);
    }
  }
  return { gone, ignored, moved };
}

// A row on Today by its candidate: the day it was first seen, its pages as they were then, and
// the sentence that keeps it out.
export type Shown = { day: string; state: string; said?: string };
// Seen again on a later day, unchanged and with no nod between, it was ignored twice: that row,
// not its kind, is said to be out.
export function seenOn(was: Shown | undefined, day: string, state: string, name: string): Shown {
  if (was?.state !== state) return { day, state };
  return was.said || was.day === day ? was : { ...was, said: notAgain(name) };
}
// Out while its sentence stands and its pages are unchanged; a deleted sentence brings it back.
export const isOut = (s: Shown | undefined, state: string, lines: string[]) => !!s?.said && s.state === state && lines.some((l) => sentenceOf(l) === s.said);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A sentence the ledger can stand behind, the moment it first can: the third filing to a project
// that has the most, or the third day set on one weekday.
export function factOf(entries: Entry[], e: Entry, name: (id: string) => string): string | undefined {
  if (!e.took) return;
  const took = entries.filter((x) => x.took && x.kind === e.kind);
  const n = (test: (x: Entry) => boolean) => took.filter(test).length;
  if (e.kind === "ideas" && e.project && n((x) => x.project === e.project) === 3 && took.every((x) => x.project === e.project || n((y) => y.project === x.project) < 3)) return `Most ideas go to ${name(e.project)}.`;
  const day = (x: Entry) => new Date(x.at).getDay();
  if (e.kind === "day" && n((x) => day(x) === day(e)) === 3) return `Tasks get their day on ${WEEKDAYS[day(e)]}s.`;
}

// The ledger in a few words for the model: "took ideas 3, day 1; ignored mention 2".
export function counts(entries: Entry[]): string {
  const by = (took: boolean) => {
    const n = new Map<string, number>();
    for (const e of entries) if (e.took === took) n.set(e.kind, (n.get(e.kind) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(", ");
  };
  return [`took ${by(true)}`, `ignored ${by(false)}`].filter((s) => /\d/.test(s)).join("; ").slice(0, 99);
}
