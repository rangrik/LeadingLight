import { Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Answer, Reply, TargetLink, useFeed } from "~/components/feed";
import { FeedbackButton } from "~/components/feedback";
import { StepCount, StepList } from "~/components/work-panel";
import { accept, acceptedOf, agentOfTask } from "~/lib/assign";
import { showTarget } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { openReview, reviewable } from "~/lib/review";
import { pageOf, space } from "~/lib/space";
import { reportOf, reportsOn, subtasksOf } from "~/lib/work";
import { sessions, stateOf } from "~/lib/work-watch";

// The review strip (features/review-side-by-side.feature): under the crumbs of a report shown
// beside its task. Answers, Send and Accept are the Feed's and the card's own.
export function ReviewStrip({ task, page }: { task: string; page: string }) {
  const { pages } = space.use();
  const live = sessions.use();
  const items = useFeed();
  const [open, setOpen] = useState(false);
  const t = pageOf(task);
  const agent = agentOfTask(t);
  if (!t || !agent) return null;
  const state = stateOf(t, agent, live);
  const asks = items.filter((i) => i.task === task && (i.request || i.reply));
  const next = items.find((i) => reviewable(i) && i.task !== task);
  // The report in view is the one accepted, if it is the agent's own; else its newest.
  const own = reportsOn(task, pages).filter((r) => reportOf(r)?.by === agent.id);
  const report = own.find((r) => r.id === page) ?? own.at(-1);
  const ready = (state === "review" || state === "idle" || state === "stopped") && !subtasksOf(task, pages).some((s) => s.properties.done !== true) ? report : undefined;
  const accepted = acceptedOf(t);
  return (
    <div className="shrink-0 border-b text-sm" data-testid="review-strip">
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 px-4 py-1">
        <StepCount agent={agent} onToggle={() => setOpen(!open)} open={open} />
        {state === "done" && <span className="text-muted-foreground">{accepted ? `Accepted ${formatAgo(accepted.at)}` : "Done"}</span>}
        <span className="ms-auto flex items-center gap-2">
          <FeedbackButton card pageId={task} />
          {ready && (
            <Button onClick={() => void accept(task, ready.id)} size="xs">
              <Check className="size-3.5" />
              Accept
            </Button>
          )}
          {next ? (
            <Button className="text-muted-foreground hover:text-foreground" onClick={() => openReview(next.task!)} size="xs" variant="link">
              Review next
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">Nothing else needs you</span>
          )}
        </span>
      </div>
      {open && <StepList agent={agent} className="px-4 pb-2" />}
      {asks.map((i) => (
        <div className="flex flex-col gap-1.5 pb-1" key={i.id}>
          {i.targets.some((x) => x.page !== page && x.page !== task) && (
            <div className="flex flex-wrap gap-1 px-4">
              <span className="text-muted-foreground text-xs leading-6">About</span>
              {i.targets.map((x, k) => (
                <TargetLink key={k} onOpen={() => showTarget(x)} t={x} />
              ))}
            </div>
          )}
          {i.request ? (
            <div className="px-2">
              <Answer item={i} />
            </div>
          ) : (
            <div className="px-4 pb-1.5">
              <p className="mb-1.5">{i.reason}</p>
              <Reply item={i} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
