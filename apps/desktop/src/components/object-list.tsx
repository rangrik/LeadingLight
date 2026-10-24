import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns3, LayoutGrid, List, Table as TableIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Select, SelectItem, SelectPopup, SelectPrimitive } from "@leadinglight/ui/components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@leadinglight/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@leadinglight/ui/components/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { PageCard } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { ValueView, visit } from "~/components/property-value";
import type { PropDef, ViewSettings } from "~/lib/catalog";
import { isDateValue } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { iconFor, pageOf } from "~/lib/space";

// Board is drawn on its own: it can be off.
const VIEWS = [
  ["list", "List", List],
  ["table", "Table", TableIcon],
  ["gallery", "Gallery", LayoutGrid],
] as const;

const NONE = "none";
const BUILT_IN: Record<string, string> = { title: "Title", created: "Created", updated: "Updated" };
const DAY: Record<string, string> = { day: "Day" }; // daily notes sort by their day

// Dates sort newest first when picked; everything else A to Z.
const newestFirst = (by: string, props: PropDef[]) =>
  by === "created" || by === "updated" || by === "day" || props.some((p) => p.id === by && (p.kind === "date" || p.kind === "created" || p.kind === "updated"));

// Grouping and the board need a select or checkbox; without one they show why they're off.
function Off({ children }: { children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup>Needs a select or checkbox property</TooltipPopup>
    </Tooltip>
  );
}

const ids = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

// A comparable form of a value; undefined sorts last either way.
function key(page: ObjectSummary, by: string, prop?: PropDef): string | number | undefined {
  if (by === "title") return pageLabel(page.title).toLowerCase();
  if (by === "created") return page.createdAt;
  if (by === "updated") return page.updatedAt;
  if (by === "day") return typeof page.properties.day === "string" ? page.properties.day : undefined;
  const v = page.properties[by];
  if (v === undefined || v === null || v === "") return undefined;
  switch (prop?.kind) {
    case "number":
      return typeof v === "number" ? v : undefined;
    case "checkbox":
      return v === true ? 1 : 0;
    case "date":
      return isDateValue(v) ? v.start + (v.time ?? "") : undefined;
    case "select":
      return prop.options.choices?.findIndex((c) => c.id === ids(v)[0]);
    case "relation":
      return pageLabel(pageOf(ids(v)[0])?.title ?? "").toLowerCase();
    default:
      return String(v).toLowerCase();
  }
}

function sorted(items: ObjectSummary[], { sort }: ViewSettings, props: PropDef[]) {
  const prop = props.find((p) => p.id === sort.by);
  return [...items].sort((a, b) => {
    const x = key(a, sort.by, prop);
    const y = key(b, sort.by, prop);
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return sort.desc ? -order : order;
  });
}

// Groups by a select or checkbox property, in its options' order; pages without a value last.
function grouped(items: ObjectSummary[], prop?: PropDef): { key: string; label: string; items: ObjectSummary[] }[] {
  if (!prop) return [{ key: "all", label: "", items }];
  if (prop.kind === "checkbox") {
    return [
      { key: "yes", label: prop.name, items: items.filter((p) => p.properties[prop.id] === true) },
      { key: "no", label: `Not ${prop.name.toLowerCase()}`, items: items.filter((p) => p.properties[prop.id] !== true) },
    ];
  }
  const choices = prop.options.choices ?? [];
  return [
    ...choices.map((c) => ({ key: c.id, label: c.name, items: items.filter((p) => ids(p.properties[prop.id]).includes(c.id)) })),
    { key: NONE, label: `No ${prop.name.toLowerCase()}`, items: items.filter((p) => !ids(p.properties[prop.id]).some((id) => choices.some((c) => c.id === id))) },
  ];
}

type Props = { items: ObjectSummary[]; props: PropDef[]; card: PropDef[]; settings: ViewSettings; onSettings: (s: ViewSettings) => void; empty: ReactNode };

// A set of pages as a list, table, gallery or board, sorted and grouped.
export function ObjectList({ items, props, card, settings, onSettings, empty }: Props) {
  const groupable = props.filter((p) => p.kind === "select" || p.kind === "checkbox");
  // A board kept from when there was something to group by shows as a list, not one column.
  const kind = settings.kind === "board" && !groupable.length ? "list" : settings.kind;
  const groupProp = groupable.find((p) => p.id === settings.group) ?? (kind === "board" ? groupable[0] : undefined);
  const groups = grouped(sorted(items, settings, props), groupProp).filter((g) => kind === "board" || g.items.length > 0);
  const set = (patch: Partial<ViewSettings>) => onSettings({ ...settings, ...patch });
  const sortItems = { ...BUILT_IN, ...(settings.sort.by === "day" || items.some((p) => p.properties.day) ? DAY : {}), ...Object.fromEntries(props.filter((p) => p.kind !== "file").map((p) => [p.id, p.name])) };
  const groupItems = { [NONE]: "No grouping", ...Object.fromEntries(groupable.map((p) => [p.id, p.name])) };

  // A grouped list doesn't repeat the group's value on every row.
  const shownOnRows = card.filter((c) => c.id !== groupProp?.id);
  // Each value has a column, so the same property lines up down the list. Titles give way first,
  // down to 6rem; then long values are cut too, so nothing leaves the pane.
  const columns = { gridTemplateColumns: ["auto", "minmax(6rem,1fr)", ...shownOnRows.map(() => "minmax(0,max-content)")].join(" ") };
  // A link, not a button: its relation chips are buttons.
  const row = (p: ObjectSummary) => (
    <div
      className="col-span-full grid h-8 cursor-default grid-cols-subgrid items-center rounded-md px-2 text-left transition-colors duration-150 hover:bg-accent"
      key={p.id}
      onClick={(e) => visit(p.id, e)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && visit(p.id, e as unknown as React.MouseEvent)}
      onPointerDown={(e) => armDrag(e, { page: p.id, label: pageLabel(p.title) })}
      role="link"
      tabIndex={0}
    >
      <RowIcon icon={iconFor(p)} />
      <span className="truncate">{pageLabel(p.title)}</span>
      {shownOnRows.map((c) => (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground text-xs" key={c.id}>
          {ValueView({ prop: c, value: p.properties[c.id], page: p })}
        </span>
      ))}
    </div>
  );
  const board = (
    <ToggleGroupItem aria-label="Board" disabled={!groupable.length} value="board">
      <Columns3 />
    </ToggleGroupItem>
  );
  const group = (
    <Select disabled={!groupable.length} items={groupItems} onValueChange={(v) => set({ group: v === NONE ? undefined : (v as string) })} value={groupProp?.id ?? NONE}>
      <SelectPrimitive.Trigger aria-label="Group by" render={<Button className="text-muted-foreground" size="sm" variant="ghost" />}>
        {groupProp ? `Group: ${groupProp.name}` : "Group"}
      </SelectPrimitive.Trigger>
      <SelectPopup alignItemWithTrigger={false}>
        {Object.entries(groupItems).map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );

  return (
    <div className="text-sm">
      {/* Controls and rows reach past the body's edge by their padding, so their text lines up with it. */}
      <div className="-ms-1.5 flex flex-wrap items-center gap-1">
        <ToggleGroup aria-label="View" onValueChange={(v) => v[0] && set({ kind: v[0] as ViewSettings["kind"] })} size="sm" value={[kind]}>
          {VIEWS.map(([view, label, Icon]) => (
            <ToggleGroupItem aria-label={label} key={view} value={view}>
              <Icon />
            </ToggleGroupItem>
          ))}
          {groupable.length ? board : <Off>{board}</Off>}
        </ToggleGroup>
        <Select items={sortItems} onValueChange={(v) => set({ sort: { by: v as string, desc: newestFirst(v as string, props) } })} value={settings.sort.by}>
          <SelectPrimitive.Trigger aria-label="Sort by" render={<Button className="text-muted-foreground" size="sm" variant="ghost" />}>
            Sort: {sortItems[settings.sort.by] ?? "Title"}
          </SelectPrimitive.Trigger>
          <SelectPopup alignItemWithTrigger={false}>
            {Object.entries(sortItems).map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          aria-label={settings.sort.desc ? "Descending" : "Ascending"}
          className="text-muted-foreground"
          onClick={() => set({ sort: { ...settings.sort, desc: !settings.sort.desc } })}
          size="icon-sm"
          variant="ghost"
        >
          {settings.sort.desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
        </Button>
        {groupable.length ? group : <Off>{group}</Off>}
      </div>

      {items.length === 0 && (typeof empty === "string" ? <p className="mt-3 text-muted-foreground">{empty}</p> : empty)}
      {items.length > 0 && kind === "board" && (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {groups.map((g) => (
            <div aria-label={g.label || "All"} className="flex min-w-48 flex-1 basis-0 flex-col gap-2" key={g.key} role="group">
              <div className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
                {g.label || "All"} <span className="font-normal">{g.items.length}</span>
              </div>
              {g.items.map((p) => (
                <PageCard className="w-full" key={p.id} page={p} />
              ))}
            </div>
          ))}
        </div>
      )}
      {/* One grid for every group, so columns line up across groups too. */}
      {items.length > 0 && kind === "list" && (
        <div className="-mx-2 mt-3 grid gap-x-2" style={columns}>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {g.label && <h3 className="col-span-full mx-2 mt-3 mb-1 font-medium text-muted-foreground text-xs first:mt-0">{g.label}</h3>}
              {g.items.map(row)}
            </Fragment>
          ))}
        </div>
      )}
      {items.length > 0 &&
        (kind === "gallery" || kind === "table") &&
        groups.map((g) => (
          <div className="mt-3" key={g.key}>
            {g.label && <h3 className="mb-1 font-medium text-muted-foreground text-xs">{g.label}</h3>}
            {kind === "gallery" && (
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @5xl:grid-cols-3">
                {g.items.map((p) => (
                  <PageCard className="w-full" key={p.id} page={p} snippet />
                ))}
              </div>
            )}
            {kind === "table" && (
              // Outside the table's own scroller, so the cells' padding isn't clipped.
              <div className="-mx-2.5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    {props.map((c) => (
                      <TableHead key={c.id}>{c.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.map((p) => (
                    <TableRow className="cursor-default" key={p.id} onClick={(e) => visit(p.id, e)}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <RowIcon icon={iconFor(p)} />
                          <span className={cn("max-w-64 truncate", !p.title.trim() && "text-muted-foreground")}>{pageLabel(p.title)}</span>
                        </span>
                      </TableCell>
                      {props.map((c) => (
                        <TableCell key={c.id}>
                          <span className="flex flex-wrap items-center gap-1">{ValueView({ prop: c, value: p.properties[c.id], page: p })}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
