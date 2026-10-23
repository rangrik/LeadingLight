import { ArrowUp, TextQuote } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { askEditor, askFromBar, closeBar, quoteInReply, useAsk } from "~/lib/ask";

// The ask bar: a small bar by the selected words, with a field to ask Claude about them
// (sent at once, the words quoted) and Quote in reply, which carries them into the panel
// to say more there. After Shipyard's selection-actions (vendor/shipyard/app/src/
// components/conversation/selection-actions.tsx): placed above the selection's first
// line, or below its last when there is no room; it follows the page as it scrolls; the
// editor keeps the words marked while the field has the keyboard; gone on Escape, on a
// click elsewhere, or once it sends.

const GAP = 8;
const EDGE = 12;

export function AskBar() {
  const { bar } = useAsk();
  const [question, setQuestion] = useState("");
  const [at, setAt] = useState<{ top: number; left: number; below: boolean; max: number }>();
  const ref = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // A fresh range for the words each time: the editor redraws those nodes when it loses
  // focus to the field, and a range kept from before collapses with them.
  const range = useCallback(() => (bar ? (askEditor()?.domRange(bar.quote.from, bar.quote.to) ?? null) : null), [bar]);
  // The pane the words scroll in; with pages side by side, each pane has its own.
  const scroller = useCallback(() => {
    const node = range()?.startContainer;
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el?.closest<HTMLElement>("[data-page-scroller]") ?? null;
  }, [range]);

  const place = useCallback(() => {
    const pane = ref.current?.offsetParent as HTMLElement | null;
    if (!bar || !pane || !ref.current) return;
    const r = range();
    const rects = r ? [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1) : [];
    if (!rects.length) return closeBar(false);
    const first = rects[0];
    const last = rects[rects.length - 1];
    const box = pane.getBoundingClientRect();
    const view = scroller()?.getBoundingClientRect() ?? box;
    // With pages side by side, the bar stays inside the card the words are in.
    const card = scroller()?.closest("section")?.getBoundingClientRect() ?? box;
    const { width, height } = ref.current.getBoundingClientRect();
    const below = first.top - height - GAP < view.top;
    const top = below ? last.bottom + GAP : first.top - height - GAP;
    if (last.bottom < view.top || first.top > view.bottom) return setAt(undefined);
    const line = rects.filter((r) => Math.abs(r.top - (below ? last.top : first.top)) < 2);
    const from = Math.min(...line.map((r) => r.left));
    const anchor = (from + Math.max(...line.map((r) => r.right))) / 2;
    const left = Math.max(Math.min(anchor - width / 2, card.right - width - EDGE), card.left + EDGE);
    setAt({ top: top - box.top, left: left - box.left, below, max: card.width - 2 * EDGE });
  }, [bar, range, scroller]);

  useLayoutEffect(place, [place]);
  useEffect(() => {
    if (!bar) return;
    setQuestion("");
    return () => setAt(undefined);
  }, [bar]);
  // The field takes the keyboard as soon as the bar is placed, before the first paint: a
  // key pressed right after opening (Escape, say) must land here, not in the page. Taking
  // it makes the editor redraw, so the words are found again right after.
  const placed = at !== undefined;
  useLayoutEffect(() => {
    if (!bar || !placed) return;
    field.current?.focus();
    place();
  }, [bar, placed, place]);

  // Gone when the selection is, unless the bar's own field took the focus.
  useEffect(() => {
    if (!bar) return;
    const onChange = () => {
      if (ref.current?.contains(document.activeElement)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) closeBar(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeBar(false);
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [bar]);

  useEffect(() => {
    if (!bar) return;
    const s = scroller();
    s?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    // The card resizes or moves when the sidebar slides or a gap is dragged.
    const resized = new ResizeObserver(place);
    if (s) resized.observe(s);
    return () => {
      s?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      resized.disconnect();
    };
  }, [bar, place, scroller]);

  if (!bar) return null;
  const send = () => {
    const q = question.trim();
    if (!q) return;
    window.getSelection()?.removeAllRanges();
    askFromBar(q);
  };
  // Buttons take no focus from the field on press.
  const keep = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <div
      aria-label="Ask Claude"
      className="absolute z-40 flex h-9 items-center gap-1 rounded-lg border bg-popover p-1 pl-2.5 text-popover-foreground shadow-lg"
      data-below={at?.below ? "" : undefined}
      data-testid="ask-bar"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeBar();
        }
      }}
      ref={ref}
      role="toolbar"
      style={at ? { top: at.top, left: at.left, maxWidth: at.max } : { top: 0, left: 0, visibility: "hidden" }}
    >
      <input
        aria-label="Ask Claude about this"
        className="h-full w-[min(15rem,40vw)] min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Ask Claude about this…"
        ref={field}
        value={question}
      />
      {question.trim() ? (
        <Button aria-label="Send" className="rounded-md" onClick={send} onPointerDown={keep} size="icon-sm">
          <ArrowUp />
        </Button>
      ) : null}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Button className="text-muted-foreground hover:text-foreground" onClick={quoteInReply} onMouseDown={keep} onPointerDown={keep} size="sm" variant="ghost">
        <TextQuote />
        Quote in reply
      </Button>
    </div>
  );
}
