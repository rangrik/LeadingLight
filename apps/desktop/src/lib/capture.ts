import type { EditorDoc } from "@leadinglight/editor/editor";
import { useStore } from "@/lib/store";
import { closeSettings } from "@/views/settings/open";
import { ensureDaily, today } from "./daily";
import { firstLineText } from "./doc-links";
import { pageLabel } from "./labels";
import { editPage, whenLive } from "./live";
import { docText } from "./objects";
import { openBeside } from "./panes";
import { isNative } from "./platform";
import { createPage, pageOf, patchSummary, savePage, space } from "./space";
import { PAGE_TYPE } from "./store";
import { captureProperties } from "./capture-inbox";
import { newPage } from "./templates";

// Idea capture (features/capture.feature): what the box holds becomes an Idea page, tagged
// in-the-middle, which shows in its day's note because it was made that day. This runs in the
// main window; the box is a view that asks it to save (docs/DECISIONS.md, 14).

export const IDEA = "idea";
export const TAG = "in-the-middle";
const PROJECT = "idea-project";
export type Draft = { id: string | null; title: string; body: EditorDoc | null; project: string | null };

// The title line, else the body's first line, as Apple Notes does.
const titleOf = ({ title, body }: Draft) => title.trim() || firstLineText(body, (id) => pageLabel(pageOf(id)?.title ?? ""));

const projectOf = (id: string) => (pageOf(id)?.properties[PROJECT] as string[] | undefined)?.[0] ?? null;
const withProject = ({ [PROJECT]: _, ...rest }: Record<string, unknown>, project: string | null) => (project ? { ...rest, [PROJECT]: [project] } : rest);

// The tag every captured idea gets, made the first time.
async function ensureTag(name: string): Promise<string> {
  const found = space.get().pages.find((p) => p.typeId === "tag" && pageLabel(p.title).toLowerCase() === name);
  return found ? found.id : (await createPage({ title: name, typeId: "tag" })).id;
}

// The first save with any text makes the Idea page; later saves update it. Gives the page's
// id; an empty box saves nothing.
export async function saveCapture(draft: Draft): Promise<string | null> {
  const title = titleOf(draft);
  if (draft.id) {
    patchSummary(draft.id, { title });
    await savePage(draft.id, { title, ...(draft.body && { content: draft.body }) });
    // Through editPage, so a pane showing the idea gets its new project.
    if (projectOf(draft.id) !== draft.project) await editPage(draft.id, { properties: (props) => withProject(props, draft.project) });
    return draft.id;
  }
  if (!title) return null;
  const body = docText(draft.body).trim() ? { content: draft.body } : {};
  return (await newPage(IDEA, { title, ...body, properties: withProject({ ...captureProperties("idea"), tags: [await ensureTag(TAG)] }, draft.project) })).id;
}

// ⇧⌘↩: the idea opens beside the page in view, the cursor at the end of its body. Settings
// would hide it, so Settings closes.
export function openIdea(id: string) {
  if (useStore.getState().view.kind === "settings") closeSettings();
  openBeside(id);
  whenLive(id, (page) => page.focus());
}

type LinkRequest = { seq: number; kind: "create" | "day"; title?: string; typeId?: string; day?: string };

// In the app the box is a window of its own (capture.rs): it sends drafts here and hears back
// once each is saved; pages its link menu and project picker make are made here too, so there
// is one writer; and ⇧⌘↩ there opens the idea here.
export async function hostCapture(): Promise<() => void> {
  if (!(await isNative)) return () => {};
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  const offs = await Promise.all([
    listen<{ seq: number; draft: Draft }>("ll:capture", async (e) => {
      const { seq, draft } = e.payload;
      const id = await saveCapture(draft).catch((err) => (console.error(err), null));
      await emitTo("capture", "ll:capture-saved", { seq, id });
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
