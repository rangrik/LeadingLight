import type { Stats } from "@leadinglight/editor/editor";
import { type Count, isSpelling, type Part, PARTS } from "@leadinglight/editor/writing";
import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { TableBody, TableCell, TableHead, TableHeader, TableRow, Table as UITable } from "@leadinglight/ui/components/table";
import { Separator } from "@leadinglight/ui/components/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { useBackToPage, useWritingPrefs } from "~/lib/writing";

// Each open page's counts, which the header shows for the page in front.
const all = new Map<string, Stats>();
const listeners = new Set<() => void>();
export function setPageStats(id: string, stats: Stats | null) {
  if (stats) all.set(id, stats);
  else all.delete(id);
  listeners.forEach((l) => l());
}
const usePageStats = (id: string) =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => all.get(id),
  );

const PART: Record<Part, [string, string]> = {
  noun: ["noun", "nouns"],
  verb: ["verb", "verbs"],
  adjective: ["adjective", "adjectives"],
  adverb: ["adverb", "adverbs"],
  conjunction: ["conjunction", "conjunctions"],
};
const STYLE = { filler: ["filler", "fillers"], redundancy: ["redundancy", "redundancies"], cliche: ["cliché", "clichés"] } as const;
const WORDS_A_MINUTE = 230;

const n = (x: number) => x.toLocaleString();
const of = (x: number, [one, many]: readonly [string, string]) => `${n(x)} ${x === 1 ? one : many}`;
const minutes = (c: Count) => (c.words && c.words < WORDS_A_MINUTE / 2 ? "<1" : n(Math.round(c.words / WORDS_A_MINUTE)));
const mistakes = (c: Count, spelling: boolean) => Object.entries(c.grammar ?? {}).reduce((sum, [kind, x]) => (isSpelling(kind) === spelling ? sum + x : sum), 0);
// Harper's kinds are written like "WordChoice".
const kindName = (kind: string) => kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);

const Dot = ({ part }: { part: Part }) => <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--syntax-${part})` }} />;

// The page's counts beside its name (features/writing.feature): what is selected, or the whole
// page. It takes only the room the crumbs leave, shows the counts that fit whole, mistakes before
// the parts of speech, and none at all when even the first won't; a click shows them all.
export function PageStats({ id }: { id: string }) {
  const stats = usePageStats(id);
  const on = useWritingPrefs().count;
  const back = useBackToPage();
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(Infinity);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Hidden counts keep their place, so measuring never moves what it measures.
    const measure = () => {
      const edge = el.getBoundingClientRect().right + 0.5;
      const items = [...el.querySelectorAll("[data-count]")];
      const over = items.findIndex((i) => i.getBoundingClientRect().right > edge);
      setFit(over < 0 ? items.length : over);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  });
  if (!on || !stats) return null;
  const sel = stats.selected?.characters ? stats.selected : null;
  const c = sel ?? stats.page;

  const items: { key: string; node: ReactNode }[] = [
    { key: "words", node: sel ? `${n(sel.words)} of ${of(stats.page.words, ["word", "words"])}` : of(c.words, ["word", "words"]) },
    { key: "time", node: `${minutes(c)} min read` },
    ...(mistakes(c, true) ? [{ key: "spelling", node: of(mistakes(c, true), ["misspelling", "misspellings"]) }] : []),
    ...(mistakes(c, false) ? [{ key: "grammar", node: of(mistakes(c, false), ["grammar issue", "grammar issues"]) }] : []),
    ...(c.parts
      ? PARTS.filter((p) => c.parts![p]).map((p) => ({
          key: p,
          node: (
            <Tooltip>
              <TooltipTrigger render={<span aria-label={of(c.parts![p], PART[p])} className="flex items-center gap-1" />}>
                <Dot part={p} />
                {n(c.parts![p])}
                {/* Names only where a wide panel has room for them. */}
                <span className="hidden @6xl/header:inline">{PART[p][c.parts![p] === 1 ? 0 : 1]}</span>
              </TooltipTrigger>
              <TooltipPopup>{of(c.parts![p], PART[p])}</TooltipPopup>
            </Tooltip>
          ),
        }))
      : []),
    ...(Object.keys(STYLE) as (keyof typeof STYLE)[]).filter((k) => c.style[k]).map((k) => ({ key: k, node: of(c.style[k], STYLE[k]) })),
  ];

  return (
    <Popover>
      <div className="flex min-w-0 flex-1 basis-0 items-baseline overflow-hidden" ref={box}>
        <Separator className={cn("mx-3 h-4 shrink-0 self-center", !fit && "invisible")} orientation="vertical" />
        <PopoverTrigger
          aria-label="Counts"
          className={cn(
            "flex h-6 shrink-0 items-center gap-x-1.5 text-muted-foreground text-xs tabular-nums transition-colors duration-150 ease-out hover:text-foreground data-popup-open:text-foreground",
            !fit && "invisible",
          )}
          onPointerDown={back.onPointerDown}
        >
          {items.map((item, i) => (
            <span className={cn("flex h-6 items-center gap-1.5 whitespace-nowrap", i >= fit && "invisible")} data-count key={item.key}>
              {i > 0 && <span aria-hidden>·</span>}
              {item.node}
            </span>
          ))}
        </PopoverTrigger>
      </div>
      <PopoverPopup align="start" className="max-h-(--available-height) w-72" finalFocus={back.finalFocus}>
        <Table page={stats.page} sel={sel} />
      </PopoverPopup>
    </Popover>
  );
}

// Every number, with the selection's beside the page's.
type Row = { label: string; mark?: ReactNode; value: (c: Count) => ReactNode };
function Table({ page, sel }: { page: Count; sel: Count | null }) {
  // Misspellings as the header has them, then Harper's other kinds.
  const kinds = Object.keys(page.grammar ?? {})
    .filter((k) => !isSpelling(k))
    .sort();
  const sections: [string, Row[]][] = [
    [
      "Text",
      [
        { label: "Words", value: (c) => n(c.words) },
        { label: "Characters", value: (c) => n(c.characters) },
        { label: "Sentences", value: (c) => n(c.sentences) },
        { label: "Paragraphs", value: (c) => n(c.paragraphs) },
        { label: "Reading time", value: (c) => `${minutes(c)} min` },
      ],
    ],
    ["Parts of speech", PARTS.map((p) => ({ label: PART[p][1], mark: <Dot part={p} />, value: (c) => (c.parts ? n(c.parts[p]) : "…") }))],
    ["Style", (Object.keys(STYLE) as (keyof typeof STYLE)[]).map((k) => ({ label: STYLE[k][1], value: (c) => n(c.style[k]) }))],
    [
      "Grammar",
      [
        { label: "Misspellings", value: (c) => (c.grammar ? n(mistakes(c, true)) : "…") },
        ...kinds.map((k): Row => ({ label: kindName(k), value: (c) => n(c.grammar?.[k] ?? 0) })),
      ],
    ],
  ];
  const upper = (s: string) => s[0].toUpperCase() + s.slice(1);
  // COSS's Table, its rows made shorter to fit a popover.
  return (
    <>
      <UITable className="tabular-nums [&_td]:py-1.5 [&_th]:h-8">
        <TableHeader>
          <TableRow>
            <TableHead />
            {sel && <TableHead className="text-right">Selected</TableHead>}
            <TableHead className="text-right">Page</TableHead>
          </TableRow>
        </TableHeader>
        {sections.map(([title, rows], i) => (
          <TableBody key={title}>
            <TableRow>
              {/* Air above each section after the first, so it reads as a new one. */}
              <TableHead className={cn(i > 0 && "h-10 align-bottom")} colSpan={sel ? 3 : 2}>
                {title}
              </TableHead>
            </TableRow>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {r.mark}
                    {upper(r.label)}
                  </span>
                </TableCell>
                {sel && <TableCell className="text-right">{r.value(sel)}</TableCell>}
                <TableCell className="text-right">{r.value(page)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        ))}
      </UITable>
      {!page.grammar && <p className="mt-2 text-muted-foreground text-xs">Checking grammar…</p>}
    </>
  );
}

