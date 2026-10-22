import { CheckIcon, ClockIcon, HandIcon, MinusIcon, XIcon } from "lucide-react";

import type { FlowRun } from "@/lib/flows";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/tip";

const words: Record<string, string> = {
  running: "Running",
  queued: "Queued: waiting for a slot, or for its flow's run in this worktree",
  waiting_gate: "Waiting for you at a gate",
  paused: "Paused",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted: berthd restarted during the run, before runs resumed",
};

// RunStatus is a run's outcome at a glance, named for screen readers and
// in a tooltip.
export function RunStatus({ status, className }: { status: FlowRun["status"] | string; className?: string }) {
  const box = cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full", className);
  const mark =
    status === "waiting_gate" ? (
      <span role="img" aria-label={words[status]} className={cn(box, "bg-warning/15 text-warning-foreground")}>
        <HandIcon className="size-2.5" strokeWidth={3} />
      </span>
    ) : status === "queued" || status === "paused" ? (
      <span role="img" aria-label={words[status]} className={cn(box, "bg-muted text-muted-foreground")}>
        <ClockIcon className="size-2.5" strokeWidth={3} />
      </span>
    ) : status === "running" ? (
      <span role="img" aria-label={words[status]} className={box}>
        <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
      </span>
    ) : status === "interrupted" || status === "cancelled" ? (
      <span role="img" aria-label={words[status]} className={cn(box, "bg-warning/15 text-warning-foreground")}>
        <MinusIcon className="size-2.5" strokeWidth={3} />
      </span>
    ) : status === "succeeded" ? (
      <span role="img" aria-label={words[status]} className={cn(box, "bg-success/15 text-success")}>
        <CheckIcon className="size-2.5" strokeWidth={3} />
      </span>
    ) : (
      <span role="img" aria-label={words[status] ?? status} className={cn(box, "bg-destructive/15 text-destructive-foreground")}>
        <XIcon className="size-2.5" strokeWidth={3} />
      </span>
    );
  return <Tip label={words[status] ?? status}>{mark}</Tip>;
}

// runTook is how long a run took, or has been going.
export function runTook(r: FlowRun): string {
  const ms = (r.finished ? new Date(r.finished).getTime() : Date.now()) - new Date(r.started).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
