// "On this page" after tweenly's table of contents, trail variant (MIT, github.com/mirukullacode/tweenly).
// Changes: headings come from the editor instead of element ids, the scroller is the page's pane,
// levels count from the page's top heading, and the rail and spotlight variants are left out.
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { List, Plane } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@leadinglight/ui/lib/utils";
import { pageLayout } from "./page-layout";

type Item = { title: string; level: number };
type Row = { top: number; height: number };
type Point = { x: number; y: number };

// A heading becomes current once it is this close to the pane's top.
const OFFSET = 32;

const headingEls = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3, h4")].filter((h) => h.textContent?.trim());

function useHeadings(editor: Editor): Item[] {
  const key = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!pageLayout(editor.state.doc).headings) return "[]";
      const list: Item[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "heading" && node.textContent.trim()) list.push({ title: node.textContent, level: node.attrs.level });
        return !node.isTextblock;
      });
      const top = Math.min(...list.map((i) => i.level));
      return JSON.stringify(list.map((i) => ({ ...i, level: Math.min(3, i.level - top + 1) })));
    },
  });
  return useMemo(() => JSON.parse(key) as Item[], [key]);
}

function useActiveHeading(editor: Editor, count: number) {
  const [active, setActive] = useState(0);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const scroller = editor.view.dom.closest<HTMLElement>("[data-page-scroller]");
    if (!scroller || !count) return;
    let frame = 0;
    const compute = () => {
      frame = 0;
      if (lock.current) return;
      const top = scroller.getBoundingClientRect().top;
      const els = headingEls(editor);
      let current = 0;
      els.forEach((el, i) => el.getBoundingClientRect().top - top <= OFFSET + 1 && (current = i));
      // The last headings may never reach the top, so the end of the scroll selects the last one.
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = els.length - 1;
      setActive(Math.max(0, current));
    };
    const release = () => {
      lock.current = false;
      onScroll();
    };
    const onScroll = () => {
      if (lock.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(release, 140);
      }
      frame ||= requestAnimationFrame(compute);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // A pane unfolding or resizing moves the headings without a scroll.
    const ro = new ResizeObserver(onScroll);
    ro.observe(scroller);
    editor.on("update", onScroll);
    frame = requestAnimationFrame(compute);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro.disconnect();
      editor.off("update", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(timer.current);
      lock.current = false;
    };
  }, [editor, count]);

  // Pin the clicked entry while the page scrolls past the headings in between.
  const jump = (i: number) => {
    lock.current = true;
    setActive(i);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => (lock.current = false), 160);
  };
  return [Math.min(active, Math.max(0, count - 1)), jump] as const;
}

function useRows(listRef: React.RefObject<HTMLElement | null>, items: Item[]) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const els = Array.from(list.querySelectorAll<HTMLElement>("[data-toc-row]"));
    const ro = new ResizeObserver(() => setRows(els.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }))));
    ro.observe(list);
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [listRef, items]);
  return rows;
}

const DOT_X = 5;
const STEP = 14;
const dotX = (level = 1) => DOT_X + (level - 1) * STEP;

function buildPath(dots: Point[]) {
  const pts: Point[] = [dots[0]];
  const stops = [0];
  let total = 0;
  const push = (p: Point) => {
    const q = pts[pts.length - 1];
    total += Math.hypot(p.x - q.x, p.y - q.y);
    pts.push(p);
  };
  for (let i = 1; i < dots.length; i++) {
    const a = dots[i - 1];
    const b = dots[i];
    // Jog diagonally halfway between two dots when the indentation changes.
    if (a.x !== b.x) {
      const mid = (a.y + b.y) / 2;
      const h = Math.min(Math.abs(b.x - a.x), (b.y - a.y) * 0.6) / 2;
      push({ x: a.x, y: mid - h });
      push({ x: b.x, y: mid + h });
    }
    push(b);
    stops.push(total);
  }
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  return { d, pts, stops, dots };
}

function pointAt(pts: Point[], length: number) {
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (!seg) continue;
    if (walked + seg >= length || i === pts.length - 1) {
      const t = Math.min(1, Math.max(0, (length - walked) / seg));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
    }
    walked += seg;
  }
  return { ...pts[0], angle: 90 };
}

export function TableOfContents({ editor }: { editor: Editor }) {
  const items = useHeadings(editor);
  const [index, jump] = useActiveHeading(editor, items.length);
  const reduced = !!useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useRows(listRef, items);
  const geo = useMemo(
    () =>
      rows.length && rows.length === items.length
        ? buildPath(rows.map((r, i) => ({ x: dotX(items[i].level), y: r.top + Math.min(r.height / 2, 16) })))
        : null,
    [rows, items],
  );

  // After a click picks an entry, the rail's list stays shut until the pointer leaves it.
  const [shut, setShut] = useState(false);
  const progress = useMotionValue(0);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const heading = useMotionValue(135);
  const rotate = useSpring(heading, { stiffness: 260, damping: 26 });
  const dash = useTransform(progress, (l) => `${l} 100000`);
  const dir = useRef(1);
  const placed = useRef(false);

  // The plane sits on the path at `progress` and faces its direction of travel.
  useEffect(() => {
    if (!geo) return;
    const sync = (l: number) => {
      const p = pointAt(geo.pts, l);
      x.set(p.x);
      y.set(p.y);
      heading.set(p.angle + 45 + (dir.current < 0 ? 180 : 0));
    };
    sync(progress.get());
    return progress.on("change", sync);
  }, [geo, progress, x, y, heading]);

  useEffect(() => {
    if (!geo) return;
    const target = geo.stops[index] ?? 0;
    if (!placed.current || reduced) {
      placed.current = true;
      progress.jump(target);
      heading.jump(pointAt(geo.pts, target).angle + 45);
      rotate.jump(heading.get());
      return;
    }
    const distance = Math.abs(target - progress.get());
    dir.current = target >= progress.get() ? 1 : -1;
    const controls = animate(progress, target, { duration: Math.min(1.1, 0.35 + distance / 500), ease: [0.65, 0, 0.35, 1] });
    controls.then(() => {
      dir.current = 1;
      heading.set(pointAt(geo.pts, target).angle + 45);
    });
    return () => controls.stop();
  }, [geo, index, reduced, progress, heading, rotate]);

  const select = (i: number) => {
    const el = headingEls(editor)[i];
    const scroller = editor.view.dom.closest<HTMLElement>("[data-page-scroller]");
    if (!el || !scroller) return;
    jump(i);
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + delta - OFFSET + 1, behavior: reduced ? "auto" : "smooth" });
  };

  if (items.length < 2) return null;
  return (
    <div className="ll-toc">
      <nav aria-label="On this page" className="w-full text-sm" data-shut={shut || undefined} onPointerLeave={() => setShut(false)}>
        <div className="ll-toc-head mb-3 flex items-center gap-2 font-medium text-foreground">
          <List aria-hidden className="size-4 text-muted-foreground" />
          On this page
        </div>
        <ul className="relative" ref={listRef}>
          {geo && (
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground">
              <path className="text-muted-foreground opacity-40" d={geo.d} fill="none" stroke="currentColor" strokeDasharray="3 4" strokeWidth={1.25} />
              <motion.path d={geo.d} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} style={{ strokeDasharray: dash }} />
              {geo.dots.map((p, i) =>
                i === index ? null : (
                  <circle
                    className={cn("transition-colors duration-300", i < index ? "" : "fill-background text-muted-foreground")}
                    cx={p.x}
                    cy={p.y}
                    fill={i < index ? "currentColor" : undefined}
                    key={i}
                    r={i < index ? 2.5 : 2.25}
                    stroke="currentColor"
                    strokeWidth={1.25}
                  />
                ),
              )}
            </svg>
          )}
          {geo && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 -mt-2.5 -ml-2.5 grid size-5 place-items-center rounded-full bg-background text-foreground"
              style={{ x, y, rotate }}
            >
              <Plane className="size-3.5" fill="currentColor" strokeWidth={1.25} />
            </motion.div>
          )}
          {items.map((item, i) => (
            <li data-toc-row key={`${i}-${item.title}`}>
              <a
                aria-current={i === index ? "location" : undefined}
                className={cn(
                  "block py-1.5 pr-2 leading-5 transition-colors duration-300",
                  i === index ? "font-semibold text-foreground" : i < index ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/60 hover:text-foreground",
                )}
                href={`#heading-${i}`}
                onClick={(e) => {
                  e.preventDefault();
                  // A mouse click shuts the rail's list; the keyboard keeps focus and the list.
                  if (e.detail) {
                    e.currentTarget.blur();
                    setShut(true);
                  }
                  select(i);
                }}
                style={{ paddingLeft: dotX(item.level) + 15 }}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
