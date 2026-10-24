import { ChevronDown, FileText, FileX, GitBranch, Globe, MessagesSquare, Plus, Square } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import { useBrowserTabs, useWorkspace } from "~/components/agent-browser";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { WorkerCard, type WorkerRow } from "~/components/worker-card";
import { type ChatSettings, type Command, Composer } from "~/components/composer";
import { useFolder } from "~/components/project-folder";
import { Turn } from "~/components/thread-view";
import { type Access, isClaude, useAiPrefs } from "~/lib/ai-prefs";
import { codex } from "~/lib/codex";
import { accessOf, adopt, type Agent, agentOf, answer, type Chat, type Conversation, chatOf, inRecord, listChats, type Output, modeFor, send, sending, setMode, setModel, splitAttached, stop, watch } from "~/lib/project-runtime/chat";
import { deliveryOf } from "~/lib/project-runtime/requests";
import { said as saidIn, type TranscriptItem } from "~/lib/project-runtime/transcript";
import { ask, call } from "~/lib/project-runtime/transport";
import { openBeside } from "~/lib/panes";
import { browserView, pageOf } from "~/lib/space";
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

// What the agent may do in the folder, as the access menu says it here.
const ACCESS_IN_FOLDER: Record<Agent, { value: Access; description: string }[]> = {
  claude: [
    { value: "ask", description: "Claude asks before changing files or running commands" },
    { value: "auto", description: "Claude Code's auto mode: a classifier approves or blocks each action and asks you when unsure" },
    { value: "full", description: "Claude changes files and runs commands without asking" },
  ],
  codex: [
    { value: "ask", description: "Codex asks before each command and change" },
    { value: "auto", description: "Codex works freely in the folder and temporary folders, and asks before going elsewhere or online" },
    { value: "full", description: "Codex runs anything without asking, outside the folder too" },
  ],
};
const NAME: Record<Agent, string> = { claude: "Claude", codex: "Codex" };

// The record's items as the note chat's turns: one per prompt, its steps, its words, its end.
// A file a turn wrote: its name, the call that wrote it, and the version the runtime kept.
type Written = { name: string; tool?: string; output?: Output };
type Report = NonNullable<TranscriptItem["report"]>;
type Shown = { items: Item[]; files: Written[]; reports: Report[]; stopped?: boolean; error?: string };
function turnsOf(chat: Chat): Shown[] {
  const out: Shown[] = [];
  const add = (i: Item) => (out.length ? out[out.length - 1].items.push(i) : out.push({ items: [i], files: [], reports: [] }));
  const last = () => out[out.length - 1] ?? (out.push({ items: [], files: [], reports: [] }), out[0]);
  for (const t of chat.window.items as TranscriptItem[]) {
    if (saidIn(t) !== null) {
      // Files sent with it show by name; the runtime keeps them under a stamped name.
      const { said, files } = splitAttached(saidIn(t) ?? "");
      out.push({ items: [{ kind: "user", text: said, files: files.map((f) => (f.split("/").at(-1) ?? f).replace(/^\d{8}-\d{6}-(\d+-)?/, "")) }], files: [], reports: [] });
    }
    // How a turn ended is said by a notice: stopped, or an error.
    else if (t.kind === "notice" && t.notice === "interrupted") last().stopped = true;
    // A worker's or a run's outcome, told to this agent: it shows on its row (features/agent-coordination.feature).
    else if (t.kind === "report" && (t.report?.session || t.report?.run)) last().reports.push(t.report);
    // Claude's own helpers are its steps, told apart from the runtime's workers.
    else if (t.kind === "crew") for (const n of t.names ?? []) add({ kind: "tool", id: `${t.id}:${n}`, name: "Subagent", input: { target: n }, status: "done" });
    else if (t.kind === "notice" && t.level === "error") last().error = t.text;
    else if (t.kind === "text" || t.kind === "notice" || t.kind === "shell") add({ kind: "text", text: t.text ?? "" });
    else if (t.kind === "tools") for (const c of t.items ?? []) add({ kind: "tool", id: c.id ?? `${t.id}:${c.target}`, name: c.verb, input: { target: c.target }, status: t.done ? "done" : "running" });
    else if (t.kind === "edit" && t.file) {
      // A refused edit changed nothing, so its file isn't listed. One the person was asked about was declined.
      const how = !t.error ? "done" : chat.requests.some((r) => r.tool_use === t.tool) ? "declined" : "failed";
      add({ kind: "tool", id: t.id, name: "Edited", input: { target: t.file }, status: how, output: t.error ? undefined : `+${t.added ?? 0} −${t.removed ?? 0}` });
      // Nor is one still waiting for the person's yes.
      const asking = chat.requests.some((r) => r.tool_use === t.tool && (r.state === "pending" || r.state === "recorded"));
      const files = out[out.length - 1]?.files;
      const same = (o: Output) => o.path === t.file || o.path.endsWith(`/${t.file}`);
      const found = chat.outputs.find((o) => o.tool === t.tool && same(o));
      // Deleted by this turn: it opens as its last kept version before.
      const output = found?.missing ? { ...found, ...chat.outputs.filter((o) => same(o) && o.kept && o.at < found.at).at(-1), missing: true, tool: found.tool } : found;
      // The turn's last write of a file is the one its chip opens.
      if (files && !t.error && !asking) files.splice(0, files.length, ...files.filter((f) => f.name !== t.file), { name: t.file, tool: t.tool, output });
    } else if (t.kind === "question") add({ kind: "text", text: (t.questions ?? []).map((q, k) => (t.answers?.[k] ? `${q.question}\n\n**${t.answers[k]}**` : q.question)).join("\n\n") });
  }
  // Ended turns end; the ledger knows how the session's own last ones went.
  const live = chat.session?.agent_state === "running" || chat.session?.agent_state === "waiting";
  // Turns a message started; not ones the agent started itself or a worker's report started.
  const sent = chat.turns.filter((t) => !t.origin || t.origin === "berth");
  out.forEach((turn, k) => {
    const isLast = k === out.length - 1;
    // A step still going when its turn ended was stopped with it.
    if (!(isLast && live)) turn.items = turn.items.map((i) => (i.kind === "tool" && i.status === "running" ? { ...i, status: "stopped" } : i));
    // The reply being written shows until the record has its words.
    if (isLast && (live || chat.draft)) return chat.draft && !inRecord(chat.window, chat.draft) && turn.items.push({ kind: "text", text: chat.draft });
    // Only turns started by a message line up with them: the agent can start one itself. Around a
    // send one side is ahead: the record has the message the list hasn't started, or the list has
    // started a turn for a message still on its way into the record.
    const shift = live && sent.at(-1)?.ended ? 1 : sending(chat).length > 0 && sent.at(-1) && !sent.at(-1)?.ended ? -1 : 0;
    const ledger = sent[sent.length - (out.length - k) + shift];
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
  const [file, setFile] = useState<Written | null>(null);
  // A file an answer links to opens as it is now. One handler, so finished turns don't redraw.
  const roots = useRef<string[]>([]);
  const [openFile] = useState(() => (href: string) => {
    const path = decodeURIComponent(href.replace(/^file:\/\//, "").replace(/[?#].*$/, ""));
    const root = roots.current.flatMap((r) => [r, r.replace(/^\/private\//, "/"), `/private${r}`]).find((r) => path.startsWith(`${r}/`));
    const name = root ? path.slice(root.length + 1) : !path.startsWith("/") && path.replace(/^\.\//, "");
    if (name) setFile({ name });
    else toastManager.add({ type: "info", title: "That file is outside the folder." });
  });
  const [attached, setAttached] = useState<File[]>([]);
  const [branch, setBranch] = useState(false);
  const [commands, setCommands] = useState<Command[]>([]);
  // A new chat's settings start as Settings › AI's and stay this chat's own.
  const defaults = () => ({ model: prefs.model, effort: prefs.effort, access: prefs.access, plan: prefs.plan });
  const [fresh, setFresh] = useState(defaults);
  const key = current ?? `new:${pageId}`;
  const chat = chatOf(key).use();
  // Files and words in the composer are this chat's: another chat starts without them.
  useEffect(() => setAttached([]), [key]);
  const cx = codex.use();
  // The workspace's browser, while the agent has one open there (features/agent-browser.feature).
  const own = (chat.conv ?? list.find((c) => c.id === current))?.location?.split("/")[1];
  const ws = useWorkspace(pageId, own);
  const tabs = useBrowserTabs(ws?.location, ws?.worktree);
  const field = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  // Follows the newest words while the person is at the bottom, not while they read back.
  const stuck = useRef(true);
  const title = pageOf(pageId)?.title.trim() || "this project";

  const refresh = () => {
    if (location) void listChats(location).then((l) => setList(l.sort((a, b) => Date.parse(b.updated ?? b.created) - Date.parse(a.updated ?? a.created))), () => {});
  };
  useEffect(refresh, [location]);
  useEffect(() => void (current ? localStorage.setItem(CHOSEN(pageId), current) : localStorage.removeItem(CHOSEN(pageId))), [current]);
  // A task's Chat button asks for its agent's conversation (components/assign.tsx).
  useEffect(() => {
    const on = (e: Event) => {
      const { page, conversation } = (e as CustomEvent<{ page: string; conversation: string }>).detail;
      if (page === pageId) (refresh(), setCurrent(conversation));
    };
    window.addEventListener("ll:chat", on);
    return () => window.removeEventListener("ll:chat", on);
  }, [location]);
  const conv = list.find((c) => c.id === current) ?? null;
  useEffect(() => (conv ? watch(key, conv) : undefined), [key, conv?.id, conv?.session]);
  const turns = useMemo(() => turnsOf(chat), [chat]);
  // Workers and runs once seen out, so a row stays until its report lands; this chat's only.
  const seen = useRef({ key, workers: new Set<string>(), runs: new Set<string>() });
  if (seen.current.key !== key) seen.current = { key, workers: new Set(), runs: new Set() };
  for (const w of chat.workers) seen.current.workers.add(w);
  for (const r of chat.runs) seen.current.runs.add(r);
  // Workers and runs stopped from their row.
  const [stopped, setStopped] = useState<string[]>([]);
  const reported = new Set(turns.flatMap((t) => t.reports.map((r) => r.session ?? r.run ?? "")));
  // The agent's own skills and commands, those that work in a chat (not the ones needing its terminal).
  const live = chat.session && !chat.session.exited ? chat.session.name : null;
  useEffect(() => {
    setCommands([]);
    if (!live) return;
    type Listed = { name: string; description?: string; kind?: string; local?: boolean; screen?: boolean };
    void ask<{ commands: Listed[] }>("GET", `/v1/sessions/${live}/commands`).then(
      // A name with a space can't be typed as a command.
      (r) => setCommands(r.commands.filter((c) => (c.kind !== "builtin" || (!c.local && !c.screen)) && !/\s/.test(c.name)).map((c) => ({ id: c.name, label: c.name, question: `${c.name} `, send: false, description: c.description }))),
      () => {},
    );
  }, [live]);
  const waitingOn = sending(chat);
  useEffect(() => void (stuck.current && log.current?.scrollTo({ top: log.current.scrollHeight })));
  // Relinked: what said the folder was gone no longer holds.
  useEffect(() => void (state && !state.missing && chatOf(key).get().error && chatOf(key).set({ ...chatOf(key).get(), error: null })), [state?.missing]);
  // The request in front: what the agent waits on now, oldest first (features/agent-interactions.feature).
  const open = chat.requests.find((r) => r.blocking && (r.state === "pending" || r.state === "recorded"));
  // A question the agent isn't waiting on sits above the composer, which stays.
  const front = open ?? chat.requests.find((r) => !r.blocking && r.kind === "question" && (r.state === "pending" || r.state === "recorded"));
  // It takes the keyboard from the composer it hides, never from the page; and when the chat opens on it.
  const opening = useRef(true);
  useEffect(() => {
    const here = opening.current || document.activeElement === document.body || !!field.current?.closest("[data-testid=project-chat]")?.contains(document.activeElement);
    if (open && here) card.current?.focus();
    if (open || chat.synced) opening.current = false;
  }, [open?.id, key, open && chat.answers[open.id]?.index, chat.synced]);

  if (!state || !location) return <p className="m-auto p-6 text-center text-muted-foreground text-sm">Link a folder to this page to chat in it.</p>;
  if (state.missing) return <p className="m-auto p-6 text-center text-muted-foreground text-sm">The folder isn't there any more. Relink it from the page's folder row.</p>;
  // An agent waiting with nothing in front of the person is still at work (Codex runs an approved command so).
  const working = chat.session?.agent_state === "running" || (chat.session?.agent_state === "waiting" && !open);
  const busy = working || waitingOn.length > 0 || !!chat.draft;
  const draft = front ? chat.answers[front.id] : undefined;
  const sent = front ? chat.deliveries[front.id] : undefined;
  const delivery = front ? (sent?.delivery === "sending" || sent?.delivery === "failed" ? sent.delivery : deliveryOf(front, draft, false, false)) : "pending";
  const started = chat.conv ?? conv;
  roots.current = [started?.dir, state.folder.path].filter((r): r is string => !!r);
  // A new chat stays with Claude while Codex isn't on this Mac or signed in.
  const mine = isClaude(fresh.model) || cx.state === "ready" ? fresh : { ...fresh, model: "opus" };
  // A started chat keeps its agent and model; a new one runs whichever the model menu picks.
  const agent: Agent = started ? (started.agent === "codex" ? "codex" : "claude") : agentOf(mine.model);
  const settings: ChatSettings = started
    ? {
        ...accessOf(started.mode, agent),
        model: started.model ?? "",
        effort: started.effort ?? "",
        // It changes between turns, while its agent runs.
        locked: !live || busy,
        models: agent === "codex" ? "gpt" : "claude",
        accessChoices: ACCESS_IN_FOLDER[agent],
        onChange: (p) =>
          void (p.model || p.effort ? setModel(key, p.model ?? started.model ?? "", p.effort ?? started.effort ?? "") : setMode(key, modeFor({ ...accessOf(started.mode, agent), ...p }, agent))).catch(
            (err) => toastManager.add({ type: "error", title: String(err.message ?? err) }),
          ),
      }
    : { ...mine, accessChoices: ACCESS_IN_FOLDER[agent], branch: state.repo ? { on: branch, set: setBranch } : undefined, onChange: (p) => setFresh((f) => ({ ...f, ...p })) };
  const go = (text: string) => {
    stuck.current = true;
    const files = attached;
    void send(key, location, text, { ...settings, branch: !started && !!state.repo && branch }, files).then((c) => {
      setAttached((a) => a.filter((f) => !files.includes(f)));
      if (!current) {
        adopt(key, c.id);
        setCurrent(c.id);
      }
      refresh();
    }, () => {});
  };
  const now = chat.turns.at(-1);
  // A card that hides the composer carries its Stop: the agent can be stopped while it asks.
  const footer = (line: ReactNode) => (
    <div className="mt-2 flex min-h-6 items-center gap-2">
      <div className="min-w-0 flex-1 [&>p]:mt-0">{line}</div>
      {open && (
        <Button onClick={() => void stop(key)} size="xs" variant="ghost">
          <Square className="size-2.5 fill-current" />
          Stop
        </Button>
      )}
    </div>
  );
  // The person's chats; a worker's (one an agent or a run started) only while it is open.
  const chats = list.filter((c) => !c.by || c.id === current);
  // A worker's own chat, when the runtime lists it among the folder's.
  const openWorker = (s: string) => void listChats(location).then((l) => {
    const c = l.find((x) => x.session === s);
    if (c) (setList(l), setCurrent(c.id));
  }, () => {});

  return (
    <div className="@container/panel flex h-full flex-col text-sm" data-testid="project-chat">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <Menu>
          <MenuTrigger render={<Button aria-label="Chats" className="h-7 min-w-0 shrink gap-1.5 px-1.5 font-medium sm:h-7" size="sm" variant="ghost" />}>
            <MessagesSquare className="text-muted-foreground" />
            <span className="truncate">{conv?.title || "New chat"}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-72" finalFocus={field}>
            <MenuItem onClick={() => (setCurrent(null), setFresh(defaults()), setBranch(false))}>
              <Plus />
              New chat
            </MenuItem>
            {chats.length > 0 && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>In “{title}”</MenuGroupLabel>
                  <MenuRadioGroup onValueChange={(v) => setCurrent(v as string)} value={current ?? ""}>
                    {chats.map((c) => (
                      <MenuRadioItem className="grid-cols-[.75rem_minmax(0,1fr)]" closeOnClick key={c.id} value={c.id}>
                        <span className="flex min-w-0 items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate">{c.title || "Untitled chat"}</span>
                          <span className="shrink-0 text-muted-foreground text-xs">
                            {c.agent === "codex" && "Codex · "}
                            {when(c.updated ?? c.created)}
                          </span>
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            )}
          </MenuPopup>
        </Menu>
        {!!live && tabs.some((t) => t.name === live) && (
          <Button className="ms-auto h-7 gap-1.5 px-1.5 sm:h-7" onClick={() => openBeside(browserView(pageId, own, live ?? ""))} size="sm" variant="ghost">
            <Globe className="size-4" />
            Browser
          </Button>
        )}
        {/* A chat on its own branch says which; its worktree is the runtime's (slice 6). */}
        {started?.location?.includes("/") && (
          <span className={cn("flex min-w-0 shrink items-center gap-1 text-muted-foreground text-xs", !(live && tabs.some((t) => t.name === live)) && "ms-auto")}>
            <GitBranch className="size-4 shrink-0" />
            <span className="truncate">ll/{started.location.split("/")[1]}</span>
          </span>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={(e) => (stuck.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 48)}
        ref={log}
      >
        {/* A chat whose agent session was removed reads its record again once it is picked up. */}
        {turns.length === 0 && waitingOn.length === 0 && started && chat.synced && !chat.session && <p className="m-auto p-6 text-center text-muted-foreground">Send a message to pick this chat up again; its earlier turns come back with it.</p>}
        {turns.length === 0 && waitingOn.length === 0 && !started && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <MessagesSquare className="size-6 text-muted-foreground" />
            <p className="text-balance text-lg">What should we do in {state.folder.path.split("/").at(-1)}?</p>
            <p className="text-balance text-muted-foreground text-xs">{NAME[agent]} works in this folder: it reads and changes its files and runs commands there.</p>
          </div>
        )}
        {turns.map((t, k) => (
          <div className="mt-4 first:mt-0" key={k}>
            <Turn
              items={t.items}
              live={busy && k === turns.length - 1 && waitingOn.length === 0}
              onFile={openFile}
              onGoAhead={() => go("Go ahead with the plan.")}
              page={title}
              started={now?.started && !now.ended ? Date.parse(now.started) : undefined}
              waiting={!!open && k === turns.length - 1}
            />
            {t.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.files.map((f) => (
                  <Button key={f.name} onClick={() => setFile(f)} size="xs" variant="outline">
                    {f.output?.missing ? <FileX className="size-4" /> : <FileText className="size-4" />}
                    {/* Deleted by that turn: it still opens as it last was, if kept. */}
                    <span className={cn(f.output?.missing && "text-muted-foreground line-through")}>{f.name}</span>
                  </Button>
                ))}
              </div>
            )}
            {(() => {
              // Workers still out show under the latest turn, and stay there until their report comes,
              // which waits for the agent's next idle; each one's outcome under the turn it came in.
              const last = k === turns.length - 1;
              const out = last ? [...seen.current.workers].filter((w) => !reported.has(w)) : [];
              const going = last ? [...seen.current.runs].filter((id) => !reported.has(id)) : [];
              const state = (s: string) => chat.sessions.find((x) => x.name === s);
              // A worker can be told of twice (its task and its turn): its last word counts.
              const told = [...new Map(t.reports.map((r) => [r.session ?? r.run ?? "", r])).values()];
              // Stopped from its row: its turn ends "finished", but it was stopped.
              const how = (s: string, status?: string) => (stopped.includes(s) && status === "finished" ? "interrupted" : status);
              const rows: WorkerRow[] = [
                ...told.map((r) =>
                  r.run && !r.session
                    ? { session: r.run, run: true, label: r.template === "loop" ? "Checked loop" : r.title || `${r.template ?? "A"} run`, status: how(r.run, r.status), duration: r.duration, answer: r.answer }
                    : { session: r.session ?? "", agent: state(r.session ?? "")?.agent, status: how(r.session ?? "", r.status), duration: r.duration, answer: r.answer, error: r.error },
                ),
                ...out.map((s) => {
                  const st = state(s)?.agent_state;
                  return st === "running" || st === "waiting" || chat.workers.includes(s)
                    ? { session: s, agent: state(s)?.agent, live: st === "waiting" ? ("waiting" as const) : ("working" as const) }
                    : { session: s, agent: state(s)?.agent, status: how(s, "finished") };
                }),
                // A run gone from the list says how it ended only in its report: until then, Working.
                ...going.map((id) => ({ session: id, run: true, label: "Checked loop", ...(stopped.includes(id) && !chat.runs.includes(id) ? { status: "cancelled" } : { live: "working" as const }) })),
              ];
              // In the order they started, so a row stays put when its worker finishes; runs after.
              rows.sort((a, b) => (state(a.session)?.created ?? "~").localeCompare(state(b.session)?.created ?? "~"));
              // A run stops by its own route, and the worker it drives with it; a worker by interrupting its turn.
              const stopRow = (s: string) => {
                setStopped((x) => [...x, s]);
                if (!going.includes(s)) return void ask("POST", `/v1/sessions/${s}/interrupt`).catch(() => {});
                void ask<{ params?: { session?: string } }>("GET", `/v1/runs/${s}`).then((r) => r.params?.session && ask("POST", `/v1/sessions/${r.params.session}/interrupt`), () => {}).catch(() => {});
                void ask("POST", `/v1/runs/${s}/cancel`).catch(() => {});
              };
              return rows.length > 0 && <WorkerCard onOpen={openWorker} onStop={stopRow} prefix={`${location}-`} rows={rows} />;
            })()}
          </div>
        ))}
        {waitingOn.map((text, k) => (
          <div className="mt-4 first:mt-0" key={`sending:${k}`}>
            <Turn items={[{ kind: "user", text }]} live onGoAhead={() => {}} page={title} />
          </div>
        ))}
        {chat.error && <p className="mt-2 break-words text-destructive-foreground">{chat.error}</p>}
      </div>
      {front &&
        (front.kind === "question" ? (
          <QuestionCard
            answer={draft?.answer ?? {}}
            busy={delivery !== "pending" && delivery !== "failed"}
            index={draft?.index ?? 0}
            key={front.id}
            onAnswer={(a, index, submit) => answer(key, front, a, index, submit)}
            ref={card}
            request={front}
          >
            {footer(<DeliveryLine delivery={delivery} error={sent?.error} onRetry={() => draft && answer(key, front, draft.answer, draft.index, true)} />)}
          </QuestionCard>
        ) : (
          <ApprovalCard busy={delivery !== "pending" && delivery !== "failed"} key={front.id} onChoose={(choice) => answer(key, front, { choice }, 0, true)} ref={card} request={front}>
            {footer(<DeliveryLine delivery={delivery} error={sent?.error} onRetry={() => draft && answer(key, front, draft.answer, 0, true)} />)}
          </ApprovalCard>
        ))}
      {/* Kept mounted under a request, so a message being written survives it. */}
      <div className={open ? "hidden" : "shrink-0"}>
        {chat.restore?.why && <p className="mx-4 mb-1.5 text-muted-foreground text-xs">{chat.restore.why}</p>}
        <Composer
          agents={[]}
          key={key}
          busy={busy}
          commands={commands}
          fieldRef={field}
          files={{
            names: attached.map((f) => f.name),
            add: (fs) => {
              // The runtime takes files up to 20 MB.
              for (const f of fs.filter((f) => f.size > 20 << 20)) toastManager.add({ type: "error", title: `${f.name} is ${(f.size / (1 << 20)).toFixed(1)} MB; files can be up to 20 MB.` });
              setAttached((a) => [...a, ...fs.filter((f) => f.size <= 20 << 20)]);
            },
            remove: (i) => setAttached((a) => a.filter((_, k) => k !== i)),
          }}
          onSend={(q) => go(q)}
          onStop={() => void stop(key)}
          pages={[]}
          placeholder={`Ask ${NAME[agent]} to work in the folder…`}
          ready
          restore={chat.restore}
          settings={settings}
        />
      </div>
      <FilePreview conv={started?.id} file={file} live={live} location={location} onClose={() => setFile(null)} worktree={started?.location?.split("/")[1]} />
    </div>
  );
}

// A file the agent changed, as it is in the folder now.
// A file a turn wrote: as that turn left it (the runtime's kept version), as it is now, and the
// change that turn made.
type View = "then" | "now" | "change";
function FilePreview({ file, location, worktree, conv, live, onClose }: { file: Written | null; location: string; worktree?: string; conv?: string; live: string | null; onClose: () => void }) {
  const views = file ? ([file.output?.kept && "then", "now", file.tool && live && "change"].filter(Boolean) as View[]) : [];
  const [view, setView] = useState<View>("now");
  const [text, setText] = useState<string | null>(null);
  useEffect(() => void (file && setView(file.output?.kept ? "then" : "now")), [file]);
  useEffect(() => {
    setText(null);
    if (!file) return;
    // A slower answer for the view left behind never takes this one's place.
    let current = true;
    const put = (s: string) => void (current && setText(s));
    const shown = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body, null, 2));
    if (view === "then" && file.output && conv) {
      void call("GET", `/v1/conversations/${conv}/outputs/${file.output.id}`).then((r) => put(r.status === 200 ? shown(r.body) : "This version wasn't kept."));
    } else if (view === "change" && file.tool && live) {
      type Detail = { hunks?: { lines: string[] }[]; old?: string; new?: string };
      void ask<Detail>("GET", `/v1/sessions/${live}/transcript/tool/${encodeURIComponent(file.tool)}`).then(
        (d) => {
          const marked = (s: string | undefined, m: string) => (s ? s.replace(/\n$/, "").split("\n").map((l) => `${m}${l}`) : []);
          // A deletion's record holds the text it took away, as an addition's would.
          const lines = d.hunks?.flatMap((h) => h.lines) ?? (file.output?.missing ? marked(d.new || d.old, "-") : [...marked(d.old, "-"), ...marked(d.new, "+")]);
          put(lines.join("\n"));
        },
        (e) => put(`Couldn't read the change: ${e.message}`),
      );
    } else {
      // The chat's own worktree, else the folder's: a checkout's main worktree, or a plain folder itself.
      type Loc = { name: string; worktrees?: { name: string; main?: boolean }[] };
      const where = worktree ? Promise.resolve(worktree) : ask<Loc[]>("GET", "/v1/locations").then((all) => all.find((l) => l.name === location)?.worktrees?.find((w) => w.main)?.name ?? location);
      void where
        .then((wt) => ask<{ content?: string }>("GET", `/v1/locations/${location}/worktrees/${encodeURIComponent(wt)}/file?path=${encodeURIComponent(file.name)}`))
        .then((f) => put(f.content ?? ""), () => put("It isn't in the folder now."));
    }
    return () => void (current = false);
  }, [file, view]);
  const said = { then: file?.output?.missing ? "As it was before this turn deleted it." : "As this turn left it.", now: "As it is in the folder now.", change: "What this turn changed." }[view];
  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={file !== null}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{file?.name}</DialogTitle>
          <DialogDescription>{said}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          {views.length > 1 && (
            <SegmentedControl aria-label="Which version" render={<RadioGroupPrimitive onValueChange={(v) => setView(v as View)} value={view} />}>
              {views.map((v) => (
                <SegmentedControlItem key={v} render={<RadioPrimitive.Root value={v} />}>
                  {{ then: "Then", now: "Now", change: "Change" }[v]}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          )}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
            {view === "change" && text
              ? text.split("\n").map((l, i) => (
                  <span className={cn("block", l.startsWith("+") && "text-success-foreground", l.startsWith("-") && "text-destructive-foreground")} key={i}>
                    {l || " "}
                  </span>
                ))
              : (text ?? "…")}
          </pre>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
