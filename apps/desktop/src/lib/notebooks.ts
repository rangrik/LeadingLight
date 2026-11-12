import { NOTEBOOK_TYPE, NOTEBOOK_SOURCE } from "./page-format";
import { blankPaper, readPaper } from "./paper";
import { createPage, pageOf, space } from "./space";
import { flushLive } from "./live";
import { openPage } from "./panes";

// Links live on notebooks, so a failed creation never changes the source.
export const notebookFor = (id: string) => space.get().pages.filter((page) => Array.isArray(page.properties[NOTEBOOK_SOURCE]) && (page.properties[NOTEBOOK_SOURCE] as string[]).includes(id) && readPaper(page.properties.paper)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
export const notebookSource = (id: string) => {
  const values = pageOf(id)?.properties[NOTEBOOK_SOURCE];
  const source = Array.isArray(values) ? values[0] : undefined;
  return typeof source === "string" ? pageOf(source) : undefined;
};
export const newNotebook = () => createPage({ typeId: NOTEBOOK_TYPE, title: "Untitled notebook", properties: { paper: blankPaper() } });
const creating = new Map<string, Promise<string>>();
export async function linkedNotebook(id: string): Promise<string> {
  const existing = notebookFor(id);
  if (existing) return existing.id;
  if (creating.has(id)) return creating.get(id)!;
  const pending = (async () => {
    await flushLive(id);
    const source = pageOf(id);
    if (!source) throw new Error("The source page is no longer available.");
    const made = await createPage({ typeId: NOTEBOOK_TYPE, title: `${source.title.trim() || "Untitled"} — notebook`, properties: { paper: blankPaper(), [NOTEBOOK_SOURCE]: [id] } });
    return made.id;
  })();
  creating.set(id, pending);
  try { return await pending; } finally { creating.delete(id); }
}
export const openLinkedNotebook = async (id: string) => openPage(await linkedNotebook(id));
