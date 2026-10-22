import { type Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEditorState } from "@tiptap/react";
import { useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup } from "@leadinglight/ui/components/popover";
import { EMOJI } from "./emoji-data";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    emojiPrefix: {
      setEmoji: (emoji: string | null) => ReturnType;
    };
  }
}

export const DEFAULT_EMOJI = "💡";
const TYPES = ["paragraph", "heading"];

type PickerState = { pos: number } | null;
const pickerKey = new PluginKey<PickerState>("emojiPicker");

// Blocks with an emoji attribute get a clickable emoji in front of their text.
// The same global attributes carry "small" for small text.
export const EmojiPrefix = Extension.create({
  name: "emojiPrefix",

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          emoji: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-emoji"),
            renderHTML: (attrs) => (attrs.emoji ? { "data-emoji": attrs.emoji } : {}),
          },
          small: {
            default: false,
            parseHTML: (el) => el.hasAttribute("data-small"),
            renderHTML: (attrs) => (attrs.small ? { "data-small": "" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setEmoji:
        (emoji) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          if ($from.depth === 0 || !TYPES.includes($from.parent.type.name)) return false;
          if (dispatch) tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, emoji });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PickerState>({
        key: pickerKey,
        state: {
          init: () => null,
          apply: (tr, prev) => {
            const meta = tr.getMeta(pickerKey) as PickerState | undefined;
            if (meta !== undefined) return meta;
            return prev && tr.docChanged ? { pos: tr.mapping.map(prev.pos) } : prev;
          },
        },
        props: {
          decorations: (state) => {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.attrs.emoji) return;
              decos.push(
                Decoration.widget(pos + 1, (view) => emojiButton(node.attrs.emoji, pos, view.editable), {
                  side: -1,
                  key: `emoji-${pos}-${node.attrs.emoji}`,
                }),
              );
            });
            return DecorationSet.create(state.doc, decos);
          },
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = (event.target as HTMLElement).closest<HTMLElement>("[data-emoji-button]");
              if (!target || !view.editable) return false;
              event.preventDefault();
              view.dispatch(view.state.tr.setMeta(pickerKey, { pos: Number(target.dataset.emojiButton) }));
              return true;
            },
          },
        },
      }),
    ];
  },
});

// On a read-only page the emoji is plain text, not a control.
function emojiButton(emoji: string, pos: number, editable: boolean): HTMLElement {
  const el = document.createElement(editable ? "button" : "span");
  el.className = "ll-emoji";
  el.contentEditable = "false";
  el.textContent = emoji;
  if (el instanceof HTMLButtonElement) {
    el.type = "button";
    el.setAttribute("aria-label", "Change emoji");
    el.dataset.emojiButton = String(pos);
  }
  return el;
}

export function EmojiPicker({ editor }: { editor: Editor }) {
  const picker = useEditorState({ editor, selector: ({ editor }) => pickerKey.getState(editor.state) ?? null });
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const anchor = picker ? editor.view.dom.querySelector<HTMLElement>(`[data-emoji-button="${picker.pos}"]`) : null;

  const close = () => {
    setQuery("");
    editor.view.dispatch(editor.state.tr.setMeta(pickerKey, null));
    editor.view.focus();
  };
  const choose = (emoji: string | null) => {
    const node = picker && editor.state.doc.nodeAt(picker.pos);
    if (node) editor.view.dispatch(editor.state.tr.setNodeMarkup(picker.pos, undefined, { ...node.attrs, emoji }));
    close();
  };
  // Typing or pasting an emoji picks it straight away.
  const onInput = (value: string) => {
    const first = [...new Intl.Segmenter().segment(value)][0]?.segment;
    if (first && /\p{Extended_Pictographic}/u.test(first)) return choose(first);
    setQuery(value);
  };
  const q = query.trim().toLowerCase();
  const items = q ? EMOJI.filter(([, name]) => name.includes(q)) : EMOJI;

  return (
    <Popover onOpenChange={(open) => !open && close()} open={Boolean(anchor)}>
      <PopoverPopup align="start" anchor={anchor} aria-label="Emoji" className="w-72" initialFocus={inputRef}>
        <Input
          aria-label="Search emoji"
          onChange={(e) => onInput(e.currentTarget.value)}
          placeholder="Search, or type an emoji"
          ref={inputRef}
          size="sm"
          type="search"
          value={query}
        />
        <div className="-mx-1 mt-2 grid max-h-48 grid-cols-8 overflow-y-auto">
          {items.map(([emoji, name]) => (
            <Button aria-label={name} className="text-lg" key={emoji} onClick={() => choose(emoji)} size="icon-sm" variant="ghost">
              {emoji}
            </Button>
          ))}
          {items.length === 0 && <p className="col-span-8 px-1 py-2 text-muted-foreground text-sm">No results</p>}
        </div>
        <Button className="mt-2 w-full" onClick={() => choose(null)} size="xs" variant="ghost">
          Remove emoji
        </Button>
      </PopoverPopup>
    </Popover>
  );
}
