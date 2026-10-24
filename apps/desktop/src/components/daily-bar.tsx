import type { EditorDoc } from "@leadinglight/editor/editor";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Calendar } from "@leadinglight/ui/components/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { visit } from "~/components/property-value";
import { ensureDaily, shiftDay, today } from "~/lib/daily";
import { hasBlockLink, linesMentioning } from "~/lib/doc-links";
import { fromIso, isoDay } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { liveContent } from "~/lib/live";
import type { ObjectSummary } from "~/lib/objects";
import { openPage } from "~/lib/panes";
import { iconFor, listed, space } from "~/lib/space";

export const goToDay = async (day: string) => openPage(await ensureDaily(day));

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

// At the end of a daily note: the pages made that day (tags and daily notes have their own
// places), except those its body links already, so nothing shows twice.
export function CreatedThisDay({ day, id, content }: { day: string; id: string; content: EditorDoc | null }) {
  const { pages } = space.use();
  const doc = liveContent(id) ?? content;
  const linked = (p: ObjectSummary) => linesMentioning(doc, p.id).length > 0 || hasBlockLink(doc, p.id);
  const made = pages.filter((p) => p.id !== id && listed(p) && isoDay(new Date(p.createdAt)) === day && !linked(p));
  if (!made.length) return null;
  return (
    <section aria-label="Created this day" className="mt-16 border-t pt-6 text-sm">
      <h2 className="mb-2 font-medium text-muted-foreground">Created this day · {made.length}</h2>
      <div className="-mx-2 flex flex-col">
        {made.map((p) => (
          <button
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent"
            key={p.id}
            onClick={(e) => visit(p.id, e)}
            onPointerDown={(e) => armDrag(e, { page: p.id, label: pageLabel(p.title) })}
            type="button"
          >
            <RowIcon icon={iconFor(p)} />
            <span className="truncate">{pageLabel(p.title)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
