import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { Check, Copy, Repeat2, Trash } from "lucide-react";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "@leadinglight/ui/components/menu";
import { deleteBlocks, duplicateBlocks, selectedBlocks } from "./block-selection";
import { SLASH_ITEMS, type SlashItem } from "./slash-items";

// Where the menu opens: beside the block handle, or at the pointer for a right-click.
export type MenuAt = { rect: DOMRect; side: "left" | "bottom" };

const TURN_INTO = SLASH_ITEMS.filter((item) => item.turn);

// A block's kind as a slash item id. Tables, media and layout blocks have none, so they can't turn.
const KIND: Record<string, (node: PMNode) => string> = {
  paragraph: (n) => (n.attrs.emoji ? "emoji" : n.attrs.small ? "small" : "text"),
  heading: (n) => (n.attrs.emoji ? "emoji" : `h${n.attrs.level}`),
  blockquote: () => "quote",
  details: () => "toggle",
  bulletList: () => "bullet",
  orderedList: (n) => (n.attrs.type === "a" ? "alpha" : n.attrs.type === "i" ? "roman" : "numbered"),
  taskList: () => "todo",
  codeBlock: () => "code",
};

// The selected blocks with their kinds. List items take their list's kind.
function selectedKinds(editor: Editor): { pos: number; node: PMNode; kind?: string }[] {
  const range = selectedBlocks(editor.state.selection);
  if (!range) return [];
  const $from = editor.state.doc.resolve(range.from);
  const blocks: { pos: number; node: PMNode; kind?: string }[] = [];
  $from.parent.forEach((node, offset) => {
    const pos = $from.start() + offset;
    const owner = $from.depth ? $from.parent : node;
    if (pos >= range.from && pos < range.to) blocks.push({ pos, node, kind: KIND[owner.type.name]?.(owner) });
  });
  return blocks;
}

// Each block turns on its own, last first so earlier positions hold, all in one undo step.
function turnInto(editor: Editor, item: SlashItem) {
  const blocks = selectedKinds(editor);
  const last = blocks.at(-1);
  if (!last || !item.turn) return;
  let chain = editor.chain().focus();
  for (const { pos, node, kind } of [...blocks].reverse()) {
    if (kind === item.id) continue;
    const select = chain.command(({ tr }) => {
      const from = tr.mapping.map(pos);
      let to = tr.mapping.map(pos + node.nodeSize, -1);
      // A toggle opens up: only its title turns, and its body follows as it was.
      if (node.type.name === "details") {
        const title = editor.schema.nodes.paragraph.create(null, node.child(0).content);
        tr.replaceWith(from, to, Fragment.from(title).append(node.child(1).content));
        to = from + title.nodeSize;
      }
      tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)));
      return true;
    });
    chain = item.turn(select.clearNodes());
  }
  // The cursor ends on the last block's first line, as after typing a shortcut there.
  chain
    .command(({ tr }) => {
      const line = Selection.findFrom(tr.doc.resolve(tr.mapping.map(last.pos)), 1, true);
      if (line) tr.setSelection(TextSelection.create(tr.doc, line.$from.end()));
      return true;
    })
    .run();
}

export function BlockMenu({ editor, at, onClose }: { editor: Editor; at: MenuAt | null; onClose: () => void }) {
  const kinds = new Set(at ? selectedKinds(editor).map((b) => b.kind) : []);
  const current = kinds.size === 1 ? [...kinds][0] : undefined;
  const run = (action: typeof deleteBlocks) => {
    editor.view.dispatch(closeHistory(editor.state.tr));
    action(editor.view);
  };
  return (
    <Menu onOpenChange={(open) => !open && onClose()} open={at !== null}>
      <MenuPopup
        align="start"
        // Beside the handle, the first row lines up with it: 1 + 4 + 28 / 2 - 24 / 2.
        alignOffset={at?.side === "left" ? -7 : 0}
        anchor={at && { getBoundingClientRect: () => at.rect }}
        aria-label="Block"
        className="w-48"
        onKeyDownCapture={(event) => {
          const duplicate = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d";
          const remove = !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "Backspace" || event.key === "Delete");
          if (!duplicate && !remove) return;
          event.preventDefault();
          event.stopPropagation();
          run(duplicate ? duplicateBlocks : deleteBlocks);
          onClose();
        }}
        // Back to the editor, which still holds the selected blocks.
        finalFocus={() => {
          editor.view.focus();
          return false;
        }}
        side={at?.side}
        sideOffset={at?.side === "bottom" ? 0 : 4}
      >
        {kinds.size > 0 && !kinds.has(undefined) && (
          <>
            <MenuSub>
              <MenuSubTrigger>
                <Repeat2 />
                Turn into
              </MenuSubTrigger>
              <MenuSubPopup className="w-48">
                {TURN_INTO.map((item) => (
                  <MenuItem key={item.id} onClick={() => item.id !== current && turnInto(editor, item)}>
                    <item.icon />
                    <span className="flex-1">{item.title}</span>
                    {item.id === current && <Check />}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
            <MenuSeparator />
          </>
        )}
        <MenuItem onClick={() => run(duplicateBlocks)}>
          <Copy />
          Duplicate
          <MenuShortcut>⌘D</MenuShortcut>
        </MenuItem>
        <MenuItem onClick={() => run(deleteBlocks)}>
          <Trash />
          Delete
          <MenuShortcut>⌫</MenuShortcut>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
