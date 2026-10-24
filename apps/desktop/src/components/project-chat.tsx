import { ChevronDown, FileText, MessagesSquare, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { Composer } from "~/components/composer";
import { useFolder } from "~/components/project-folder";
import { Turn } from "~/components/thread-view";
import { useAiPrefs } from "~/lib/ai-prefs";
import { answer, type Chat, type Conversation, chatOf, listChats, send, sending, stop, watch } from "~/lib/project-runtime/chat";
import { deliveryOf } from "~/lib/project-runtime/requests";
import type { TranscriptItem } from "~/lib/project-runtime/transcript";
import { ask } from "~/lib/project-runtime/transport";
import { pageOf } from "~/lib/space";
import type { Item } from "~/lib/threads";

// A project's chat (features/project-chat.feature): an agent working in the page's folder, in a
// card beside the page. The turns look as the note chat's do (thread-view.tsx); what the agent
// changed in the folder is listed under its turn, and opens.

const CHOSEN = (pageId: string) => `ll.chat.${pageId}`;
const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const when = (iso?: string) => {
  const m = Math.round(((iso ? Date.parse(iso) : Date.now()) - Date.now()) / 60000);
  return Math.abs(m) < 60 ? ago.format(m, "minute") : Math.abs(m) < 1440 ? ago.format(Math.round(m / 60), "hour") : ago.format(Math.round(m / 1440), "day");
};

// The record's items as the note chat's turns: one per prompt, its steps, its words, its end.
type Shown = { items: Item[]; files: string[]; stopped?: boolean; error?: string };
function turnsOf(chat: Chat): Shown[] {
  const out: Shown[] = [];
  const add = (i: Item) => (out.length ? out[out.length - 1].items.push(i) : out.push({ items: [i], files: [] }));
  const last = () => out[out.length - 1] ?? (out.push({ items: [], files: [] }), out[0]);
  for (const t of chat.window.items as TranscriptItem[]) {
    if (t.kind === "user") out.push({ items: [{ kind: "user", text: t.text ?? "" }], files: [] });
    // How a turn ended is said by a notice: stopped, or an error.
    else if (t.kind === "notice" && t.notice === "interrupted") last().stopped = true;
    else if (t.kind === "notice" && t.level === "error") last().error = t.text;
    else if (t.kind === "text" || t.kind === "notice" || t.kind === "command" || t.kind === "shell") add({ kind: "text", text: t.text ?? "" });
    else if (t.kind === "tools") for (const c of t.items ?? []) add({ kind: "tool", id: c.id ?? `${t.id}:${c.target}`, name: c.verb, input: { target: c.target }, status: t.done ? "done" : "running" });
    else if (t.kind === "edit" && t.file) {
      // A refused edit changed nothing, so its file isn't listed. One the person was asked about was declined.
      const how = !t.error ? "done" : chat.requests.some((r) => r.tool_use === t.tool) ? "declined" : "failed";
      add({ kind: "tool", id: t.id, name: "Edited", input: { target: t.file }, status: how, output: t.error ? undefined : `+${t.added ?? 0} −${t.removed ?? 0}` });
      const files = out[out.length - 1]?.files;
      if (files && !t.error && !files.includes(t.file)) files.push(t.file);
    } else if (t.kind === "question") add({ kind: "text", text: (t.questions ?? []).map((q, k) => (t.answers?.[k] ? `${q.question}\n\n**${t.answers[k]}**` : q.question)).join("\n\n") });
  }
  // Ended turns end; the ledger knows how the session's own last ones went.
  const live = chat.session?.agent_state === "running" || chat.session?.agent_state === "waiting";
  out.forEach((turn, k) => {
    const isLast = k === out.length - 1;
    if (isLast && live) return chat.draft && turn.items.push({ kind: "text", text: chat.draft });
    const ledger = chat.turns[chat.turns.length - (out.length - k)];
    const ms = ledger?.started && ledger.ended ? Date.parse(ledger.ended) - Date.parse(ledger.started) : 0;
    turn.items.push({ kind: "end", ms, how: turn.error ? "failed" : turn.stopped ? "stopped" : "done", error: turn.error });
  });
  return out;
}

export function ProjectChat({ pageId }: { pageId: string }) {
  const state = useFolder(pageId);
  const location = state?.folder.location;
  const prefs = useAiPrefs();
  const [list, setList] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem(CHOSEN(pageId)));
  const [file, setFile] = useState<string | null>(null);
  const key = current ?? `new:${pageId}`;
  const chat = chatOf(key).use();
  const field = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const title = pageOf(pageId)?.title.trim() || "this project";

  const refresh = () => {
    if (location) void listChats(location).then((l) => setList(l.sort((a, b) => Date.parse(b.updated ?? b.created) - Date.parse(a.updated ?? a.created))), () => {});
  };
  useEffect(refresh, [location]);
  useEffect(() => void (current ? localStorage.setItem(CHOSEN(pageId), current) : localStorage.removeItem(CHOSEN(pageId))), [current]);
  const conv = list.find((c) => c.id === current) ?? null;
  useEffect(() => (conv ? watch(key, conv) : undefined), [key, conv?.id, conv?.session]);
  const turns = useMemo(() => turnsOf(chat), [chat]);
  const waitingOn = sending(chat);
  useEffect(() => void log.current?.scrollTo({ top: log.current.scrollHeight }), [turns.length, chat.draft, waitingOn.length]);
  // The request in front: what the agent waits on now, oldest first (features/agent-interactions.feature).
  const open = chat.requests.find((r) => r.blocking && (r.state === "pending" || r.state === "recorded"));
  // It takes the keyboard from the composer it hides, never from the page.
  useEffect(() => {
    const here = document.activeElement === document.body || !!field.current?.closest("[data-testid=project-chat]")?.contains(document.activeElement);
    if (open && here) card.current?.focus();
  }, [open?.id]);

  if (!state || !location) return <p className="m-auto p-6 text-center text-muted-foreground text-sm">Link a folder to this page to chat in it.</p>;
  if (state.missing) return <p className="m-auto p-6 text-center text-muted-foreground text-sm">The folder isn't there any more. Relink it from the page's folder row.</p>;
  const busy = chat.session?.agent_state === "running" || waitingOn.length > 0;
  const draft = open ? chat.answers[open.id] : undefined;
  const sent = open ? chat.deliveries[open.id] : undefined;
  const delivery = open ? (sent?.delivery === "sending" || sent?.delivery === "failed" ? sent.delivery : deliveryOf(open, draft, false, false)) : "pending";
  const go = (text: string) =>
    void send(key, location, text, prefs).then((c) => {
      if (!current) {
        // The new chat takes its own key from here on, keeping what it holds.
        chatOf(c.id).set(chatOf(key).get());
        chatOf(key).set({ ...chatOf(key).get(), conv: null, window: { items: [], next: 0 }, submissions: [], texts: {}, requests: [], answers: {}, deliveries: {}, restore: null });
        setCurrent(c.id);
      }
      refresh();
    }, () => {});

  return (
    <div className="flex h-full flex-col text-sm" data-testid="project-chat">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <Menu>
          <MenuTrigger render={<Button aria-label="Chats" className="h-7 min-w-0 gap-1.5 px-1.5 font-medium sm:h-7" size="sm" variant="ghost" />}>
            <MessagesSquare className="text-muted-foreground" />
            <span className="truncate">{conv?.title || "New chat"}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-72" finalFocus={field}>
            <MenuItem onClick={() => setCurrent(null)}>
              <Plus />
              New chat
            </MenuItem>
            {list.length > 0 && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>In “{title}”</MenuGroupLabel>
                  <MenuRadioGroup onValueChange={(v) => setCurrent(v as string)} value={current ?? ""}>
                    {list.map((c) => (
                      <MenuRadioItem closeOnClick key={c.id} value={c.id}>
                        <span className="flex min-w-0 items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate">{c.title || "Untitled chat"}</span>
                          <span className="shrink-0 text-muted-foreground text-xs">{when(c.updated ?? c.created)}</span>
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            )}
          </MenuPopup>
        </Menu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" ref={log}>
        {turns.length === 0 && waitingOn.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <MessagesSquare className="size-6 text-muted-foreground" />
            <p className="text-balance text-lg">What should we do in {state.folder.path.split("/").at(-1)}?</p>
            <p className="text-balance text-muted-foreground text-xs">Claude works in this folder: it reads and changes its files and runs commands there.</p>
          </div>
        )}
        {turns.map((t, k) => (
          <div className="mt-4 first:mt-0" key={k}>
            <Turn items={t.items} live={busy && k === turns.length - 1 && waitingOn.length === 0} onGoAhead={() => go("Go ahead with the plan.")} page={title} waiting={!!open && k === turns.length - 1} />
            {t.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.files.map((f) => (
                  <Button key={f} onClick={() => setFile(f)} size="xs" variant="outline">
                    <FileText />
                    {f}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {waitingOn.map((text, k) => (
          <div className="mt-4 first:mt-0" key={`sending:${k}`}>
            <Turn items={[{ kind: "user", text }]} live onGoAhead={() => {}} page={title} />
          </div>
        ))}
        {chat.error && <p className="mt-2 text-destructive-foreground">{chat.error}</p>}
      </div>
      {open &&
        (open.kind === "question" ? (
          <QuestionCard
            answer={draft?.answer ?? {}}
            busy={delivery !== "pending" && delivery !== "failed"}
            index={draft?.index ?? 0}
            key={open.id}
            onAnswer={(a, index, submit) => answer(key, open, a, index, submit)}
            ref={card}
            request={open}
          >
            <DeliveryLine delivery={delivery} error={sent?.error} onRetry={() => draft && answer(key, open, draft.answer, draft.index, true)} />
          </QuestionCard>
        ) : (
          <ApprovalCard busy={delivery !== "pending" && delivery !== "failed"} key={open.id} onChoose={(choice) => answer(key, open, { choice }, 0, true)} ref={card} request={open}>
            <DeliveryLine delivery={delivery} error={sent?.error} onRetry={() => draft && answer(key, open, draft.answer, 0, true)} />
          </ApprovalCard>
        ))}
      {/* Kept mounted under a request, so a message being written survives it. */}
      <div className={open ? "hidden" : "shrink-0"}>
        {chat.restore?.why && <p className="mx-3 mb-1 text-muted-foreground text-xs">{chat.restore.why}</p>}
        <Composer agents={[]} busy={busy} commands={[]} fieldRef={field} onSend={(q) => go(q)} onStop={() => void stop(key)} pages={[]} placeholder="Ask Claude to work in the folder…" ready restore={chat.restore} />
      </div>
      <FilePreview file={file} location={location} onClose={() => setFile(null)} />
    </div>
  );
}

// A file the agent changed, as it is in the folder now.
function FilePreview({ file, location, onClose }: { file: string | null; location: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!file) return;
    // The folder's own workspace: a checkout's main worktree, or a plain folder itself.
    void ask<{ name: string; worktrees?: { name: string; main?: boolean }[] }[]>("GET", "/v1/locations")
      .then((all) => all.find((l) => l.name === location)?.worktrees?.find((w) => w.main)?.name ?? location)
      .then((wt) => ask<{ content?: string }>("GET", `/v1/locations/${location}/worktrees/${encodeURIComponent(wt)}/file?path=${encodeURIComponent(file)}`))
      .then((f) => setText(f.content ?? ""), (e) => setText(`Couldn't read it: ${e.message}`));
  }, [file]);
  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={file !== null}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{file}</DialogTitle>
          <DialogDescription>As it is in the folder now.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">{text ?? "…"}</pre>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
