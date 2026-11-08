import { ArrowDown, ArrowUp, CalendarDays, CornerDownLeft, Globe, Plus, Settings } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { closeSettings, openSettings } from "@/views/settings/open";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@leadinglight/ui/components/command";
import { Kbd, KbdGroup } from "@leadinglight/ui/components/kbd";
import { ICONS, toggleView } from "~/components/bar";
import { RowIcon } from "~/components/page-icon";
import { type BarView, NAMES, showing } from "~/lib/bar";
import { dayPage, today } from "~/lib/daily";
import { useKeysFor } from "~/lib/keymap";
import { pageLabel } from "~/lib/labels";
import { rank } from "~/lib/match";
import type { ObjectSummary } from "~/lib/objects";
import { holder, openBeside, openFrom, panes } from "~/lib/panes";
import { useMobile } from "~/lib/platform";
import { browserView, CALENDAR_VIEW, iconFor, listed, pageOf, propOf, type Space, space, typeOf, typeView } from "~/lib/space";
import { createStore } from "~/lib/state";
import { PAGE_TYPE } from "~/lib/store";
import { ABOUT } from "~/lib/tail-memory";
import { newPage } from "~/lib/templates";

// Quick open (features/search.feature): ⌘K, a few letters of a page's name, Enter.
export const quickOpen = createStore(false);
// Where the keyboard was, noted here: the field's autoFocus takes it before Base UI can. Base UI
// reads finalFocus only once the switcher has gone, so chose is cleared on the next open.
let back: HTMLElement | null = null;
let chose = false;
export const toggleQuickOpen = () => {
  if (!quickOpen.get()) {
    const a = document.activeElement;
    back = a instanceof HTMLElement && a !== document.body ? a : null;
    chose = false;
  }
  quickOpen.set(!quickOpen.get());
};

type How = { shiftKey: boolean; metaKey: boolean };
// pane: what it opens lands in a pane, whose page then takes the keyboard.
type Row = { value: string; label: string; icon: ReactNode; meta?: string; open?: boolean; keys?: string; pane: boolean; run: (how: How) => unknown };
type Group = { value: string; label?: string; items: Row[] };
const BAR: BarView[] = ["suggestions", "feed", "captures", "ask"];
const icon = (Icon: typeof Globe) => <Icon className="size-4 shrink-0 text-muted-foreground" />;

// Daily notes, tags, templates and the app's own pages (agents, reports) have their own places.
const findable = (p: ObjectSummary) => listed(p) && !typeOf(p.typeId).made;
const names = (p: ObjectSummary) => [p.title, ...(typeof p.properties.aliases === "string" ? p.properties.aliases.split(/[,;\n]/) : [])];
const projectOf = (p: ObjectSummary) => {
  for (const [key, value] of Object.entries(p.properties)) {
    const prop = propOf(key);
    if (prop?.kind === "relation" && prop.options.type === "project" && Array.isArray(value)) return pageOf(String(value[0]))?.title;
  }
};

const pageRow = (p: ObjectSummary): Row => ({
  value: p.id,
  label: pageLabel(p.title),
  icon: <RowIcon icon={iconFor(p)} />,
  meta: [typeOf(p.typeId).name, projectOf(p)].filter(Boolean).join(" · "),
  open: !!holder(p.id),
  pane: true,
  run: (how) => openFrom(p.id, how),
});

// The places the sidebar and the bar lead to, by name.
function commands({ pages, types }: Space, mobile: boolean, keys: (id: string) => string | undefined): Row[] {
  const row = (value: string, label: string, i: ReactNode, run: Row["run"], pane = true, k?: string): Row => ({ value: `cmd:${value}`, label, icon: i, keys: k, pane, run });
  return [
    row("today", "Today", icon(CalendarDays), (how) => dayPage(today()).then((id) => openFrom(id, how))),
    row("calendar", "Calendar", icon(CalendarDays), (how) => openFrom(CALENDAR_VIEW, how)),
    ...(mobile ? [] : [row("browser", "Browser", icon(Globe), () => openBeside(browserView("")))]),
    row("settings", "Settings", icon(Settings), () => openSettings(), false, keys("settings")),
    // The sidebar's types: the app's own once there is one of them.
    ...types
      .filter((t) => !t.made || (t.id !== ABOUT && pages.some((p) => p.typeId === t.id)))
      .map((t) => row(`type:${t.id}`, t.plural, <RowIcon icon={t.icon} />, (how) => openFrom(typeView(t.id), how))),
    ...BAR.map((v) => row(v, NAMES[v], icon(ICONS[v]), () => showing(v) || toggleView(v), false, keys(v))),
  ];
}

function groupsFor(query: string, s: Space, mobile: boolean, keys: (id: string) => string | undefined): Group[] {
  const all = commands(s, mobile, keys);
  const title = query.trim();
  if (!title) {
    const recent = s.pages.filter(findable).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    return [{ value: "recent", label: "Recent", items: recent.map(pageRow) }, { value: "commands", label: "Commands", items: all }];
  }
  const hits = s.pages
    .filter(findable)
    .map((p) => ({ p, r: Math.min(...names(p).map((n) => rank(title, n) ?? Infinity)) }))
    .filter((h) => h.r < Infinity)
    .sort((a, b) => a.r - b.r || b.p.updatedAt - a.p.updatedAt);
  const create: Row = { value: "new", label: `New page “${title}”`, icon: <Plus className="size-4 shrink-0 text-muted-foreground" />, pane: true, run: (how) => newPage(PAGE_TYPE, { title }).then((obj) => openFrom(obj.id, how)) };
  // Commands match by a word's start, never by scattered letters.
  const cmds = all.map((c) => ({ c, r: rank(title, c.label) ?? 3 })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r);
  // Commands come second, unless one is named better than any page ("today", "sett").
  const ahead = (cmds[0]?.r ?? 3) < (hits[0]?.r ?? 3);
  // Fifty pages are plenty to scroll; more letters narrow them.
  const pages: Group = { value: "pages", label: ahead ? "Pages" : undefined, items: hits.slice(0, 50).map((h) => pageRow(h.p)) };
  const commandsGroup: Group = { value: "commands", label: "Commands", items: cmds.map((x) => x.c) };
  const exact = hits[0]?.r === 0 || cmds[0]?.r === 0;
  return [...(ahead ? [commandsGroup, pages] : [pages, commandsGroup]), { value: "new", items: exact ? [] : [create] }].filter((g) => g.items.length);
}

// Once the switcher has gone (the page behind is inert till then), a page opened takes the
// keyboard; anything else that left it nowhere (Captures) gives it back.
function settle(pane: boolean, tries = 60) {
  const card = document.querySelector(`[data-pane="${panes.get().focus}"]`);
  const editor = card?.querySelector<HTMLElement>(".ProseMirror[contenteditable=true]");
  const gone = !document.querySelector("[data-slot=command-dialog-popup]");
  if (gone && !pane) return void (document.activeElement === document.body && back?.isConnected && back.focus());
  if (gone && card?.contains(document.activeElement)) return;
  if (gone && editor) return editor.focus();
  if (tries) requestAnimationFrame(() => settle(pane, tries - 1));
}

// Centred over the pages, not the window, as far as the window allows.
function overPages() {
  const area = (document.querySelector("[data-pane-area]") ?? document.querySelector(".ll-inset"))?.getBoundingClientRect();
  if (!area) return 0;
  const room = Math.max(0, innerWidth - 32 - Math.min(560, innerWidth - 32)) / 2;
  return Math.max(-room, Math.min(room, (area.left + area.right - innerWidth) / 2));
}

export function QuickOpen() {
  const open = quickOpen.use();
  const s = space.use();
  const mobile = useMobile();
  const keys = useKeysFor();
  const [query, setQuery] = useState("");
  // Base UI runs a plain Enter itself but ignores ⇧↩ and ⌘↩, which run the highlighted row here.
  const highlighted = useRef<Row>(undefined);
  const groups = useMemo(() => (open ? groupsFor(query, s, mobile, keys) : []), [open, query, s, mobile, keys]);
  // Measured again on close too, so it doesn't move while it fades.
  const left = useMemo(overPages, [open]);

  const choose = (row: Row, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const how = { shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey };
    chose = true;
    quickOpen.set(false);
    if (row.pane && useStore.getState().view.kind === "settings") closeSettings();
    void Promise.resolve(row.run(how)).then(() => settle(row.pane), console.error);
  };

  return (
    <CommandDialog onOpenChange={quickOpen.set} onOpenChangeComplete={(o) => o || setQuery("")} open={open}>
      <CommandDialogPopup
        aria-label="Quick open"
        className="max-h-[min(32rem,80vh)] max-w-[560px] sm:mt-[2vh]"
        finalFocus={() => !chose && !!back?.isConnected && back}
        style={{ left }}
      >
        <Command items={groups} mode="none" onItemHighlighted={(row) => void (highlighted.current = row as Row | undefined)} onValueChange={setQuery} value={query}>
          <CommandInput
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.shiftKey || e.metaKey || e.ctrlKey) || !highlighted.current) return;
              e.preventDefault();
              choose(highlighted.current, e);
            }}
            placeholder="Open a page…"
          />
          <CommandPanel>
            <CommandList>
              {(group: Group) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    {group.label && <CommandGroupLabel>{group.label}</CommandGroupLabel>}
                    <CommandCollection>
                      {(row: Row) => (
                        <CommandItem className="gap-2" key={row.value} onClick={(e) => choose(row, e)} value={row}>
                          {row.icon}
                          <span className="min-w-0 truncate">{row.label}</span>
                          <span className="min-w-0 flex-[1_1_0] truncate text-muted-foreground">{row.meta}</span>
                          {row.open && <span className="shrink-0 text-muted-foreground text-xs">open</span>}
                          {row.keys && <Kbd className="shrink-0">{row.keys}</Kbd>}
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  <CommandSeparator />
                </Fragment>
              )}
            </CommandList>
          </CommandPanel>
          {/* Above the popup's muted ::before, which otherwise veils the hints past reading. */}
          <CommandFooter className="relative">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd><ArrowUp /></Kbd>
                  <Kbd><ArrowDown /></Kbd>
                </KbdGroup>
                <span>Move</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd><CornerDownLeft /></Kbd>
                <span>Open</span>
              </div>
              {!mobile && <>
                <div className="flex items-center gap-2">
                  <Kbd>⇧<CornerDownLeft /></Kbd>
                  <span>Beside</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>⌘<CornerDownLeft /></Kbd>
                  <span>New tab</span>
                </div>
              </>}
            </div>
            <div className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
