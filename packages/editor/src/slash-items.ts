import type { ChainedCommands, Editor, Range } from "@tiptap/core";
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
  Mic,
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
import type { ComponentType } from "react";
import { DEFAULT_EMOJI } from "./emoji-prefix";
import { type LinkType, nameNew } from "./page-links";

export type SlashItem = {
  id: string;
  title: string;
  section: string;
  keywords: string;
  hint?: string;
  icon: ComponentType;
  run: (editor: Editor, range: Range) => void;
  // Set on kinds a block can be turned into (block menu): the commands that reshape a plain line.
  turn?: (chain: ChainedCommands) => ChainedCommands;
};

// Remove the typed "/query" and reset the block before applying a kind.
const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range).clearNodes();
const item = (
  id: string,
  title: string,
  section: string,
  keywords: string,
  icon: SlashItem["icon"],
  run: SlashItem["run"],
  hint?: string,
): SlashItem => ({ id, title, section, keywords, icon, run, hint });
const kind = (
  id: string,
  title: string,
  section: string,
  keywords: string,
  icon: SlashItem["icon"],
  turn: NonNullable<SlashItem["turn"]>,
  hint?: string,
): SlashItem => ({ ...item(id, title, section, keywords, icon, (e, r) => turn(start(e, r)).run(), hint), turn });

export const SLASH_ITEMS: SlashItem[] = [
  kind("text", "Text", "Basic", "paragraph plain", Type, (c) => c.setParagraph()),
  kind("small", "Small text", "Basic", "caption fine print", ALargeSmall, (c) =>
    c.setParagraph().updateAttributes("paragraph", { small: true }),
  ),
  kind("h1", "Heading 1", "Basic", "h1 title", Heading1, (c) => c.setHeading({ level: 1 }), "#"),
  kind("h2", "Heading 2", "Basic", "h2 subtitle", Heading2, (c) => c.setHeading({ level: 2 }), "##"),
  kind("h3", "Heading 3", "Basic", "h3", Heading3, (c) => c.setHeading({ level: 3 }), "###"),
  kind("h4", "Heading 4", "Basic", "h4", Heading4, (c) => c.setHeading({ level: 4 }), "####"),
  kind("quote", "Quote", "Basic", "blockquote", Quote, (c) => c.setBlockquote(), ">"),
  // Opened in a second step: a toggle created open races TipTap's own opening timer.
  {
    ...kind("toggle", "Toggle", "Basic", "collapse details expand", SquareChevronRight, (c) => c.setDetails()),
    run: (e, r) => {
      start(e, r).setDetails().run();
      e.commands.updateAttributes("details", { open: true });
    },
  },
  item("emoji", "Emoji", "Basic", "icon prefix", Sparkles, (e, r) =>
    e.chain().focus().deleteRange(r).setEmoji(DEFAULT_EMOJI).run(),
  ),
  kind("bullet", "Bullet list", "Lists", "unordered ul", List, (c) => c.toggleBulletList(), "-"),
  kind("numbered", "Numbered list", "Lists", "ordered ol", ListOrdered, (c) => c.toggleOrderedList(), "1."),
  // Made with their type, so TipTap joins them to a neighbouring list of the same type.
  kind("alpha", "Alphabetical list", "Lists", "letters abc", ArrowDownAZ, (c) =>
    c.toggleList("orderedList", "listItem", false, { type: "a" }), "a.",
  ),
  kind("roman", "Roman list", "Lists", "numerals", Landmark, (c) =>
    c.toggleList("orderedList", "listItem", false, { type: "i" }), "i.",
  ),
  kind("todo", "To-do list", "Lists", "todo task checkbox check", SquareCheck, (c) => c.toggleTaskList(), "[]"),
  kind("code", "Code block", "Blocks", "pre snippet", Code, (c) => c.setCodeBlock(), "```"),
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
  item("voice", "Voice recording", "Media", "record microphone dictation transcribe", Mic, (e, r) =>
    e.chain().focus().deleteRange(r).insertContent({ type: "voiceRecording" }).run(),
  ),
  item("file", "File", "Media", "attachment pdf document", Paperclip, (e, r) =>
    e.chain().focus().deleteRange(r).insertMedia("file").run(),
  ),
  item("embed", "Embed", "Media", "youtube vimeo link iframe", Globe, (e, r) =>
    e.chain().focus().deleteRange(r).insertEmbed().run(),
  ),
];

// Last, one item per type: it asks for a name in the "@" menu and links the new page there.
const newItem = (type: LinkType): SlashItem =>
  item(`new-${type.id}`, type.name, "New", "new", () => type.icon, (e, r) => nameNew(e, r, type));

// Name matches come before keyword matches, so "/columns" finds Columns before Table.
export function filterSlashItems(query: string, types: LinkType[] = []): SlashItem[] {
  const all = [...SLASH_ITEMS, ...types.map(newItem)];
  const q = query.trim().toLowerCase();
  if (!q) return all;
  const byTitle = all.filter((i) => i.title.toLowerCase().includes(q));
  return [...byTitle, ...all.filter((i) => !byTitle.includes(i) && i.keywords.includes(q))];
}
