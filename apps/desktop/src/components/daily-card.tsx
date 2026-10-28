import { MessageSquareDashed } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { Row } from "~/components/work-panel";
import { card, dismissAll, goThrough, handOff, leftovers, saying, todayCard } from "~/lib/leftovers";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { space } from "~/lib/space";
import { tail } from "~/lib/tail";
import { reportsOn } from "~/lib/work";

// Under Today's day bar, once a day, when earlier days left suggestions or captures: a box like the
// work panel's. Handed off, it says so until the agent's report comes back, under Feed.
export function DailyCard() {
  const lines = tail.use();
  const { pages } = space.use();
  card.use();
  const { enabled } = projectPrefs.use();
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => leftovers(lines, pages), [lines, pages]);
  const c = todayCard();
  if (c.dismissed || (c.task ? reportsOn(c.task, pages).length > 0 : !items.length)) return null;
  const hand = (
    <Button disabled={!enabled || busy} onClick={() => (setBusy(true), void handOff(items).finally(() => setBusy(false)))} size="xs" variant="ghost">
      Hand off
    </Button>
  );
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm" data-testid="daily-card">
      <Row>
        <MessageSquareDashed className="size-4 shrink-0 text-muted-foreground" />
        {/* Its own width first: the buttons wrap under it before it is cut, then among themselves, at the end. */}
        <span className="min-w-0 flex-auto truncate text-muted-foreground">{c.task ? "Handed to an agent." : saying(items)}</span>
        {!c.task && (
          <span className="ms-auto flex flex-wrap justify-end gap-1">
            <Button onClick={() => goThrough(items)} size="xs" variant="outline">
              Go through
            </Button>
            <Button onClick={() => void dismissAll(items)} size="xs" variant="ghost">
              Dismiss all
            </Button>
            {enabled ? (
              hand
            ) : (
              <Tooltip>
                <TooltipTrigger render={<span className="flex" />}>{hand}</TooltipTrigger>
                <TooltipPopup>Needs Projects on in Settings</TooltipPopup>
              </Tooltip>
            )}
          </span>
        )}
      </Row>
      {c.error && <p className="ms-6 text-muted-foreground">Didn't go: {c.error}</p>}
    </div>
  );
}
