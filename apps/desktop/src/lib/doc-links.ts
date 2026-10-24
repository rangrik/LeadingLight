import type { EditorDoc } from "@leadinglight/editor/editor";

// Reading links out of a stored page body, and adding one, without an editor.

const isText = (n: EditorDoc) => n.type === "text";
const isTextblock = (n: EditorDoc) => Boolean(n.content?.length) && n.content!.every((c) => isText(c) || c.type === "mention" || c.type === "hardBreak");

function* textblocks(node: EditorDoc): Generator<EditorDoc> {
  if (node.type === "codeBlock") return;
  if (node.content && isTextblock(node)) yield node;
  else for (const child of node.content ?? []) yield* textblocks(child);
}

// A line's text, with each mention as its page's current title.
export const lineText = (block: EditorDoc, title: (id: string) => string) =>
  (block.content ?? [])
    .map((n) => (isText(n) ? n.text : n.type === "mention" ? `${n.attrs?.tag ? "#" : "@"}${title(n.attrs?.id)}` : " "))
    .join("");

// The first line's text, mentions by their titles: what names an idea typed without a title.
export function firstLineText(doc: EditorDoc | null, title: (id: string) => string): string {
  for (const block of doc ? textblocks(doc) : []) return lineText(block, title).trim();
  return "";
}

// The lines that mention the page.
export const linesMentioning = (doc: EditorDoc | null, id: string) =>
  doc ? [...textblocks(doc)].filter((b) => b.content?.some((n) => n.type === "mention" && n.attrs?.id === id)) : [];

export function hasBlockLink(node: EditorDoc | null, id: string): boolean {
  if (!node) return false;
  return (node.type === "pageLink" && node.attrs?.id === id) || (node.content ?? []).some((c) => hasBlockLink(c, id));
}

// Lines whose plain text holds the words, as a whole word, any case.
const wordAt = (text: string, words: string) => {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
};
export const linesSaying = (doc: EditorDoc | null, words: string) =>
  doc ? [...textblocks(doc)].filter((b) => b.content?.some((n) => isText(n) && wordAt(n.text ?? "", words) >= 0)) : [];

const headingText = (n: EditorDoc) => (n.content ?? []).map((c) => c.text ?? "").join("").trim().toLowerCase();

// Adds a bullet holding line under the heading (any level) that reads heading, wherever it is;
// with no such heading, a level-3 one is added at the end first.
export function linkUnderHeading(doc: EditorDoc | null, heading: string, line: EditorDoc[]): EditorDoc {
  const content = [...(doc?.content ?? [])];
  let at = content.findIndex((n) => n.type === "heading" && headingText(n) === heading.toLowerCase());
  if (at < 0) at = content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: heading }] }) - 1;
  const item: EditorDoc = { type: "listItem", content: [{ type: "paragraph", content: line }] };
  const list = content[at + 1];
  if (list?.type === "bulletList") content[at + 1] = { ...list, content: [...(list.content ?? []), item] };
  else content.splice(at + 1, 0, { type: "bulletList", content: [item] });
  return { ...doc, type: "doc", content };
}

// The first plain-text occurrence of the words becomes a mention of the page.
export function linkFirst(doc: EditorDoc, words: string, id: string): EditorDoc {
  let done = false;
  const walk = (node: EditorDoc): EditorDoc => {
    if (done || node.type === "codeBlock" || !node.content) return node;
    const content = node.content.flatMap((n) => {
      if (done || !isText(n)) return [walk(n)];
      const text = n.text ?? "";
      const at = wordAt(text, words);
      if (at < 0) return [n];
      done = true;
      const piece = (t: string) => (t ? [{ ...n, text: t }] : []);
      return [...piece(text.slice(0, at)), { type: "mention", attrs: { id, tag: false } }, ...piece(text.slice(at + words.length))];
    });
    return { ...node, content };
  };
  return walk(doc);
}
