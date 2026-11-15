import { ArrowDownUp, Bot, Brain, Camera, ChevronRight, Eye, FilePen, FilePlus, FileText, Globe, Link, ListPlus, MousePointerClick, Paperclip, PencilLine, Search, SquareTerminal, TextCursorInput, Wrench } from "lucide-react";
import { memo, type MouseEvent, type Ref, useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { cn } from "@leadinglight/ui/lib/utils";
import { openLink } from "~/lib/links";
import { space as browser } from "~/lib/browser-space";
import { openPage } from "~/lib/panes";
import { pageOf } from "~/lib/space";
import { turnContent, type Approval, type Item } from "~/lib/threads";
import { useReplyMarkdown } from "~/lib/reply-markdown";

// A thread as synara draws one: my messages on the right; each turn's steps folded under one
// line ("Worked for 12s") once it is done; the answer, the text after the last step, below.

type Step = Extract<Item, { kind: "tool" | "thinking" }>;

const secs = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const cut = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n)}…` : s);

const LL_STEPS: Record<string, [typeof Wrench, string]> = {
  project: [FileText, "Read its project in LeadingLight"],
  read: [FileText, "Read a page in LeadingLight"],
  search: [Search, "Searched LeadingLight"],
  attachment: [Paperclip, "Opened an attachment from LeadingLight"],
  publish: [FilePlus, "Published a report"],
  task: [ListPlus, "Updated its subtasks"],
  status: [ListPlus, "Updated its checklist"],
  context: [Link, "Said what its question is about"],
};

// What a step did, in a few words, and how to ask for it before it runs.
export function describe(name: string, input: Record<string, unknown>, page: string) {
  const other = str(input.page);
  const on = `“${cut(other ? (pageOf(other)?.title ?? other) : page)}”`;
  const tab = `“${cut(browser.get().tabs.find((t) => t.id === input.tab)?.title ?? "a tab")}”`;
  switch (name.replace(/^mcp__notes__/, "")) {
    case "read_tab":
      return { icon: Eye, done: `Read ${tab}`, ask: "" };
    case "screenshot_tab":
      return { icon: Camera, done: `Looked at ${tab}`, ask: "" };
    case "scroll":
      return { icon: ArrowDownUp, done: `Scrolled ${tab}`, ask: "" };
    case "click":
      return { icon: MousePointerClick, done: `Asked to press something in ${tab}`, ask: "" };
    case "type":
      return { icon: TextCursorInput, done: `Asked to type in ${tab}`, ask: "" };
    case "go_to":
      return { icon: Globe, done: `Went to ${/^https?:\/\/([^/]+)/.exec(str(input.url))?.[1] ?? "a page"}`, ask: "" };
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
    case "rename_page":
      return { icon: PencilLine, done: `Renamed ${on} to “${cut(str(input.title))}”`, ask: `Rename ${on} to “${cut(str(input.title))}”?` };
    case "create_page":
      return { icon: FilePlus, done: `Created “${cut(str(input.title))}”`, ask: `Create “${cut(str(input.title))}”?` };
    case "WebSearch":
      return { icon: Globe, done: `Searched the web for “${cut(str(input.query))}”`, ask: "Search the web?" };
    case "WebFetch": {
      const host = /^https?:\/\/([^/]+)/.exec(str(input.url))?.[1] ?? str(input.url);
      return { icon: Link, done: `Read ${host}`, ask: `Open ${host}?` };
    }
  }
  // LeadingLight's own tools, as Claude ("read") and Codex ("leadinglight.read") name them.
  const ll = name === "Run" ? LL_STEPS[str(input.target).replace(/^leadinglight\./, "")] : undefined;
  if (ll) return { icon: ll[0], done: ll[1], ask: "" };
  // A project chat's steps, as the runtime names them: what was done to what.
  const step = { Run: [SquareTerminal, "Ran"], Read: [FileText, "Read"], Search: [Search, "Searched"], Edited: [PencilLine, "Edited"], Skill: [Wrench, "Used skill"], Subagent: [Bot, "Asked a subagent:"] }[name] as [typeof Wrench, string] | undefined;
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

// A link never takes the app's window: a web link opens in the browser, any other goes to onFile.
const follow = (e: MouseEvent, onFile?: (href: string) => void) => {
  const href = (e.target as Element).closest("a")?.getAttribute("href");
  if (href == null) return;
  e.preventDefault();
  if (/^(https?|mailto):/i.test(href)) openLink(href);
  else onFile?.(href);
};
const Markdown = ({ text, streaming, onFile }: { text: string; streaming?: boolean; onFile?: (href: string) => void }) => {
  const html = useReplyMarkdown(text || "​");
  // micromark escapes any HTML in the answer, so this is the answer's own Markdown only.
  return <div className="ll-answer" dangerouslySetInnerHTML={{ __html: html }} data-streaming={streaming ? "" : undefined} onClick={(e) => follow(e, onFile)} />;
};

type TurnProps = { items: Item[]; live: boolean; started?: number; waiting?: boolean; page: string; onGoAhead: () => void; onFile?: (href: string) => void; cards?: boolean };
// Only the turn being worked on redraws as words stream in; finished ones keep their Markdown.
const same = (a: TurnProps, b: TurnProps) => a.live === b.live && a.started === b.started && a.waiting === b.waiting && a.page === b.page && a.onFile === b.onFile && a.cards === b.cards && a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i]);
const NOTE_CHANGES = /^(mcp__notes__)?(insert_text|create_page|rename_page)$/;
function NoteCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const id = /\(id: ([^)]+)\)/.exec(item.output ?? "")?.[1];
  if (!id || !pageOf(id)) return null;
  const name = item.name.replace(/^mcp__notes__/, "");
  const what = name === "create_page" ? "A new note" : name === "rename_page" ? "Renamed" : str(item.input.after) ? `Added under “${cut(str(item.input.after), 32)}”` : "Added at the end";
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{pageOf(id)?.title || "Untitled"}</p>
        <p className="truncate text-muted-foreground text-xs">{what}</p>
      </div>
      <Button onClick={() => openPage(id)} size="sm" variant="outline">Open</Button>
    </div>
  );
}
export const Turn = memo(function Turn({ items, live, started, waiting, page, onGoAhead, onFile, cards }: TurnProps) {
  const [open, setOpen] = useState(false);
  const now = useNow(live && !waiting);
  // Until the runtime lists the turn, it began when it was first shown.
  const [shownAt] = useState(Date.now);
  // The message that started it, and any typed into it while it ran.
  const users = items.filter((i): i is Extract<Item, { kind: "user" }> => i.kind === "user");
  const end = items.find((i) => i.kind === "end");
  const { work, answer } = turnContent(items);
  const how = end?.how ?? (live ? "working" : "stopped");
  // A turn whose length isn't known (a project chat's older turns) says only how it ended.
  const length = end?.ms ? `${how === "done" ? " for" : ""} ${secs(end.ms)}` : "";
  const line = waiting ? "Waiting for you" : live ? `Working for ${secs(now - (started ?? shownAt))}` : `${{ done: "Worked", stopped: end?.ms ? "Stopped after" : "Stopped", failed: end?.ms ? "Failed after" : "Failed" }[how as "done"]}${length}`;
  const shown = live || open;
  return (
    <div className="mt-4 first:mt-0">
      {users.map((user, k) => (
        <div className={cn("flex justify-end", k > 0 && "mt-2")} key={k}>
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
      ))}
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
          {work.map((i, k) => (i.kind === "text" ? <div className="my-1 text-muted-foreground" key={k}><Markdown onFile={onFile} text={i.text} /></div> : <StepRow item={i} key={k} page={page} />))}
        </div>
      )}
      {answer.map((t, k) => (
        <div className="mt-2" key={k}>
          <Markdown onFile={onFile} streaming={live && k === answer.length - 1} text={t.text} />
        </div>
      ))}
      {cards && items.map((i, k) => i.kind === "tool" && i.status === "done" && NOTE_CHANGES.test(i.name) && <NoteCard item={i} key={`card-${k}`} />)}
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
  // A press or typing says what, once done: its result begins with it ("Pressed “Annual”").
  const did = item.kind === "tool" && /(^|__)(click|type)$/.test(item.name) && item.status === "done" ? /^[^.]+/.exec(item.output ?? "")?.[0] : undefined;
  const label = item.kind === "tool" ? (did ?? tool?.done ?? "") : item.end ? `Thought for ${secs(item.end - item.start)}` : "Thinking";
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
// A browser page action asks in its own words, and "Always" allows one site for the thread.
export function ApprovalCard({ approval, page, onAnswer, ref }: { approval: Approval; page: string; onAnswer: (choice: "once" | "thread" | "decline") => void; ref?: Ref<HTMLDivElement> }) {
  const { tool, input } = approval;
  const name = tool.replace(/^mcp__notes__/, "");
  if (/^(click|type|go_to)$/.test(name)) {
    const host = str(input.host), who = str(input.who) || "Claude", label = cut(str(input.label), 60), why = str(input.why).trim();
    const title = input.risky ? `Let ${who} sign in, pay or send on ${host}?` : `Let ${who} ${{ click: "click on", type: "type on", go_to: "go to" }[name]} ${host}?`;
    const wants = name === "click" ? `press “${label}”` : name === "type" ? `type “${cut(str(input.text), 60)}” into “${label}”` : `open ${label}`;
    return (
      <div aria-label="Approval" className="mt-3 rounded-xl border p-4 outline-none" onKeyDown={(e) => {
        const choice = ({ "1": "once", "2": approval.grant ? "thread" : undefined, "3": "decline" } as const)[e.key as "1"];
        if (!choice || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        onAnswer(choice);
      }} ref={ref} role="group" tabIndex={-1}>
        <p className="font-medium">{title}</p>
        <p className="mt-2 text-muted-foreground">It wants to {wants}{why ? ` ${why.replace(/\.$/, "")}` : ""}. {input.risky ? "This looks like signing in, paying or sending, so it asks every time." : "It will ask again before it signs in, pays or sends anything."}</p>
        <div className="mt-3 flex flex-col gap-1.5">
          <Button onClick={() => onAnswer("once")} variant="secondary">Allow once</Button>
          {approval.grant && <Button onClick={() => onAnswer("thread")} variant="outline">Always allow on {host}</Button>}
          <Button onClick={() => onAnswer("decline")} variant="ghost">Not now</Button>
        </div>
      </div>
    );
  }
  const removed = name === "edit_page" ? str(input.find) : "";
  // A rename says it all in its question: no box of code under it.
  const added = str(input.replace) || str(input.markdown) || str(input.query) || str(input.url) || (removed || name === "write_page" || name === "rename_page" ? "" : JSON.stringify(input, null, 2));
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
