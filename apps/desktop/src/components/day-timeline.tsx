import type { EditorDoc } from "@leadinglight/editor/editor";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { cn } from "@leadinglight/ui/lib/utils";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { visit } from "~/components/property-value";
import { showBar } from "~/lib/bar";
import { captureOf } from "~/lib/capture-inbox";
import { shiftDay, today } from "~/lib/daily";
import { hasBlockLink, linesMentioning } from "~/lib/doc-links";
import { feedFocus } from "~/lib/feed";
import { formatTime, fromIso } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { liveContent } from "~/lib/live";
import { parentOf } from "~/lib/linked";
import { localPrefs } from "~/lib/local-prefs";
import { type ObjectSummary, objects } from "~/lib/objects";
import { iconFor, listed, pageOf, space, typeOf } from "~/lib/space";
import { reportOf } from "~/lib/work";

// A daily note's day in time order, from the records (features/today-timeline.feature).
// "Just my words" hides it on every day; it is a view, so it is kept on this Mac only.
export const timelinePrefs = localPrefs("ll.timeline", { words: false });
// A busy day shows its last entries; the morning folds above them.
const SHOWN = 8;
// One time column width for every day, wide enough for this locale's longest time.
const TIME_WIDTH = `${formatTime(new Date(2000, 0, 1, 12, 59).getTime()).length}ch`;

type Entry = { key: string; at: number; icon: ReactNode; line: ReactNode; page?: string; open: (e: React.MouseEvent) => void };

const Name = ({ children }: { children: string }) => <span className="text-foreground">{children}</span>;
// An agent's page is "Claude: its task"; the line names the task apart.
const agentName = (id?: string) => ((id && pageOf(id)?.title.trim()) || "An agent").split(": ")[0];

// In a pane under 36 rem (narrow, as for .ll-page in styles.css) the time folds under the words.
function Row({ time, icon, line, dot = true, ...rest }: { time: string; icon: ReactNode; line: ReactNode; dot?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <li className={cn("relative col-span-full grid grid-cols-subgrid before:absolute before:top-3.5 before:left-[2.5px] before:h-full before:w-px before:bg-border last:before:hidden", !dot && "before:hidden")}>
      <span className={cn("relative mt-[11px] size-1.5 rounded-full bg-muted-foreground/60", !dot && "invisible")} />
      <button className="col-[2/-1] grid grid-cols-subgrid items-baseline rounded-md px-1.5 py-1 text-left transition-colors duration-150 ease-out hover:bg-accent" type="button" {...rest}>
        <span className="col-start-2 row-start-2 text-muted-foreground text-xs tabular-nums leading-4 @min-[36rem]:col-start-1 @min-[36rem]:row-start-1" style={{ minWidth: TIME_WIDTH }}>{time}</span>
        <span className="col-start-1 row-start-1 flex self-start pt-0.5 @min-[36rem]:col-start-2">{icon}</span>
        <span className="col-start-2 row-start-1 line-clamp-2 text-muted-foreground leading-5 @min-[36rem]:col-start-3 @min-[36rem]:line-clamp-1">{line}</span>
      </button>
    </li>
  );
}

// Between the day bar and the body. Pages made or edited keep This day's rules: tags, daily notes,
// pages under a page, pages the app makes and pages the body links already have their own places.
export function DayTimeline({ day, id, content }: { day: string; id: string; content: EditorDoc | null }) {
  const { pages } = space.use();
  const { words } = timelinePrefs.use();
  const asks = useFeed(true);
  const [open, setOpen] = useState(false);
  const from = fromIso(day).getTime(), to = fromIso(shiftDay(day, 1)).getTime();
  // Edits before a page's last one are only in its history.
  const [touched, setTouched] = useState(new Map<string, number>());
  useEffect(() => {
    let live = true;
    objects.touched(from, to).then((rows) => live && setTouched(new Map(rows.map((r) => [r.id, r.at]))), console.error);
    return () => { live = false; };
  }, [from, to]);
  const doc = liveContent(id) ?? content;
  const linked = (p: ObjectSummary) => linesMentioning(doc, p.id).length > 0 || hasBlockLink(doc, p.id);
  const within = (at = 0) => (at >= from && at < to ? at : 0);
  const entries: Entry[] = [];
  const add = (p: ObjectSummary, at: number, line: ReactNode) =>
    entries.push({ key: p.id, at, icon: <RowIcon icon={iconFor(p)} />, line, page: p.id, open: (e) => visit(p.id, e) });
  for (const p of pages) {
    if (p.id === id) continue;
    const report = reportOf(p);
    if (report) {
      if (within(p.createdAt)) add(p, p.createdAt, <><Name>{agentName(report.by)}</Name> published <Name>{pageLabel(p.title)}</Name></>);
      continue;
    }
    if (!listed(p) || parentOf(p) || typeOf(p.typeId).made) continue;
    // A capture shows once, as captured; a page made and edited that day, once, as made.
    const caught = within(captureOf(p)?.capturedAt);
    const made = within(p.createdAt);
    const at = caught || made || Math.max(within(touched.get(p.id)), within(p.updatedAt));
    // Reading the body for links is the slow part, so only for pages of the day.
    if (at && !linked(p)) add(p, at, <>{caught ? "captured" : made ? "made" : "edited"} <Name>{pageLabel(p.title)}</Name></>);
  }
  // Questions are about now: they show while they wait, on today's note only.
  if (day === today())
    for (const q of asks) {
      const said = q.kind === "question" && within(q.at) ? /^.*? (asks|says): (.*)$/s.exec(q.reason) : null;
      if (said)
        entries.push({
          key: q.id, at: q.at, icon: <MessageCircleQuestion className="size-4 text-muted-foreground" />,
          line: <><Name>{agentName(q.agent)}</Name> {said[1] === "asks" ? "asked" : "said"}: {said[2]}</>,
          open: () => (feedFocus.set(q.id), showBar("feed")),
        });
    }
  if (!entries.length) return null;
  entries.sort((a, b) => a.at - b.at);
  // Folding one entry would save no room.
  const earlier = entries.length > SHOWN + 1 ? entries.length - SHOWN : 0;
  return (
    <section aria-label="Timeline" className="mt-4 text-sm">
      <div className="flex justify-end">
        <SegmentedControl aria-label="Show" render={<RadioGroupPrimitive onValueChange={(v) => timelinePrefs.set({ words: v === "words" })} value={words ? "words" : "day"} />} size="sm">
          <SegmentedControlItem render={<RadioPrimitive.Root value="day" />}>Day</SegmentedControlItem>
          <SegmentedControlItem render={<RadioPrimitive.Root value="words" />}>Just my words</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {!words && (
        <ol className="mt-1 grid grid-cols-[6px_auto_minmax(0,1fr)] gap-x-1.5 @min-[36rem]:grid-cols-[6px_auto_auto_minmax(0,1fr)]">
          {earlier > 0 && (
            <Row
              aria-expanded={open}
              dot={false}
              icon={<ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-150 ease-out", open && "rotate-90")} />}
              line={`${earlier} earlier`}
              onClick={() => setOpen(!open)}
              time=""
            />
          )}
          {(open ? entries : entries.slice(earlier)).map((e) => (
            <Row
              icon={e.icon}
              key={e.key}
              line={e.line}
              onClick={e.open}
              onPointerDown={e.page ? (ev) => armDrag(ev, { page: e.page!, label: pageLabel(pageOf(e.page!)?.title ?? "") }) : undefined}
              time={formatTime(e.at)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
