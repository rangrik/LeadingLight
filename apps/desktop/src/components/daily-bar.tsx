import type { EditorDoc } from "@leadinglight/editor/editor";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Calendar } from "@leadinglight/ui/components/calendar";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { visit } from "~/components/property-value";
import { dayPage, shiftDay, today } from "~/lib/daily";
import { hasBlockLink, linesMentioning } from "~/lib/doc-links";
import { formatTime, fromIso, isoDay } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { liveContent } from "~/lib/live";
import { localPrefs } from "~/lib/local-prefs";
import { parentOf } from "~/lib/linked";
import { type ObjectSummary, objects } from "~/lib/objects";
import { openPage } from "~/lib/panes";
import { iconFor, listed, space, typeOf } from "~/lib/space";

export const goToDay = async (day: string) => openPage(await dayPage(day));

// Under a daily note's title: step a day, jump to today, or pick any day.
export function DailyBar({ day }: { day: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="-ms-1.5 mt-3 flex items-center gap-1">
      <Button aria-label="Previous day" className="text-muted-foreground" onClick={() => void goToDay(shiftDay(day, -1))} size="icon-sm" variant="ghost">
        <ChevronLeft />
      </Button>
      <Button className="text-muted-foreground" disabled={day === today()} onClick={() => void goToDay(today())} size="sm" variant="ghost">
        Today
      </Button>
      <Button aria-label="Next day" className="text-muted-foreground" onClick={() => void goToDay(shiftDay(day, 1))} size="icon-sm" variant="ghost">
        <ChevronRight />
      </Button>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger render={<Button aria-label="Pick a day" className="text-muted-foreground" size="icon-sm" variant="ghost" />}>
          <CalendarDays />
        </PopoverTrigger>
        <PopoverPopup align="start">
          <Calendar
            defaultMonth={fromIso(day)}
            mode="single"
            onSelect={(d) => {
              setOpen(false);
              if (d) void goToDay(isoDay(d)); // the day already shown comes back as no day
            }}
            selected={fromIso(day)}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

// Pages made or edited on a day, newest first, a page made that day once. Tags, daily notes and
// pages under a page have their own places; agents' pages aren't the day's work; pages the day's
// own words link (content) would show twice. ready: the day's history has been read.
export function useDayRows(day: string, id: string, content: EditorDoc | null) {
  const { pages } = space.use();
  const from = fromIso(day).getTime(), to = fromIso(shiftDay(day, 1)).getTime();
  // Edits before a page's last one are only in its history.
  const [touched, setTouched] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let live = true;
    objects.touched(from, to).then((rows) => live && setTouched(new Map(rows.map((r) => [r.id, r.at]))), console.error);
    return () => { live = false; };
  }, [from, to]);
  const linked = (p: ObjectSummary) => linesMentioning(content, p.id).length > 0 || hasBlockLink(content, p.id);
  const within = (at = 0) => (at >= from && at < to ? at : 0);
  const rows = pages
    .flatMap((p) => {
      const made = within(p.createdAt);
      const at = made || Math.max(within(touched?.get(p.id)), within(p.updatedAt));
      return at && p.id !== id && listed(p) && !parentOf(p) && !typeOf(p.typeId).made && !linked(p) ? [{ p, made, at }] : [];
    })
    .sort((a, b) => b.at - a.at);
  return { rows, ready: touched !== null };
}

const thisDay = localPrefs("ll.this-day", { open: false });

// Under the day bar (and Today's strip), folded to its count; open or folded is remembered.
export function ThisDay({ day, id, content }: { day: string; id: string; content: EditorDoc | null }) {
  const { open } = thisDay.use();
  const { rows } = useDayRows(day, id, liveContent(id) ?? content);
  if (!rows.length) return null;
  return (
    <Collapsible onOpenChange={(o) => thisDay.set({ open: o })} open={open} render={<section aria-label="This day" />}>
      <CollapsibleTrigger className="flex h-6 items-center gap-2 text-muted-foreground hover:text-foreground data-panel-open:[&>svg]:rotate-90">
        <ChevronRight className="size-4 transition-transform duration-150 ease-out" />
        This day · {rows.length}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="-mx-2 flex flex-col pt-1">
          {rows.map(({ p, made, at }) => (
            <button
              className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent"
              key={p.id}
              onClick={(e) => visit(p.id, e)}
              onPointerDown={(e) => armDrag(e, { page: p.id, label: pageLabel(p.title) })}
              type="button"
            >
              <RowIcon icon={iconFor(p)} />
              <span className="min-w-0 flex-1 truncate">{pageLabel(p.title)}</span>
              <span className="text-muted-foreground">{made ? "made" : "edited"}</span>
              <span className="text-muted-foreground tabular-nums">{formatTime(at)}</span>
            </button>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
