import { MessageSquareDashed } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { DailyCard } from "~/components/daily-card";
import { visit } from "~/components/property-value";
import { Row } from "~/components/work-panel";
import { barViewOf, showBar } from "~/lib/bar";
import { follow, type Line, nod, type Part, tail, TODAY, undo } from "~/lib/tail";

// Tail's lines (docs/TAIL.md): rows like the work panel's, on Today, under a page's title and in
// the bar's Suggestions. Each fades in and out over 150 ms; the fade in is an animation, since
// WebKit holds a transition still while the window is behind others (editor.css, ll-fade-in).
const FADE = "animate-[ll-fade-in_150ms_ease-out] transition-opacity duration-150 ease-out data-leaving:opacity-0";

// Lines that leave stay a moment where they were, fading out.
export function useFading(lines: Line[]) {
  const [shown, setShown] = useState(() => lines.map((line) => ({ line, leaving: false })));
  useEffect(() => {
    setShown((was) => {
      const next = lines.map((line) => ({ line, leaving: false }));
      was.forEach((w, i) => !lines.some((l) => l.id === w.line.id) && next.splice(i, 0, { line: w.line, leaving: true }));
      return next;
    });
    const t = setTimeout(() => setShown(lines.map((line) => ({ line, leaving: false }))), 150);
    return () => clearTimeout(t);
  }, [lines]);
  return shown;
}

// The row above a page's title is the one without a block; a suggestion's is in the bar.
const useLines = (where: string) => {
  const all = tail.use();
  return useFading(useMemo(() => all.filter((l) => l.where === where && l.block === undefined), [all, where]));
};

// Names and quoted words in the foreground; they open their page, unless it is this one. In a
// row (fit) a name is a box of its own, so a long one can end in an ellipsis.
const Words = ({ parts, where, fit, open }: { parts: Part[]; where?: string; fit?: boolean; open?: (page: string) => void }) =>
  parts.map((p, i) => {
    if (typeof p === "string") return p;
    // Wrapped in the panel, a long name breaks as a box: its lines start at the left, as words do.
    const name = cn("text-start text-foreground", fit && "inline-block truncate align-top");
    const view = barViewOf(p.page);
    return p.page === where ? (
      <span className={name} data-name key={i}>
        {p.text}
      </span>
    ) : (
      <button className={cn(name, "underline-offset-2 hover:underline")} data-name key={i} onClick={(e) => (view ? showBar(view) : open ? open(p.page) : visit(p.page, e))} type="button">
        {p.text}
      </button>
    );
  });

const ruler = document.createElement("canvas").getContext("2d");
// The width a name needs to show its first letters and an ellipsis in room, ending where the
// ellipsis does so the words after it sit flush. None below about four letters.
function cut(name: HTMLElement, room: number) {
  const text = name.firstChild;
  if (!(text instanceof Text) || !ruler) return;
  const s = getComputedStyle(name);
  ruler.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const dots = ruler.measureText("…").width;
  const left = name.getBoundingClientRect().left;
  const range = document.createRange();
  range.setStart(text, 0);
  const end = (i: number) => {
    range.setEnd(text, i);
    return range.getBoundingClientRect().right - left;
  };
  let k = text.length;
  while (k > 0 && (end(k) + dots > Math.floor(room) || /\s/.test(text.data[k - 1]))) k--;
  if (k < (text.data.match(/^(\s*\S){4}/)?.[0].length ?? Infinity)) return;
  return Math.ceil(end(k) + dots);
}

// The widest name takes only the room the other words leave, so the words after it still show.
// When that would leave it under four letters, the whole sentence ends in one ellipsis instead.
function useFit(words: Part[], on: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const fit = () => {
      const names = [...el.querySelectorAll<HTMLElement>("[data-name]")];
      for (const n of names) Object.assign(n.style, { maxWidth: "", display: "" });
      const all = document.createRange();
      all.selectNodeContents(el);
      const over = all.getBoundingClientRect().width - el.getBoundingClientRect().width;
      if (over <= 0) return;
      const wide = names.reduce<HTMLElement | undefined>((a, n) => (a && a.offsetWidth > n.offsetWidth ? a : n), undefined);
      const width = wide && cut(wide, wide.getBoundingClientRect().width - over);
      // Else the names flow as plain words, so the sentence's own ellipsis cuts through them.
      if (wide && width) wide.style.maxWidth = `${width}px`;
      else for (const n of names) n.style.display = "contents";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [words, on]);
  return ref;
}

// The nod, or Undo once nodded: the same button, so nothing jumps.
const Nod = ({ line }: { line: Line }) => (
  <Button onClick={() => void (line.done ? undo(line) : nod(line))} size="xs" variant="outline">
    {line.done ? "Undo" : line.nod}
  </Button>
);

// One line; in the bar's narrow panel (open: where a name goes) as many as its words need.
type RowProps = { line: Line; leaving: boolean; words?: Part[]; here?: string; open?: (page: string) => void } & React.HTMLAttributes<HTMLDivElement>;
export function TailRow({ line, leaving, words = line.done?.words ?? line.words, here = line.where, open, ...rest }: RowProps) {
  const ref = useFit(words, !open);
  return (
    <Row className={cn(FADE, open && "flex-nowrap items-start")} data-leaving={leaving || undefined} {...rest}>
      <MessageSquareDashed className={cn("size-4 shrink-0 text-muted-foreground", open && "mt-1")} />
      <span className={cn("min-w-0 flex-1 text-muted-foreground", open ? "leading-6" : "truncate")} ref={ref}>
        <Words fit={!open} open={open} parts={words} where={here} />
      </span>
      {/* A done row on Today keeps its words after Undo has gone. */}
      {(!line.done || line.done.undo) && <Nod line={line} />}
    </Row>
  );
}

const Rows = ({ rows, className }: { rows: { line: Line; leaving: boolean }[]; className: string }) =>
  rows.length > 0 && (
    <div className={cn("flex flex-col gap-1 text-sm", className)}>
      {rows.map(({ line, leaving }) => (
        <TailRow key={line.id} leaving={leaving} line={line} />
      ))}
    </div>
  );

// Under Today's day bar: the daily card, then up to three rows from the records, never stored in the note.
export const TailToday = () => (
  <>
    <DailyCard />
    <Rows className="mt-2" rows={useLines(TODAY)} />
  </>
);

// In the band above a page's title, where its hover controls sit, so nothing moves: where you
// stopped. onRow hides those controls.
export function TailPage({ pageId, onRow }: { pageId: string; onRow: (shown: boolean) => void }) {
  useEffect(() => follow(pageId), [pageId]);
  const rows = useLines(pageId);
  useLayoutEffect(() => onRow(rows.length > 0), [onRow, rows.length]);
  return <Rows className="absolute inset-x-0 bottom-full mb-1" rows={rows} />;
}
