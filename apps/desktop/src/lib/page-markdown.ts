import type { EditorDoc } from "@leadinglight/editor/editor";

// A page as Claude reads it: Markdown, so it sees headings, lists and emphasis. Its edits name
// the page's words (what the editor finds), so plainWords takes Markdown marks back off them.

const MARKS: Record<string, [string, string]> = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], code: ["`", "`"] };

function inline(n: EditorDoc, title: (id: string) => string): string {
  if (n.type === "text") {
    let t = n.text ?? "";
    for (const m of n.marks ?? []) {
      const [a, b] = MARKS[m.type] ?? ["", ""];
      t = m.type === "link" ? `[${t}](${m.attrs?.href ?? ""})` : `${a}${t}${b}`;
    }
    return t;
  }
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return `${n.attrs?.tag ? "#" : "@"}${title(n.attrs?.id)}`;
  return (n.content ?? []).map((c) => inline(c, title)).join("");
}

function block(n: EditorDoc, title: (id: string) => string): string {
  const kids = n.content ?? [];
  const blocks = (list: EditorDoc[]) => list.map((c) => block(c, title)).filter(Boolean).join("\n\n");
  const item = (c: EditorDoc, mark: string) => {
    const [first, ...rest] = (c.content ?? []).map((k) => block(k, title));
    return [`${mark}${first ?? ""}`, ...rest.map((r) => r.replace(/^/gm, "  "))].join("\n");
  };
  switch (n.type) {
    case "heading":
      return `${"#".repeat(n.attrs?.level ?? 1)} ${inline(n, title)}`;
    case "bulletList":
      return kids.map((c) => item(c, "- ")).join("\n");
    case "orderedList":
      return kids.map((c, i) => item(c, `${i + 1}. `)).join("\n");
    case "taskList":
      return kids.map((c) => item(c, c.attrs?.checked ? "- [x] " : "- [ ] ")).join("\n");
    case "blockquote":
      return blocks(kids).replace(/^/gm, "> ");
    case "codeBlock":
      return `\`\`\`${n.attrs?.language ?? ""}\n${inline(n, title)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "table":
      return kids.map((row, i) => `| ${(row.content ?? []).map((cell) => blocks(cell.content ?? []).replace(/\n+/g, " ")).join(" | ")} |${i === 0 ? `\n|${" --- |".repeat(row.content?.length ?? 0)}` : ""}`).join("\n");
    case "image":
    case "video":
    case "audio":
    case "file":
    case "embed":
      return `[${n.type}${n.attrs?.name ? `: ${n.attrs.name}` : ""}]`;
    case "pageLink":
      return `@${title(n.attrs?.id)}`;
  }
  // Paragraphs and anything else holding text read as their text; containers as their blocks.
  return kids.some((c) => c.type === "text" || c.type === "mention" || c.type === "hardBreak") ? inline(n, title) : blocks(kids);
}

export const docMarkdown = (doc: EditorDoc | null | undefined, title: (id: string) => string = () => "") => (doc ? block(doc, title) : "");

// The words a Markdown snippet stands for, one line per block, as the editor finds them.
export const plainWords = (md: string) =>
  md
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|~~|`|\*|(?<!\w)_|_(?!\w)/g, ""),
    )
    .join("\n");
