import { Extension, type KeyboardShortcutCommand } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Highlight from "@tiptap/extension-highlight";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import type { AssetStore } from "./assets";
import { BlockSelectionExtension, SelectAll } from "./block-selection";
import { CodeBlock } from "./code-block";
import { BlockDrop } from "./drop";
import { EmojiPrefix } from "./emoji-prefix";
import { Column, Columns, Group } from "./layout";
import { OrderedListStyles } from "./lists";
import { createMedia } from "./media";
import { SlashCommands, slashMenuOpen } from "./slash-menu";
import { Tables } from "./table";

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
        !slashMenuOpen(this.editor.state) && first() && this.editor.view.endOfTextblock("up") && this.options.onExitTop(),
      Backspace: () => {
        const { doc, selection } = this.editor.state;
        return first() && doc.childCount === 1 && selection.$from.parent.content.size === 0 && this.options.onExitTop();
      },
    };
  },
});

// Enter in an open toggle's title moves into its empty first line instead of adding another.
const Toggle = Details.extend({
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

const hint = (node: PMNode) => {
  if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
  if (node.type.name === "detailsSummary") return "Toggle";
  return node.type.name === "paragraph" ? "Type '/' for commands" : null;
};

// The hint on the empty line holding the text cursor, at any depth (columns, toggles, lists,
// cells). Ours because TipTap's nested mode leaves old hints behind (3.32).
const Placeholder = Extension.create({
  name: "placeholder",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("placeholder"),
        props: {
          decorations: ({ doc, selection }) => {
            const node = selection.$from.parent;
            const text = selection instanceof TextSelection && selection.empty && !node.content.size && hint(node);
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

// Meta+click (Ctrl+click elsewhere) opens a link; a plain click puts the cursor in it.
const OpenLinks = Extension.create<{ open: (href: string) => void }>({
  name: "openLinks",
  addOptions: () => ({ open: () => {} }),
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("openLinks"),
        props: {
          handleClick: (_view, _pos, event) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
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

export function createExtensions(opts: {
  onExitTop: () => boolean;
  assets: AssetStore;
  openLink: (href: string) => void;
}) {
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
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      dropcursor: { color: "var(--info)", width: 2 },
    }),
    Bold.extend(plain),
    Italic.extend(plain),
    Underline.extend(plain),
    Strike.extend(plain),
    Code.extend(plain),
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    OrderedListStyles,
    Highlight.extend(plain),
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
    Placeholder,
    BlurSelection,
    SlashCommands,
    BlockSelectionExtension,
    SelectAll,
    BlockDrop,
    Unformat,
    KeepTab,
    OpenLinks.configure({ open: opts.openLink }),
    ExitTop.configure({ onExitTop: opts.onExitTop }),
  ];
}
