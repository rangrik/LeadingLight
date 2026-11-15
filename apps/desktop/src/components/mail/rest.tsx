// The rest (design 5.4) and the end (5.5).
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@leadinglight/ui/components/empty";
import { keepGoing, useMail } from "~/lib/mail";
import { ago, ending, restWords } from "~/lib/mail-rules";
import { back, cameFromToday, doClear, doKeep, Keyed, look, restLater, run } from "./act";
import { useMailKeys } from "./keys";


export function RestView({ pane, view }: { pane: string; view: string }) {
  const m = useMail();
  const { headline, groups } = restWords(m.rest, !m.unread);
  // Opened from the rest's own Look: clearing it, or Later, goes back where he came from.
  const only = look.use().rest;
  const clear = () => {
    if (m.offline) return;
    if (only) back(pane);
    run(doClear());
  };
  const later = () => (only ? back(pane) : restLater());
  useMailKeys(pane, view, (e, typing, button) => {
    if (e.key === "Escape") return (back(pane), true);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Enter on a focused button is that button's.
    if (k === "e" || (k === "enter" && !button)) return (clear(), true);
    if (k === "l") return (later(), true);
  });
  return (
    <div className="ll-rise">
      <h1 className="mt-1.5 pt-10 text-balance font-semibold text-2xl leading-8 tracking-[-0.4px]">{headline}</h1>
      <p className="mt-1.5 text-pretty text-muted-foreground">Clearing archives them in Gmail and marks them read. Nothing is deleted.</p>
      <div className="-mx-2 mt-4 flex flex-col">
        {groups.map((g) => (
          <Collapsible key={g.name}>
            <CollapsibleTrigger render={<Button className="group/grp flex h-9 w-full justify-start gap-2 px-2 text-left font-normal transition-colors duration-150 ease-out sm:h-9" variant="ghost" />}>
              <ChevronRight className="text-muted-foreground transition-transform duration-150 ease-out group-data-panel-open/grp:rotate-90 motion-reduce:transition-none" />
              <span className="font-medium">{g.name}</span>
              <span className="text-muted-foreground tabular-nums">{g.items.length}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground group-data-panel-open/grp:invisible @max-[34rem]:hidden">
                {g.senders.slice(0, 3).join(", ")}
                {g.senders.length > 3 && ` and ${g.items.length - 3} more`}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              {g.items.map((i) => (
                <div className="group/row relative flex h-8 items-center gap-3 rounded-md ps-8 pe-2 transition-colors duration-150 ease-out hover:bg-accent" key={i.mail.key}>
                  <span className="flex w-39 shrink-0">
                    <Tooltip>
                      <TooltipTrigger render={<span className="max-w-full truncate" />}>{i.mail.name}</TooltipTrigger>
                      <TooltipPopup align="start">{i.mail.address}</TooltipPopup>
                    </Tooltip>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{i.mail.subject}</span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums group-focus-within/row:invisible group-hover/row:invisible @max-[34rem]:hidden">{ago(i.mail.date, m.now)}</span>
                  <Button className="absolute end-1 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100" onClick={() => run(doKeep(i))} size="xs" variant="ghost">
                    Keep
                  </Button>
                </div>
              ))}
            </CollapsiblePanel>
          </Collapsible>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Keyed disabled={m.offline} k="E" onClick={clear}>
          Clear all
        </Keyed>
        <Keyed k="L" onClick={later} variant="outline">
          Later
        </Keyed>
      </div>
    </div>
  );
}

// "That's everything", or "5 done" when more wait. Enter goes back where he came from.
export function EndView({ pane, view }: { pane: string; view: string }) {
  const m = useMail();
  const { title, line } = ending(m);
  const more = m.waiting.length > 0;
  const go = () => back(pane);
  useMailKeys(pane, view, (e, typing, button) => {
    if (e.key === "Escape") return (go(), true);
    if (e.key === "Enter" && !typing && !button) return (go(), true);
  });
  return (
    <Empty className="ll-rise flex-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Check />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{line}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        <Keyed k="↵" onClick={go}>
          {more ? "Stop here" : cameFromToday(pane) ? "Back to Today" : "Done"}
        </Keyed>
        {more && (
          <Button onClick={() => run(keepGoing())} variant="outline">
            Keep going
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
