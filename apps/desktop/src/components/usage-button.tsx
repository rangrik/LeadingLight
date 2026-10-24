import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { duration, type Limit, pace, type Plan, refreshUsage, resetText, usage } from "~/lib/usage";

// The bottom of the sidebar: a ring per plan, weekly outside and 5h inside, filled by what is
// used (as a person reads a full bar), after synara's usage rail; a click opens each limit.

const tone = (used: number) => (used >= 90 ? "destructive" : used >= 75 ? "warning" : "success");
const STROKE = { destructive: "stroke-destructive", warning: "stroke-warning", success: "stroke-success" };
const FILL = { destructive: "bg-destructive", warning: "bg-warning", success: "bg-success" };
const PACE = { behind: "bg-destructive", "on-track": "bg-warning", ahead: "bg-success" };
const TEXT = { destructive: "text-destructive-foreground", warning: "text-warning-foreground", success: "text-muted-foreground" };
const most = (p: Plan) => (p.limits.length ? Math.max(...p.limits.map((l) => l.used)) : null);

function Ring({ plan }: { plan: Plan }) {
  const outer = plan.limits.find((l) => l.label === "Weekly") ?? plan.limits.at(-1);
  const inner = plan.limits.find((l) => l.label === "5h");
  // A plan without a 5h limit (Codex's) has only the outer ring.
  const arc = (l: Limit | undefined, r: number) => (
    <>
      {(l || r > 5) && <circle className="stroke-current opacity-15" cx="8" cy="8" fill="none" r={r} strokeWidth="1.75" />}
      {l && <circle className={cn("transition-[stroke-dasharray] duration-200 ease-out", STROKE[tone(l.used)])} cx="8" cy="8" fill="none" pathLength={100} r={r} strokeDasharray={`${l.used} 100`} strokeLinecap="round" strokeWidth="1.75" />}
    </>
  );
  return (
    <svg aria-hidden className={cn("size-4 shrink-0 -rotate-90", plan.state !== "ok" && "opacity-50")} viewBox="0 0 16 16">
      {arc(outer, 6.75)}
      {arc(inner, 3.75)}
    </svg>
  );
}

function Row({ limit }: { limit: Limit }) {
  const p = pace(limit);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{limit.label}</span> <span className="text-xs">{limit.used}% used</span>
        </span>
        <span className="text-muted-foreground text-xs">{resetText(limit)}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-200 ease-out", FILL[tone(limit.used)])} style={{ width: `${limit.used}%` }} />
        {p && limit.used < 100 && (
          <span aria-hidden className={cn("absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-popover", PACE[p.status as keyof typeof PACE])} style={{ left: `${p.tick}%` }} />
        )}
      </div>
      {p && (
        <div className="mt-1 flex justify-between gap-2 text-muted-foreground text-xs">
          <span>{p.gap}</span>
          <span>{p.eta}</span>
        </div>
      )}
    </div>
  );
}

export function UsageButton() {
  const { plans, checked, checking } = usage.use();
  // While the card is open its "Checked" and countdowns move on.
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [open]);
  // Checked as the app opens, then every 5 minutes while it is in front.
  useEffect(() => {
    void refreshUsage(true);
    const t = window.setInterval(() => document.visibilityState === "visible" && void refreshUsage(true), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  const shown = plans.filter((p) => p.state !== "missing");
  if (!shown.length) return null;
  return (
    // Names give way first when the sidebar is narrow.
    <SidebarFooter className="@container/usage">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover
            onOpenChange={(o) => {
              setOpen(o);
              if (o) void refreshUsage();
            }}
          >
            <PopoverTrigger render={<SidebarMenuButton aria-label="Usage" className="gap-2.5" />}>
              {shown.map((p) => (
                <span className="flex shrink-0 items-center gap-1" key={p.id} title={`${p.name}: the most used of its limits`}>
                  <Ring plan={p} />
                  <span className="hidden @[14rem]/usage:inline">{p.name}</span>
                  {most(p) !== null && <span className={cn("tabular-nums", TEXT[tone(most(p) ?? 0)])}>{most(p)}%</span>}
                </span>
              ))}
            </PopoverTrigger>
            <PopoverPopup align="end" className="w-72" side="right" sideOffset={16}>
              <div className="flex flex-col gap-4 text-sm">
                {shown.map((p) => (
                  <section aria-label={p.name} key={p.id}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{p.name}</span>
                      {p.plan && <span className="text-muted-foreground text-xs">{p.plan}</span>}
                    </div>
                    {p.limits.map((l) => (
                      <Row key={l.label} limit={l} />
                    ))}
                    {p.credits && <p className="mt-2 text-muted-foreground text-xs">{p.credits}</p>}
                    {p.note && <p className="mt-2 text-muted-foreground text-xs">{p.note}</p>}
                  </section>
                ))}
                <div className="-mb-1 flex items-center justify-between text-muted-foreground text-xs">
                  <span>{checked ? `Checked ${Date.now() - checked < 60_000 ? "just now" : `${duration(Date.now() - checked)} ago`}` : "Checking…"}</span>
                  <Button aria-label="Check again" className="-me-1.5" disabled={checking} onClick={() => void refreshUsage(true)} size="icon-xs" variant="ghost">
                    <RefreshCw className={cn(checking && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </PopoverPopup>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
