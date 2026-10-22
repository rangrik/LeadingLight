import { AlertCircleIcon, AlertTriangleIcon, ArrowUpIcon, BarChart3Icon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, GitBranchIcon, GlobeIcon, LayoutGridIcon, RefreshCwIcon, SendIcon, Table2Icon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { ArtId } from "@/lib/whats-new-model";
import { cn } from "@/lib/utils";

// The What's new card's pictures: small renders of the app's own pieces
// (an artifact's card, a visual diff's slider, the Console drawer, a row
// being renamed, a helper's report, the times), drawn with the theme's
// tokens so they look right in every theme. Each is drawn at about the
// app's own size on a 480×280 canvas and scaled to fit its frame. They say
// nothing a screen reader needs (the item's words do), so they are hidden
// from it, and nothing in them moves.

export const ART_W = 480;
export const ART_H = 280;

// WhatsNewArt fills its container's width, keeping the canvas's shape.
export function WhatsNewArt({ art, className }: { art: ArtId; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(ART_W);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || ART_W));
    ro.observe(el);
    setWidth(el.clientWidth || ART_W);
    return () => ro.disconnect();
  }, []);
  const k = width / ART_W;
  const Draw = DRAW[art];
  return (
    <div ref={box} aria-hidden className={cn("relative w-full overflow-hidden bg-background", className)} style={{ height: ART_H * k }} data-whats-new-art={art}>
      <div className="absolute top-0 left-0 origin-top-left select-none text-foreground text-xs leading-tight" style={{ width: ART_W, height: ART_H, transform: `scale(${k})` }}>
        <Draw />
      </div>
    </div>
  );
}

const DRAW: Record<ArtId, () => React.ReactElement> = {
  artifacts: Artifacts,
  "visual-diff": VisualDiff,
  devtools: Devtools,
  rename: Rename,
  "agent-messages": AgentMessages,
  speed: Speed,
};

// A line of text that isn't there: a muted bar.
const Bar = ({ w, className }: { w: number | string; className?: string }) => <span className={cn("block h-1.5 rounded-full bg-muted-foreground/20", className)} style={{ width: w }} />;

// An artifact's card in a chat, as components/art/art-card.tsx draws it:
// a thumbnail, its title, the headline its data gives, what and which
// version. Under the reply box, "N artifacts" opens the board.
function ArtCard({ thumb, icon, title, gist, gistClass, meta, live }: { thumb: React.ReactNode; icon: React.ReactNode; title: string; gist: string; gistClass: string; meta: string; live?: boolean }) {
  return (
    <div className="flex h-[74px] overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="flex w-[136px] shrink-0 border-r bg-background px-3.5 py-3">{thumb}</div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3.5">
        <span className="flex items-center gap-1.5 font-medium">
          {icon}
          {title}
        </span>
        <span className={cn("font-medium text-[11.5px]", gistClass)}>{gist}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {meta}
          {live && (
            <span className="ml-auto flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] text-foreground/80">
              <span className="size-1.5 rounded-full bg-success" />
              Live
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function Artifacts() {
  const bars = [
    [46, 16],
    [34, 13],
    [40, 20],
    [26, 10],
    [30, 14],
  ];
  return (
    <div className="flex h-full flex-col gap-2.5 px-6 pt-5">
      <span className="text-foreground/80 text-xs">The trigram index is in. Here is what it did:</span>
      <ArtCard
        thumb={
          <span className="flex w-full items-end gap-2">
            {bars.map(([a, b], i) => (
              <span key={i} className="flex flex-1 items-end gap-[2px]">
                <span className="w-full rounded-t-[2px] bg-muted-foreground/30" style={{ height: a }} />
                <span className="w-full rounded-t-[2px] bg-info" style={{ height: b }} />
              </span>
            ))}
          </span>
        }
        icon={<BarChart3Icon className="size-3.5 text-muted-foreground" />}
        title="p95 before and after"
        gist="/search 1,240 → 410 ms (−67%)"
        gistClass="text-success-foreground"
        meta="Bar chart · v2"
        live
      />
      <ArtCard
        thumb={
          <span className="flex w-full flex-col justify-center gap-[5px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="h-1 flex-1 rounded-full bg-muted-foreground/25" />
                <span className={cn("h-1 w-3.5 rounded-full", i === 1 || i === 3 ? "bg-destructive" : "bg-success")} />
              </span>
            ))}
          </span>
        }
        icon={<Table2Icon className="size-3.5 text-muted-foreground" />}
        title="Search test results"
        gist="3 failed of 16"
        gistClass="text-destructive-foreground"
        meta="Table · v1"
      />
      <div className="mt-auto flex items-center gap-2 pb-4">
        <span className="flex h-8 flex-1 items-center rounded-lg border bg-card px-3 text-muted-foreground">
          Reply, or ask for something else
          <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-muted">
            <ArrowUpIcon className="size-3" />
          </span>
        </span>
        <span className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-foreground">
          <LayoutGridIcon className="size-3.5" />6 artifacts
        </span>
      </div>
    </div>
  );
}

// A page, drawn in blocks; `after` has a banner the change added, which
// pushed the cards down.
function Page({ after }: { after?: boolean }) {
  return (
    <div className="flex h-full flex-col gap-2.5 bg-card p-3.5">
      <div className="flex items-center gap-2">
        <span className="size-3 rounded-[3px] bg-foreground/70" />
        <Bar w={48} className="bg-foreground/30" />
        <span className="ml-auto flex gap-2">
          <Bar w={22} />
          <Bar w={22} />
          <Bar w={22} />
        </span>
      </div>
      <div className="flex flex-col gap-1.5 pt-1.5">
        <span className="block h-3 w-[64%] rounded-sm bg-foreground/55" />
        <Bar w="48%" />
      </div>
      {after && (
        <span className="relative block h-6 rounded-sm bg-info/20 outline-2 outline-warning outline-offset-2">
          <span className="-top-2 -right-2 absolute flex size-4 items-center justify-center rounded-full bg-warning font-semibold text-[9px] text-background">1</span>
        </span>
      )}
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex h-20 flex-col justify-end gap-1.5 rounded-md border bg-background p-2">
            <Bar w="80%" />
            <Bar w="50%" />
          </span>
        ))}
      </div>
    </div>
  );
}

// A visual diff's tab: the before/after slider on a page, the change boxed
// and numbered.
function VisualDiff() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2.5 text-[11px]">
        <span className="flex rounded-md bg-muted p-0.5">
          <span className="rounded-[5px] bg-background px-2 py-0.5 font-medium shadow-xs">Slider</span>
          <span className="px-2 py-0.5 text-muted-foreground">Side by side</span>
          <span className="px-2 py-0.5 text-muted-foreground">Flicker</span>
          <span className="px-2 py-0.5 text-muted-foreground">Heatmap</span>
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          Changes
          <ChevronLeftIcon className="size-3.5" />
          <span className="text-foreground tabular-nums">1 of 3</span>
          <ChevronRightIcon className="size-3.5" />
        </span>
      </div>
      <div className="relative mx-6 mt-4 flex-1 overflow-hidden rounded-t-lg border border-b-0">
        <div className="absolute inset-0">
          <Page />
        </div>
        <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 46%)" }}>
          <Page after />
        </div>
        <div className="absolute inset-y-0 left-[46%] w-px bg-foreground/80">
          <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 flex h-7 w-4.5 items-center justify-center gap-px rounded-full border bg-background shadow-sm">
            <span className="h-3 w-px bg-muted-foreground" />
            <span className="h-3 w-px bg-muted-foreground" />
          </span>
        </div>
      </div>
    </div>
  );
}

// A Browser tab with its Console drawer open, an error ready to send.
function Devtools() {
  const row = "flex h-7 items-center gap-2 border-t px-4 font-mono text-[11px]";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
        <GlobeIcon className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate rounded-md bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">http://checkout-fix.shop.devl.localhost:1377/cart</span>
        <span className="rounded-full bg-destructive/12 px-1.5 py-px font-medium text-[10.5px] text-destructive-foreground tabular-nums">4</span>
      </div>
      <div className="flex flex-col gap-2 bg-card px-5 py-4">
        <span className="font-semibold text-sm">Cart</span>
        <Bar w="34%" />
      </div>
      <div className="flex flex-1 flex-col border-t bg-background">
        <div className="flex items-center gap-4 px-4 pt-2 text-[11.5px]">
          <span className="border-foreground border-b-2 pb-1.5 font-medium">Console</span>
          <span className="pb-1.5 text-muted-foreground">Network</span>
          <span className="ml-auto pb-1.5 text-[11px] text-muted-foreground">⌘⌥I</span>
        </div>
        <div className={cn(row, "h-8 bg-destructive/8")}>
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive-foreground" />
          <span className="min-w-0 flex-1 truncate text-destructive-foreground">TypeError: cart.summary is undefined</span>
          <span className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-0.5 font-sans text-[11px] text-foreground shadow-xs">
            <SendIcon className="size-3" />
            Send to agent
          </span>
        </div>
        <div className={row}>
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive-foreground" />
          <span className="min-w-0 flex-1 truncate text-destructive-foreground">Unhandled rejection: payment provider timed out</span>
        </div>
        <div className={row}>
          <AlertTriangleIcon className="size-3.5 shrink-0 text-warning-foreground" />
          <span className="truncate text-warning-foreground">Image has no width or height</span>
        </div>
        <div className={cn(row, "text-muted-foreground")}>
          <span className="w-3.5 shrink-0" />
          cart ready {"{ items: 2, currency: \"EUR\" }"}
        </div>
      </div>
    </div>
  );
}

// The sidebar with a worktree's row turned into its name field, and the
// name where the worktree shows: its tab group, with the branch kept.
function Rename() {
  const row = "flex h-7 items-center gap-2 rounded-md px-2";
  return (
    <div className="flex h-full">
      <div className="flex w-[236px] shrink-0 flex-col gap-0.5 border-r bg-sidebar px-2.5 py-4 text-sidebar-foreground">
        <div className={cn(row, "font-medium")}>
          <span className="size-3 rounded-[3px] border border-muted-foreground/60" />
          shop
          <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">devl</span>
        </div>
        <div className={cn(row, "pl-6")}>
          <span className="size-1.5 rounded-full bg-warning" />
          checkout-fix
        </div>
        <div className="mt-0.5 mb-1 ml-4 flex flex-col gap-1.5">
          <span className="flex h-7 items-center rounded-md border border-ring bg-background px-2 ring-2 ring-ring/25">
            Refund flow
            <span className="ml-px h-3.5 w-px bg-foreground" />
          </span>
          <span className="whitespace-nowrap px-1 text-[10px] text-muted-foreground">
            Branch stays <span className="font-mono">https-linear-app-acme</span>
          </span>
        </div>
        <div className={cn(row, "pl-6")}>
          <CheckIcon className="size-3 text-success" />
          order-export
        </div>
        <div className={cn(row, "pl-6")}>
          <span className="size-1.5 rounded-full bg-success" />
          search-perf
        </div>
        <div className={cn(row, "pl-6 text-muted-foreground")}>
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          qa-deck
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center gap-1.5 border-b px-3">
          <span className="flex h-6 items-center gap-1.5 rounded-md px-2 font-medium text-[11px]" style={{ background: "color-mix(in oklab, var(--wt-violet, var(--info)) 15%, transparent)", color: "var(--wt-violet, var(--foreground))" }}>
            Refund flow
          </span>
          <span className="flex h-6 items-center rounded-md bg-accent px-2 text-[11px]">Claude Code</span>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5">
          <span className="text-[11px] text-muted-foreground">
            shop / <span className="text-foreground">Refund flow</span>
          </span>
          <div className="ml-auto max-w-[85%] rounded-xl bg-muted px-2.5 py-1.5 text-[11px]">Fix the refund webhook</div>
          <div className="flex flex-col gap-1.5">
            <Bar w="88%" />
            <Bar w="70%" />
            <Bar w="78%" />
          </div>
        </div>
        <div className="flex h-7 items-center gap-1.5 border-t px-3 text-[10.5px] text-muted-foreground">
          <GitBranchIcon className="size-3" />
          <span className="text-foreground/85">Refund flow</span>
          <span className="truncate font-mono">https-linear-app-acme</span>
        </div>
      </div>
    </div>
  );
}

// A helper's report and a teammate's question in a chat, each as its
// sender's own card.
function Sender({ initial, tone, name, kind }: { initial: string; tone: string; name: string; kind: string }) {
  return (
    <>
      <span className="flex size-5 items-center justify-center rounded-full font-semibold text-[10px]" style={{ background: `color-mix(in oklab, var(--wt-${tone}, var(--info)) 22%, transparent)`, color: `var(--wt-${tone}, var(--foreground))` }}>
        {initial}
      </span>
      <span className="font-medium">{name}</span>
      <span className="text-[11px] text-muted-foreground">{kind}</span>
    </>
  );
}

function AgentMessages() {
  return (
    <div className="flex h-full flex-col gap-3 px-6 pt-6">
      <div className="ml-auto max-w-[70%] rounded-xl bg-muted px-3 py-1.5">Find every caller of chargeCard</div>
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Sender initial="S" tone="violet" name="scout" kind="Helper" />
          <span className="rounded-full bg-info/12 px-1.5 py-px font-medium text-[10px] text-info-foreground">Report</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">1m 48s · to Claude</span>
        </div>
        <span className="text-foreground/85 leading-snug">Found 4 callers of chargeCard. Two retry without an idempotency key.</span>
        <span className="self-start rounded-md border px-2 py-0.5 text-[11px]">Read report</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-xs">
        <Sender initial="R" tone="cyan" name="reviewer" kind="Teammate" />
        <span className="rounded-full bg-warning/12 px-1.5 py-px font-medium text-[10px] text-warning-foreground">Question</span>
        <span className="min-w-0 flex-1 truncate text-foreground/85">Keep the old retry path?</span>
        <span className="rounded-md border px-2 py-0.5 text-[11px]">Reply</span>
      </div>
      <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ background: "var(--wt-magenta, var(--info))" }} />
        <span className="text-foreground/85">build-watch</span>
        Update · tests green on main
        <span className="ml-auto flex items-center gap-1">
          <CheckIcon className="size-3.5 text-success" />3 finished
        </span>
      </div>
    </div>
  );
}

// The times before and after, and a box's link coming back by itself.
function Speed() {
  const rows: [string, string, string, number][] = [
    ["Sidebar ready, 300 worktrees", "2.48 s", "0.07 s", 0.07 / 2.48],
    ["Sidebar memory, 300 worktrees", "120 MB", "20 MB", 20 / 120],
    ["A reply's update, 2,000-turn chat", "57 ms", "15 ms", 15 / 57],
  ];
  return (
    <div className="flex h-full flex-col gap-3.5 px-6 pt-5">
      {rows.map(([what, before, after, ratio]) => (
        <div key={what} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground">{what}</span>
          <span className="flex items-center gap-3">
            <span className="h-1.5 flex-1 rounded-full bg-muted-foreground/25" />
            <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{before}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="flex-1">
              <span className="block h-1.5 rounded-full bg-success" style={{ width: `${Math.max(ratio * 100, 1.5)}%` }} />
            </span>
            <span className="w-12 text-right font-medium font-mono text-[11px] text-success-foreground tabular-nums">{after}</span>
          </span>
        </div>
      ))}
      <div className="mt-auto mb-4 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-xs">
        <RefreshCwIcon className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          Reconnecting to devl… <span className="text-muted-foreground">Next try in 6s</span>
        </span>
        <span className="rounded-md border px-2 py-0.5 text-[11px]">Try now</span>
      </div>
    </div>
  );
}
