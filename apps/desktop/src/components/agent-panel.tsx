import { Check, Copy, Move, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { markdownHtml } from "@/lib/markdown-html";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@leadinglight/ui/components/menu";
import { cn } from "@leadinglight/ui/lib/utils";
import { Composer, type Mention } from "~/components/composer";
import { type AgentStatus, agentStatus, ask, cancel } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents } from "~/lib/agents";
import { type Corner, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { askEditor, closeAsk, type Quote, takeAskNow, useAsk } from "~/lib/ask";
import { buildPrompt, type NoteText, SYSTEM, type Seen } from "~/lib/ask-prompt";
import { openLink } from "~/lib/links";
import { docText, objects } from "~/lib/objects";

// The agent panel: a card inside the note's panel, docked to a corner, where a question
// about the selected words (or the page) is asked and Claude's answer streams in.

type UserMsg = { role: "user"; quote: Quote | null; text: string };
type BotMsg = { role: "assistant"; text: string; done: boolean; error?: string };
type Thread = {
  messages: (UserMsg | BotMsg)[];
  sessionId?: string;
  busy?: string;
  // The words the next question is about, and the words Insert and Replace act on.
  pending: Quote | null;
  quote: Quote | null;
  mentions: Mention[];
  // What the session has been sent (lib/ask-prompt.ts); kept only once an answer lands.
  seen: Seen;
  note?: string;
};

// Each page keeps its own thread while the app runs, outside the component: a stream
// that lands after the person switched pages still goes to the page that asked.
const EMPTY: Thread = { messages: [], pending: null, quote: null, mentions: [], seen: {} };
const threads = new Map<string, Thread>();
const listeners = new Set<() => void>();
function patch(pageId: string, f: (t: Thread) => Thread) {
  threads.set(pageId, f(threads.get(pageId) ?? EMPTY));
  listeners.forEach((l) => l());
}
const useThread = (pageId: string | undefined) =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => (pageId ? threads.get(pageId) : undefined) ?? EMPTY,
  );

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

// The mentioned pages' words, read from storage: no editor is open on them.
const mentionedPages = (mentions: Mention[]): Promise<NoteText[]> =>
  Promise.all(
    mentions.flatMap((m) => (m.kind === "page" ? [m] : [])).map(async (m) => {
      const obj = await objects.get(m.id).catch(() => null);
      return { id: m.id, title: obj?.title ?? m.name, text: obj ? docText(obj.content) : "" };
    }),
  );

// A one-paragraph answer goes in as inline text, so replacing words keeps their sentence whole.
function toInsert(markdown: string): string {
  const html = markdownHtml(markdown.trim()).html.trim();
  const one = /^<p>([\s\S]*)<\/p>$/.exec(html);
  return one ? one[1] : html;
}

export function AgentPanel() {
  const { open, quote, page, pages, askNow } = useAsk();
  const prefs = useAiPrefs();
  const pageId = page?.id;
  const thread = useThread(pageId);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [agents, setAgents] = useState<Agent[]>(BUILT_IN);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // A new Ask makes its words the next question's subject, and the field takes the
  // keyboard at once, so nothing typed reaches the page underneath.
  useEffect(() => {
    if (!open || !pageId) return;
    patch(pageId, (t) => ({ ...t, pending: quote, note: undefined }));
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, quote, pageId]);
  const check = () => {
    setStatus(null);
    void agentStatus().then(setStatus);
  };
  useEffect(() => {
    if (!open) return;
    check();
    void listAgents().then(setAgents);
  }, [open]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [thread.messages, thread.pending]);

  const ready = !!status?.installed && !!status.logged_in;

  const patchLast = (id: string, f: (m: BotMsg) => BotMsg) =>
    patch(id, (t) => {
      const messages = [...t.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") messages[messages.length - 1] = f(last);
      return { ...t, messages };
    });

  // The words the question is about come from the thread, or straight from the ask bar:
  // its question can arrive in the same render that sets them, before the thread has them.
  const send = (question: string, q: Quote | null = thread.pending) => {
    if (!page || !pageId || thread.busy || !ready) return;
    const id = pageId;
    const askId = crypto.randomUUID();
    const agent = thread.mentions.flatMap((m) => (m.kind === "agent" ? agents.filter((a) => a.id === m.id) : []))[0];
    // The answer is about the words quoted with it; a follow-up without a quote is about
    // the thread, so Replace goes away until words are quoted again.
    patch(id, (t) => ({
      ...t,
      busy: askId,
      pending: null,
      quote: q,
      note: undefined,
      messages: [...t.messages, { role: "user", quote: q, text: question }, { role: "assistant", text: "", done: false }],
    }));
    const fail = (message: string) => {
      patchLast(id, (m) => ({ ...m, done: true, error: message }));
      patch(id, (t) => ({ ...t, busy: undefined }));
    };
    mentionedPages(thread.mentions)
      .then((pages) => {
        const note = { id, title: page.title(), text: page.text() };
        const { prompt, seen } = buildPrompt({ seen: thread.seen, note, pages, agent: agent?.prompt ?? null, quote: q?.text ?? null, question });
        return ask({ id: askId, prompt, system: SYSTEM, model: agent?.model ?? prefs.model, effort: prefs.effort, resume: thread.sessionId }, (e) => {
          if (e.type === "delta") patchLast(id, (m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "done") {
            patchLast(id, (m) => ({ ...m, done: true }));
            patch(id, (t) => ({ ...t, busy: undefined, sessionId: e.session_id ?? t.sessionId, seen }));
          } else fail(e.message);
        });
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
  };

  // A question the ask bar sent goes as soon as Claude Code is ready and the thread is free.
  useEffect(() => {
    if (!open || !ready || !askNow || thread.busy) return;
    const now = takeAskNow();
    if (now) send(now.question, quote);
  }, [open, ready, askNow, thread.busy]);

  if (!open || !page || !pageId) return null;
  const id = pageId;

  const stop = () => {
    if (!thread.busy) return;
    void cancel(thread.busy);
    patchLast(id, (m) => ({ ...m, done: true }));
    patch(id, (t) => ({ ...t, busy: undefined }));
    field.current?.focus();
  };

  const last = [...thread.messages].reverse().find((m): m is BotMsg => m.role === "assistant" && m.done && !m.error && m.text.trim().length > 0);
  const target = () => {
    const editor = askEditor();
    return editor && thread.quote ? editor.find(thread.quote.text, thread.quote.from) : null;
  };
  const insert = () => {
    const editor = askEditor();
    if (!editor || !last) return;
    editor.insertAfter(target()?.to ?? editor.selection().to, markdownHtml(last.text).html);
  };
  const replace = () => {
    const editor = askEditor();
    if (!editor || !last) return;
    const hit = target();
    if (!hit) {
      patch(id, (t) => ({ ...t, note: "Those words have changed since, so nothing was replaced." }));
      return;
    }
    editor.replaceRange(hit.from, hit.to, toInsert(last.text));
    // Replaced once: the words are gone, so the next insert goes below instead.
    patch(id, (t) => ({ ...t, quote: null }));
  };
  const copy = () => {
    if (!last) return;
    navigator.clipboard
      .writeText(last.text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // A browser without clipboard access: nothing to show.
      });
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

  return (
    <section
      aria-label="Agent"
      className={cn(
        "absolute z-30 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
        CORNER[prefs.corner],
      )}
      data-corner={prefs.corner}
      data-testid="agent-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
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
      <header className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <Sparkles className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">Ask</span>
        <Menu>
          <MenuTrigger render={<Button aria-label="Move the panel" size="icon-sm" variant="ghost" />}>
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
        <Button aria-label="Close" onClick={() => closeAsk()} size="icon-sm" variant="ghost">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm" ref={log}>
        {!status && <p className="text-muted-foreground">Checking Claude Code…</p>}
        {status && !ready && (
          <div className="space-y-2 text-muted-foreground">
            {status.installed ? (
              <p>Claude Code is installed but not signed in. Run {code("claude auth login")} in Terminal, then check again.</p>
            ) : (
              <p>
                Claude Code is not installed. Get it from {install}, sign in with {code("claude auth login")}, then check again.
              </p>
            )}
            {status.error && <p className="text-xs">{status.error}</p>}
            <Button onClick={check} size="sm" variant="outline">
              Check again
            </Button>
          </div>
        )}
        {ready && thread.messages.length === 0 && !thread.pending && <p className="text-muted-foreground">Ask about this page.</p>}
        {thread.messages.map((m, i) =>
          m.role === "user" ? (
            <div className="mt-2 first:mt-0" key={i}>
              {m.quote && <blockquote className="mb-1 border-l-2 border-muted-foreground/40 pl-2 text-muted-foreground">{m.quote.text}</blockquote>}
              <p className="font-medium">{m.text}</p>
            </div>
          ) : (
            <div className="mt-2" key={i}>
              {/* micromark escapes any HTML in the answer, so this is the answer's own Markdown only. */}
              <div className="ll-answer" dangerouslySetInnerHTML={{ __html: markdownHtml(m.text || (m.done ? "" : "​")).html }} data-streaming={m.done ? undefined : ""} />
              {m.error && <p className="mt-1 text-destructive-foreground">{m.error}</p>}
            </div>
          ),
        )}
        {last && !thread.busy && (
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
        {thread.note && <p className="mt-1 text-xs text-muted-foreground">{thread.note}</p>}
        {thread.pending && (
          <blockquote className="mt-2 border-l-2 border-muted-foreground/40 pl-2 text-muted-foreground">{thread.pending.text}</blockquote>
        )}
      </div>

      <Composer
        agents={agents}
        busy={!!thread.busy}
        fieldRef={field}
        mentions={thread.mentions}
        onMentions={(mentions) => patch(id, (t) => ({ ...t, mentions }))}
        onSend={send}
        onStop={stop}
        pages={pages.filter((p) => p.id !== id)}
        placeholder={thread.pending ? "Ask about the selection…" : "Ask about this page…"}
        ready={ready}
      />
    </section>
  );
}
