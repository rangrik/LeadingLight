import { type ReactElement, useSyncExternalStore } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { space } from "~/lib/space";
import { sessions, STATE_LABEL, type TaskState, taskState } from "~/lib/work-watch";

const both = (fn: () => void) => {
  const a = space.subscribe(fn);
  const b = sessions.subscribe(fn);
  return () => (a(), b());
};

// Amber is the one colour with a meaning, an agent waits for you: a 6 px dot on a task's tab or row,
// or a project's on the rail. It takes no room: the row places it in the gap before its icon.
export function StateDot({ pageId = "", state: given, className }: { pageId?: string; state?: TaskState; className?: string }) {
  const state = useSyncExternalStore(both, () => given ?? taskState(pageId));
  if (state !== "input") return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span aria-label={STATE_LABEL[state]} className={cn("absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-warning before:absolute before:-inset-1", className)} data-state-dot={state} role="img" />}
      />
      <TooltipPopup>{STATE_LABEL[state]}</TooltipPopup>
    </Tooltip>
  );
}

// Working and ready are words where a dot stood: the task's row or tab says its state when pointed at.
const SAID: (TaskState | undefined)[] = ["input", "working", "review"];
export function StateTip({ pageId, side, children }: { pageId: string; side?: "right"; children: ReactElement }) {
  const state = useSyncExternalStore(both, () => taskState(pageId));
  if (!state || !SAID.includes(state)) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side={side}>{STATE_LABEL[state]}</TooltipPopup>
    </Tooltip>
  );
}
