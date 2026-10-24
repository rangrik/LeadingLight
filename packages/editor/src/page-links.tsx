import { type Editor, Extension, mergeAttributes, Node, type Range } from "@tiptap/core";
import { type EditorState, PluginKey } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { type ComponentType, Fragment, type ReactNode, useEffect, useRef } from "react";
import { cn } from "@leadinglight/ui/lib/utils";
import { keepFocus, surface } from "./ui";

// Links to other pages. The editor stores only page ids; the app supplies search, creation
// and how a link looks, so titles and icons always show their current state.

// Items sharing a section sit under its heading; a key starting "new" makes a page.
export type LinkItem = { key: string; title: string; icon: ReactNode; hint?: string; section?: string; link: () => Promise<string> };
export type LinkType = { id: string; name: string; icon: ReactNode; tag?: boolean };
export type LinkHost = {
  // Given a type, only its pages, after a new one of it.
  search: (query: string, tag: boolean, typeId?: string) => LinkItem[];
  // What the slash menu's "New" section offers.
  types: () => LinkType[];
  title: (id: string) => string; // for copying as plain text
  Mention: ComponentType<{ id: string; tag: boolean }>;
  Block: ComponentType<{ id: string; view: string | null; setView: (view: string) => void; selected: boolean }>;
};

// An inline link: "@Dune" in a sentence, or "#idea" for a tag.
export const Mention = Node.create<{ host: LinkHost | null }>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ host: null }),
  addAttributes: () => ({ id: { default: null }, tag: { default: false } }),
  parseHTML: () => [{ tag: "span[data-mention]", getAttrs: (el) => ({ id: el.getAttribute("data-mention"), tag: el.hasAttribute("data-tag") }) }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-mention": node.attrs.id, ...(node.attrs.tag ? { "data-tag": "" } : {}) }),
  ],
  renderText({ node }) {
    return `${node.attrs.tag ? "#" : "@"}${this.options.host?.title(node.attrs.id) ?? ""}`;
  },
  addNodeView() {
    const Host = this.options.host?.Mention;
    return ReactNodeViewRenderer(({ node }: NodeViewProps) => (
      <NodeViewWrapper as="span" className="ll-mention">
        {Host ? <Host id={node.attrs.id} tag={node.attrs.tag} /> : node.attrs.id}
      </NodeViewWrapper>
    ));
  },
});

// A link on its own line, shown as a line, a card or the page itself.
export const PageLink = Node.create<{ host: LinkHost | null }>({
  name: "pageLink",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions: () => ({ host: null }),
  addAttributes: () => ({ id: { default: null }, view: { default: null } }),
  parseHTML: () => [{ tag: "div[data-page-link]", getAttrs: (el) => ({ id: el.getAttribute("data-page-link"), view: el.getAttribute("data-view") }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-link": node.attrs.id, "data-view": node.attrs.view })],
  renderText({ node }) {
    return this.options.host?.title(node.attrs.id) ?? "";
  },
  addNodeView() {
    const Host = this.options.host?.Block;
    return ReactNodeViewRenderer(
      ({ node, updateAttributes, selected }: NodeViewProps) => (
        <NodeViewWrapper className="ll-page-link" data-selected={selected || undefined}>
          {Host ? <Host id={node.attrs.id} selected={selected} setView={(view) => updateAttributes({ view })} view={node.attrs.view} /> : node.attrs.id}
        </NodeViewWrapper>
      ),
      // Clicks and keys inside a card belong to the card's own controls.
      { stopEvent: ({ event }) => (event.target as Element | null)?.closest?.("button, a, input, [role=menu], [role=checkbox]") != null },
    );
  },
});

type MenuProps = { items: LinkItem[]; index: number; empty: string; onPick: (item: LinkItem) => void; onHover: (i: number) => void };

// Keys that must not reach the editor's own keymaps (Escape selects a block) while a menu is open.
const keys = { "@": new PluginKey("links@"), "[[": new PluginKey("links[["), "#": new PluginKey("links#") };
export const linkMenuOpen = (state: EditorState) =>
  Object.values(keys).some((k) => Boolean((k.getState(state) as { active?: boolean } | undefined)?.active));

// Focus stays in the editor, so this is a listbox styled like the slash menu.
function LinkMenu({ items, index, empty, onPick, onHover }: MenuProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector("[data-highlighted]")?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <div aria-label="Link to a page" className={cn(surface, "w-72")} role="listbox">
      <div className="max-h-[min(20rem,50vh)] overflow-y-auto overscroll-contain p-1" ref={list}>
        {items.length === 0 && <div className="px-2 py-1.5 text-muted-foreground text-sm">{empty}</div>}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.section && item.section !== items[i - 1]?.section && (
              <div className="truncate px-2 py-1.5 font-medium text-muted-foreground text-xs" role="presentation">
                {item.section}
              </div>
            )}
            <div
              aria-selected={i === index}
              className="flex min-h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-foreground text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              data-highlighted={i === index || undefined}
              onClick={() => onPick(item)}
              onMouseDown={keepFocus}
              onMouseMove={() => i !== index && onHover(i)}
              role="option"
            >
              {item.icon}
              <span className="flex-1 truncate">{item.title}</span>
              {item.hint && <span className="shrink-0 text-muted-foreground text-xs">{item.hint}</span>}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// The type an "@" (or a "#", for a tag) was typed for by the slash menu's "New" section, until
// its menu closes.
const naming = new WeakMap<Editor, LinkType>();

// "/task": an "@" whose menu names a new task, or links one there is.
export function nameNew(editor: Editor, range: Range, type: LinkType) {
  naming.set(editor, type);
  editor.chain().focus().deleteRange(range).insertContent(type.tag ? "#" : "@").run();
}

function linkSuggestion(editor: Editor, host: LinkHost, char: keyof typeof keys, tag: boolean) {
  let busy = false; // one pick at a time: a double click must not make two pages
  const scope = () => {
    const type = naming.get(editor);
    return type && char !== "[[" && Boolean(type.tag) === tag ? type : undefined;
  };
  return Suggestion<LinkItem, LinkItem>({
    pluginKey: keys[char],
    editor,
    char,
    // "[[" runs to the end of a title, spaces and all; "@" keeps going past a space while a page
    // matches, or while it names a new page.
    allowSpaces: !tag,
    allow: ({ state, range }) => {
      if (state.doc.resolve(range.from).parent.type.spec.code) return false;
      const query = state.doc.textBetween(range.from, range.to).slice(char.length);
      // "#" alone starts a heading; the menu waits for the first letter, unless "/tag" typed it.
      if (tag) return query.length > 0 || Boolean(scope());
      return char === "[[" || Boolean(scope()) || !query.includes(" ") || host.search(query, false).some((i) => !i.key.startsWith("new"));
    },
    items: ({ query }) => host.search(query, tag, scope()?.id),
    command: ({ editor, range, props }) => {
      if (busy) return;
      busy = true;
      void props.link().finally(() => (busy = false)).then((id) => {
        const $from = editor.state.doc.resolve(range.from);
        // Alone on its line, a page link becomes a block; in a sentence it stays inline.
        // Top level only: a list item or a table cell can't hold a block link.
        const alone =
          !tag &&
          $from.depth === 1 &&
          $from.parent.type.name === "paragraph" &&
          $from.parent.textContent.trim() === editor.state.doc.textBetween(range.from, range.to).trim();
        if (alone) {
          // The cursor goes to the line after the link, adding one when there is none.
          const at = $from.before();
          const next = editor.state.doc.resolve($from.after()).nodeAfter;
          const line = next?.type.name === "paragraph" && next.content.size === 0 ? [] : [{ type: "paragraph" }];
          editor
            .chain()
            .focus()
            .insertContentAt({ from: at, to: $from.after() }, [{ type: "pageLink", attrs: { id } }, ...line])
            .setTextSelection(at + 2)
            .run();
        } else {
          editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id, tag } }, { type: "text", text: " " }]).run();
        }
      });
    },
    render: () => {
      let menu: ReactRenderer<unknown, MenuProps> | undefined;
      let unmount: (() => void) | undefined;
      let current: SuggestionProps<LinkItem, LinkItem>;
      let index = 0;
      const props = (): MenuProps => ({
        items: current.items,
        index,
        empty: scope() ? `Type a name for the new ${scope()!.name.toLowerCase()}` : tag ? "No tags" : "No pages",
        onPick: (item) => current.command(item),
        onHover: (i) => {
          index = i;
          menu?.updateProps(props());
        },
      });
      const move = (step: number) => {
        const n = current.items.length;
        if (n) index = (index + step + n) % n;
        menu?.updateProps(props());
        return true;
      };
      return {
        onStart: (p) => {
          current = p;
          index = 0;
          menu = new ReactRenderer(LinkMenu, { props: props(), editor: p.editor });
          unmount = p.mount(menu.element as HTMLElement);
        },
        onUpdate: (p) => {
          if (p.items !== current.items) index = 0;
          current = p;
          menu?.updateProps(props());
        },
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowDown") return move(1);
          if (event.key === "ArrowUp") return move(-1);
          if (event.key === "Enter") {
            const item = current.items[index];
            if (item) current.command(item);
            // Still asking for a name: Enter must not split the line.
            return Boolean(item || scope());
          }
          return false;
        },
        onExit: () => {
          if (scope()) naming.delete(editor);
          unmount?.();
          menu?.destroy();
          menu = undefined;
        },
      };
    },
  });
}

// "@" and "[[" link a page; "#" links a tag.
export const LinkMenus = Extension.create<{ host: LinkHost | null }>({
  name: "linkMenus",
  addOptions: () => ({ host: null }),
  addProseMirrorPlugins() {
    const host = this.options.host;
    if (!host) return [];
    return [linkSuggestion(this.editor, host, "@", false), linkSuggestion(this.editor, host, "[[", false), linkSuggestion(this.editor, host, "#", true)];
  },
});
