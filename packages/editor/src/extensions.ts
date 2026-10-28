import { Extension, type KeyboardShortcutCommand, markInputRule, markPasteRule } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import type { MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Cite, Cited, Note, Thought } from "./anchors";
import type { AssetStore } from "./assets";
import { BlockSelectionExtension, SelectAll } from "./block-selection";
import { CodeBlock } from "./code-block";
import { BlockDrop } from "./drop";
import { EmojiPrefix } from "./emoji-prefix";
import { TextHighlight } from "./highlight";
import { Column, Columns, Group } from "./layout";
import { MarkdownPaste } from "./markdown";
import { OrderedListStyles } from "./lists";
import { createMedia } from "./media";
import { type LinkHost, LinkMenus, linkMenuOpen, Mention, PageLink } from "./page-links";
import { SlashCommands, slashMenuOpen } from "./slash-menu";
import { Tables } from "./table";
import { Todo } from "./todo";
import { WritingAids } from "./writing";
import { CaretScroll } from "./caret-scroll";

// ArrowUp on the first line, or Backspace in a lone empty block, hands focus back to the title.
// Low priority so menus get the keys first.
const ExitTop = Extension.create<{ onExitTop: () => boolean }>({
  name: "exitTop",
  priority: 10,
  addOptions() {
    return { onExitTop: () => false };
  },
  addKeyboardShortcuts() {
    const first = () => {
      const { $from, empty } = this.editor.state.selection;
      return empty && $from.depth === 1 && $from.index(0) === 0;
    };
    return {
      ArrowUp: () =>
        !slashMenuOpen(this.editor.state) && !linkMenuOpen(this.editor.state) && first() && this.editor.view.endOfTextblock("up") && this.options.onExitTop(),
      Backspace: () => {
        const { doc, selection } = this.editor.state;
        return first() && doc.childCount === 1 && selection.$from.parent.content.size === 0 && this.options.onExitTop();
      },
    };
  },
});

// Toggles take their first line as the title (TipTap's setDetails leaves it empty), and Enter in an
// open toggle's title moves into its empty first line instead of adding another.
const Toggle = Details.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      setDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const range = state.selection.$from.blockRange(state.selection.$to);
          const lines = range && state.doc.slice(range.start, range.end).content;
          const title = lines?.firstChild;
          if (!range || !lines || !title?.isTextblock) return false;
          const { detailsSummary, detailsContent, paragraph } = state.schema.nodes;
          const body = lines.cut(title.nodeSize);
          const toggle = this.type.create(null, [
            detailsSummary.create(null, title.content),
            detailsContent.create(null, body.size ? body : paragraph.create()),
          ]);
          if (dispatch) {
            tr.replaceWith(range.start, range.end, toggle);
            tr.setSelection(TextSelection.create(tr.doc, range.start + 2 + title.content.size));
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const parent = (this.parent?.() ?? {}) as Record<string, KeyboardShortcutCommand>;
    return {
      ...parent,
      Enter: (props) => {
        const { state, view } = this.editor;
        const { $head, empty } = state.selection;
        if (empty && $head.parent.type.name === "detailsSummary" && $head.node(-1).attrs.open) {
          const first = state.doc.nodeAt($head.after())?.firstChild;
          if (first?.type.name === "paragraph" && first.content.size === 0) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $head.after() + 2)));
            return true;
          }
        }
        return parent.Enter?.(props) ?? false;
      },
    };
  },
});

const hint = (node: PMNode, paragraph: string) => {
  // An emoji line has its emoji where the hint would be drawn.
  if (node.attrs.emoji) return null;
  if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
  if (node.type.name === "detailsSummary") return "Toggle";
  return node.type.name === "paragraph" ? paragraph : null;
};

// The hint on the empty line holding the text cursor, at any depth (columns, toggles, lists,
// cells). Ours because TipTap's nested mode leaves old hints behind (3.32).
const Placeholder = Extension.create<{ paragraph: string }>({
  name: "placeholder",
  addOptions: () => ({ paragraph: "Type '/' for commands" }),
  addProseMirrorPlugins() {
    const editor = this.editor;
    const paragraph = this.options.paragraph;
    return [
      new Plugin({
        key: new PluginKey("placeholder"),
        props: {
          decorations: ({ doc, selection }) => {
            const node = selection.$from.parent;
            const text = selection instanceof TextSelection && selection.empty && !node.content.size && hint(node, paragraph);
            if (!text || !editor.isEditable) return null;
            const pos = selection.$from.before();
            return DecorationSet.create(doc, [Decoration.node(pos, pos + node.nodeSize, { class: "is-empty", "data-placeholder": text })]);
          },
        },
      }),
    ];
  },
});

// Keeps selected text visible while focus is in the link field. Text only: a block selection has
// its tint, and pressing a block handle takes focus for a moment, which mustn't flash a highlight.
const BlurSelection = Extension.create({
  name: "blurSelection",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("blurSelection"),
        props: {
          decorations: ({ doc, selection }) =>
            editor.isFocused || selection.empty || !(selection instanceof TextSelection)
              ? null
              : DecorationSet.create(doc, [Decoration.inline(selection.from, selection.to, { class: "ll-blur-selection" })]),
        },
      }),
    ];
  },
});

// Lists, tables, code and columns use Tab first; anywhere else it must not move focus out of the page.
const KeepTab = Extension.create({
  name: "keepTab",
  priority: 5,
  addKeyboardShortcuts: () => ({ Tab: () => true, "Shift-Tab": () => true }),
});

// Backspace at the very start of a heading or a quote unformats it before it joins the block
// above. Runs before TipTap's own Backspace, which would join straight away.
const Unformat = Extension.create({
  name: "unformat",
  priority: 150,
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name === "heading") return this.editor.commands.setParagraph();
        const quote = $from.depth >= 2 && $from.node(-1).type.name === "blockquote" && $from.index(-1) === 0;
        return quote ? this.editor.commands.lift("blockquote") : false;
      },
    };
  },
});

// Meta+click (Ctrl+click elsewhere) opens a link; a plain click puts the cursor in it, but in a
// report, which takes no cursor, opens it. Chips and
// quotes that point into the app (data-href) open on a plain click and never take the cursor.
const OpenLinks = Extension.create<{ open: (href: string) => void }>({
  name: "openLinks",
  addOptions: () => ({ open: () => {} }),
  addProseMirrorPlugins() {
    const chip = (e: Event) => (e.target as HTMLElement).closest("[data-href], [data-note-chip]");
    return [
      new Plugin({
        key: new PluginKey("openLinks"),
        props: {
          handleDOMEvents: {
            mousedown: (_view, event) => {
              if (!chip(event)) return false;
              event.preventDefault();
              return true;
            },
            click: (_view, event) => {
              const href = chip(event)?.getAttribute("data-href");
              if (!href) return false;
              this.options.open(href);
              return true;
            },
          },
          handleClick: (view, _pos, event) => {
            // Words that can't be edited (a report) have no cursor to place: a click opens.
            if (!(event.metaKey || event.ctrlKey) && !view.dom.closest("[data-annotate]")) return false;
            const href = (event.target as HTMLElement).closest("a[href]")?.getAttribute("href");
            if (!href) return false;
            this.options.open(href);
            return true;
          },
        },
      }),
    ];
  },
});

// A new line starts plain instead of carrying bold, italic and the rest on, as in Notion.
const plain = { keepOnSplit: false };

// Emphasis as Markdown has it: the marked words can't start or end with a space, so "2 * 3 * 4"
// stays as written. TipTap's own rules make " 3 " italic, typed or pasted.
const marked = (marker: string, flags = "") => {
  const m = marker.replace(/\*/g, "\\*");
  return new RegExp(`(?:^|\\s)(${m}(?!\\s)([^${marker[0]}]*[^${marker[0]}\\s])${m})${flags ? "" : "$"}`, flags);
};
const emphasis = (...markers: string[]) => ({
  ...plain,
  addInputRules(this: { type: MarkType }) {
    return markers.map((m) => markInputRule({ find: marked(m), type: this.type }));
  },
  addPasteRules(this: { type: MarkType }) {
    return markers.map((m) => markPasteRule({ find: marked(m, "g"), type: this.type }));
  },
});

export function createExtensions(opts: {
  onExitTop: () => boolean;
  assets: AssetStore;
  openLink: (href: string) => void;
  links?: LinkHost;
  onNote?: (id: string, quote: string, existing?: boolean) => boolean;
  placeholder?: string;
}) {
  const host = opts.links ?? null;
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: false,
      orderedList: false,
      // ll: is the app's own address for a page and a place in it (an agent's report links with it).
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["ll"] },
      dropcursor: { color: "var(--info)", width: 2 },
    }),
    Bold.extend(emphasis("**", "__")),
    Italic.extend(emphasis("*", "_")),
    Underline.extend(plain),
    Strike.extend(emphasis("~~")),
    Code.extend(plain),
    CodeBlock,
    TaskList,
    Todo.configure({ nested: true }),
    OrderedListStyles,
    TextHighlight.extend(emphasis("==")),
    Typography,
    Toggle.configure({ persist: true, HTMLAttributes: { class: "ll-toggle" } }),
    DetailsSummary,
    DetailsContent,
    Tables,
    Columns,
    Column,
    Group,
    EmojiPrefix,
    ...createMedia(opts.assets),
    MarkdownPaste,
    // Link nodes are always in the schema, so a page with links reads even without a host.
    Mention.configure({ host }),
    PageLink.configure({ host }),
    LinkMenus.configure({ host }),
    Note.configure({ onAdd: opts.onNote ?? null }),
    Cited,
    Thought,
    Cite,
    opts.placeholder ? Placeholder.configure({ paragraph: opts.placeholder }) : Placeholder,
    BlurSelection,
    WritingAids,
    CaretScroll,
    SlashCommands.configure({ host }),
    BlockSelectionExtension,
    SelectAll,
    BlockDrop,
    Unformat,
    KeepTab,
    OpenLinks.configure({ open: opts.openLink }),
    ExitTop.configure({ onExitTop: opts.onExitTop }),
  ];
}
