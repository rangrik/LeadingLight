import { Extension } from "@tiptap/core";
import { type EditorState, PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useRef } from "react";
import { cn } from "@leadinglight/ui/lib/utils";
import type { LinkHost } from "./page-links";
import { filterSlashItems, type SlashItem } from "./slash-items";
import { keepFocus, surface } from "./ui";

export const slashKey = new PluginKey("slashCommands");

// Our keymaps run before the menu's own key handling, so they check this first.
export const slashMenuOpen = (state: EditorState) =>
  Boolean((slashKey.getState(state) as { active?: boolean } | undefined)?.active);

type MenuProps = {
  items: SlashItem[];
  index: number;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
};

// Focus stays in the editor, so this is a listbox styled with COSS Menu's classes
// rather than a Base UI Menu, which would take focus.
function SlashMenu({ items, index, onPick, onHover }: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector("[data-highlighted]")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const sections = new Map<string, SlashItem[]>();
  for (const item of items) sections.set(item.section, [...(sections.get(item.section) ?? []), item]);

  return (
    <div aria-label="Insert block" className={cn(surface, "w-64")} role="listbox">
      <div className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain p-1" ref={listRef}>
        {items.length === 0 && <div className="px-2 py-1.5 text-muted-foreground text-sm">No results</div>}
        {[...sections].map(([name, list]) => (
          <div aria-label={name} key={name} role="group">
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">{name}</div>
            {list.map((item) => {
              const i = items.indexOf(item);
              return (
                <div
                  aria-selected={i === index}
                  className="flex min-h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-foreground text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground [&>:first-child]:-mx-0.5 [&>:first-child]:size-4 [&>:first-child]:shrink-0 [&>:first-child]:opacity-80"
                  data-highlighted={i === index || undefined}
                  key={item.id}
                  onClick={() => onPick(item)}
                  onMouseDown={keepFocus}
                  onMouseMove={() => i !== index && onHover(i)}
                  role="option"
                >
                  <item.icon />
                  <span className="flex-1 truncate">{item.title}</span>
                  {item.hint && (
                    <kbd className="ms-auto font-medium font-sans text-muted-foreground/72 text-xs tracking-widest">
                      {item.hint}
                    </kbd>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export const SlashCommands = Extension.create<{ host: LinkHost | null }>({
  name: "slashCommands",
  addOptions: () => ({ host: null }),

  addProseMirrorPlugins() {
    const host = this.options.host;
    const find = (query: string) => filterSlashItems(query, host?.types() ?? []);
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashKey,
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        // Not in code blocks, and give up once a query with a space matches nothing.
        allow: ({ state, range }) => {
          if (state.doc.resolve(range.from).parent.type.spec.code) return false;
          const query = state.doc.textBetween(range.from, range.to).slice(1);
          return !(query.includes(" ") && find(query).length === 0);
        },
        placement: "bottom-start",
        offset: { mainAxis: 8 },
        items: ({ query }) => find(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        // Items and the highlight live here, not in React state, so a fast "/table⏎"
        // picks from the list the plugin has, not one React hasn't rendered yet.
        render: () => {
          let menu: ReactRenderer<unknown, MenuProps> | undefined;
          let unmount: (() => void) | undefined;
          let current: SuggestionProps<SlashItem, SlashItem>;
          let index = 0;
          const props = (): MenuProps => ({
            items: current.items,
            index,
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
              menu = new ReactRenderer(SlashMenu, { props: props(), editor: p.editor });
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
                return true;
              }
              return false;
            },
            onExit: () => {
              unmount?.();
              menu?.destroy();
              menu = undefined;
            },
          };
        },
      }),
    ];
  },
});
