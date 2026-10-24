import { Check, ChevronDown, Copy, Pin, PinOff, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { markdownHtml } from "@/lib/markdown-html";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { useSidebar } from "@leadinglight/ui/components/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { Composer, type Mention } from "~/components/composer";
import { CARD } from "~/components/pane-area";
import { ApprovalCard, Turn } from "~/components/thread-view";
import { type AgentStatus, agentStatus } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents } from "~/lib/agents";
import { type Corner, isClaude, type Side, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { askEditor, closeAsk, type Quote, takeAskNow, useAsk } from "~/lib/ask";
import { INSTALL } from "~/lib/clis";
import { codex, gptModel, loadCodex } from "~/lib/codex";
import type { NoteText } from "~/lib/ask-prompt";
import { openLink } from "~/lib/links";
import { objects } from "~/lib/objects";
import { inlineHtml } from "~/lib/note-tools";
import { docMarkdown } from "~/lib/page-markdown";
import { pageOf } from "~/lib/space";
import { isReport } from "~/lib/work";
import { type Item, newThread, patchThread, pickThread, setPending, usePageThreads } from "~/lib/threads";
import { answer, sendTurn, stopTurn } from "~/lib/turn";

// The agent panel, where Claude answers about the page and works on it: pinned beside the pages
// as a card of their kind, or floating in a corner of them. Each page keeps its threads (lib/threads.ts).

// Top corners sit under the page's header band, so the crumbs and its buttons stay in sight (floatBox).
const CORNER: Record<Corner, string> = { br: "right-3 bottom-3", bl: "left-3 bottom-3", tr: "right-3 top-(--header-height)", tl: "left-3 top-(--header-height)" };
// The resize handle sits on the corner that faces the page, and drags away from the dock:
// a corner mark that is always there, and fills in when the pointer is over it. It is the
// header's padding wide, so it never covers the header's first or last button.
const HANDLE: Record<Corner, string> = {
  br: "top-0 left-0 cursor-nwse-resize rounded-tl-xl border-t-2 border-l-2",
  bl: "top-0 right-0 cursor-nesw-resize rounded-tr-xl border-t-2 border-r-2",
  tr: "bottom-0 left-0 cursor-nesw-resize rounded-bl-xl border-b-2 border-l-2",
  tl: "bottom-0 right-0 cursor-nwse-resize rounded-br-xl border-b-2 border-r-2",
};
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

// dock: the side it shows pinned on, while there is room for it; fit: the most it may take then (App.tsx).
export function AgentPanel({ windowToggle, dock, fit }: { windowToggle: boolean; dock: Side | null; fit: number }) {
  const { open, quote, page, pages, askNow, asked } = useAsk();
  const prefs = useAiPrefs();
  const { open: sidebarOpen } = useSidebar();
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
  // Where a dragged panel was let go, to glide from there into its corner.
  const dropped = useRef<DOMRect | null>(null);
  const settle = () => {
    const el = box.current;
    const from = dropped.current;
    dropped.current = null;
    if (!el || !from) return;
    el.style.transform = "";
    const to = el.getBoundingClientRect();
    el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 200ms ease-out";
    el.style.transform = "";
  };
  useLayoutEffect(settle, [prefs.corner]);

  // A new Ask makes its words the next question's subject, and the field takes the
  // keyboard at once, so nothing typed reaches the page underneath: once, when its threads are in.
  const took = useRef(asked);
  useEffect(() => {
    if (!open || !pageId || !thread || took.current === asked) return;
    took.current = asked;
    setPending(pageId, quote);
    const frame = requestAnimationFrame(() => (card.current ?? field.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [asked, !!thread]);
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

  const side = dock;
  // Pinned, only the width changes, up to what the pages beside it spare.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    // From the size on screen, not the saved one: a saved size bigger than the window is clamped.
    const rect = box.current?.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: rect?.width ?? prefs.panelW, h: rect?.height ?? prefs.panelH };
    const max = side ? fit : Infinity;
    const sx = (side ? side === "right" : prefs.corner.endsWith("r")) ? -1 : 1;
    const sy = prefs.corner.includes("b") ? -1 : 1;
    const move = (ev: PointerEvent) => {
      const panelW = Math.max(MIN.w, Math.min(max, Math.round(start.w + sx * (ev.clientX - start.x))));
      setAiPrefs(side ? { panelW } : { panelW, panelH: Math.max(MIN.h, Math.round(start.h + sy * (ev.clientY - start.y))) });
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

  const pinLabel = prefs.pinned ? "Unpin" : `Pin to the ${prefs.corner.endsWith("l") ? "left" : "right"}`;
  // Unpinned, it floats on the side it was pinned to (or stays where it floats for room); pinned,
  // it goes to the side it floats on.
  const pin = () =>
    setAiPrefs(prefs.pinned ? { pinned: null, ...(side && { corner: `${prefs.corner[0]}${side[0]}` as Corner }) } : { pinned: prefs.corner.endsWith("l") ? "left" : "right" });
  // Pinned, the gap between it and the pages resizes it, as the gap between two pages does.
  const gap = side && (
    <div
      aria-label="Resize the panel"
      aria-orientation="vertical"
      className={cn("group/edge flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center", side === "left" ? "-order-1" : "order-1")}
      onPointerDown={startResize}
      role="separator"
    >
      <span className="h-8 w-1 rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover/edge:opacity-100" />
    </div>
  );
  const beside = cn("relative shrink-0", CARD, side === "left" ? "-order-2" : "order-2");
  // Pinned, it is the pages' kind of header: as tall, a window drag area, past the traffic lights
  // when it is at the window's left edge (panel-header.tsx).
  const head = cn(
    "flex shrink-0 items-center gap-1 ps-3",
    side ? "h-(--header-height) pe-2 transition-[padding] duration-200 ease-linear" : "h-10 border-b pe-1.5",
    windowToggle && side === "left" && !sidebarOpen && "ps-[calc(var(--traffic-left)_+_50px)]",
  );
  const ends = (
    <>
      <Tooltip>
        <TooltipTrigger render={<Button aria-label={pinLabel} className="size-7 sm:size-7" onClick={pin} size="icon-sm" variant="ghost" />}>
          {prefs.pinned ? <PinOff /> : <Pin />}
        </TooltipTrigger>
        <TooltipPopup>
          {pinLabel}
          {prefs.pinned && !side && <span className="block text-muted-foreground">Floating while the pages need the room</span>}
          {!prefs.pinned && fit < MIN.w && <span className="block text-muted-foreground">Pins when the pages have room</span>}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button aria-label="Close" className="size-7 sm:size-7" onClick={() => closeAsk()} size="icon-sm" variant="ghost" />}>
          <X />
        </TooltipTrigger>
        <TooltipPopup>Close</TooltipPopup>
      </Tooltip>
    </>
  );

  if (!open) return null;
  // Pinned, it keeps its card while no page is in front (a list, or the next page loading), so the
  // pages beside it never jump; the line shows only if that lasts.
  if (!page || !pageId || !threads || !thread)
    return side ? (
      <>
        {gap}
        <section aria-label="Agent" className={cn("flex flex-col", beside)} ref={box} style={{ width: Math.min(prefs.panelW, fit) }}>
          <header className={head} data-tauri-drag-region>
            <span className="h-full flex-1" data-tauri-drag-region />
            {ends}
          </header>
          <p className="m-auto px-6 text-balance text-center text-muted-foreground text-sm transition-opacity delay-300 duration-150 starting:opacity-0">
            Open a page to ask {gpt ? "GPT" : "Claude"} about it.
          </p>
        </section>
      </>
    ) : null;
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

  const code = (text: string) => <code className="whitespace-nowrap rounded bg-muted px-1 font-mono">{text}</code>;
  const install = (
    <button className="underline" onClick={() => openLink("https://claude.com/code")} type="button">
      claude.com/code
    </button>
  );
  const earlier = threads.list.filter((t) => t.items.length);

  // Floating, its header drags it; let go, it settles into the nearest of the four corners.
  const startMove = (e: React.PointerEvent<HTMLElement>) => {
    const el = box.current;
    const area = el?.offsetParent?.getBoundingClientRect();
    if (side || !el || !area || e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const header = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    el.style.transition = "none";
    const move = (ev: PointerEvent) => void (el.style.transform = `translate(${ev.clientX - start.x}px, ${ev.clientY - start.y}px)`);
    const up = () => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      document.body.classList.remove("select-none");
      const r = (dropped.current = el.getBoundingClientRect());
      // Its middle against the middle of the room it moves in, which starts under the header band.
      const head = parseFloat(getComputedStyle(el).getPropertyValue("--header-height")) || 0;
      const corner = `${r.top + r.height / 2 < area.top + (head + area.height - 12) / 2 ? "t" : "b"}${r.left + r.width / 2 < area.left + area.width / 2 ? "l" : "r"}` as Corner;
      if (corner === prefs.corner) settle();
      // Floating for room, where it is put is also the side it pins to again.
      else setAiPrefs({ corner, ...(prefs.pinned && { pinned: corner.endsWith("l") ? ("left" as const) : ("right" as const) }) });
    };
    header.setPointerCapture(e.pointerId);
    document.body.classList.add("select-none");
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
  };

  return (
    <>
      {gap}
      <section
        aria-label="Agent"
        className={cn(
          "@container/panel flex flex-col overflow-hidden",
          side
            ? beside
            : cn("absolute z-30 max-h-[calc(100%-var(--header-height)-0.75rem)] max-w-[calc(100%-1.5rem)] rounded-xl border bg-popover text-popover-foreground shadow-lg", CORNER[prefs.corner]),
        )}
        data-corner={side ? undefined : prefs.corner}
        data-pinned={side ?? undefined}
        data-testid="agent-panel"
        ref={box}
        onKeyDown={(e) => {
          // Keys from its menus, which sit outside it, are theirs.
          if (e.key === "Escape" && e.currentTarget.contains(e.target as Node)) {
            e.stopPropagation();
            closeAsk();
          }
        }}
        style={side ? { width: Math.min(prefs.panelW, fit) } : { width: prefs.panelW, height: prefs.panelH }}
      >
        {!side && (
          <div
            aria-label="Drag to resize"
            className={cn(
              "absolute z-10 size-3 touch-none border-muted-foreground/50 transition-colors duration-150 hover:border-foreground hover:bg-accent",
              HANDLE[prefs.corner],
            )}
            data-testid="agent-panel-resize"
            onPointerDown={startResize}
            role="separator"
          />
        )}
        <header className={head} data-tauri-drag-region={side ? true : undefined} onPointerDown={startMove}>
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
          <span className={cn("h-full flex-1", !side && "cursor-grab")} data-tauri-drag-region={side ? true : undefined} />
          {ends}
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
              <p className="text-balance text-muted-foreground text-xs">{gpt ? "GPT" : "Claude"} can read {page && isReport(page.id) ? "this report (an agent's, which doesn't change)" : "and change this page"}, find your other pages, and look things up.</p>
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
    </>
  );
}
