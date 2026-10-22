import type { PageStyle } from "@leadinglight/editor/editor";
import type { LLObject } from "./store";

// What a page is called in lists and dialogs. A title of only spaces counts as none.
export const pageLabel = (title: string) => title.trim() || "Untitled";

// A page with no style saved, or one this version doesn't know, is Plain.
export const pageStyle = (page: LLObject): PageStyle => (page.properties.style === "playful" ? "playful" : "plain");
