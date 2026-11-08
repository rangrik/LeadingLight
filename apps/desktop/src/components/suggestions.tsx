import { useEffect, useMemo } from "react";
import { TailRow, useFading } from "~/components/tail";
import { useFront } from "~/lib/bar";
import { dayPage, dayShown, today } from "~/lib/daily";
import { openBeside } from "~/lib/panes";
import { inPanel, type Line, saw, tail, TODAY } from "~/lib/tail";

// The Inbox's suggestions (features/suggestions.feature): tail's offers about the page in front, then
// those about other pages and the day's rows, which Today shows itself. What it shows is seen.
export function useSuggestions() {
  const all = tail.use();
  const front = useFront();
  const day = dayShown(today());
  const lines = useMemo(() => all.filter((l) => inPanel(l) && !(l.where === TODAY && day && front === day)), [all, front, day]);
  // Faded here, so a section goes only once its last row has gone.
  const rows = useFading(lines);
  useEffect(() => saw(lines.map((l) => l.id)), [lines]);
  useEffect(() => () => light(), []);
  return { front, rows };
}
export type Rows = ReturnType<typeof useFading>;

// On this page a row lights its block's words while hovered or holding the keyboard; elsewhere it
// quotes them, and a name opens its page beside the one in front. Enter shows its block.
export function Group({ title, rows, front, lit }: { title?: string; rows: Rows; front?: string; lit?: boolean }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title} className="px-4">
      {title && <h4 className="flex h-8 items-center font-medium text-muted-foreground text-xs">{title}</h4>}
      <div className="flex flex-col">
        {rows.map(({ line, leaving }) => (
          <TailRow
            className="-mx-2.5 rounded-lg px-2.5 py-1 outline-none transition-[opacity,background-color] hover:bg-accent/40 focus:bg-accent/60"
            data-inbox-row
            here={front}
            key={line.id}
            leaving={leaving}
            line={line}
            onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && void show(line)}
            open={openBeside}
            tabIndex={-1}
            words={line.done?.words ?? (lit ? line.words : (line.row ?? line.words))}
            {...(lit && { onBlur: () => light(), onFocus: () => light(line), onPointerEnter: () => light(line), onPointerLeave: () => light() })}
          />
        ))}
      </div>
    </section>
  );
}

// Its page to the front (a day's row, Today), then its block lit once the page has drawn.
async function show(line: Line) {
  openBeside(line.where === TODAY ? await dayPage(today()) : line.where);
  requestAnimationFrame(() => requestAnimationFrame(() => light(line)));
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
