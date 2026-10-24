import { Brain, ChevronRight, FilePen, FilePlus, FileText, Globe, Link, ListPlus, Paperclip, PencilLine, Search, SquareTerminal, Wrench } from "lucide-react";
import { memo, type Ref, useEffect, useState } from "react";
import { markdownHtml } from "@/lib/markdown-html";
import { Button } from "@leadinglight/ui/components/button";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { cn } from "@leadinglight/ui/lib/utils";
import { openPage } from "~/lib/panes";
import { pageOf } from "~/lib/space";
import type { Approval, Item } from "~/lib/threads";

// A thread as synara draws one: my messages on the right; each turn's steps folded under one
// line ("Worked for 12s") once it is done; the answer, the text after the last step, below.

type Step = Extract<Item, { kind: "tool" | "thinking" }>;

const secs = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const cut = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n)}…` : s);

// What a step did, in a few words, and how to ask for it before it runs.
export function describe(name: string, input: Record<string, unknown>, page: string) {
  const other = str(input.page);
  const on = `“${cut(other ? (pageOf(other)?.title ?? other) : page)}”`;
  switch (name.replace(/^mcp__notes__/, "")) {
    case "read_page":
      return { icon: FileText, done: `Read ${on}`, ask: `Read ${on}?` };
    case "search_pages":
      return { icon: Search, done: `Searched pages for “${cut(str(input.query))}”`, ask: "Search your pages?" };
    case "edit_page":
      return { icon: PencilLine, done: `Edited ${on}`, ask: `Edit ${on}?` };
    case "insert_text":
      return { icon: ListPlus, done: `Added to ${on}`, ask: `Add to ${on}?` };
    case "write_page":
      return { icon: FilePen, done: `Rewrote ${on}`, ask: `Rewrite ${on}?` };
    case "create_page":
      return { icon: FilePlus, done: `Created “${cut(str(input.title))}”`, ask: `Create “${cut(str(input.title))}”?` };
    case "WebSearch":
      return { icon: Globe, done: `Searched the web for “${cut(str(input.query))}”`, ask: "Search the web?" };
    case "WebFetch": {
      const host = /^https?:\/\/([^/]+)/.exec(str(input.url))?.[1] ?? str(input.url);
      return { icon: Link, done: `Read ${host}`, ask: `Open ${host}?` };
    }
  }
  // A project chat's steps, as the runtime names them: what was done to what.
  const step = { Run: [SquareTerminal, "Ran"], Read: [FileText, "Read"], Search: [Search, "Searched"], Edited: [PencilLine, "Edited"], Skill: [Wrench, "Used skill"] }[name] as [typeof Wrench, string] | undefined;
  if (step && str(input.target)) return { icon: step[0], done: `${step[1]} ${cut(str(input.target))}`, ask: "" };
  return { icon: Wrench, done: `Used ${name}`, ask: `Use ${name}?` };
}

// A clock for the turn being worked on.
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

const Markdown = ({ text, streaming }: { text: string; streaming?: boolean }) => (
  // micromark escapes any HTML in the answer, so this is the answer's own Markdown only.
  <div className="ll-answer" dangerouslySetInnerHTML={{ __html: markdownHtml(text || "​").html }} data-streaming={streaming ? "" : undefined} />
);

type TurnProps = { items: Item[]; live: boolean; started?: number; waiting?: boolean; page: string; onGoAhead: () => void };
// Only the turn being worked on redraws as words stream in; finished ones keep their Markdown.
const same = (a: TurnProps, b: TurnProps) => a.live === b.live && a.started === b.started && a.waiting === b.waiting && a.page === b.page && a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i]);
export const Turn = memo(function Turn({ items, live, started, waiting, page, onGoAhead }: TurnProps) {
  const [open, setOpen] = useState(false);
  const now = useNow(live && !waiting);
  const user = items[0]?.kind === "user" ? items[0] : null;
  const end = items.find((i) => i.kind === "end");
  const body = items.filter((i) => i.kind !== "user" && i.kind !== "end");
  // Text before the last step is the turn's narration and folds with the steps.
  const last = body.reduce((at, i, k) => (i.kind === "text" ? at : k), -1);
  const work = body.slice(0, last + 1);
  const answer = body.slice(last + 1).flatMap((i) => (i.kind === "text" ? [i] : []));
  const how = end?.how ?? (live ? "working" : "stopped");
  // A turn whose length isn't known (a project chat's older turns) says only how it ended.
  const length = end?.ms ? `${how === "done" ? " for" : ""} ${secs(end.ms)}` : "";
  const line = waiting ? "Waiting for you" : live ? `Working for ${secs(now - (started ?? now))}` : `${{ done: "Worked", stopped: end?.ms ? "Stopped after" : "Stopped", failed: end?.ms ? "Failed after" : "Failed" }[how as "done"]}${length}`;
  const shown = live || open;
  return (
    <div className="mt-4 first:mt-0">
      {user && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 dark:bg-foreground/10">
            {user.quote && <blockquote className="mb-1 border-l-2 border-muted-foreground/40 pl-2 text-muted-foreground">{user.quote}</blockquote>}
            <p className="whitespace-pre-wrap break-words">{user.text}</p>
            {/* A project chat's message names the files sent with it. */}
            {user.files && user.files.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground text-xs">
                {user.files.map((f) => (
                  <span className="inline-flex items-center gap-1" key={f}>
                    <Paperclip className="size-3" />
                    {f}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
      {(work.length > 0 || live || how !== "done") && (
        <button
          aria-expanded={shown}
          className="group mt-3 flex h-6 items-center gap-1 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground disabled:hover:text-muted-foreground"
          disabled={live || !work.length}
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {live && !waiting && <Spinner className="me-1 size-4" />}
          {line}
          {!live && work.length > 0 && <ChevronRight className={cn("size-4 transition-transform duration-150 ease-out", open && "rotate-90")} />}
        </button>
      )}
      {shown && work.length > 0 && (
        <div className="mt-1 flex flex-col">
          {work.map((i, k) => (i.kind === "text" ? <div className="my-1 text-muted-foreground" key={k}><Markdown text={i.text} /></div> : <StepRow item={i} key={k} page={page} />))}
        </div>
      )}
      {answer.map((t, k) => (
        <div className="mt-2" key={k}>
          <Markdown streaming={live && k === answer.length - 1} text={t.text} />
        </div>
      ))}
      {end?.error && <p className="mt-2 text-destructive-foreground">{end.error}</p>}
      {end?.plan && (
        <Button className="mt-2" onClick={onGoAhead} size="sm">
          Make these changes
        </Button>
      )}
    </div>
  );
}, same);

function StepRow({ item, page }: { item: Step; page: string }) {
  const [open, setOpen] = useState(false);
  const tool = item.kind === "tool" ? describe(item.name, item.input, page) : null;
  const Icon = tool?.icon ?? Brain;
  const label = item.kind === "tool" ? (tool?.done ?? "") : item.end ? `Thought for ${secs(item.end - item.start)}` : "Thinking";
  const running = item.kind === "tool" ? item.status === "running" : !item.end;
  // A project chat's step has only its target, shown as it is.
  const input = item.kind === "tool" && Object.keys(item.input).join() === "target" ? str(item.input.target) : item.kind === "tool" && Object.keys(item.input).length ? JSON.stringify(item.input, null, 2) : "";
  const details = item.kind === "tool" ? [input, item.output ?? ""].filter(Boolean).join("\n\n") : item.text;
  const created = item.kind === "tool" && item.name.endsWith("create_page") && item.status === "done" ? /\(id: ([^)]+)\)/.exec(item.output ?? "")?.[1] : undefined;
  return (
    <div>
      <div className="flex h-6 items-center gap-2">
        <button
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {running ? <Spinner className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0" />}
          <span className="truncate">
            {label}
            {item.kind === "tool" && (item.status === "failed" || item.status === "declined" || item.status === "stopped") && (
              <span className={cn(item.status === "failed" && "text-destructive-foreground")}> · {item.status}</span>
            )}
          </span>
        </button>
        {created && (
          <Button onClick={() => openPage(created)} size="xs" variant="outline">
            Open
          </Button>
        )}
      </div>
      {open && details && <pre className="mt-1 mb-2 ms-6 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{details}</pre>}
    </div>
  );
}

// A change waiting for the person, where the composer was: what it would do, and three answers.
export function ApprovalCard({ approval, page, onAnswer, ref }: { approval: Approval; page: string; onAnswer: (choice: "once" | "thread" | "decline") => void; ref?: Ref<HTMLDivElement> }) {
  const { tool, input } = approval;
  const name = tool.replace(/^mcp__notes__/, "");
  const removed = name === "edit_page" ? str(input.find) : "";
  const added = str(input.replace) || str(input.markdown) || str(input.query) || str(input.url) || (removed || name === "write_page" ? "" : JSON.stringify(input, null, 2));
  // It takes 1, 2 and 3 while focus is in it.
  return (
    <div
      aria-label="Approval"
      className="mx-2 mb-2 rounded-xl border bg-background p-3 shadow-xs/5 outline-none"
      onKeyDown={(e) => {
        const choice = ({ "1": "once", "2": "thread", "3": "decline" } as const)[e.key as "1"];
        if (!choice || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        onAnswer(choice);
      }}
      ref={ref}
      role="group"
      tabIndex={-1}
    >
      <p className="font-medium text-sm">{describe(tool, input, page).ask}</p>
      {name === "write_page" && <p className="mt-1 text-muted-foreground text-xs">Replaces the whole page with:</p>}
      {(removed || added) && (
        <div className="mt-2 max-h-36 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
          {removed && <p className="whitespace-pre-wrap break-words text-destructive-foreground line-through">{removed}</p>}
          {added && <p className={cn("whitespace-pre-wrap break-words", !/^Web(Search|Fetch)$/.test(tool) && "text-success-foreground")}>{added}</p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button onClick={() => onAnswer("once")} size="sm">
          Allow once
        </Button>
        <Button onClick={() => onAnswer("thread")} size="sm" variant="outline">
          Allow for this thread
        </Button>
        <Button onClick={() => onAnswer("decline")} size="sm" variant="ghost">
          Decline
        </Button>
      </div>
    </div>
  );
}
