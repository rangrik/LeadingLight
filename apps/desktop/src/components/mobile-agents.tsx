import { ArrowLeft, Bot, Plus, RefreshCw, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/views/settings/confirm";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { turnsOf } from "~/components/project-chat";
import { Turn } from "~/components/thread-view";
import { mobileAgents, mobileCall, refreshMobileAgents } from "~/lib/mobile-agents";
import { answer, chatOf, type Conversation, watch } from "~/lib/project-runtime/chat";
import { deliveryOf } from "~/lib/project-runtime/requests";
import { ask } from "~/lib/project-runtime/transport";

type Project = { name: string; path: string; missing?: boolean };
type Intent = { id: string; name: string; text: string; agent: string; conversation?: string };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
const label = (p: Project) => p.path.split("/").filter(Boolean).at(-1) || p.name;

export function MobileAgentsButton() {
  const [open, setOpen] = useState(false);
  const state = mobileAgents.use();
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Bot />Agents on Mac</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="h-[min(850px,calc(100svh-4rem))] max-w-3xl" bottomStickOnMobile={false}>
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle>Agents on {state.connection?.name || "Mac"}</DialogTitle>
          <DialogDescription>Work runs on your Mac, including while this app is closed.</DialogDescription>
        </DialogHeader>
        {open && <MobileProjects key={state.connection?.id || "unpaired"} />}
      </DialogPopup>
    </Dialog>
  </>;
}

function MobileProjects() {
  const state = mobileAgents.use();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await refreshMobileAgents();
        if (mobileAgents.get().connection) {
          const list = await ask<Project[]>("GET", "/v1/locations");
          if (!done) { setProjects(list); setSelected((p) => list.find((x) => x.name === p?.name) ?? null); }
        }
        if (!done) setError("");
      } catch (e) { if (!done) setError(message(e)); }
      finally { if (!done) { setLoaded(true); timer = setTimeout(refresh, 5000); } }
    };
    void refresh();
    return () => { done = true; clearTimeout(timer); };
  }, []);
  if (!state.connection) return <p className="p-6 text-sm text-muted-foreground">Connect your Mac in Settings → Devices. No cloud account is needed.</p>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {!state.online && <p role="status" className="px-6 pb-3 text-sm text-muted-foreground">Mac unavailable. Check Tailscale and keep the Mac awake. Your drafts are kept.</p>}
    {error && !selected && <p role="alert" className="px-6 pb-3 text-sm text-destructive-foreground">{error}</p>}
    {selected ? <>
      <div className="px-3 pb-2"><Button size="sm" variant="ghost" onClick={() => setSelected(null)}><ArrowLeft />{label(selected)}</Button></div>
      <MobileProjectChat key={selected.name} project={selected} host={state.connection.id} online={state.online} />
    </> : <div className="space-y-2 overflow-y-auto p-6 pt-0">
      {projects.map((p) => <Button key={p.name} variant="outline" className="w-full justify-start" disabled={p.missing} onClick={() => setSelected(p)}>{label(p)}{p.missing ? " · Folder unavailable" : ""}</Button>)}
      {!projects.length && <p className="text-sm text-muted-foreground">{loaded ? "No shared projects. Choose folders in Settings → Devices on your Mac." : "Loading shared projects…"}</p>}
    </div>}
  </div>;
}

function MobileProjectChat({ project, host, online }: { project: Project; host: string; online: boolean }) {
  const namespace = `mobile:${host}:${project.name}`;
  const [list, setList] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<string | null>(() => read(`${namespace}:chosen`, null));
  const [agent, setAgent] = useState("claude");
  const [text, setText] = useState(() => read(`${namespace}:draft`, ""));
  const [pending, setPending] = useState<Intent | null>(() => read(`${namespace}:pending`, null));
  const [dismiss, setDismiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const key = `${namespace}:${current || "new"}`;
  const chat = chatOf(key).use();
  const conv = list.find((c) => c.id === current) ?? null;
  const mounted = useRef(true);
  const sameHost = () => {
    if (!mounted.current || mobileAgents.get().connection?.id !== host) throw new Error("The Mac connection changed. Reopen this conversation before continuing.");
  };
  const macCall = (method: string, path: string, body?: unknown) => mobileCall(method, path, body, host);
  const macAsk = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const result = await macCall(method, path, body);
    if (result.status >= 400) throw new Error((result.body as { error?: string })?.error || `The Mac answered ${result.status}`);
    return result.body as T;
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { localStorage.setItem(`${namespace}:draft`, JSON.stringify(text)); }, [namespace, text]);
  useEffect(() => { localStorage.setItem(`${namespace}:chosen`, JSON.stringify(current)); }, [namespace, current]);
  const refresh = () => {
    sameHost();
    return macAsk<Conversation[]>("GET", `/v1/conversations?location=${encodeURIComponent(project.name)}&limit=200`).then((all) => { sameHost(); setList(all); return all; });
  };
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refresh(); if (!done) setPollError(""); } catch (e) { if (!done) setPollError(message(e)); } finally { if (!done) timer = setTimeout(poll, 5000); } };
    void poll();
    return () => { done = true; clearTimeout(timer); };
  }, [project.name]);
  useEffect(() => conv ? watch(key, conv) : undefined, [key, conv?.id, conv?.session, conv?.live]);
  const front = chat.requests.find((r) => r.state === "pending" || r.state === "recorded");
  const draft = front ? chat.answers[front.id] : undefined;
  const delivery = front ? chat.deliveries[front.id]?.delivery ?? deliveryOf(front, draft, false, false) : "pending";
  const working = chat.session?.agent_state === "running" || chat.session?.agent_state === "waiting";
  const keep = (intent: Intent | null) => { localStorage.setItem(`${namespace}:pending`, JSON.stringify(intent)); if (mounted.current) setPending(intent); };
  const send = async () => {
    if (busy || !online || (!pending && !text.trim())) return;
    const intent = pending ?? { id: crypto.randomUUID(), name: `mobile-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, text: text.trim(), agent, conversation: current ?? undefined };
    keep(intent); setBusy(true); setError("");
    try {
      const all = await refresh();
      sameHost();
      let target = all.find((c) => intent.conversation ? c.id === intent.conversation : c.session === intent.name);
      if (!intent.conversation && !target) {
        const result = await macCall("POST", "/v1/sessions", { name: intent.name, location: project.name, agent: intent.agent, driver: intent.agent, prompt: intent.text, title: intent.text.split("\n")[0].slice(0, 200) });
        if (result.status >= 400 && result.status !== 409) { if (result.status < 500) keep(null); throw new Error((result.body as { error?: string })?.error || "The Mac has not confirmed this start. Check and retry."); }
        target = (await refresh()).find((c) => c.session === intent.name);
        if (!target) throw new Error("The Mac has not confirmed this start. Check and retry to find the same agent.");
      } else if (intent.conversation) {
        if (!target) { keep(null); throw new Error("This conversation is no longer shared by the Mac."); }
        if (!target.live) {
          const resumed = await macAsk<{ name: string }>("POST", `/v1/conversations/${target.id}/resume`, {});
          sameHost();
          target = { ...target, session: resumed.name, live: true };
        }
        const result = await macCall("POST", `/v1/sessions/${target.session}/send`, { text: intent.text, when: "now", idem_key: intent.id });
        if (result.status >= 400) { if (result.status < 500) keep(null); throw new Error((result.body as { error?: string })?.error || "The Mac has not confirmed this message. Check and retry."); }
      }
      keep(null);
      if (mounted.current && target) { setCurrent(target.id); setText(""); await refresh(); }
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const turns = turnsOf(chat);
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-agent-chat">
    <div className="flex shrink-0 items-center gap-2 border-y px-4 py-2">
      <Select value={current || "new"} onValueChange={(value) => setCurrent(value === "new" ? null : value)} disabled={busy || !!pending}>
        <SelectTrigger className="min-w-0 flex-1" aria-label="Conversation"><SelectValue placeholder="New chat">{conv?.title || "New chat"}</SelectValue></SelectTrigger>
        <SelectPopup><SelectItem value="new">New chat</SelectItem>{list.map((c) => <SelectItem key={c.id} value={c.id}>{c.title || c.agent}</SelectItem>)}</SelectPopup>
      </Select>
      <Button size="icon-sm" variant="ghost" aria-label="New chat" disabled={busy || !!pending} onClick={() => setCurrent(null)}><Plus /></Button>
      {working && <Button size="sm" variant="outline" disabled={!online || busy} onClick={() => {
        if (!chat.conv?.session) return;
        setBusy(true); setError("");
        void macAsk("POST", `/v1/sessions/${chat.conv.session}/interrupt`).catch((e) => setError(message(e))).finally(() => setBusy(false));
      }}><Square />Stop</Button>}
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-label="Conversation messages">
      {turns.map((turn, i) => <Turn key={i} items={turn.items} live={!!working && i === turns.length - 1} waiting={!!front} page={label(project)} onGoAhead={() => {}} />)}
      {!turns.length && <p className="text-sm text-muted-foreground">{current ? "Loading conversation…" : "Ask an agent to work in this project on your Mac."}</p>}
      {(error || online && (pollError || chat.error)) && <p role="alert" className="break-words text-sm text-destructive-foreground">{error || pollError || chat.error}</p>}
    </div>
    {front && <div className="max-h-[45%] shrink-0 overflow-y-auto">
      {front.kind === "question" ? <QuestionCard request={front} answer={draft?.answer ?? {}} index={draft?.index ?? 0} busy={!online || !["pending", "failed"].includes(delivery)} onAnswer={(a, i, submit) => answer(key, front, a, i, submit)} /> : <ApprovalCard request={front} busy={!online || !["pending", "failed"].includes(delivery)} allowedChoices={["allow", "deny", "approve_each", "keep_planning"]} onChoose={(choice) => answer(key, front, { choice }, 0, true)} />}
      <div className="px-4 pb-2"><DeliveryLine delivery={delivery} error={chat.deliveries[front.id]?.error} onRetry={() => draft && answer(key, front, draft.answer, draft.index, true)} /></div>
    </div>}
    <form className="shrink-0 space-y-2 border-t p-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Field><FieldLabel className="sr-only">Message to agent</FieldLabel><Textarea aria-label="Message to agent" className="max-h-32" value={pending?.text ?? text} disabled={busy || !!pending} onChange={(e) => setText(e.target.value)} placeholder="Ask your Mac to…" /></Field>
      <div className="flex items-center gap-2">
        {!current && <Select value={agent} onValueChange={(value) => value && setAgent(value)} disabled={busy || !!pending}><SelectTrigger className="w-32 min-w-0 shrink" aria-label="Agent"><SelectValue>{agent === "codex" ? "Codex" : "Claude Code"}</SelectValue></SelectTrigger><SelectPopup><SelectItem value="claude">Claude Code</SelectItem><SelectItem value="codex">Codex</SelectItem></SelectPopup></Select>}
        <Button className="ml-auto shrink-0" type="submit" size="sm" disabled={busy || !online || !!front || !pending && !text.trim()}>{pending ? <RefreshCw /> : <Send />}{busy ? "Sending…" : pending ? "Check and retry" : "Send"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Approval required</p>
      {pending && !busy && <Button size="xs" variant="ghost" onClick={() => setDismiss(true)}>Dismiss saved request</Button>}
    </form>
    <ConfirmDialog open={dismiss} onOpenChange={setDismiss} title="Dismiss saved request?" description="Check the conversation on your Mac first. Dismissing does not stop an agent or undo a message. Sending these words again as a new request may repeat the work." confirm="Dismiss request" onConfirm={() => { if (pending) setText(pending.text); keep(null); setError(""); }} />
  </div>;
}
