import { useSyncExternalStore } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { space } from "~/lib/space";
import { sessions, STATE_LABEL, type TaskState, taskState } from "~/lib/work-watch";

// The states that want a glance (features/task-work.feature); the rest show no dot.
const COLOR: Partial<Record<TaskState, string>> = { working: "bg-info", input: "bg-warning", review: "bg-success" };
const both = (fn: () => void) => {
  const a = space.subscribe(fn);
  const b = sessions.subscribe(fn);
  return () => (a(), b());
};

// A task's state as a 6 px dot on its tab or sidebar row, or a given one (a project's on the rail).
// It takes no room: the row places it in the gap before its icon. Redrawn only when the state changes.
export function StateDot({ pageId = "", state: given, className }: { pageId?: string; state?: TaskState; className?: string }) {
  const state = useSyncExternalStore(both, () => given ?? taskState(pageId));
  const color = state && COLOR[state];
  if (!state || !color) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span aria-label={STATE_LABEL[state]} className={cn("absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full before:absolute before:-inset-1", color, className)} data-state-dot={state} role="img" />}
      />
      <TooltipPopup>{STATE_LABEL[state]}</TooltipPopup>
    </Tooltip>
  );
}
