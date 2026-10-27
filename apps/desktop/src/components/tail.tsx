import { baselineOffset, GUTTER, NOTE_FONT } from "@leadinglight/editor/editor";
import { MessageSquareDashed } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { cn } from "@leadinglight/ui/lib/utils";
import { visit } from "~/components/property-value";
import { Row } from "~/components/work-panel";
import { useKeysFor } from "~/lib/keymap";
import { watchLive } from "~/lib/live";
import { follow, type Line, nod, type Part, tail, TODAY, undo } from "~/lib/tail";

// Tail's lines (docs/TAIL.md): rows like the work panel's, on Today and under a page's title, and
// a chip in the margin beside the line just written. Each fades in and out over 150 ms.

const FADE = "transition-opacity duration-150 ease-out starting:opacity-0 data-leaving:opacity-0";

// Lines that leave stay a moment where they were, fading out.
function useFading(lines: Line[]) {
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

const useLines = (where: string) => {
  const all = tail.use();
  return useFading(useMemo(() => all.filter((l) => l.where === where), [all, where]));
};

// Names and quoted words in the foreground; they open their page, unless it is this one. In a
// row (fit) a name is a box of its own, so a long one can end in an ellipsis.
const Words = ({ parts, where, fit }: { parts: Part[]; where: string; fit?: boolean }) =>
  parts.map((p, i) => {
    if (typeof p === "string") return p;
    const name = cn("text-foreground", fit && "inline-block truncate align-top");
    return p.page === where ? (
      <span className={name} data-name key={i}>
        {p.text}
      </span>
    ) : (
      <button className={cn(name, "underline-offset-2 hover:underline")} data-name key={i} onClick={(e) => visit(p.page, e)} type="button">
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
function useFit(words: Part[]) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
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
  }, [words]);
  return ref;
}

// The nod, or Undo once nodded: the same button, so nothing jumps.
const Nod = ({ line }: { line: Line }) => (
  <Button onClick={() => void (line.done ? undo(line) : nod(line))} size="xs" variant="outline">
    {line.done ? "Undo" : line.nod}
  </Button>
);

function TailRow({ line, leaving }: { line: Line; leaving: boolean }) {
  const words = line.done?.words ?? line.row ?? line.words;
  return (
    <Row className={FADE} data-leaving={leaving || undefined}>
      <MessageSquareDashed className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground" ref={useFit(words)}>
        <Words fit parts={words} where={line.where} />
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

// Under Today's day bar: up to three rows from the records, never stored in the note.
export const TailToday = () => <Rows className="mt-2" rows={useLines(TODAY)} />;

type Spot = { root: HTMLElement; top: number; edge: number; mid: number };

// Where a chip sits beside a block, placed as a sidenote is (sidenotes.tsx). None when the margin
// beside the text, as it is, has no room: tail never narrows the text or folds the sidebar.
function useSpot(pageId: string, body: RefObject<HTMLDivElement | null>, block: number | undefined) {
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    const root = body.current?.querySelector<HTMLElement>(".ll-editor-root");
    const text = root?.querySelector<HTMLElement>(".ll-editor");
    const scroller = root?.closest<HTMLElement>("[data-page-scroller]");
    if (block === undefined || !root || !text || !scroller) return setSpot(null);
    const measure = () => {
      // The line's first words: a paragraph's, or the title of the task link a nod made of it.
      const el = text.children[block];
      const first = el && document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)).nextNode();
      const range = document.createRange();
      if (first) range.selectNodeContents(first);
      const words = first?.parentElement && range.getClientRects()[0];
      const right = text.getBoundingClientRect().right;
      const free = scroller.getBoundingClientRect().right - parseFloat(getComputedStyle(scroller).paddingRight) - right;
      if (!words || free < GUTTER + 256 || root.dataset.notes) return setSpot(null);
      const box = root.getBoundingClientRect();
      const note = baselineOffset({ fontStyle: "normal", fontWeight: "400", fontSize: NOTE_FONT.size, fontFamily: getComputedStyle(text).fontFamily }, NOTE_FONT.line);
      // Its first baseline on the line's first baseline.
      setSpot({ root, top: words.top - box.top + baselineOffset(getComputedStyle(first.parentElement)) - note, edge: right - box.left, mid: words.top - box.top + words.height / 2 });
    };
    let frame = 0;
    const schedule = () => (frame ||= requestAnimationFrame(() => ((frame = 0), measure())));
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    ro.observe(scroller);
    // A link's own view draws a moment after the edit that made it.
    const off = watchLive(pageId, schedule);
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(frame);
    };
  }, [pageId, body, block]);
  return spot;
}

// The sentence, then the nod with its key; a hairline to the line on hover, as a sidenote has.
function Chip({ line, spot, leaving }: { line: Line; spot: Spot; leaving: boolean }) {
  const keysFor = useKeysFor();
  const [hover, setHover] = useState(false);
  const bend = spot.edge + GUTTER * 0.45;
  const end = spot.top + 10;
  return (
    <>
      {hover && (
        <svg aria-hidden className="ll-note-line">
          <path d={`M ${spot.edge} ${spot.mid} C ${bend} ${spot.mid} ${bend} ${end} ${spot.edge + GUTTER - 6} ${end}`} strokeWidth={1} />
        </svg>
      )}
      <aside
        className={cn("ll-note text-[13px] leading-[19.5px]", FADE)}
        data-leaving={leaving || undefined}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{ top: spot.top, left: spot.edge + GUTTER }}
      >
        <MessageSquareDashed className="mt-[1.75px] size-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <p className="text-muted-foreground">
            <Words parts={line.done?.words ?? line.words} where={line.where} />
          </p>
          <span className="flex items-center gap-1.5">
            <Nod line={line} />
            {!line.done && <Kbd>{keysFor("nod")}</Kbd>}
          </span>
        </div>
      </aside>
    </>
  );
}

// In the band above a page's title, where its hover controls sit, so nothing moves: where you
// stopped, or the chip's line when the margin has no room for it. onRow hides those controls.
export function TailPage({ pageId, body, onRow }: { pageId: string; body: RefObject<HTMLDivElement | null>; onRow: (shown: boolean) => void }) {
  useEffect(() => follow(pageId), [pageId]);
  const shown = useLines(pageId);
  const chip = shown.find((s) => s.line.block !== undefined);
  const spot = useSpot(pageId, body, chip?.line.block);
  const rows = shown.filter((s) => s !== chip || !spot);
  useLayoutEffect(() => onRow(rows.length > 0), [onRow, rows.length]);
  return (
    <>
      <Rows className="absolute inset-x-0 bottom-full mb-1" rows={rows} />
      {chip && spot && createPortal(<Chip leaving={chip.leaving} line={chip.line} spot={spot} />, spot.root)}
    </>
  );
}
