import type { EditorDoc } from "@leadinglight/editor/editor";

// Pages saved by the first editor (BlockNote) hold an array of blocks. This turns one into
// the current document shape, so those notes open with their content instead of empty.
type Inline = { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: unknown };
type Block = { type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

const MARKS: Record<string, string> = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", code: "code" };
const LISTS: Record<string, string> = { bulletListItem: "bulletList", numberedListItem: "orderedList", checkListItem: "taskList" };
const MEDIA = new Set(["image", "video", "audio", "file"]);

function inline(content: unknown, marks: EditorDoc[] = []): EditorDoc[] {
  if (!Array.isArray(content)) return [];
  return (content as Inline[]).flatMap((c) => {
    if (c.type === "link") return inline(c.content, [...marks, { type: "link", attrs: { href: c.href } }]);
    if (c.type !== "text" || !c.text) return [];
    const styled = Object.entries(c.styles ?? {})
      .filter(([name, on]) => on && MARKS[name])
      .map(([name]) => ({ type: MARKS[name] }));
    const all = [...marks, ...styled];
    return [{ type: "text", text: c.text, ...(all.length ? { marks: all } : {}) }];
  });
}

function textblock(type: string, block: Block, attrs?: Record<string, unknown>): EditorDoc {
  const content = inline(block.content);
  return { type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

// BlockNote cells are inline content, or (in later versions) a cell holding it.
function table(block: Block): EditorDoc {
  const rows = ((block.content as { rows?: { cells: unknown[] }[] } | undefined)?.rows ?? []).filter((r) => r.cells?.length);
  if (!rows.length) return { type: "paragraph" };
  const cell = (c: unknown): EditorDoc => {
    const content = inline(Array.isArray(c) ? c : (c as { content?: unknown })?.content);
    return { type: "tableCell", content: [{ type: "paragraph", ...(content.length ? { content } : {}) }] };
  };
  return { type: "table", content: rows.map((r) => ({ type: "tableRow", content: r.cells.map(cell) })) };
}

function convert(blocks: Block[]): EditorDoc[] {
  const out: EditorDoc[] = [];
  for (const block of blocks) {
    const list = LISTS[block.type];
    if (list) {
      const task = list === "taskList";
      const item: EditorDoc = {
        type: task ? "taskItem" : "listItem",
        ...(task ? { attrs: { checked: Boolean(block.props?.checked) } } : {}),
        content: [textblock("paragraph", block), ...convert(block.children ?? [])],
      };
      const last = out[out.length - 1];
      if (last?.type === list) last.content?.push(item);
      else out.push({ type: list, content: [item] });
      continue;
    }
    if (block.type === "heading") out.push(textblock("heading", block, { level: Math.min(Number(block.props?.level) || 1, 4) }));
    else if (block.type === "quote") out.push({ type: "blockquote", content: [textblock("paragraph", block)] });
    else if (block.type === "codeBlock") {
      const text = inline(block.content).map((t) => t.text).join("");
      out.push({ type: "codeBlock", attrs: { language: block.props?.language ?? "plaintext" }, ...(text ? { content: [{ type: "text", text }] } : {}) });
    } else if (MEDIA.has(block.type) && block.props?.url) {
      out.push({ type: block.type, attrs: { src: block.props.url, name: block.props.name ?? null } });
    } else if (block.type === "table") out.push(table(block));
    else out.push(textblock("paragraph", block));
    // BlockNote nested blocks under any block; outside lists they come back unindented.
    out.push(...convert(block.children ?? []));
  }
  return out;
}

export function fromBlockNote(blocks: unknown[]): EditorDoc {
  const content = convert(blocks as Block[]);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
