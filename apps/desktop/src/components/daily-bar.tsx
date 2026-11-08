import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Calendar } from "@leadinglight/ui/components/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { dayPage, shiftDay, today } from "~/lib/daily";
import { fromIso, isoDay } from "~/lib/format";
import { openPage } from "~/lib/panes";

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
