import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { TailRow, useFading } from "~/components/tail";
import { useFront } from "~/lib/bar";
import { dayShown, today } from "~/lib/daily";
import { openBeside } from "~/lib/panes";
import { inPanel, type Line, saw, tail, TODAY } from "~/lib/tail";

// The bar's Suggestions (features/suggestions.feature): tail's offers about the page in front, then
// those about other pages and the day's rows, which Today shows itself. What it shows is seen.
export function Suggestions({ pane }: { pane?: boolean }) {
  const all = tail.use();
  const front = useFront();
  const day = dayShown(today());
  const lines = useMemo(() => all.filter((l) => inPanel(l) && !(l.where === TODAY && day && front === day)), [all, front, day]);
  // Faded here, so the panel is empty only once the last row has gone.
  const rows = useFading(lines);
  useEffect(() => saw(lines.map((l) => l.id)), [lines]);
  useEffect(() => () => light(), []);
  const ref = useUnderTitle(pane);
  if (!rows.length) return <p className="m-auto px-6 py-10 text-center text-muted-foreground text-sm">Nothing yet.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-sm" ref={ref}>
      <Group front={front} lit rows={rows.filter((r) => r.line.where === front)} title="On this page" />
      <Group front={front} rows={rows.filter((r) => r.line.where !== front)} title="Elsewhere" />
    </div>
  );
}

// On this page a row lights its block's words while hovered or holding the keyboard; elsewhere it
// quotes them, and a name opens its page beside the one in front.
function Group({ title, rows, front, lit }: { title: string; rows: ReturnType<typeof useFading>; front?: string; lit?: boolean }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="flex h-8 items-center font-medium text-muted-foreground text-xs">{title}</h3>
      <div className="flex flex-col gap-2">
        {rows.map(({ line, leaving }) => (
          <TailRow
            here={front}
            key={line.id}
            leaving={leaving}
            line={line}
            open={openBeside}
            words={line.done?.words ?? (lit ? line.words : (line.row ?? line.words))}
            {...(lit && { onBlur: () => light(), onFocus: () => light(line), onPointerEnter: () => light(line), onPointerLeave: () => light() })}
          />
        ))}
      </div>
    </section>
  );
}

// In a pane, the rows start under the header's title, wherever its back and forward put it.
function useUnderTitle(pane?: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const section = el?.closest("section");
    const title = section?.querySelector("header [data-slot=breadcrumb-page]");
    if (!pane || !el || !section || !title) return;
    const place = () => (el.style.paddingInlineStart = `${title.getBoundingClientRect().left - el.getBoundingClientRect().left}px`);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(section);
    return () => ro.disconnect();
  });
  return ref;
}

// A highlight that never enters the page (CSS Custom Highlight API), as Show's light is.
function light(line?: Line) {
  const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (r: Range) => unknown }).Highlight;
  if (!css?.highlights || !Highlight) return;
  const el = line?.block === undefined ? null : document.querySelector(`[data-pane-page="${CSS.escape(line.where)}"] .ll-editor > :nth-child(${line.block + 1})`);
  if (!el) return void css.highlights.delete("ll-target");
  const range = document.createRange();
  range.selectNodeContents(el);
  css.highlights.set("ll-target", new Highlight(range));
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
