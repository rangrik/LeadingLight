import { useLayoutEffect, useRef } from "react";

// Keeping the words being read where they are when something above them changes height, where the
// browser doesn't do so itself (WebKit has no scroll anchoring; Chromium does, through overflow-anchor).
const anchors = typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto");

// For a box above the words: its growth while it is above the view is made up for.
export function useAnchored(ref: React.RefObject<HTMLElement | null>) {
  const height = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>("[data-page-scroller]");
    if (!el || !scroller || anchors) return;
    height.current = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const delta = el.offsetHeight - height.current;
      height.current = el.offsetHeight;
      if (delta && el.getBoundingClientRect().bottom < scroller.getBoundingClientRect().top + 1) scroller.scrollTop += delta;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

// For a stream of articles the view may be inside: the one at the top of the view stays put when
// one lands or grows above it. Chromium's anchoring skips a landing (the next one's margin changes),
// so this runs there too; what it already made up for reads as no move.
export function useStreamAnchored(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>("[data-page-scroller]");
    if (!el || !scroller) return;
    let read: Element | undefined;
    let top = 0;
    let height = el.offsetHeight;
    const mark = () => {
      const view = scroller.getBoundingClientRect().top;
      read = [...el.children].find((c) => c.getBoundingClientRect().bottom > view);
      top = read?.getBoundingClientRect().top ?? 0;
      // Only an article reaching above the view is being read; one below it moves with the page.
      if (top > view) read = undefined;
    };
    const ro = new ResizeObserver(() => {
      const moved = read?.isConnected ? read.getBoundingClientRect().top - top : 0;
      if (moved) scroller.scrollTop += moved;
      height = el.offsetHeight;
      mark();
    });
    // A scroll seen after a change but before the observer is left to it.
    const scrolled = () => el.offsetHeight === height && mark();
    mark();
    ro.observe(el);
    scroller.addEventListener("scroll", scrolled, { passive: true });
    return () => (ro.disconnect(), scroller.removeEventListener("scroll", scrolled));
  }, [ref]);
}
