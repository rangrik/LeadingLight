import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { duration, type Limit, pace, type Plan, refreshUsage, resetText, usage } from "~/lib/usage";

// One line above the sidebar's toolbar: a thin bar per plan, grey until it runs low; a click opens each limit.

const tone = (used: number) => (used >= 90 ? "destructive" : used >= 75 ? "warning" : "success");
const FILL = { destructive: "bg-destructive", warning: "bg-warning", success: "bg-success" };
const LINE = { destructive: "bg-destructive", warning: "bg-warning", success: "bg-sidebar-foreground/40" };
const PACE = { behind: "bg-destructive", "on-track": "bg-warning", ahead: "bg-success" };
const TEXT = { destructive: "text-destructive-foreground", warning: "text-warning-foreground", success: "text-muted-foreground" };
const most = (p: Plan) => (p.limits.length ? Math.max(...p.limits.map((l) => l.used)) : null);

// Name and percentage over a bar as wide as half the row, so the bar stays readable in a narrow sidebar.
function Meter({ plan }: { plan: Plan }) {
  const used = most(plan);
  return (
    <span className={cn("flex min-w-0 flex-1 flex-col gap-1", plan.state !== "ok" && "opacity-50")}>
      <span className="flex gap-1 leading-4">
        <span className="min-w-0 flex-1 truncate">{plan.name}</span>
        {used !== null && <span className={cn("shrink-0 tabular-nums", TEXT[tone(used)])}>{used}%</span>}
      </span>
      <span aria-hidden className="h-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
        {used !== null && <span className={cn("block h-full rounded-full transition-[width] duration-200 ease-out", LINE[tone(used)])} style={{ width: `${used}%` }} />}
      </span>
    </span>
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
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover
          onOpenChange={(o) => {
            setOpen(o);
            if (o) void refreshUsage();
          }}
        >
          <PopoverTrigger render={<SidebarMenuButton aria-label="Usage" className="h-auto gap-3 py-1.5 text-muted-foreground text-xs" />}>
            {shown.map((p) => (
              <Meter key={p.id} plan={p} />
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
  );
}
