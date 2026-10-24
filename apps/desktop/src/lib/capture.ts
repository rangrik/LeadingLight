import type { EditorDoc } from "@leadinglight/editor/editor";
import { ensureDaily, today } from "./daily";
import { firstLineText, linesMentioning, linkUnderHeading } from "./doc-links";
import { pageLabel } from "./labels";
import { editPage, whenLive } from "./live";
import { docText } from "./objects";
import { openPage } from "./panes";
import { isNative } from "./platform";
import { createPage, pageOf, patchSummary, savePage, space } from "./space";
import { PAGE_TYPE } from "./store";
import { newPage } from "./templates";

// Idea capture (features/capture.feature): what the box holds becomes an Idea page, tagged
// in-the-middle and linked from today's daily note under an "Ideas" heading. This runs in the
// main window; the box is a view that asks it to save (docs/DECISIONS.md, 13).

export const IDEA = "idea";
export const TAG = "in-the-middle";
export type Draft = { id: string | null; title: string; body: EditorDoc | null };

const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

// Today's "Ideas" heading gets a bullet: the time, then a link to the idea. Once per idea.
export const withIdea = (doc: EditorDoc | null, id: string, at = new Date()): EditorDoc =>
  doc && linesMentioning(doc, id).length ? doc : linkUnderHeading(doc, "Ideas", [{ type: "text", text: `${time.format(at)} ` }, { type: "mention", attrs: { id, tag: false } }]);

// The title line, else the body's first line, as Apple Notes does.
const titleOf = ({ title, body }: Draft) => title.trim() || firstLineText(body, (id) => pageLabel(pageOf(id)?.title ?? ""));

// The tag every captured idea gets, made the first time.
async function ensureTag(name: string): Promise<string> {
  const found = space.get().pages.find((p) => p.typeId === "tag" && pageLabel(p.title).toLowerCase() === name);
  return found ? found.id : (await createPage({ title: name, typeId: "tag" })).id;
}

// The first save with any text makes the Idea page and its line in Today; later saves only
// update the page. Gives the page's id; an empty box saves nothing.
export async function saveCapture(draft: Draft): Promise<string | null> {
  const title = titleOf(draft);
  if (draft.id) {
    patchSummary(draft.id, { title });
    await savePage(draft.id, { title, ...(draft.body && { content: draft.body }) });
    return draft.id;
  }
  if (!title) return null;
  const id = crypto.randomUUID();
  // The link first, so a daily note open in a pane knows the idea before its page appears.
  await editPage(await ensureDaily(today()), { content: (doc) => withIdea(doc, id) });
  const body = docText(draft.body).trim() ? { content: draft.body } : {};
  await newPage(IDEA, { id, title, ...body, properties: { tags: [await ensureTag(TAG)] } });
  return id;
}

// ⌘↩: the idea opens with the cursor at the end of its body, so writing can go on.
export function openIdea(id: string) {
  openPage(id);
  whenLive(id, (page) => page.focus());
}

type LinkRequest = { seq: number; kind: "create" | "day"; title?: string; typeId?: string; day?: string };

// In the app the box is a window of its own (capture.rs): it sends drafts here and hears back
// once each is saved; pages its link menu makes are made here too, so there is one writer; and
// ⌘↩ there opens the idea here.
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
      const id = await (kind === "day" ? ensureDaily(day) : createPage({ title, typeId }).then((p) => p.id)).catch((err) => (console.error(err), null));
      await emitTo("capture", "ll:capture-linked", { seq, id });
    }),
    listen<string>("ll:open-page", (e) => openIdea(e.payload)),
  ]);
  return () => offs.forEach((off) => off());
}
