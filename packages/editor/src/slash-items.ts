import type { Editor, Range } from "@tiptap/core";
import {
  ALargeSmall,
  ArrowDownAZ,
  AudioLines,
  Code,
  Columns2,
  Film,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image,
  Landmark,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Paperclip,
  Quote,
  SquareCheck,
  SquareChevronRight,
  SquareDashed,
  Sparkles,
  Table,
  Type,
} from "lucide-react";
import { DEFAULT_EMOJI } from "./emoji-prefix";

export type SlashItem = {
  id: string;
  title: string;
  section: string;
  keywords: string;
  hint?: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
};

// Remove the typed "/query" and reset the block before applying a kind.
const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range).clearNodes();
const item = (
  id: string,
  title: string,
  section: string,
  keywords: string,
  icon: LucideIcon,
  run: SlashItem["run"],
  hint?: string,
): SlashItem => ({ id, title, section, keywords, icon, run, hint });

export const SLASH_ITEMS: SlashItem[] = [
  item("text", "Text", "Basic", "paragraph plain", Type, (e, r) => start(e, r).setParagraph().run()),
  item("small", "Small text", "Basic", "caption fine print", ALargeSmall, (e, r) =>
    start(e, r).setParagraph().updateAttributes("paragraph", { small: true }).run(),
  ),
  item("h1", "Heading 1", "Basic", "h1 title", Heading1, (e, r) => start(e, r).setHeading({ level: 1 }).run(), "#"),
  item("h2", "Heading 2", "Basic", "h2 subtitle", Heading2, (e, r) => start(e, r).setHeading({ level: 2 }).run(), "##"),
  item("h3", "Heading 3", "Basic", "h3", Heading3, (e, r) => start(e, r).setHeading({ level: 3 }).run(), "###"),
  item("h4", "Heading 4", "Basic", "h4", Heading4, (e, r) => start(e, r).setHeading({ level: 4 }).run(), "####"),
  item("quote", "Quote", "Basic", "blockquote", Quote, (e, r) => start(e, r).setBlockquote().run(), ">"),
  // Opened in a second step: a toggle created open races TipTap's own opening timer.
  item("toggle", "Toggle", "Basic", "collapse details expand", SquareChevronRight, (e, r) => {
    start(e, r).setDetails().run();
    e.commands.updateAttributes("details", { open: true });
  }),
  item("emoji", "Emoji", "Basic", "icon prefix", Sparkles, (e, r) =>
    e.chain().focus().deleteRange(r).setEmoji(DEFAULT_EMOJI).run(),
  ),
  item("bullet", "Bullet list", "Lists", "unordered ul", List, (e, r) => start(e, r).toggleBulletList().run(), "-"),
  item("numbered", "Numbered list", "Lists", "ordered ol", ListOrdered, (e, r) => start(e, r).toggleOrderedList().run(), "1."),
  item("alpha", "Alphabetical list", "Lists", "letters abc", ArrowDownAZ, (e, r) =>
    start(e, r).toggleOrderedList().updateAttributes("orderedList", { type: "a" }).run(), "a.",
  ),
  item("roman", "Roman list", "Lists", "numerals", Landmark, (e, r) =>
    start(e, r).toggleOrderedList().updateAttributes("orderedList", { type: "i" }).run(), "i.",
  ),
  item("todo", "To-do list", "Lists", "todo task checkbox check", SquareCheck, (e, r) => start(e, r).toggleTaskList().run(), "[]"),
  item("code", "Code block", "Blocks", "pre snippet", Code, (e, r) => start(e, r).setCodeBlock().run(), "```"),
  item("table", "Table", "Blocks", "grid rows columns", Table, (e, r) =>
    e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  ),
  item("columns", "Columns", "Blocks", "two side by side layout", Columns2, (e, r) =>
    e.chain().focus().deleteRange(r).setColumns(2).run(),
  ),
  item("group", "Group", "Blocks", "box container", SquareDashed, (e, r) => e.chain().focus().deleteRange(r).setGroup().run()),
  item("divider", "Divider", "Blocks", "hr rule line separator", Minus, (e, r) =>
    e.chain().focus().deleteRange(r).setHorizontalRule().run(), "---",
  ),
  item("image", "Image", "Media", "picture photo png jpg", Image, (e, r) =>
    e.chain().focus().deleteRange(r).insertMedia("image").run(),
  ),
  item("video", "Video", "Media", "movie mp4", Film, (e, r) => e.chain().focus().deleteRange(r).insertMedia("video").run()),
  item("audio", "Audio", "Media", "sound mp3 recording", AudioLines, (e, r) =>
    e.chain().focus().deleteRange(r).insertMedia("audio").run(),
  ),
  item("file", "File", "Media", "attachment pdf document", Paperclip, (e, r) =>
    e.chain().focus().deleteRange(r).insertMedia("file").run(),
  ),
  item("embed", "Embed", "Media", "youtube vimeo link iframe", Globe, (e, r) =>
    e.chain().focus().deleteRange(r).insertEmbed().run(),
  ),
];

// Name matches come before keyword matches, so "/columns" finds Columns before Table.
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  const byTitle = SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q));
  return [...byTitle, ...SLASH_ITEMS.filter((i) => !byTitle.includes(i) && i.keywords.includes(q))];
}
