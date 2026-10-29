import { Check, ChevronDown, Copy, Plus, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { markdownHtml } from "@/lib/markdown-html";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@leadinglight/ui/components/empty";
import { isDesktop, useMobile } from "~/lib/platform";
import { refreshPairs, remoteReady, selectedPair, useRemote } from "~/lib/remote";
import { useCloud } from "~/lib/cloud";
import { openPairingSettings, RemoteAgentConnection } from "~/components/pairing-settings";
import { cn } from "@leadinglight/ui/lib/utils";
import { Composer, type Mention } from "~/components/composer";
import { ApprovalCard, Turn } from "~/components/thread-view";
import { type AgentStatus, agentStatus, LOCAL_AGENTS_MESSAGE } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents } from "~/lib/agents";
import { isClaude, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
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
import { type Item, newThread, patchThread, pickThread, setPending, turnContent, usePageThreads } from "~/lib/threads";
import { answer, sendTurn, stopTurn } from "~/lib/turn";
import { authored } from "@leadinglight/editor/authorship";
import { action } from "~/lib/history-types";
import { flushAll } from "~/lib/saving";

// The bar's Ask, where Claude answers about the page in front and works on it. Each page keeps its
// threads (lib/threads.ts). head puts the thread menu in the bar's header; in a pane it tops the thread.

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

// Asks already taken, kept here: Ask opens for an ask, and must still see it as new.
let took = 0;

// In a pane the menu's words start 16 px in, under the pane's title (9 px, then its own 7).
type AskViewProps = { head?: (menu: ReactNode) => ReactNode };
export function AskView(props: AskViewProps) {
  const mobile = useMobile();
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const cloud = useCloud();
  const remote = useRemote(), pair = selectedPair();
  useEffect(() => { void isDesktop.then((value) => { setDesktop(value); if (!value && !mobile) void refreshPairs(); }); }, [mobile]);
  if (mobile) return <Empty><EmptyDescription>Agents are not available in the iPad app.</EmptyDescription></Empty>;
  if (desktop === null || !desktop && (!cloud.initialized || !remote.initialized)) return <section aria-label="Agent" className="flex h-full min-h-0 flex-col" data-testid="agent-panel">
    {props.head?.(null)}<Empty><EmptyDescription role="status">Loading your Mac connection…</EmptyDescription></Empty>
  </section>;
  if (desktop !== true && !(pair?.state === "active" && pair.localKey) && !(import.meta.env.DEV && !remote.selected)) return <section aria-label="Agent" className="flex h-full min-h-0 flex-col" data-testid="agent-panel">
    {props.head?.(null)}
    <Empty><EmptyHeader><EmptyTitle>Agents work on your Mac</EmptyTitle><EmptyDescription>{LOCAL_AGENTS_MESSAGE}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={openPairingSettings}>Connect a Mac</Button><p className="text-xs text-muted-foreground">Pair this browser with your Mac to use its agents here.</p></EmptyContent></Empty>
  </section>;
  return <LocalAskView {...props} />;
}

function LocalAskView({ head = (menu) => <div className="shrink-0 ps-[9px] pe-2 pt-2">{menu}</div> }: AskViewProps) {
  const { quote, page, pages, askNow, asked } = useAsk();
  const remote = useRemote(), pair = selectedPair();
  const readiness = JSON.stringify(pair?.status ?? null);
  const available = !pair || remoteReady();
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
  // keyboard at once, so nothing typed reaches the page underneath: once, when its threads are in.
  // Taken in the frame, as React's second mount in dev cancels the first one's.
  useEffect(() => {
    if (!pageId || !thread || took === asked) return;
    setPending(pageId, quote);
    const frame = requestAnimationFrame(() => {
      took = asked;
      (card.current ?? field.current)?.focus();
    });
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
    void agentStatus().then(setStatus).catch((e) => setStatus({ installed: false, logged_in: false, error: String(e) }));
    void loadCodex(true);
  };
  useEffect(() => {
    check();
    void listAgents().then(setAgents);
  }, [pair?.id, pair?.online, readiness, remote.connected]);
  useEffect(() => {
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [thread?.items, threads?.pending, thread?.approval]);
  useEffect(() => {
    pinned.current = true;
  }, [thread?.id, thread?.busy]);

  // Ready when the provider the chosen model needs is there and signed in.
  const ready = available && (gpt ? cx.state === "ready" && !!gptModel(prefs.model) : !!status?.installed && !!status.logged_in);

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
    if (!ready || !askNow || thread?.busy) return;
    const now = takeAskNow();
    if (now) send(now.question, [], quote);
  }, [ready, askNow, thread?.busy]);

  // With no page in front (a list, or the next page loading) the line shows only if that lasts.
  if (!page || !pageId || !threads || !thread)
    return (
      <section aria-label="Agent" className="flex h-full min-h-0 flex-col" data-testid="agent-panel">
        {head(null)}
        {pair && <RemoteAgentConnection />}
        <p className="m-auto px-6 text-balance text-center text-muted-foreground text-sm transition-opacity delay-300 duration-150 starting:opacity-0">
          Open a page to ask {gpt ? "GPT" : "Claude"} about it.
        </p>
      </section>
    );
  const id = pageId;
  const title = page.title().trim();
  const items = thread.items;
  const lastTurn = turnsOf(items).at(-1) ?? [];
  // The last turn's answer, which Insert, Replace and Copy act on; a plan is not one.
  const final = !thread.busy && lastTurn.some((i) => i.kind === "end" && i.how === "done" && !i.plan) ? turnContent(lastTurn).answer.at(-1) : undefined;

  const target = () => {
    const editor = askEditor();
    return editor && thread.quote ? editor.find(thread.quote.text, thread.quote.from) : null;
  };
  const applyAnswer = async (fn: () => void) => {
    try {
      await flushAll();
      authored(action("Added agent answer", { kind: "agent", name: gpt ? "GPT" : "Claude", model: prefs.model, run: thread.id }), fn);
      await flushAll();
    } catch (error) { patchThread(id, thread.id, (t) => ({ ...t, note: error instanceof Error ? error.message : String(error) })); }
  };
  const insert = () => void applyAnswer(() => {
    const editor = askEditor();
    if (editor && final) editor.insertAfter(target()?.to ?? editor.selection().to, markdownHtml(final.text).html);
  });
  const replace = () => void applyAnswer(() => {
    const editor = askEditor();
    if (!editor || !final) return;
    const hit = target();
    if (!hit) return patchThread(id, thread.id, (t) => ({ ...t, note: "Those words have changed since, so nothing was replaced." }));
    editor.replaceRange(hit.from, hit.to, inlineHtml(final.text));
    // Replaced once: the words are gone, so the next insert goes below instead.
    patchThread(id, thread.id, (t) => ({ ...t, quote: null }));
  });
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

  // A new thread, or an earlier one on this page; it shares a line with the view's name.
  const menu = (
    <Menu>
      <MenuTrigger render={<Button aria-label="Threads" className="h-7 min-w-0 shrink gap-1 px-1.5 font-normal text-muted-foreground sm:h-7" size="sm" variant="ghost" />}>
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
  );

  return (
    <section
      aria-label="Agent"
      className="@container/panel flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="agent-panel"
      ref={box}
      onKeyDown={(e) => {
        // Keys from its menus, which sit outside it, are theirs.
        if (e.key === "Escape" && e.currentTarget.contains(e.target as Node)) {
          e.stopPropagation();
          closeAsk();
        }
      }}
    >
      {head(menu)}
      {pair && <RemoteAgentConnection />}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        ref={log}
      >
        {available && gpt && !ready && (
          <div className="space-y-2 text-muted-foreground">
            {cx.state === "checking" ? (
              <p>Checking Codex…</p>
            ) : cx.state === "missing" ? (
              <p>
                Codex is not installed{pair ? ` on ${pair.macName || "your Mac"}` : ""}. Get it from{" "}
                <button className="underline" onClick={() => openLink(INSTALL.codex)} type="button">
                  OpenAI
                </button>
                , sign in with {code("codex login")}, then check again.
              </p>
            ) : cx.state === "signed-out" ? (
              <p>Codex is not signed in{pair ? ` on ${pair.macName || "your Mac"}` : ""}. Run {code("codex login")} in Terminal on that Mac, then check again.</p>
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
        {available && !gpt && !status && <p className="text-muted-foreground">Checking Claude Code…</p>}
        {available && !gpt && status && !ready && (
          <div className="space-y-2 text-muted-foreground">
            {status.installed ? (
              <p>Claude Code is not signed in{pair ? ` on ${pair.macName || "your Mac"}` : ""}. Run {code("claude auth login")} in Terminal on that Mac, then check again.</p>
            ) : (
              <p>
                Claude Code is not installed{pair ? ` on ${pair.macName || "your Mac"}` : ""}. Get it from <span className="whitespace-nowrap">{install},</span> sign in with {code("claude auth login")}, then check again.
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
          stopping={!!thread.stopping}
          fieldRef={field}
          onSend={(q, m) => send(q, m)}
          onStop={() => void stopTurn(id, thread.id)}
          pages={pages.filter((p) => p.id !== id)}
          placeholder={threads.pending ? "Ask about the selection…" : "Ask about this page…"}
          ready={ready}
        />
      </div>
    </section>
  );
}
