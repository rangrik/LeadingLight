// Mail home (design 5.2): the same words as Today's row, with the list. Before any account is
// connected, how to connect.
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Skeleton } from "@leadinglight/ui/components/skeleton";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Tabs, TabsList, TabsTab } from "@leadinglight/ui/components/tabs";
import { cn } from "@leadinglight/ui/lib/utils";
import { useCloud } from "~/lib/cloud";
import { keepGoing, refresh, startFresh, useMail } from "~/lib/mail";
import { ago, type Item, minutesOf, restWords, VERDICT } from "~/lib/mail-rules";
import { showIn } from "~/lib/panes";
import { phone } from "~/lib/platform";
import { MAIL_READING } from "~/lib/space";
import { back, doClear, goThrough, Keyed, openLook, run } from "./act";
import { connection, connectNow, openAccounts } from "./accounts";
import { useMailKeys } from "./keys";
import { MailCard } from "./look";
import { AccountTag, WhenCell } from "./tags";

export const Title = ({ children }: { children: React.ReactNode }) => <h1 className="text-balance pt-10 font-bold font-heading text-[2.25rem] leading-[1.2] tracking-tight">{children}</h1>;
const Lede = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-pretty text-base leading-[1.6]">{children}</p>;
const Small = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn("text-muted-foreground text-xs", className)}>{children}</span>;
const Label = ({ children }: { children: React.ReactNode }) => <p className="mt-4 flex h-8 items-center font-medium text-muted-foreground text-xs">{children}</p>;
const column = "w-full max-w-[760px] px-16 pb-12 @max-xl:px-6";

export function Home({ pane, view, demo, active }: { pane: string; view: string; demo: boolean; active: boolean }) {
  const m = useMail();
  const cloud = useCloud();
  const c = connection.use();
  const s = m.said;
  const [days, setDays] = useState<3 | 7 | 14>(7);
  const [key, setKey] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const wasReading = useRef(false);
  const items = [...m.look, ...m.waiting, ...m.later];
  const position = items.findIndex((i) => i.mail.key === key);
  const reading = view === MAIL_READING;
  const selected = reading ? items[position] : undefined;
  const notice = c.notice && <p className="mt-4 text-muted-foreground" role="status">{c.notice}</p>;
  const go = s.state === "first" ? () => run(startFresh(days)) : ["needs", "away", "started", "unread", "due"].includes(s.state) ? () => goThrough(s.state) : null;
  useMailKeys(pane, view, (e, typing, button) => {
    if (selected || e.key !== "Enter" || typing || button || e.metaKey || e.ctrlKey || !go) return;
    return (go(), true);
  });
  useEffect(() => {
    const returning = wasReading.current && !reading;
    wasReading.current = reading;
    if (!active) return;
    if (reading && !selected) return back(pane);
    if (!reading && !returning) return;
    const row = list.current?.querySelector<HTMLButtonElement>(`[data-mail-key="${CSS.escape(key)}"]`);
    if (!reading) return row?.focus();
    if (row?.offsetParent) {
      row.scrollIntoView({ block: "nearest" });
      if (list.current?.contains(document.activeElement)) row.focus({ preventScroll: true });
    } else list.current?.closest("[data-pane]")?.querySelector<HTMLButtonElement>('header [data-slot="breadcrumb-link"]')?.focus({ preventScroll: true });
  }, [active, key, reading, selected?.mail.key, pane]);
  const select = (next: string) => {
    setKey(next);
    showIn(pane, MAIL_READING);
  };

  if (!m.accounts.length) {
    const signedOut = !demo && !cloud.user;
    return (
      <div className={column}>
        <Title>Mail</Title>
        <Lede>LeadingLight reads your new mail and tells you what needs you. Nothing is sent or put away unless you say so.</Lede>
        {c.waiting && <p className="mt-2 text-muted-foreground">Finish in the browser window that opened. This page updates by itself.</p>}
        {notice}
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
              {c.waiting ? "Open Google again" : "Connect Gmail"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (s.state === "first")
    return (
      <div className={column}>
        <Title>Start fresh</Title>
        <Lede>{s.line}</Lede>
        <div className="mt-3 flex flex-col gap-1.5 text-muted-foreground tabular-nums">
          {m.accounts.map((a, i) => (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" key={a.account}>
              <p className="flex min-w-0 items-center gap-2">
                <span className="flex w-18 shrink-0">
                  <AccountTag account={a.account} />
                </span>
                <span className="truncate">
                  {a.email} · {(a.inbox ?? 0).toLocaleString("en-US")} waiting
                </span>
              </p>
              {i === m.accounts.length - 1 && (
                <Button className="text-muted-foreground" disabled={c.busy} onClick={() => void connectNow()} size="xs" variant="ghost">
                  {c.waiting ? "Open Google again" : "Add another account"}
                </Button>
              )}
            </div>
          ))}
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
          <Small>Choose once. New mail arrives automatically. Older mail stays in Gmail.</Small>
        </div>
        {notice}
      </div>
    );

  if (s.state === "reading")
    return (
      <div className={column}>
        <Title>{s.title}</Title>
        <p className="mt-4 flex items-center gap-2.5 text-muted-foreground">
          <Spinner className="size-4" />
          {s.line || "This takes about a minute. Today shows the result."}
        </p>
        {["w-full", "w-[78%]", "w-[64%]"].map((w) => (
          <Skeleton className={cn("mt-4 h-9 rounded-lg", w)} key={w} />
        ))}
        {notice}
      </div>
    );

  const unread = s.state === "unread";
  const rest = restWords(m.rest, !m.unread);
  const row = (i: Item, note?: string) => <Row item={i} key={i.mail.key} note={note} now={m.now} onClick={() => select(i.mail.key)} selected={i === selected} unread={note ? !i.lines : unread} />;
  return (
    <div className={cn("h-full", selected && "grid grid-rows-[minmax(0,1fr)]", selected && !phone && "@[50rem]/mail:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
      <div className={cn("@container min-w-0 h-full overflow-y-auto", selected && (phone ? "hidden" : "hidden @[50rem]/mail:block"))} ref={list}>
        <div className={cn(column, selected && "px-6")}>
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
          {s.state === "away" && <Label>Start with these</Label>}
          {m.look.length > 0 && (
            <div className={cn("-mx-2 flex flex-col", s.state !== "away" && "mt-6")}>
              {m.look.map((i) => row(i))}
            </div>
          )}
          {m.waiting.length > 0 && (
            <>
              <Label>Waiting for the next look</Label>
              <div className="-mx-2 flex flex-col">
                {m.waiting.map((i) => row(i))}
              </div>
            </>
          )}
          {m.rest.length > 0 && (
            <div className={cn("relative flex min-h-15 items-center gap-3 pt-4 pb-2 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border", m.look.length || m.waiting.length ? "mt-2" : "mt-6")}>
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
                {m.later.map((i) => row(i, "back in your next look"))}
              </div>
            </>
          )}
          {notice}
        </div>
      </div>
      {selected && (
        <section aria-label="Selected email" className={cn("@container min-w-0 overflow-y-auto", !phone && "@[50rem]/mail:border-s")} key={key}>
          <div className={cn("w-full max-w-[760px] px-6 pt-6 pb-12", !phone && "@[50rem]/mail:pt-10 @[50rem]/mail:px-8")}>
            <MailCard close={() => back(pane)} item={selected} pane={pane} step={(by) => setKey(items[position + by]?.mail.key ?? key)} view={view} />
          </div>
        </section>
      )}
    </div>
  );
}

// The headline (or, not read, the subject), then what it is and who; at the right, the account
// and the date in two columns that line up down the list. Narrow, those two take a third line.
function Row({ item, now, unread, note, onClick, selected }: { item: Item; now: number; unread: boolean; note?: string; onClick: () => void; selected: boolean }) {
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
  return (
    <Button aria-current={selected || undefined} className="flex h-auto min-h-13 w-full items-center justify-start gap-3 whitespace-normal rounded-md p-[7px] text-left font-normal transition-colors duration-150 ease-out aria-[current=true]:bg-accent @max-[34rem]:flex-wrap @max-[34rem]:gap-y-1.5 sm:h-auto" data-mail-key={m.key} onClick={onClick} variant="ghost">
      {inner}
    </Button>
  );
}
