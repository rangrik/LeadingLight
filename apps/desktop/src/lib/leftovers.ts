import type { EditorDoc } from "@leadinglight/editor/editor";
import { aiPrefs } from "~/lib/ai-prefs";
import { assign, projectFor } from "~/lib/assign";
import { showBar } from "~/lib/bar";
import { captureOf, setCaptureProperty, setReviewed, toReview } from "~/lib/capture-inbox";
import { today } from "~/lib/daily";
import { localPrefs } from "~/lib/local-prefs";
import { objects, type ObjectSummary } from "~/lib/objects";
import { openBeside } from "~/lib/panes";
import { folders } from "~/lib/project-runtime/folders";
import { removePage, space } from "~/lib/space";
import { type Line, type Part, tail } from "~/lib/tail";
import { newPage } from "~/lib/templates";

// The daily card on Today (features/suggestions.feature): what earlier days left, suggestions not
// nodded and captures not reviewed, to go through, dismiss or hand to an agent. Once a day.

export const card = localPrefs<{ day: string; dismissed?: boolean; task?: string; error?: string }>("ll.tail.card", { day: "" });
export const todayCard = () => (card.get().day === today() ? card.get() : { day: today() });

// A suggestion, or a capture's page, and when it came.
export type Leftover = { page: string; at: number; line?: Line };
export function leftovers(lines: Line[], pages: ObjectSummary[]): Leftover[] {
  const end = new Date().setHours(0, 0, 0, 0);
  const offers = lines.flatMap((line) => (line.block !== undefined && !line.done && line.at !== undefined && line.at < end ? [{ page: line.where, at: line.at, line }] : []));
  return [...offers, ...toReview(pages).flatMap((p) => (captureOf(p)!.capturedAt < end ? [{ page: p.id, at: captureOf(p)!.capturedAt }] : []))];
}
// "Yesterday left 4 things." when all came yesterday, else "Left over: 5 things."
export function saying(items: Leftover[]) {
  const yesterday = new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() - 1);
  const things = `${items.length} ${items.length === 1 ? "thing" : "things"}.`;
  return items.every((i) => i.at >= yesterday) ? `Yesterday left ${things}` : `Left over: ${things}`;
}

// The first beside Today, in the panel that answers it; the card counts down as each is acted on.
export function goThrough([first]: Leftover[]) {
  if (!first) return;
  openBeside(first.page);
  showBar(first.line ? "suggestions" : "captures");
}

// Captures reviewed and suggestions gone, none counted as ignored.
export async function dismissAll(items: Leftover[]) {
  card.set({ day: today(), dismissed: true });
  tail.set(tail.get().filter((l) => !items.some((i) => i.line?.id === l.id)));
  for (const i of items) if (!i.line) await setReviewed(i.page, true);
}

const text = (t: string): EditorDoc => ({ type: "text", text: t });
const mention = (id: string): EditorDoc => ({ type: "mention", attrs: { id, tag: false } });
const plain = (parts: Part[]) => parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
const linksIn = (n?: EditorDoc | null): string[] => (!n ? [] : [...((n.type === "mention" || n.type === "pageLink") && n.attrs?.id ? [n.attrs.id] : []), ...(n.content ?? []).flatMap(linksIn)]);

// A task "Review yesterday's leftovers", its brief naming each item and the pages it links to,
// assigned in the first item's project with a linked folder, else any.
export async function handOff(items: Leftover[]) {
  let project: string | undefined;
  for (const i of items) project ??= await projectFor(i.page);
  project ??= [...folders.get().values()].find((f) => !f.missing)?.folder.pageId;
  if (!project) return card.set({ day: today(), error: "no project has a linked folder yet" });
  const lines: EditorDoc[] = [];
  for (const i of items) {
    const pages = [...new Set(i.line ? (i.line.pages ?? [i.page]) : [i.page, ...linksIn((await objects.get(i.page))?.content)])];
    const said = i.line ? `Tail suggested: ${plain(i.line.row ?? i.line.words)} About ` : "A capture not reviewed: ";
    lines.push({ type: "paragraph", content: [text(said), ...pages.flatMap((id, k) => [...(k ? [text(", ")] : []), mention(id)])] });
  }
  const intro = { type: "paragraph", content: [text("Yesterday left these. Take each where it should go, and report what you did with every one.")] };
  const task = await newPage("task", { title: "Review yesterday's leftovers", content: { type: "doc", content: [intro, ...lines] }, properties: { "task-project": [project] } });
  card.set({ day: today(), task: task.id, error: undefined });
  const { model, effort, access } = aiPrefs();
  await assign(task.id, { model, effort, access }).catch((e: Error) => {
    removePage(task.id);
    card.set({ day: today(), task: undefined, error: e.message });
  });
}

// For the scenes: what waits now, as if yesterday left it, and a new card.
async function asYesterday() {
  const at = new Date().setHours(0, 0, 0, 0) - 12 * 3_600_000;
  tail.set(tail.get().map((l) => (l.block !== undefined ? { ...l, at } : l)));
  for (const p of toReview(space.get().pages)) await setCaptureProperty(p.id, "captureInbox", { ...captureOf(p), capturedAt: at });
  card.set({ day: "" });
}
if (import.meta.env.DEV) Object.assign((window as unknown as { __tail: object }).__tail, { yesterday: asYesterday });
