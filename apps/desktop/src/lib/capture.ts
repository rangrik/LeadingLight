import { attachVoiceAsset, type EditorDoc } from "@leadinglight/editor/editor";
import type { Asset } from "@leadinglight/editor/assets";
import { useStore } from "@/lib/store";
import { closeSettings } from "@/views/settings/open";
import { ensureDaily, today } from "./daily";
import { firstLineText } from "./doc-links";
import { pageLabel } from "./labels";
import { editPage, liveEditor, whenLive } from "./live";
import { docText, objects } from "./objects";
import { openBeside } from "./panes";
import { isDesktop } from "./platform";
import { createPage, markSaved, pageOf, patchSummary, retype, savePage, space } from "./space";
import { PAGE_TYPE } from "./store";
import { captureOf, captureProperties, markCapture, setCaptureProject } from "./capture-inbox";
import { readText } from "./capture-text";
import { newPage } from "./templates";
import { link, saveWebSource, type SourceMode } from "./web-source";

// Idea capture (features/capture.feature): what the box holds becomes an Idea page, tagged
// in-the-middle, which shows in its day's note because it was made that day. This runs in the
// main window; the box is a view that asks it to save (docs/DECISIONS.md, 14).

export const IDEA = "idea";
export const TAG = "in-the-middle";
const PROJECT = "idea-project";
// task: ⌃↩ saves it as a task in the project instead (docs/TAIL.md); took: ⌃↩ took tail's guess;
// voice: the body holds a saved recording, so it is a recording in Captures.
export type Draft = { id: string | null; title: string; body: EditorDoc | null; project: string | null; task?: boolean; took?: boolean; voice?: boolean };
// Tail's read of the words: the project they seem to be for, and whether they are a task.
export type Guess = { task: boolean; project: string | null };
export type WebSaved = { id: string | null; missing?: number; error?: string };

// The title line without its address, else the body's first line, as Apple Notes does.
const titleOf = ({ title, body, voice }: Draft) =>
  readText(title).words || firstLineText(body, (id) => pageLabel(pageOf(id)?.title ?? "")) || (voice ? "Voice recording" : "");
// An address typed with words goes into the body as a link, at the top.
const withLink = ({ title, body }: Draft) => {
  const { url } = readText(title);
  return url ? { type: "doc", content: [link(url, url), ...(body?.content ?? [])] } : body;
};

const projectOf = (id: string) => (pageOf(id)?.properties[PROJECT] as string[] | undefined)?.[0] ?? null;
const withProject = ({ [PROJECT]: _, ...rest }: Record<string, unknown>, project: string | null) => (project ? { ...rest, [PROJECT]: [project] } : rest);

// The tag every captured idea gets, made the first time.
export async function ensureTag(name: string): Promise<string> {
  const found = space.get().pages.find((p) => p.typeId === "tag" && pageLabel(p.title).toLowerCase() === name);
  return found ? found.id : (await createPage({ title: name, typeId: "tag" })).id;
}

export async function saveCapture(draft: Draft): Promise<string | null> {
  const id = await saveIdea(draft);
  if (id && draft.task) await retype(id, "task", (props) => ({ ...withProject(props, null), "task-project": draft.project ? [draft.project] : [] }));
  // A recording made after the words were saved turns the idea into a recording.
  const page = id && pageOf(id);
  if (page && draft.voice && captureOf(page)?.kind !== "voice") await markCapture(page.id, "voice");
  return id;
}

const voiceSaves = new Map<string, Promise<void>>();
export function saveVoice(id: string, recordingId: string, asset: Asset): Promise<void> {
  // Two stopped takes must read one another's saved audio before patching a closed page.
  const save = (voiceSaves.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let open = liveEditor(id);
    let attached = false;
    if (open) attached = open.attachVoiceAsset(recordingId, asset);
    else {
      const page = await objects.get(id);
      open = liveEditor(id);
      if (open) attached = open.attachVoiceAsset(recordingId, asset);
      else if (page) {
        const content = attachVoiceAsset(page.content ?? { type: "doc", content: [] }, recordingId, asset);
        if (content) {
          await objects.update(id, { content });
          // A page reopened during the write must keep the take in its next autosave too.
          liveEditor(id)?.attachVoiceAsset(recordingId, asset);
          patchSummary(id, { updatedAt: Date.now() });
          markSaved();
          attached = true;
        }
      }
    }
    if (attached) await markCapture(id, "voice");
  });
  voiceSaves.set(id, save);
  return save.finally(() => { if (voiceSaves.get(id) === save) voiceSaves.delete(id); });
}

// A lone address saves a webpage (web-sources.feature), in the box's project.
export async function saveWebpage(url: string, mode: SourceMode, project: string | null, signal?: AbortSignal): Promise<WebSaved> {
  const { page, missing } = await saveWebSource(url, mode, { signal });
  if (project) await setCaptureProject(page, project);
  return { id: page.id, missing };
}

// The first save with any text makes the Idea page; later saves update it. Gives the page's
// id; an empty box saves nothing.
async function saveIdea(draft: Draft): Promise<string | null> {
  const title = titleOf(draft);
  const content = withLink(draft);
  if (draft.id) {
    patchSummary(draft.id, { title });
    await savePage(draft.id, { title, ...(content && { content }) });
    // Through editPage, so a pane showing the idea gets its new project.
    if (projectOf(draft.id) !== draft.project) await editPage(draft.id, { properties: (props) => withProject(props, draft.project) });
    return draft.id;
  }
  if (!title) return null;
  const body = docText(content).trim() || draft.voice ? { content } : {};
  return (await newPage(IDEA, { title, ...body, properties: withProject({ ...captureProperties(draft.voice ? "voice" : "idea"), tags: [await ensureTag(TAG)] }, draft.project) })).id;
}

// ⇧⌘↩: the idea opens beside the page in view, the cursor at the end of its body. Settings
// would hide it, so Settings closes.
export function openIdea(id: string) {
  if (useStore.getState().view.kind === "settings") closeSettings();
  openBeside(id);
  whenLive(id, (page) => page.focus());
}

type LinkRequest = { seq: number; kind: "create" | "day"; title?: string; typeId?: string; day?: string };

// In the app the box is a window of its own (capture.rs): it sends drafts and webpages here and
// hears back once each is saved; pages its link menu and project picker make are made here too,
// so there is one writer; tail guesses here, where it runs; and ⇧⌘↩ there opens the idea here.
export async function hostCapture(tail: { guess: (text: string, opened: number) => Promise<Guess>; took: (project: string) => void }): Promise<() => void> {
  if (!(await isDesktop)) return () => {};
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  // A webpage is fetched here; the box's Escape stops it.
  const fetching = new Map<number, AbortController>();
  const offs = await Promise.all([
    listen<{ seq: number; url: string; mode: SourceMode; project: string | null }>("ll:capture-web", async (e) => {
      const { seq, url, mode, project } = e.payload;
      const stop = new AbortController();
      fetching.set(seq, stop);
      const saved = await saveWebpage(url, mode, project, stop.signal).catch((err) => ({ id: null, error: err instanceof Error ? err.message : String(err) }));
      fetching.delete(seq);
      await emitTo("capture", "ll:capture-web-saved", { seq, ...saved });
    }),
    listen<number>("ll:capture-web-cancel", (e) => fetching.get(e.payload)?.abort()),
    listen<{ seq: number; draft: Draft }>("ll:capture", async (e) => {
      const { seq, draft } = e.payload;
      // ⌃↩ there saves what tail guessed: the nod.
      if (draft.took && draft.project) tail.took(draft.project);
      const id = await saveCapture(draft).catch((err) => (console.error(err), null));
      await emitTo("capture", "ll:capture-saved", { seq, id });
    }),
    listen<{ seq: number; id: string; recordingId: string; asset: Asset }>("ll:capture-voice", async ({ payload }) => {
      const { seq, id, recordingId, asset } = payload;
      const saved = await saveVoice(id, recordingId, asset).then(() => id, (err) => (console.error(err), null));
      await emitTo("capture", "ll:capture-saved", { seq, id: saved });
    }),
    listen<{ seq: number; text: string; opened: number }>("ll:capture-guess", async (e) => {
      const { seq, text, opened } = e.payload;
      await emitTo("capture", "ll:capture-guessed", { seq, ...(await tail.guess(text, opened)) });
    }),
    listen<LinkRequest>("ll:capture-link", async (e) => {
      const { seq, kind, title = "", typeId = PAGE_TYPE, day = today() } = e.payload;
      const id = await (kind === "day" ? ensureDaily(day) : newPage(typeId, { title }).then((p) => p.id)).catch((err) => (console.error(err), null));
      await emitTo("capture", "ll:capture-linked", { seq, id });
    }),
    listen<string>("ll:open-page", (e) => openIdea(e.payload)),
  ]);
  return () => offs.forEach((off) => off());
}
