// One mail (design 5.3): its tags, who wrote, three lines, the four choices, and the mail under them.
// Reply and Make a task replace the choices in place.
import { ArrowUpRight, CalendarIcon, ChevronRight, CircleAlert, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Calendar } from "@leadinglight/ui/components/calendar";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { cn } from "@leadinglight/ui/lib/utils";
import { fromIso, isoDay as isoOf } from "~/lib/format";
import { openExternal } from "~/lib/gmail";
import { gmailLink, mailSource, type ThreadPart, useMail } from "~/lib/mail";
import { addresses, ago, clock, isoDay, type Item, replyAddress, shortDay } from "~/lib/mail-rules";
import { back, doDone, doLater, doReply, doTask, Key, Keyed, run, type Trouble } from "./act";
import { useMailKeys } from "./keys";
import { Tags } from "./tags";

const PICK = { none: "done", quick: "reply", reply: "reply", work: "task" } as const;
const CHOICES = [["reply", "Reply", "R"], ["done", "Done", "E"], ["task", "Make a task", "T"], ["later", "Later", "L"]] as const;
const ACK = "Got it. I'll get back to you on this.";
const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function MailCard({ item, pane, view, trouble, step, close }: { item: Item; pane: string; view: string; trouble?: Trouble; step: (by: number) => void; close?: () => void }) {
  const { now, offline } = useMail();
  const { mail: m, lines: l } = item;
  const [mode, setMode] = useState<"reply" | "task" | null>(trouble?.reply ? "reply" : null);
  const [open, setOpen] = useState(true);
  const drafts = l?.replies ?? [];
  const [pick, setPick] = useState(trouble?.reply ? drafts.length : 0);
  const [text, setText] = useState(trouble?.reply ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string>();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const titleBox = useRef<HTMLInputElement>(null);
  const filled = l && PICK[l.verdict];
  const act = (p: Promise<unknown>) => (setBusy(true), run(p.finally(() => setBusy(false))));
  const choose = (what: (typeof CHOICES)[number][0]) => {
    if (what === "done") return act(doDone(item));
    if (what === "later") return act(doLater(item));
    if (what === "reply") return (setMode("reply"), setPick(0), setText(drafts[0]?.text ?? ""));
    setMode("task");
    setTitle(l?.task?.title ?? (l ? l.headline : m.subject));
    setDue(l?.task?.due ?? l?.due);
    setAck(false);
  };
  const choosePick = (n: number) => {
    setPick(n);
    setText(drafts[n]?.text ?? "");
    if (n === drafts.length) setTimeout(() => box.current?.focus());
  };
  const send = () => text.trim() && !offline && act(doReply(item, text));
  const ackText = l?.task?.ack || ACK;
  const make = () => title.trim() && act(doTask(item, { title, due, reply: ack && !offline ? ackText : undefined }));
  useEffect(() => {
    if (mode === "task") titleBox.current?.select();
    if (mode === "reply" && !text) box.current?.focus();
  }, [mode]);

  useMailKeys(pane, view, (e, typing, button) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.metaKey && k === "Enter") return mode === "reply" ? (send(), true) : mode === "task" ? (make(), true) : false;
    if (k === "Escape") return mode ? (setMode(null), true) : (close ? close() : back(pane), true);
    if (typing) return k === "Enter" && e.target === titleBox.current ? (make(), true) : false;
    if (e.metaKey || e.ctrlKey || e.altKey || busy) return false;
    if (mode === "reply" && /^[1-9]$/.test(k) && +k <= drafts.length + 1) return (choosePick(+k - 1), true);
    if (mode) return false;
    const keys: Record<string, () => void> = { r: () => choose("reply"), e: () => !offline && choose("done"), t: () => choose("task"), l: () => choose("later"), o: () => setOpen((o) => !o), j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1) };
    if (keys[k]) return (keys[k](), true);
    // Enter on a focused button is that button's; otherwise the filled choice.
    if (k === "Enter" && filled && !button) return (choose(filled), true);
  });

  const Heading = close ? "h2" : "h1";
  return (
    <article className={cn("ll-rise", !close && "pt-10")}>
      <Tags item={item} now={now} />
      <Heading className="mt-2.5 text-balance font-semibold text-2xl leading-8 tracking-[-0.4px]">{l ? l.headline : m.subject || "(No subject)"}</Heading>
      {/* The name, then the address and when; narrow, the address takes its own line. */}
      <p className="mt-1.5 flex min-w-0 gap-2 whitespace-nowrap text-muted-foreground @max-[34rem]:flex-col @max-[34rem]:gap-0" data-testid="mail-who">
        {m.name !== m.address && <span className="shrink-0 font-medium text-foreground">{m.name}</span>}
        <span className="flex min-w-0 gap-1.5">
          <span className="min-w-0 select-all truncate">{m.address}</span>
          <span className="shrink-0">· {ago(m.date, now)}</span>
        </span>
      </p>
      {l?.upset && l.tone && (
        <p className="mt-3 flex gap-2 font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {l.tone}
        </p>
      )}
      {l && (
        <dl className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 @max-[34rem]:grid-cols-1 @max-[34rem]:gap-y-0.5">
          {(
            [
              ["What happened", l.happened],
              ["Where it stands", l.stands],
              ["Your part", l.part],
            ] as const
          ).map(([label, words], n) => (
            <div className="contents" key={label}>
              <dt className={cn("text-muted-foreground", n > 0 && "@max-[34rem]:mt-2")}>{label}</dt>
              <dd className="text-pretty text-base leading-[1.6]">{words}</dd>
            </div>
          ))}
        </dl>
      )}
      {mode === "reply" ? (
        <div className="ll-rise mt-6 flex flex-col gap-2.5">
          {drafts.length > 0 && (
            <div aria-label="Drafts" className="flex flex-wrap gap-1.5" role="group">
              {[...drafts.map((d) => d.label), "Write my own"].map((label, n) => (
                <Button aria-pressed={pick === n} className="aria-pressed:border-ring aria-pressed:bg-accent/60" key={label} onClick={() => choosePick(n)} size="sm" variant="outline">
                  {label}
                  <Key k={String(n + 1)} />
                </Button>
              ))}
            </div>
          )}
          <Textarea aria-label="Your reply" className="[&_textarea]:resize-none" onChange={(e) => setText(e.currentTarget.value)} placeholder="Write your reply" ref={box} value={text} />
          <div className="flex flex-wrap items-center gap-2">
            <Keyed disabled={!text.trim() || offline || busy} k="⌘↵" onClick={send}>
              Send
            </Keyed>
            <Keyed k="Esc" onClick={() => setMode(null)} variant="ghost">
              Cancel
            </Keyed>
            <span className="ms-auto text-muted-foreground text-xs @max-[34rem]:ms-0 @max-[34rem]:basis-full">
              To {replyAddress(m)} · from {m.email}
            </span>
          </div>
          {trouble && <Line trouble={trouble} />}
        </div>
      ) : mode === "task" ? (
        <div className="ll-rise mt-6 flex flex-col gap-2.5">
          <label className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-4 @max-[34rem]:grid-cols-1 @max-[34rem]:gap-1">
            <span className="text-muted-foreground">Task</span>
            <Input aria-label="Task" onChange={(e) => setTitle(e.currentTarget.value)} ref={titleBox} value={title} />
          </label>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-4 @max-[34rem]:grid-cols-1 @max-[34rem]:gap-1">
            <span className="text-muted-foreground">Due</span>
            <DuePicker due={due} onChange={setDue} />
          </div>
          <Field>
            <FieldLabel className="items-start font-normal">
              <Checkbox checked={ack} className="mt-0.5" disabled={offline} onCheckedChange={setAck} />
              Also reply “{ackText}”
            </FieldLabel>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Keyed disabled={!title.trim() || busy} k="↵" onClick={make}>
              Make task
            </Keyed>
            <Keyed k="Esc" onClick={() => setMode(null)} variant="ghost">
              Cancel
            </Keyed>
            <span className="ms-auto text-muted-foreground text-xs @max-[34rem]:ms-0 @max-[34rem]:basis-full">The task keeps a link to this mail.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {CHOICES.map(([what, label, k]) => (
              <Keyed disabled={busy || (offline && what === "done")} k={k} key={what} onClick={() => choose(what)} variant={what === filled ? "default" : "outline"}>
                {label}
              </Keyed>
            ))}
          </div>
          {trouble && <Line step={() => step(1)} trouble={trouble} />}
        </>
      )}
      <Original item={item} open={open} setOpen={setOpen} />
    </article>
  );
}

// The one error line, with the mail still there.
function Line({ trouble, step }: { trouble: Trouble; step?: () => void }) {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-destructive text-sm" role="alert">
      {trouble.text}
      <Button onClick={trouble.gone ? step : trouble.retry} size="xs" variant="outline">
        {trouble.gone ? "Next" : "Try again"}
      </Button>
    </p>
  );
}

function DuePicker({ due, onChange }: { due?: string; onChange: (due?: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Button className="w-fit" size="sm" variant="outline" />}>
        <CalendarIcon />
        {due ? shortDay(due) : "No date"}
      </PopoverTrigger>
      <PopoverPopup align="start">
        <Calendar
          defaultMonth={due ? fromIso(due) : undefined}
          mode="single"
          onSelect={(d) => {
            setOpen(false);
            onChange(d ? isoOf(d) : undefined);
          }}
          selected={due ? fromIso(due) : undefined}
        />
      </PopoverPopup>
    </Popover>
  );
}

// The mail itself, as text: about three lines that fade, or all of it with earlier messages and files.
function Original({ item, open, setOpen }: { item: Item; open: boolean; setOpen: (fn: (o: boolean) => boolean) => void }) {
  const m = item.mail;
  const [thread, setThread] = useState<ThreadPart[] | null>(null);
  const [earlier, setEarlier] = useState(false);
  useEffect(() => {
    let alive = true;
    mailSource()
      .then((s) => s.thread(m.account, m.threadId))
      .then((t) => alive && setThread(t), () => alive && setThread([]));
    return () => {
      alive = false;
    };
  }, [m.key]);
  const latest = thread?.at(-1) ?? { text: m.snippet, files: [] };
  const before = thread?.slice(0, -1) ?? [];
  const files = latest.files ?? [];
  const paras = (t: string) => t.split(/\n{2,}/).map((p, i) => <p className="whitespace-pre-wrap py-[3px] [overflow-wrap:anywhere]" key={i}>{p}</p>);
  return (
    <section className="mt-8 rounded-lg border">
      <div className="flex h-10 items-center gap-2 ps-3 pe-2 font-medium text-muted-foreground text-xs">
        <span className="min-w-0 flex-1 truncate">
          {m.subject || "(No subject)"}
          {!open && files.length > 0 && ` · ${files.length} file${files.length === 1 ? "" : "s"}`}
        </span>
        <Button aria-expanded={open} onClick={() => setOpen((o) => !o)} size="xs" variant="ghost">
          {open ? "Show less" : "Show all"}
          <Key k="O" />
        </Button>
      </div>
      {open && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 pb-2.5 text-xs" data-testid="mail-heads">
          {(
            [
              ["To", addresses(m.to).join(", ") || m.email],
              ["Cc", addresses(m.cc).join(", ")],
              ["Sent", `${shortDay(isoDay(m.date))}, ${clock(m.date)}`],
            ] as const
          ).filter(([, v]) => v).map(([k, v]) => (
            <div className="contents" key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && before.length > 0 && (
        <Button className="mx-1 mb-1 text-muted-foreground" onClick={() => setEarlier((x) => !x)} size="xs" variant="ghost">
          <ChevronRight className={cn("transition-transform duration-150 motion-reduce:transition-none", earlier && "rotate-90")} />
          {before.length} earlier message{before.length === 1 ? "" : "s"}
        </Button>
      )}
      {open && earlier && (
        <div className="px-3 pb-3 text-muted-foreground text-sm leading-[22px]">
          {before.map((p, i) => (
            <div className="border-b py-2 last:border-0" key={i}>
              <p className="font-medium text-xs">{p.from}</p>
              {paras(p.text)}
            </div>
          ))}
        </div>
      )}
      <div className={cn("px-3 pb-3 text-sm leading-[22px]", !open && "max-h-[78px] overflow-hidden [mask-image:linear-gradient(#000_40%,transparent)]")} data-testid="mail-body">
        {paras(latest.text || "This mail has no text. Open it in Gmail to see it.")}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 ps-3 pe-2 pb-2">
          {files.map((f, i) => (
            <Badge key={i} size="lg" variant="outline">
              <Paperclip className="text-muted-foreground" />
              {f.name}
              <span className="text-muted-foreground">{size(f.size)}</span>
            </Badge>
          ))}
          <Button className="ms-auto text-muted-foreground" onClick={() => run(openExternal(gmailLink(m)))} size="xs" variant="ghost">
            Open in Gmail
            <ArrowUpRight />
          </Button>
        </div>
      )}
    </section>
  );
}
