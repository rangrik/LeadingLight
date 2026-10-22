import type { CSSProperties } from "react";

import type { GraphRow } from "@/views/worktrees/commit-graph";

// Rows have one height, so each row's slice of the graph meets the next.
// One line per commit, like `git log --graph --oneline`; the height follows
// the density setting (useGraphRowHeight).
const LANE_W = 12;
const PAD = 6;

// Lane colours: the worktree's branch in the accent, the base in solid
// muted grey, and side branches from a categorical palette of equal
// lightness, so none reads as a status (green done, amber warning). Hues
// steer clear of the accent's blue. Each theme's appearance picks the
// lightness that holds against its background; see laneVars.
const HUES = [300, 175, 340, 70, 215, 135];
const BRANCH = "var(--color-info)";
const BASE = "color-mix(in oklch, var(--color-muted-foreground) 80%, transparent)";
export const laneColor = (i: number) => (i === 0 ? BRANCH : i === 1 ? BASE : `var(--lane-${(i - 2) % HUES.length})`);

// laneVars sets the side-branch palette on the graph's container.
export const laneVars = (dark: boolean) =>
  Object.fromEntries(HUES.map((h, i) => [`--lane-${i}`, dark ? `oklch(0.74 0.12 ${h})` : `oklch(0.58 0.15 ${h})`])) as CSSProperties;

export const gutterWidth = (lanes: number) => PAD * 2 + lanes * LANE_W;

const x = (lane: number) => PAD + lane * LANE_W + LANE_W / 2;

// GraphGutter draws one row of the commit graph: lines passing through,
// lines into and out of this row's commit, and its dot. A commit of the
// branch's own is a filled dot; one the branch lacks (behind) is hollow; a
// merge is a ring around a dot.
export function GraphGutter({ row, lanes, height, highlight }: { row: GraphRow; lanes: number; height: number; highlight?: boolean }) {
  const dotY = height / 2;
  const cx = x(row.lane);
  const color = laneColor(row.color);
  const behind = row.side === "behind";
  return (
    <svg width={gutterWidth(lanes)} height={height} className="shrink-0 overflow-visible" aria-hidden>
      {row.edges.map((e, i) => {
        const y1 = e.start === "top" ? 0 : dotY;
        const y2 = e.end === "bottom" ? height : dotY;
        const [x1, x2] = [x(e.from), x(e.to)];
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke={laneColor(e.color)} strokeWidth={e.color === 0 ? 2 : 1.5} strokeLinecap="round" />;
      })}
      {highlight && <circle cx={cx} cy={dotY} r={7.5} fill={color} opacity={0.2} />}
      {row.merge ? (
        <>
          <circle cx={cx} cy={dotY} r={4.25} fill="var(--color-popover)" stroke={color} strokeWidth={1.5} />
          {!behind && <circle cx={cx} cy={dotY} r={1.5} fill={color} />}
        </>
      ) : behind ? (
        <circle cx={cx} cy={dotY} r={3.25} fill="var(--color-popover)" stroke={color} strokeWidth={1.5} />
      ) : (
        <circle cx={cx} cy={dotY} r={3.5} fill={color} stroke="var(--color-popover)" strokeWidth={1.5} />
      )}
    </svg>
  );
}
