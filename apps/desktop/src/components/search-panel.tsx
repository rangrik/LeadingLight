import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, Plus, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { Toggle } from "@leadinglight/ui/components/toggle";
import { useStore } from "@/lib/store";
import { closeSettings } from "@/views/settings/open";
import { RowIcon } from "~/components/page-icon";
import { lightWords } from "~/lib/feed";
import { pageLabel } from "~/lib/labels";
import { liveEditor, whenLive } from "~/lib/live";
import { focusedPage, openBeside, openPage } from "~/lib/panes";
import { type Block, type Filter, filtersFor, grouped, type Hit, marks, parse, readIndex, search, snippet, toggle } from "~/lib/search";
import { iconFor, space } from "~/lib/space";
import { createStore } from "~/lib/state";
import { PAGE_TYPE } from "~/lib/store";
import { newPage } from "~/lib/templates";

// ⌘K and the sidebar's Search row (features/search.feature).
export const searching = createStore(false);
export const toggleSearch = () => searching.set(!searching.get());

type Row = { key: string; hit?: Hit; create?: string; all?: Filter; count?: number };
type Rows = { value: string; label: string; items: Row[] };

const RECENT = 8;
// More than this in a group is behind its "Show all", which filters to the group's type.
const PER_GROUP = 6;

export function SearchPanel() {
  const open = searching.use();
  // The editor that had the keyboard gets it back on Esc.
  const back = useRef<string | undefined>(undefined);
  const chosen = useRef(false);
  useEffect(() => {
    if (!open) return;
    const page = focusedPage();
    back.current = page && liveEditor(page)?.hasFocus() ? page : undefined;
    chosen.current = false;
  }, [open]);
  return (
    <CommandDialog onOpenChange={(next) => searching.set(next)} open={open}>
      <CommandDialogPopup
        aria-label="Search"
        // Two-line rows need more room than COSS's 420 px.
        className="max-h-[min(36rem,80vh)] max-w-[640px]"
        finalFocus={() => {
          if (chosen.current) return false;
          const editor = back.current ? liveEditor(back.current) : null;
          if (!editor) return true;
          editor.refocus();
          return false;
        }}
      >
        <SearchBody onChosen={() => { chosen.current = true; searching.set(false); }} />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function SearchBody({ onChosen }: { onChosen: () => void }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  // Bodies are read once, on the first open; until then titles are found.
  const [read, setRead] = useState(0);
  useEffect(() => void readIndex().then(() => setRead((n) => n + 1), console.error), []);
  // Typing never searches: only the words still there 80 ms after the last key do.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 80);
    return () => window.clearTimeout(t);
  }, [text]);
  const { pages, types } = space.use();
  const q = useMemo(() => parse(query), [query, pages, types]);
  const hits = useMemo(() => search(q), [q, read]);
  const rows = useMemo(() => rowsFor(q, hits), [q, hits]);
  const chips = useMemo(() => chipsFor(q, hits), [q, hits]);
  const highlighted = useRef<Row | undefined>(undefined);

  const setNow = (next: string) => {
    setText(next);
    setQuery(next);
  };
  const choose = (row: Row, beside: boolean) => {
    if (row.all) return setNow(toggle(q, row.all));
    onChosen();
    if (useStore.getState().view.kind === "settings") closeSettings();
    const go = (id: string) => (beside ? openBeside(id) : openPage(id));
    if (row.create !== undefined) {
      const type = q.filters.find((f) => f.kind === "type")?.id ?? PAGE_TYPE;
      // Made to be written in: the caret goes to its body.
      return void newPage(type, { title: row.create }).then((p) => (go(p.id), whenLive(p.id, (live) => live.focus())), console.error);
    }
    if (!row.hit) return;
    const { page, block } = row.hit;
    go(page.id);
    // Once the page has laid out its words, as the Feed does.
    if (block) whenLive(page.id, (live) => requestAnimationFrame(() => requestAnimationFrame(() => showBlock(page.id, block, live))));
  };
  const act = useRef({ choose, setNow });
  act.current = { choose, setNow };

  // A key changes only the field; what is below it changes with the search, 80 ms later.
  const filters = useMemo(() => chips.length > 0 && (
    <div aria-label="Filters" className="flex flex-wrap gap-1.5 px-4 pb-2.5" role="group">
      {chips.map((f) => {
        const on = q.filters.some((g) => g.kind === f.kind && g.id === f.id);
        return (
          <Toggle
            key={`${f.kind}:${f.id}`}
            // The field keeps the keyboard.
            onMouseDown={(e) => e.preventDefault()}
            onPressedChange={() => act.current.setNow(toggle(q, f))}
            pressed={on}
            size="sm"
            variant="outline"
          >
            {f.label}
            {on && <X />}
          </Toggle>
        );
      })}
    </div>
  ), [chips, q]);
  const list = useMemo(() => (
    <CommandPanel>
      {rows[0]?.items[0]?.create !== undefined && <p className="px-4 pt-4 text-muted-foreground text-sm">Nothing has these words.</p>}
      <CommandList>
        {(group: Rows) => (
          <Fragment key={group.value}>
            <CommandGroup items={group.items}>
              {group.label && <CommandGroupLabel>{group.label}</CommandGroupLabel>}
              <CommandCollection>
                {(row: Row) => (
                  <CommandItem className="items-start gap-2" key={row.key} onClick={(e) => act.current.choose(row, e.shiftKey)} value={row}>
                    <RowView row={row} terms={q.terms} />
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
            <CommandSeparator />
          </Fragment>
        )}
      </CommandList>
    </CommandPanel>
  ), [rows, q]);

  return (
    <Command
      itemToStringValue={(row) => (row as Row).key}
      items={rows}
      mode="none"
      onItemHighlighted={(row) => void (highlighted.current = row as Row | undefined)}
      // Only typing changes the words: choosing a row must not write its key into the field.
      onValueChange={(value, { reason }) => (reason === "input-change" || reason === "input-clear") && setText(value)}
      value={text}
    >
      <CommandInput
        aria-label="Search"
        onKeyDown={(e) => {
          // The list is always open, so its own Escape would close nothing: one Escape closes the panel.
          if (e.key === "Escape") {
            e.preventBaseUIHandler();
            return searching.set(false);
          }
          if (e.key !== "Enter" || !highlighted.current) return;
          e.preventDefault();
          e.preventBaseUIHandler();
          choose(highlighted.current, e.shiftKey);
        }}
        placeholder="Search pages and their words"
      />
      {filters}
      {list}
      {FOOTER}
    </Command>
  );
}

// Relative, so its hints sit above the popup's tint rather than under it.
const FOOTER = (
  <CommandFooter className="relative">
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <KbdGroup>
          <Kbd><ArrowUpIcon /></Kbd>
          <Kbd><ArrowDownIcon /></Kbd>
        </KbdGroup>
        <span>Navigate</span>
      </div>
      <div className="flex items-center gap-2">
        <Kbd><CornerDownLeftIcon /></Kbd>
        <span>Open</span>
      </div>
      <div className="flex items-center gap-2">
        <KbdGroup>
          <Kbd>⇧</Kbd>
          <Kbd><CornerDownLeftIcon /></Kbd>
        </KbdGroup>
        <span>Open beside</span>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Kbd>Esc</Kbd>
      <span>Close</span>
    </div>
  </CommandFooter>
);

// The block the words are in, scrolled to and lit, with the caret at its start.
function showBlock(id: string, block: Block, live: { editor: () => ReturnType<typeof liveEditor>; reveal: (anchor: string) => void }) {
  const editor = live.editor();
  const at = block.raw ? editor?.find(block.raw, 0) : null;
  if (!editor || !at) return live.reveal(`b${block.top}`);
  editor.focus(at.from);
  lightWords(id, block.raw);
}

function rowsFor(q: ReturnType<typeof parse>, hits: Hit[]): Rows[] {
  if (!q.terms.length && !q.filters.length) return [{ value: "recent", label: "Recent", items: hits.slice(0, RECENT).map((hit) => ({ key: hit.page.id, hit })) }];
  if (!hits.length) return q.rest ? [{ value: "new", label: "", items: [{ key: "new", create: q.rest }] }] : [];
  const typed = q.filters.some((f) => f.kind === "type");
  const all = filtersFor();
  return grouped(hits).map(({ type, hits: list }) => {
    const items: Row[] = list.slice(0, typed ? 50 : PER_GROUP).map((hit) => ({ key: hit.page.id, hit }));
    const filter = all.find((f) => f.kind === "type" && f.id === type.id);
    if (!typed && filter && list.length > PER_GROUP) items.push({ key: `all:${type.id}`, all: filter, count: list.length });
    return { value: type.id, label: `${type.plural} · ${list.length}`, items };
  });
}

// The filters on first, then the types and projects the results fall in, and "Edited this week".
function chipsFor(q: ReturnType<typeof parse>, hits: Hit[]): Filter[] {
  const on = (kind: Filter["kind"]) => q.filters.find((f) => f.kind === kind);
  const count = new Map<string, number>();
  for (const h of hits) for (const id of [h.page.typeId, h.project?.id]) if (id) count.set(id, (count.get(id) ?? 0) + 1);
  const offered = (kind: Filter["kind"], n: number) =>
    on(kind) ? [on(kind)!] : filtersFor().filter((f) => f.kind === kind && count.has(f.id)).sort((a, b) => count.get(b.id)! - count.get(a.id)!).slice(0, n);
  const all = [...offered("type", 3), ...offered("project", 2), on("week") ?? filtersFor().find((f) => f.kind === "week")!];
  return [...all.filter((f) => q.filters.includes(f)), ...all.filter((f) => !q.filters.includes(f))];
}

function Bold({ text, spans }: { text: string; spans: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<b className="font-semibold text-foreground" key={a}>{text.slice(a, b)}</b>);
    at = b;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function RowView({ row, terms }: { row: Row; terms: string[] }) {
  if (row.create !== undefined)
    return (
      <>
        <span className="flex h-5 items-center"><Plus className="size-4 text-muted-foreground" /></span>
        <span className="min-w-0 flex-1 basis-0 truncate">New page “{row.create}”</span>
      </>
    );
  if (row.all) return <span className="min-w-0 flex-1 basis-0 truncate ps-6 text-muted-foreground">Show all {row.count} {row.all.label.toLowerCase()}</span>;
  const { page, title, block, more, project } = row.hit!;
  const label = pageLabel(page.title);
  const line = block && snippet(block.text, marks(block.text, terms));
  return (
    <>
      <span className="flex h-5 items-center"><RowIcon icon={iconFor(page)} /></span>
      <span className="flex min-w-0 flex-1 basis-0 flex-col">
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 basis-0 truncate">
            <Bold spans={title ? marks(label, terms) : []} text={label} />
          </span>
          {project && <span className="shrink-0 text-muted-foreground text-xs">{pageLabel(project.title)}</span>}
        </span>
        {line && (
          <span className="flex items-baseline gap-3 text-muted-foreground text-xs leading-5">
            <span className="min-w-0 flex-1 basis-0 truncate">
              <Bold spans={line.spans} text={line.text} />
            </span>
            {more > 0 && <span className="shrink-0">+{more} more</span>}
          </span>
        )}
      </span>
    </>
  );
}
