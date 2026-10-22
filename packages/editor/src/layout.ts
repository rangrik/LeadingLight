import { mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    layout: {
      setColumns: (count?: number) => ReturnType;
      setGroup: () => ReturnType;
    };
  }
}

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="column"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "column", class: "ll-column" }),
    0,
  ],
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,4}",
  isolating: true,
  defining: true,
  parseHTML: () => [{ tag: 'div[data-type="columns"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "columns", class: "ll-columns" }),
    0,
  ],

  addCommands() {
    return {
      setColumns:
        (count = 2) =>
        ({ chain, state }) => {
          const at = state.selection.from;
          return chain()
            .insertContent({
              type: this.name,
              content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
            })
            .command(({ tr }) => {
              // insertContent leaves the caret in the last column; start in the first.
              let found = -1;
              tr.doc.nodesBetween(tr.mapping.map(at, -1), tr.doc.content.size, (node, pos) => {
                if (found < 0 && node.type.name === this.name) found = pos;
                return found < 0;
              });
              if (found >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(found + 3)));
              return true;
            })
            .run();
        },
    };
  },

  // Tab hops to the next column when the cursor sits directly in a column's text.
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { $from } = this.editor.state.selection;
        if ($from.depth < 2 || $from.node(-1).type.name !== "column") return false;
        const columns = $from.node(-2);
        const index = $from.index(-2);
        if (index >= columns.childCount - 1) return false;
        const next = $from.start(-2) + columns.child(index).nodeSize + 1;
        this.editor.view.dispatch(
          this.editor.state.tr.setSelection(TextSelection.near(this.editor.state.doc.resolve(next))),
        );
        return true;
      },
    };
  },
});

export const Group = Node.create({
  name: "group",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML: () => [{ tag: 'div[data-type="group"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "group", class: "ll-group" }),
    0,
  ],

  addCommands() {
    return {
      setGroup:
        () =>
        ({ chain, state }) => {
          if (state.selection.empty && state.selection.$from.parent.content.size === 0) {
            return chain()
              .insertContent({ type: this.name, content: [{ type: "paragraph" }] })
              .run();
          }
          return chain().wrapIn(this.name).run();
        },
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-g": () => this.editor.commands.setGroup() };
  },
});
