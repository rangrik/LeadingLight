import { editPage } from "./live";
import type { ObjectSummary } from "./objects";
import { pageOf } from "./space";

type Page = Pick<ObjectSummary, "typeId" | "properties">;

// Thoughts pages, essays and reports hang off a source; they never are one.
export const canRead = (page: Page) => !page.properties.role && !page.properties.report;

// A page read from gets the Your words column (features/reading-layout.feature): a Book, a saved
// webpage, or any page turned on by hand. An explicit off wins over its type.
export function isSource(page: Page): boolean {
  const { reading, sourceUrl } = page.properties;
  if (!canRead(page)) return false;
  if (typeof reading === "boolean") return reading;
  return page.typeId === "book" || (typeof sourceUrl === "string" && sourceUrl !== "");
}

// ⌥⌘R, for the page in front.
export function toggleReading(id: string | undefined) {
  const page = id ? pageOf(id) : undefined;
  if (!page || !canRead(page)) return;
  void editPage(page.id, { properties: (p) => ({ ...p, reading: !isSource({ typeId: page.typeId, properties: p }) }) });
}
