import { Check, ChevronDown, Copy, Move, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { markdownHtml } from "@/lib/markdown-html";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { cn } from "@leadinglight/ui/lib/utils";
import { Composer, type Mention } from "~/components/composer";
import { ApprovalCard, Turn } from "~/components/thread-view";
import { type AgentStatus, agentStatus } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents } from "~/lib/agents";
import { type Corner, isClaude, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { askEditor, closeAsk, type Quote, takeAskNow, useAsk } from "~/lib/ask";
import { INSTALL } from "~/lib/clis";
import { codex, gptModel, loadCodex } from "~/lib/codex";
import type { NoteText } from "~/lib/ask-prompt";
import { openLink } from "~/lib/links";
import { objects } from "~/lib/objects";
import { inlineHtml } from "~/lib/note-tools";
import { docMarkdown } from "~/lib/page-markdown";
import { pageOf } from "~/lib/space";
import { type Item, newThread, patchThread, pickThread, setPending, usePageThreads } from "~/lib/threads";
import { answer, sendTurn, stopTurn } from "~/lib/turn";

// The agent panel: a card inside the note's panel, docked to a corner, where Claude answers
// about the page and works on it. Each page keeps its threads (lib/threads.ts).

const CORNER: Record<Corner, string> = { br: "right-3 bottom-3", bl: "left-3 bottom-3", tr: "right-3 top-3", tl: "left-3 top-3" };
// The resize handle sits on the corner that faces the page, and drags away from the dock:
// a corner mark that is always there, and fills in when the pointer is over it. It is the
// header's padding wide, so it never covers the header's first or last button.
const HANDLE: Record<Corner, string> = {
  br: "top-0 left-0 cursor-nwse-resize rounded-tl-xl border-t-2 border-l-2",
  bl: "top-0 right-0 cursor-nesw-resize rounded-tr-xl border-t-2 border-r-2",
  tr: "bottom-0 left-0 cursor-nesw-resize rounded-bl-xl border-b-2 border-l-2",
  tl: "bottom-0 right-0 cursor-nwse-resize rounded-br-xl border-b-2 border-r-2",
};
const CORNERS: { value: Corner; label: string }[] = [
  { value: "tl", label: "Top left" },
  { value: "tr", label: "Top right" },
  { value: "bl", label: "Bottom left" },
  { value: "br", label: "Bottom right" },
];
const MIN = { w: 280, h: 240 };

const titleOf = (id: string) => pageOf(id)?.title ?? "";
// The mentioned pages' words, read from storage: no editor is open on them.
const mentionedPages = (mentions: Mention[]): Promise<NoteText[]> =>
  Promise.all(
    mentions.flatMap((m) => (m.kind === "page" ? [m] : [])).map(async (m) => {
      const obj = await objects.get(m.id).catch(() => null);
      return { id: m.id, title: obj?.title ?? m.name, text: obj ? docMarkdown(obj.content, titleOf) : "" };
    }),
  );

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const when = (t: number) => {
  const m = Math.round((t - Date.now()) / 60000);
  return Math.abs(m) < 60 ? ago.format(m, "minute") : Math.abs(m) < 1440 ? ago.format(Math.round(m / 60), "hour") : ago.format(Math.round(m / 1440), "day");
};

// Each turn's items, from its question to the next.
const turnsOf = (items: Item[]) => items.reduce<Item[][]>((turns, i) => (i.kind === "user" || !turns.length ? [...turns, [i]] : (turns[turns.length - 1].push(i), turns)), []);

export function AgentPanel() {
  const { open, quote, page, pages, askNow } = useAsk();
  const prefs = useAiPrefs();
  const pageId = page?.id;
  const threads = usePageThreads(pageId);
  const thread = threads?.thread;
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [agents, setAgents] = useState<Agent[]>(BUILT_IN);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  // The log follows new words only while it is scrolled to its end, so reading back stays put.
  const pinned = useRef(true);
  // Finished turns don't redraw (thread-view.tsx), so their button calls through this.
  const goAheadNow = useRef(() => {});

  // A new Ask makes its words the next question's subject, and the field takes the
  // keyboard at once, so nothing typed reaches the page underneath.
  useEffect(() => {
    if (!open || !pageId) return;
    setPending(pageId, quote);
    const frame = requestAnimationFrame(() => (card.current ?? field.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, quote, pageId]);
  // A change waiting takes the keyboard from the field it hides, and gives it back once answered;
  // never from the page, where the person may be typing.
  const waiting = thread?.approval?.requestId;
  useEffect(() => {
    const here = document.activeElement === document.body || !!box.current?.contains(document.activeElement);
    if (here) (waiting ? card.current : field.current)?.focus();
  }, [waiting]);
  const cx = codex.use();
  const gpt = !isClaude(prefs.model);
  const check = () => {
    setStatus(null);
    void agentStatus().then(setStatus);
    void loadCodex(true);
  };
  useEffect(() => {
    if (!open) return;
    check();
    void listAgents().then(setAgents);
  }, [open]);
  useEffect(() => {
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [thread?.items, threads?.pending, thread?.approval]);
  useEffect(() => {
    pinned.current = true;
  }, [thread?.id, thread?.busy]);

  // Ready when the provider the chosen model needs is there and signed in.
  const ready = gpt ? cx.state === "ready" && !!gptModel(prefs.model) : !!status?.installed && !!status.logged_in;

  // The words come from the panel, or straight from the ask bar: its question can arrive in
  // the same render that sets them, before the panel has them.
  const send = (question: string, mentions: Mention[] = [], q: Quote | null = threads?.pending ?? null) => {
    if (!page || !thread || thread.busy || !ready) return;
    setPending(page.id, null);
    const agent = mentions.flatMap((m) => (m.kind === "agent" ? agents.filter((a) => a.id === m.id) : []))[0];
    void sendTurn({ page, threadId: thread.id, question, quote: q, pages: mentionedPages(mentions), agent });
  };

  // A question the ask bar sent goes as soon as Claude Code is ready and the thread is free.
  useEffect(() => {
    if (!open || !ready || !askNow || thread?.busy) return;
    const now = takeAskNow();
    if (now) send(now.question, [], quote);
  }, [open, ready, askNow, thread?.busy]);

  if (!open || !page || !pageId || !threads || !thread) return null;
  const id = pageId;
  const title = page.title().trim();
  const items = thread.items;
  const lastTurn = turnsOf(items).at(-1) ?? [];
  // The last turn's answer, which Insert, Replace and Copy act on; a plan is not one.
  const final = !thread.busy && lastTurn.some((i) => i.kind === "end" && i.how === "done" && !i.plan) ? lastTurn.filter((i) => i.kind === "text").at(-1) : undefined;

  const target = () => {
    const editor = askEditor();
    return editor && thread.quote ? editor.find(thread.quote.text, thread.quote.from) : null;
  };
  const insert = () => {
    const editor = askEditor();
    if (editor && final) editor.insertAfter(target()?.to ?? editor.selection().to, markdownHtml(final.text).html);
  };
  const replace = () => {
    const editor = askEditor();
    if (!editor || !final) return;
    const hit = target();
    if (!hit) return patchThread(id, thread.id, (t) => ({ ...t, note: "Those words have changed since, so nothing was replaced." }));
    editor.replaceRange(hit.from, hit.to, inlineHtml(final.text));
    // Replaced once: the words are gone, so the next insert goes below instead.
    patchThread(id, thread.id, (t) => ({ ...t, quote: null }));
  };
  const copy = () => {
    if (!final) return;
    navigator.clipboard
      .writeText(final.text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // A browser without clipboard access: nothing to show.
      });
  };
  goAheadNow.current = () => {
    setAiPrefs({ plan: false });
    send("Go ahead with the plan.", [], null);
    field.current?.focus();
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    // From the size on screen, not the saved one: a saved size bigger than the window is clamped.
    const box = handle.parentElement?.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: box?.width ?? prefs.panelW, h: box?.height ?? prefs.panelH };
    const sx = prefs.corner.includes("r") ? -1 : 1;
    const sy = prefs.corner.includes("b") ? -1 : 1;
    const move = (ev: PointerEvent) => {
      setAiPrefs({ panelW: Math.max(MIN.w, Math.round(start.w + sx * (ev.clientX - start.x))), panelH: Math.max(MIN.h, Math.round(start.h + sy * (ev.clientY - start.y))) });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.releasePointerCapture(e.pointerId);
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  };

  const code = (text: string) => <code className="whitespace-nowrap rounded bg-muted px-1 font-mono">{text}</code>;
  const install = (
    <button className="underline" onClick={() => openLink("https://claude.com/code")} type="button">
      claude.com/code
    </button>
  );
  const earlier = threads.list.filter((t) => t.items.length);

  return (
    <section
      aria-label="Agent"
      className={cn(
        "@container/panel absolute z-30 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
        CORNER[prefs.corner],
      )}
      data-corner={prefs.corner}
      data-testid="agent-panel"
      ref={box}
      onKeyDown={(e) => {
        // Keys from its menus, which sit outside it, are theirs.
        if (e.key === "Escape" && e.currentTarget.contains(e.target as Node)) {
          e.stopPropagation();
          closeAsk();
        }
      }}
      style={{ width: prefs.panelW, height: prefs.panelH }}
    >
      <div
        aria-label="Drag to resize"
        className={cn(
          "absolute z-10 size-3 touch-none border-muted-foreground/50 transition-colors duration-150 hover:border-foreground hover:bg-accent",
          HANDLE[prefs.corner],
        )}
        data-testid="agent-panel-resize"
        onPointerDown={startResize}
        role="separator"
        title="Drag to resize"
      />
      <header className="flex h-10 shrink-0 items-center gap-1 border-b ps-3 pe-1.5">
        <Menu>
          <MenuTrigger render={<Button aria-label="Threads" className="h-7 min-w-0 gap-1.5 px-1.5 font-medium sm:h-7" size="sm" variant="ghost" />}>
            <Sparkles className="text-muted-foreground" />
            <span className="truncate">{thread.title || "New thread"}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-72" finalFocus={field}>
            <MenuItem onClick={() => newThread(id)}>
              <Plus />
              New thread
            </MenuItem>
            {earlier.length > 0 && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>On {title ? `“${title}”` : "this page"}</MenuGroupLabel>
                  <MenuRadioGroup onValueChange={(v) => pickThread(id, v as string)} value={thread.id}>
                    {earlier.map((t) => (
                      <MenuRadioItem closeOnClick key={t.id} value={t.id}>
                        <span className="flex min-w-0 items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 text-muted-foreground text-xs">{when(t.updated)}</span>
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            )}
          </MenuPopup>
        </Menu>
        <span className="flex-1" />
        <Menu>
          <MenuTrigger render={<Button aria-label="Move the panel" className="size-7 sm:size-7" size="icon-sm" variant="ghost" />}>
            <Move />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup onValueChange={(v) => setAiPrefs({ corner: v as Corner })} value={prefs.corner}>
              {CORNERS.map((c) => (
                <MenuRadioItem closeOnClick key={c.value} value={c.value}>
                  {c.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
        <Button aria-label="Close" className="size-7 sm:size-7" onClick={() => closeAsk()} size="icon-sm" variant="ghost">
          <X />
        </Button>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        ref={log}
      >
        {gpt && !ready && (
          <div className="space-y-2 text-muted-foreground">
            {cx.state === "checking" ? (
              <p>Checking Codex…</p>
            ) : cx.state === "missing" ? (
              <p>
                Codex is not installed. Get it from{" "}
                <button className="underline" onClick={() => openLink(INSTALL.codex)} type="button">
                  OpenAI
                </button>
                , sign in with {code("codex login")}, then check again.
              </p>
            ) : cx.state === "signed-out" ? (
              <p>Codex is installed but not signed in. Run {code("codex login")} in Terminal, then check again.</p>
            ) : (
              <p>Your Codex doesn't offer this model. Pick another in the model menu below.</p>
            )}
            {cx.state !== "checking" && (
              <Button onClick={check} size="sm" variant="outline">
                Check again
              </Button>
            )}
          </div>
        )}
        {!gpt && !status && <p className="text-muted-foreground">Checking Claude Code…</p>}
        {!gpt && status && !ready && (
          <div className="space-y-2 text-muted-foreground">
            {status.installed ? (
              <p>Claude Code is installed but not signed in. Run {code("claude auth login")} in Terminal, then check again.</p>
            ) : (
              <p>
                Claude Code is not installed. Get it from <span className="whitespace-nowrap">{install},</span> sign in with {code("claude auth login")}, then check again.
              </p>
            )}
            {status.error && <p className="text-xs">{status.error}</p>}
            <Button onClick={check} size="sm" variant="outline">
              Check again
            </Button>
          </div>
        )}
        {ready && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Sparkles className="size-6 text-muted-foreground" />
            <p className="text-balance text-lg">What should we do with {title ? `“${title}”` : "this page"}?</p>
            <p className="text-balance text-muted-foreground text-xs">{gpt ? "GPT" : "Claude"} can read and change this page, find your other pages, and look things up.</p>
          </div>
        )}
        {turnsOf(items).map((t, k, all) => (
          <Turn
            items={t}
            key={`${thread.id}:${k}`}
            live={!!thread.busy && k === all.length - 1}
            onGoAhead={() => goAheadNow.current()}
            page={title || "Untitled"}
            started={thread.started}
            waiting={!!thread.approval && k === all.length - 1}
          />
        ))}
        {final && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button onClick={insert} size="sm" variant="outline">
              Insert below
            </Button>
            {thread.quote && (
              <Button onClick={replace} size="sm" variant="outline">
                Replace
              </Button>
            )}
            <Button aria-label={copied ? "Copied" : "Copy the answer"} onClick={copy} size="icon-sm" variant="ghost">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        )}
        {thread.note && <p className="mt-1 text-muted-foreground text-xs">{thread.note}</p>}
      </div>

      {thread.approval && <ApprovalCard approval={thread.approval} onAnswer={(c) => answer(id, thread.id, c)} page={title || "Untitled"} ref={card} />}
      {/* Kept mounted under an approval, so a draft being written survives it. */}
      <div className={cn("shrink-0", thread.approval && "hidden")}>
        {threads.pending && (
          <div className="mx-2 mb-1.5 flex items-start gap-1 text-muted-foreground">
            <blockquote className="line-clamp-3 min-w-0 flex-1 border-l-2 border-muted-foreground/40 pl-2 text-sm">{threads.pending.text}</blockquote>
            <Button
              aria-label="Remove the quote"
              onClick={() => {
                setPending(id, null);
                field.current?.focus();
              }}
              size="icon-xs"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        )}
        <Composer
          agents={agents}
          busy={!!thread.busy}
          fieldRef={field}
          onSend={(q, m) => send(q, m)}
          onStop={() => stopTurn(id, thread.id)}
          pages={pages.filter((p) => p.id !== id)}
          placeholder={threads.pending ? "Ask about the selection…" : "Ask about this page…"}
          ready={ready}
        />
      </div>
    </section>
  );
}
