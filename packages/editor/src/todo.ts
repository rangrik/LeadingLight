// Pen marks ported from Yash Bavadiya's scribble checkbox (MIT, github.com/xevrion/ui-lab).
// Changes: a TipTap node view instead of a React label, a 16px box, timing in editor.css.
import TaskItem from "@tiptap/extension-task-item";
import type { NodeView } from "@tiptap/pm/view";
import { tap } from "./sound";

type Line = { x0: number; x1: number; y: number };
type Stroke = { d: string; width: number };
type Timed = Stroke & { delay: number; ms: number };

const CHECK_MS = 200;
// The strike starts while the check's tail is still drawing, as a hand moves on.
const STRIKE_DELAY_MS = 140;

// FNV-1a, so a reload draws the same marks the page had.
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = (n: number) => Math.round(n * 10) / 10;

// A short dip, then a long flick past the box's top-right corner, in a 24 unit box. Every part
// varies, but inside ranges that always read as a check.
function checkPath(seed: number): Stroke {
  const rand = random(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const sx = between(3.5, 7);
  const sy = between(10, 14);
  const vx = sx + between(3.5, 5.5);
  const vy = between(16.5, 19.5);
  const angle = (between(48, 68) * Math.PI) / 180;
  const length = between(15, 21);
  const ex = vx + Math.cos(angle) * length;
  const ey = vy - Math.sin(angle) * length;
  const dipBow = between(-1.2, 1.4);
  const flickBow = between(-2.2, 1.6);
  const nx = Math.sin(angle);
  const ny = Math.cos(angle);
  let d =
    `M${r(sx)} ${r(sy)}` +
    `C${r(sx + 1.3 + dipBow)} ${r(sy + 2 - dipBow * 0.5)} ${r(vx - 1.8)} ${r(vy - between(0.2, 1.4))} ${r(vx)} ${r(vy)}` +
    `C${r(vx + (ex - vx) * 0.3 + nx * flickBow)} ${r(vy + (ey - vy) * 0.3 + ny * flickBow)} ${r(vx + (ex - vx) * 0.7 + nx * flickBow)} ${r(vy + (ey - vy) * 0.7 + ny * flickBow)} ${r(ex)} ${r(ey)}`;
  // Sometimes the pen lifts with a small hook instead of a clean stop.
  if (rand() < 0.45) {
    d += `q${r(between(0.6, 1.6))} ${r(between(-0.6, 0.3))} ${r(between(1.2, 2.6))} ${r(between(0.4, 1.4))}`;
  }
  // The box is drawn at 0.8 scale, so these units keep the original's 1.75–2.3px pen.
  return { d, width: r(between(2.2, 2.9)) };
}

// One wavering line per row, mostly rising left to right, with ragged ends.
function strikePath(line: Line, seed: number): Stroke {
  const rand = random(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const x0 = line.x0 - between(1, 5);
  const x1 = line.x1 + between(1, 6);
  const w = x1 - x0;
  const { y } = line;
  const slope = between(-2, 0.6);
  const d =
    `M${r(x0)} ${r(y - slope / 2 + between(-0.6, 0.6))}` +
    `C${r(x0 + w * between(0.25, 0.4))} ${r(y + between(-1.8, 1.8))} ${r(x0 + w * between(0.6, 0.75))} ${r(y + between(-1.8, 1.8))} ${r(x1)} ${r(y + slope / 2 + between(-0.6, 0.6))}`;
  return { d, width: r(between(1.4, 1.9)) };
}

// Longer rows take longer to draw, but never so long the pen feels slow.
const strikeMs = (line: Line) => Math.round(Math.min(260, Math.max(120, (line.x1 - line.x0) * 0.9)));

const NS = "http://www.w3.org/2000/svg";

function svg(name: string) {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("class", `ll-scribble ${name}`);
  el.setAttribute("aria-hidden", "true");
  return el;
}

// Paths are reused, so a stroke that is mid-draw keeps drawing.
function paint(el: SVGSVGElement, strokes: Timed[]) {
  while (el.childElementCount > strokes.length) el.lastElementChild!.remove();
  strokes.forEach((s, i) => {
    const path = el.children[i] ?? el.appendChild(document.createElementNS(NS, "path"));
    path.setAttribute("pathLength", "1");
    path.setAttribute("d", s.d);
    path.setAttribute("stroke-width", String(s.width));
    path.setAttribute("style", `--ll-delay: ${s.delay}ms; --ll-draw: ${s.ms}ms`);
  });
}

// In a Playful page a to-do checks itself off like a pen: a quick check, then a line through its
// own words. The marks are always drawn; editor.css hides them in a Plain page.
export const Todo = TaskItem.extend({
  addNodeView() {
    const base = this.parent?.();
    if (!base) return null;
    return (props) => {
      const view = base(props) as NodeView;
      const item = view.dom as HTMLElement;
      const content = view.contentDOM as HTMLElement;
      const check = svg("ll-check");
      check.setAttribute("viewBox", "0 0 24 24");
      const strike = svg("ll-strike");
      const label = item.querySelector("label")!;
      label.append(check);
      item.append(strike);
      // In a Playful page a check also taps, like a pen on paper.
      label.querySelector("input")!.addEventListener("change", (e) => {
        if ((e.target as HTMLInputElement).checked && props.editor.isEditable && item.closest('[data-style="playful"]')) tap();
      });

      let checked = props.node.attrs.checked;
      let seed = hash(props.node.textContent);
      let lines: Line[] = [];
      let frame = 0;

      const draw = () => {
        paint(check, [{ ...checkPath(seed), delay: 0, ms: CHECK_MS }]);
        let delay = STRIKE_DELAY_MS;
        paint(
          strike,
          lines.map((line, i) => {
            const s = { ...strikePath(line, seed + i + 1), delay, ms: strikeMs(line) };
            delay += s.ms;
            return s;
          }),
        );
      };

      // Follows the text's real rows, so wrapped words get one line per row.
      const measure = () => {
        frame = 0;
        const text = content.firstElementChild;
        if (!text) return;
        const origin = item.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        const rows: { top: number; bottom: number; left: number; right: number }[] = [];
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width < 1) continue;
          const row = rows.find((l) => Math.abs(l.top - rect.top) < rect.height / 2);
          if (row) {
            row.left = Math.min(row.left, rect.left);
            row.right = Math.max(row.right, rect.right);
          } else rows.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        }
        // Just under the middle of the row lands on the x-height.
        const next = rows.map((row) => ({
          x0: r(row.left - origin.left),
          x1: r(row.right - origin.left),
          y: r((row.top + row.bottom) / 2 - origin.top + 0.5),
        }));
        if (next.length === lines.length && next.every((l, i) => l.x0 === lines[i].x0 && l.x1 === lines[i].x1 && l.y === lines[i].y)) return;
        lines = next;
        draw();
      };

      draw();
      const observer = new ResizeObserver(() => measure());
      observer.observe(content);

      return {
        ...view,
        update: (node, decorations, inner) => {
          if (!view.update?.(node, decorations, inner)) return false;
          // Every new check gets a new hand, so no two look the same.
          if (node.attrs.checked && !checked) {
            seed = Math.floor(Math.random() * 4294967296);
            draw();
          }
          checked = node.attrs.checked;
          frame ||= requestAnimationFrame(measure);
          return true;
        },
        // The marks sit outside the text, so changing them is not an edit.
        ignoreMutation: (m) => m.type !== "selection" && !content.contains(m.target),
        destroy: () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
        },
      };
    };
  },
});
