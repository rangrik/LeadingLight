import {
  ALargeSmall,
  Calendar as CalendarIcon,
  CalendarClock,
  CalendarPlus,
  CircleChevronDown,
  ExternalLink,
  Hash,
  Link as LinkIcon,
  type LucideIcon,
  Paperclip,
  Plus,
  SquareCheck,
  Waypoints,
  X,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Calendar } from "@leadinglight/ui/components/calendar";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { assets } from "~/lib/assets";
import type { Choice, DateValue, FileValue, Kind, PropDef } from "~/lib/catalog";
import { formatDate, formatMoment, fromIso, isDateValue, isoDay } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { openLink } from "~/lib/links";
import type { ObjectSummary } from "~/lib/objects";
import { COLORS, type Color } from "~/lib/page-meta";
import { openBeside, openPage } from "~/lib/panes";
import { createPage, iconFor, pageOf, putProp, space, typeOf } from "~/lib/space";

export const KIND_ICONS: Record<Kind, LucideIcon> = {
  text: ALargeSmall,
  number: Hash,
  checkbox: SquareCheck,
  date: CalendarIcon,
  select: CircleChevronDown,
  relation: Waypoints,
  link: LinkIcon,
  file: Paperclip,
  created: CalendarPlus,
  updated: CalendarClock,
};

// Values come from storage, so each kind checks the shape it reads.
const asIds = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const asFile = (v: unknown) => (v && typeof v === "object" && typeof (v as FileValue).url === "string" ? (v as FileValue) : undefined);
const empty = <span className="text-muted-foreground/60">Empty</span>;

// Opens the page; with Shift, beside the one in view.
export const visit = (id: string, e: React.MouseEvent) => (e.shiftKey ? openBeside(id) : openPage(id));

// A page as a small chip: its icon and title.
export function PageChip({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const page = pageOf(id);
  return (
    <Badge className="group/chip h-6 max-w-full gap-1.5 px-1.5 sm:h-6 sm:text-sm" render={<span />} size="lg" variant="outline">
      <button
        className="flex min-w-0 items-center gap-1.5"
        onClick={(e) => {
          e.stopPropagation(); // inside a card, the chip opens its own page
          visit(id, e);
        }}
        type="button"
      >
        <RowIcon icon={page && iconFor(page)} />
        <span className="truncate">{page ? pageLabel(page.title) : "Deleted page"}</span>
      </button>
      {onRemove && (
        <button aria-label="Remove" className="-me-0.5 rounded-sm text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/chip:opacity-100" onClick={onRemove} type="button">
          <X className="size-3.5" />
        </button>
      )}
    </Badge>
  );
}

const ChoiceChip = ({ choice }: { choice: Choice }) => (
  <Badge className={cn("h-6 px-1.5 text-foreground sm:h-6 sm:text-sm", COLORS[choice.color].band)} size="lg">
    {choice.name}
  </Badge>
);

// Read-only, for lists, cards and the other side of a relation.
export function ValueView({ prop, value, page }: { prop: PropDef; value: unknown; page: ObjectSummary }): ReactNode {
  switch (prop.kind) {
    case "checkbox":
      return <Checkbox checked={value === true} disabled />;
    case "date":
      return isDateValue(value) ? formatDate(value) : null;
    case "select":
      return asIds(value).map((id) => {
        const choice = prop.options.choices?.find((c) => c.id === id);
        return choice && <ChoiceChip choice={choice} key={id} />;
      });
    case "relation":
      return asIds(value).map((id) => <PageChip id={id} key={id} />);
    case "file":
      return asFile(value)?.name ?? null;
    case "created":
      return formatMoment(page.createdAt);
    case "updated":
      return formatMoment(page.updatedAt);
    default:
      return value === undefined || value === null || value === "" ? null : String(value);
  }
}

type EditProps = { prop: PropDef; value: unknown; page: ObjectSummary; onChange: (value: unknown) => void };

// The editable value in a page's property row. An emptied value is passed on as undefined.
export function PropValue({ prop, value, page, onChange }: EditProps) {
  switch (prop.kind) {
    case "text":
      return <TextValue label={prop.name} onChange={(v) => onChange(v || undefined)} value={typeof value === "string" ? value : ""} />;
    case "number":
      return (
        <input
          aria-label={prop.name}
          className="w-full appearance-none bg-transparent py-1.5 leading-5 outline-none placeholder:text-muted-foreground/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          inputMode="decimal"
          onChange={(e) => onChange(e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value))}
          placeholder="Empty"
          type="number"
          value={typeof value === "number" ? value : ""}
        />
      );
    case "checkbox":
      return <Checkbox aria-label={prop.name} checked={value === true} onCheckedChange={(c) => onChange(c ? true : undefined)} />;
    case "date":
      return <DateValueEditor onChange={onChange} prop={prop} value={isDateValue(value) ? value : undefined} />;
    case "select":
      return <SelectValue onChange={onChange} prop={prop} value={asIds(value)} />;
    case "relation":
      return <RelationValue onChange={onChange} prop={prop} value={asIds(value)} />;
    case "link":
      return <LinkValue name={prop.name} onChange={onChange} value={typeof value === "string" ? value : ""} />;
    case "file":
      return <FileValueEditor onChange={onChange} value={asFile(value)} />;
    default:
      return <span className="flex h-8 items-center text-muted-foreground">{ValueView({ prop, value, page })}</span>;
  }
}

function TextValue({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      aria-label={label}
      className="block w-full resize-none overflow-hidden bg-transparent py-1.5 leading-5 outline-none placeholder:text-muted-foreground/60"
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="Empty"
      ref={ref}
      rows={1}
      value={value}
    />
  );
}

// The trigger every popover value uses: its content, or "Empty".
const Trigger = ({ children, ...props }: React.ComponentProps<"button">) => (
  <button className="flex min-h-8 w-full flex-wrap items-center gap-1 py-1 text-left" type="button" {...props}>
    {children}
  </button>
);

function DateValueEditor({ prop, value, onChange }: { prop: PropDef; value?: DateValue; onChange: (v?: DateValue) => void }) {
  const range = prop.options.range;
  const from = value ? fromIso(value.start) : undefined;
  const to = value?.end ? fromIso(value.end) : undefined;
  return (
    <Popover>
      <PopoverTrigger render={<Trigger aria-label={prop.name} />}>{value ? formatDate(value) : empty}</PopoverTrigger>
      <PopoverPopup align="start">
        {range ? (
          <Calendar
            mode="range"
            onSelect={(r) => onChange(r?.from ? { ...value, start: isoDay(r.from), end: r.to && isoDay(r.to) } : undefined)}
            selected={{ from, to }}
          />
        ) : (
          <Calendar mode="single" onSelect={(d) => onChange(d ? { ...value, start: isoDay(d) } : undefined)} selected={from} />
        )}
        <div className="mt-2 flex items-center gap-2">
          {prop.options.time && value && (
            <Input
              aria-label="Time"
              onChange={(e) => onChange({ ...value, time: e.currentTarget.value || undefined })}
              size="sm"
              type="time"
              value={value.time ?? ""}
            />
          )}
          {value && (
            <Button className="ms-auto" onClick={() => onChange(undefined)} size="xs" variant="ghost">
              Clear
            </Button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const nextColor = (n: number) => (Object.keys(COLORS) as Color[])[n % Object.keys(COLORS).length];

function SelectValue({ prop, value, onChange }: { prop: PropDef; value: string[]; onChange: (v?: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const choices = prop.options.choices ?? [];
  const q = query.trim();
  const shown = choices.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const pick = (id: string) => {
    const next = prop.options.many ? (value.includes(id) ? value.filter((v) => v !== id) : [...value, id]) : value[0] === id ? [] : [id];
    onChange(next.length ? next : undefined);
    if (!prop.options.many) setOpen(false);
  };
  const create = () => {
    const choice = { id: crypto.randomUUID().slice(0, 8), name: q, color: nextColor(choices.length) };
    void putProp({ ...prop, options: { ...prop.options, choices: [...choices, choice] } });
    setQuery("");
    pick(choice.id);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Trigger aria-label={prop.name} />}>
        {choices.some((c) => value.includes(c.id)) ? choices.filter((c) => value.includes(c.id)).map((c) => <ChoiceChip choice={c} key={c.id} />) : empty}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64">
        <Input
          aria-label="Find or create an option"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && q && !shown.length && create()}
          placeholder="Find or create an option"
          size="sm"
          value={query}
        />
        <div className="-mx-1 mt-2 flex max-h-60 flex-col overflow-y-auto text-sm *:shrink-0">
          {shown.map((c) => (
            <button aria-pressed={value.includes(c.id)} className="flex h-8 items-center gap-2 rounded-md px-1 hover:bg-accent" key={c.id} onClick={() => pick(c.id)} type="button">
              <ChoiceChip choice={c} />
              {value.includes(c.id) && <span className="ms-auto text-muted-foreground text-xs">Selected</span>}
            </button>
          ))}
          {q && !choices.some((c) => c.name.toLowerCase() === q.toLowerCase()) && (
            <button className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground hover:bg-accent" onClick={create} type="button">
              <Plus className="size-4" />
              Create “{q}”
            </button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

// Pages the picker offers: of the property's type, when it has one.
export function PagePicker({
  typeId,
  exclude,
  onPick,
  label,
  empty: isEmpty,
  trigger,
}: {
  typeId?: string;
  exclude: string[];
  onPick: (id: string) => void;
  label: string;
  empty?: boolean;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { pages } = space.use();
  const q = query.trim().toLowerCase();
  const shown = pages
    .filter((p) => (!typeId || p.typeId === typeId) && !exclude.includes(p.id) && !p.properties.templateOf)
    .filter((p) => pageLabel(p.title).toLowerCase().includes(q))
    .slice(0, 50);
  const done = (id: string) => {
    onPick(id);
    setQuery("");
    setOpen(false);
  };
  const create = async () => done((await createPage({ title: query.trim(), typeId: typeId ?? "page" })).id);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      {trigger ? (
        <PopoverTrigger render={trigger} />
      ) : isEmpty ? (
        <PopoverTrigger render={<Trigger aria-label={label} />}>{empty}</PopoverTrigger>
      ) : (
        <PopoverTrigger render={<Button aria-label={label} className="text-muted-foreground" size="icon-xs" variant="ghost" />}>
          <Plus className="size-4" />
        </PopoverTrigger>
      )}
      <PopoverPopup align="start" className="w-72">
        <Input
          aria-label="Find or create a page"
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={typeId ? `Find or create: ${typeOf(typeId).plural}` : "Find or create a page"}
          size="sm"
          value={query}
        />
        <div className="-mx-1 mt-2 flex max-h-60 flex-col overflow-y-auto text-sm *:shrink-0">
          {shown.map((p) => (
            <button className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" key={p.id} onClick={() => done(p.id)} type="button">
              <RowIcon icon={iconFor(p)} />
              <span className="truncate">{pageLabel(p.title)}</span>
            </button>
          ))}
          {query.trim() && !shown.some((p) => pageLabel(p.title).toLowerCase() === q) && (
            <button className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-accent" onClick={() => void create()} type="button">
              <Plus className="size-4" />
              Create “{query.trim()}”
            </button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function RelationValue({ prop, value, onChange }: { prop: PropDef; value: string[]; onChange: (v?: string[]) => void }) {
  const set = (next: string[]) => onChange(next.length ? next : undefined);
  return (
    <div className={cn("flex min-h-8 w-full flex-wrap items-center gap-1", value.length > 0 && "py-1")}>
      {value.map((id) => (
        <PageChip id={id} key={id} onRemove={() => set(value.filter((v) => v !== id))} />
      ))}
      {(prop.options.many || value.length === 0) && (
        <PagePicker
          empty={value.length === 0}
          exclude={value}
          label={`Add to ${prop.name}`}
          onPick={(id) => set(prop.options.many ? [...value, id] : [id])}
          typeId={prop.options.type}
        />
      )}
    </div>
  );
}

function LinkValue({ name, value, onChange }: { name: string; value: string; onChange: (v?: string) => void }) {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : value.includes("@") ? `mailto:${value}` : `https://${value}`;
  return (
    <div className="flex h-8 w-full items-center gap-1">
      <input
        aria-label={name}
        className="min-w-0 flex-1 bg-transparent py-1.5 leading-5 outline-none placeholder:text-muted-foreground/60"
        onChange={(e) => onChange(e.currentTarget.value || undefined)}
        placeholder="Empty"
        type="text"
        value={value}
      />
      {value && (
        <Button aria-label={`Open ${name}`} onClick={() => openLink(href)} size="icon-xs" variant="ghost">
          <ExternalLink className="size-4" />
        </Button>
      )}
    </div>
  );
}

function FileValueEditor({ value, onChange }: { value?: FileValue; onChange: (v?: FileValue) => void }) {
  const input = useRef<HTMLInputElement>(null);
  if (value) {
    return (
      <Badge className="group/chip h-6 gap-1.5 px-1.5 sm:h-6 sm:text-sm" render={<span />} size="lg" variant="outline">
        <button className="flex min-w-0 items-center gap-1.5" onClick={() => assets.open(value)} type="button">
          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{value.name}</span>
        </button>
        <button aria-label="Remove" className="text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/chip:opacity-100" onClick={() => onChange(undefined)} type="button">
          <X className="size-3.5" />
        </button>
      </Badge>
    );
  }
  return (
    <>
      <Trigger onClick={() => input.current?.click()}>{empty}</Trigger>
      <input
        className="hidden"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (file) onChange(await assets.put(file));
        }}
        ref={input}
        type="file"
      />
    </>
  );
}
