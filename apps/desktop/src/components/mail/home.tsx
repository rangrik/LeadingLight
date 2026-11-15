// Mail home (design 5.2): the same words as Today's row, with the list. Before any account is
// connected, how to connect.
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Skeleton } from "@leadinglight/ui/components/skeleton";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Tabs, TabsList, TabsTab } from "@leadinglight/ui/components/tabs";
import { cn } from "@leadinglight/ui/lib/utils";
import { useCloud } from "~/lib/cloud";
import { keepGoing, refresh, startFresh, useMail } from "~/lib/mail";
import { ago, type Item, minutesOf, restWords, VERDICT } from "~/lib/mail-rules";
import { doClear, goThrough, Keyed, openLook, run } from "./act";
import { connection, connectNow, openAccounts } from "./accounts";
import { useMailKeys } from "./keys";
import { AccountTag, WhenCell } from "./tags";

export const Title = ({ children }: { children: React.ReactNode }) => <h1 className="text-balance pt-10 font-bold font-heading text-[2.25rem] leading-[1.2] tracking-tight">{children}</h1>;
const Lede = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-pretty text-base leading-[1.6]">{children}</p>;
const Small = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn("text-muted-foreground text-xs", className)}>{children}</span>;
const Label = ({ children }: { children: React.ReactNode }) => <p className="mt-4 flex h-8 items-center font-medium text-muted-foreground text-xs">{children}</p>;

export function Home({ pane, view, demo }: { pane: string; view: string; demo: boolean }) {
  const m = useMail();
  const cloud = useCloud();
  const c = connection.use();
  const s = m.said;
  const [days, setDays] = useState<3 | 7 | 14>(7);
  const go = s.state === "first" ? () => run(startFresh(days)) : ["needs", "away", "started", "unread", "due"].includes(s.state) ? () => goThrough(s.state) : null;
  useMailKeys(pane, view, (e, typing, button) => {
    if (e.key !== "Enter" || typing || button || e.metaKey || e.ctrlKey || !go) return;
    return (go(), true);
  });

  if (!m.accounts.length) {
    const signedOut = !demo && !cloud.user;
    return (
      <>
        <Title>Mail</Title>
        <Lede>LeadingLight reads your new mail and tells you what needs you. Nothing is sent or put away unless you say so.</Lede>
        {c.waiting && <p className="mt-2 text-muted-foreground">Finish in the browser window that opened. This page updates by itself.</p>}
        {c.notice && <p className="mt-2 text-muted-foreground" role="status">{c.notice}</p>}
        {(m.error || c.error) && !signedOut && (
          <div className="mt-4 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm">{c.error || m.error}</p>
            {m.error && (
              <Button disabled={m.loading} onClick={() => void refresh({ full: true })} size="sm" variant="outline">
                Try again
              </Button>
            )}
          </div>
        )}
        <div className="mt-4">
          {signedOut ? (
            <Button onClick={() => window.dispatchEvent(new Event("leadinglight:cloud-account"))}>Sign in to connect Gmail</Button>
          ) : (
            <Button disabled={c.busy || m.loading || !!m.error} onClick={() => void connectNow()}>
              Connect Gmail
            </Button>
          )}
        </div>
      </>
    );
  }

  if (s.state === "first")
    return (
      <>
        <Title>Start fresh</Title>
        <Lede>{s.line}</Lede>
        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="flex flex-col gap-1.5 text-muted-foreground tabular-nums">
            {m.accounts.map((a) => (
              <p className="flex min-w-0 items-center gap-2" key={a.account}>
                <span className="flex w-18 shrink-0">
                  <AccountTag account={a.account} />
                </span>
                <span className="truncate">
                  {a.email} · {(a.inbox ?? 0).toLocaleString("en-US")} waiting
                </span>
              </p>
            ))}
          </div>
          <Button className="text-muted-foreground" disabled={c.busy} onClick={() => void connectNow()} size="xs" variant="ghost">
            Add another account
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>Start from the last</span>
          <Tabs onValueChange={(v) => setDays(v as 3 | 7 | 14)} value={days}>
            <TabsList>
              {([3, 7, 14] as const).map((n) => (
                <TabsTab key={n} value={n}>
                  {n} days
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Keyed disabled={m.offline} k="↵" onClick={go!}>
            Start
          </Keyed>
          <Small>Older mail stays in Gmail, untouched. It never shows up here.</Small>
        </div>
      </>
    );

  if (s.state === "reading")
    return (
      <>
        <Title>{s.title}</Title>
        <p className="mt-4 flex items-center gap-2.5 text-muted-foreground">
          <Spinner className="size-4" />
          {s.line || "This takes about a minute. Today shows the result."}
        </p>
        {["w-full", "w-[78%]", "w-[64%]"].map((w) => (
          <Skeleton className={cn("mt-4 h-9 rounded-lg", w)} key={w} />
        ))}
      </>
    );

  const unread = s.state === "unread";
  const label = s.state === "away" || s.state === "paused";
  const rest = restWords(m.rest, !m.unread);
  return (
    <>
      <Title>{s.title}</Title>
      {s.line ? <Lede>{s.line}</Lede> : s.small && <Small className="mt-2 block">{s.small}</Small>}
      {s.signedOut.map((words) => (
        <div className="mt-4 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2.5 text-sm" key={words}>
          <CircleAlert className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-auto truncate text-muted-foreground">
            <span className="font-medium text-foreground">{words}</span> · Google signed LeadingLight out
          </span>
          <Button className="ms-auto" onClick={openAccounts} size="xs" variant="outline">
            Reconnect
          </Button>
        </div>
      ))}
      {(go || s.state === "paused" || s.state === "done") && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {go && (
            <Keyed k="↵" onClick={go}>
              {s.state === "started" ? "Continue" : "Go through"}
            </Keyed>
          )}
          {s.state === "paused" && (
            <Button onClick={() => run(keepGoing().then(() => openLook()))} variant="outline">
              Keep going
            </Button>
          )}
          {(s.line || s.state === "done") && <Small>{s.small}</Small>}
        </div>
      )}
      {label && s.state === "away" && <Label>Start with these</Label>}
      {s.state !== "paused" && s.state !== "done" && m.look.length > 0 && (
        <div className={cn("-mx-2 flex flex-col", !label && "mt-6")}>
          {m.look.map((i) => (
            <Row item={i} key={i.mail.key} now={m.now} onClick={() => openLook(i.mail.key)} unread={unread} />
          ))}
        </div>
      )}
      {m.waiting.length > 0 && label && (
        <>
          <Label>Waiting for the next look</Label>
          <div className="-mx-2 flex flex-col">
            {m.waiting.map((i) => (
              <Row item={i} key={i.mail.key} now={m.now} unread={unread} />
            ))}
          </div>
        </>
      )}
      {m.rest.length > 0 && (
        <div className={cn("relative flex min-h-15 items-center gap-3 pt-4 pb-2 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border", m.look.length && s.state !== "paused" && s.state !== "done" ? "mt-2" : "mt-6")}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{rest.headline}</span>
            <span className="block truncate text-muted-foreground text-xs">{rest.counts}</span>
          </span>
          <Button disabled={m.offline} onClick={() => run(doClear())} size="xs" variant="outline">
            Clear all
          </Button>
          <Button className="-me-[7px]" onClick={() => openLook("", true)} size="xs" variant="ghost">
            Look
          </Button>
        </div>
      )}
      {m.later.length > 0 && (
        <>
          <Label>Kept for later</Label>
          <div className="-mx-2 flex flex-col">
            {m.later.map((i) => (
              <Row item={i} key={i.mail.key} note="back in your next look" now={m.now} unread={!i.lines} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// The headline (or, not read, the subject), then what it is and who; at the right, the account
// and the date in two columns that line up down the list. Narrow, those two take a third line.
function Row({ item, now, unread, note, onClick }: { item: Item; now: number; unread: boolean; note?: string; onClick?: () => void }) {
  const { mail: m, lines: l } = item;
  const read = l && !unread, mins = read && l.verdict !== "work" && minutesOf(item);
  const sub = (read ? [VERDICT[l.verdict], mins && `${mins} min`, m.name] : [m.name, ago(m.date, now)]).filter(Boolean).join(" · ") + (note ? ` · ${note}` : "");
  const inner = (
    <>
      <span className="min-w-0 flex-1 @max-[34rem]:basis-full">
        <span className="block truncate font-medium">{read ? l.headline : m.subject || "(No subject)"}</span>
        <span className="block truncate text-muted-foreground text-xs">{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-4 text-muted-foreground text-xs tabular-nums @max-[34rem]:gap-2">
        <span className="flex w-18 @max-[34rem]:w-auto">
          <AccountTag account={m.account} />
        </span>
        <span className="flex w-33 justify-end whitespace-nowrap @max-[34rem]:w-auto">{read && <WhenCell item={item} now={now} />}</span>
      </span>
    </>
  );
  const box = "flex h-auto min-h-13 w-full items-center gap-3 rounded-md border border-transparent p-[7px] text-left font-normal @max-[34rem]:flex-wrap @max-[34rem]:gap-y-1.5";
  return onClick ? (
    <Button className={cn(box, "justify-start whitespace-normal transition-colors duration-150 ease-out sm:h-auto")} onClick={onClick} variant="ghost">
      {inner}
    </Button>
  ) : (
    <div className={cn(box, "text-sm")}>{inner}</div>
  );
}
