import { ArrowLeft, Bot, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/views/settings/confirm";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { turnsOf } from "~/components/project-chat";
import { Turn } from "~/components/thread-view";
import { initMobileNotifications } from "~/lib/mobile-notifications";
import { createStore } from "~/lib/state";
import { useApprovalFeedback } from "~/lib/project-runtime/approval-feedback";
import { mobileAgents, mobileCall, refreshMobileAgents, useRemoteWork } from "~/lib/mobile-agents";
import { answer, chatOf, type Conversation, watch } from "~/lib/project-runtime/chat";
import { deliveryOf, mergeRequests, type RuntimeRequest } from "~/lib/project-runtime/requests";
import { editPage } from "~/lib/live";
import { pageOf } from "~/lib/space";
import { useCloud } from "~/lib/cloud";
import { useMobile } from "~/lib/platform";
import { locationOf } from "~/lib/project-runtime/folders";
import { RemoteComposer } from "~/components/remote-composer";

type Project = { name: string; path: string; missing?: boolean };
type Intent = { id: string; name: string; text: string; agent: string; model?: string; conversation?: string };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
const label = (p: Project) => p.path.split("/").filter(Boolean).at(-1) || p.name;

export type MobileAgentTarget = { connection: string; project: string; conversation: string; request: string; generation: number };
type TaskConnection = { host: string; name: string; project: string; conversation: string };
const taskConnection = (id?: string) => id ? pageOf(id)?.properties.remoteWork as TaskConnection | undefined : undefined;
type PageWork = { project: string; projectTitle: string; task?: { id: string; title: string } };
type Panel = { open: boolean; target: MobileAgentTarget | null; owner?: string; page?: PageWork };
const closed: Panel = { open: false, target: null };
const panel = createStore<Panel>(closed);
const clearTarget = () => panel.set({ ...panel.get(), target: null });
function connectionSettings() {
  panel.set(closed);
  window.dispatchEvent(new Event("leadinglight:cloud-account"));
}

export function MobileAgentsButton({ className, page, onOpen }: { className?: string; page?: PageWork; onOpen?: () => void } = {}) {
  const supported = useRemoteWork(), { user } = useCloud();
  if (!supported) return null;
  const host = taskConnection(page?.task?.id)?.name;
  return <Button aria-label={page ? `Remote work on ${page.task?.title || page.projectTitle}` : undefined} className={className} variant={page ? "ghost" : "outline"} size="sm" onClick={() => { onOpen?.(); panel.set({ open: true, target: null, owner: user?.id, page }); }}><Bot />{host ? `Work on ${host}` : "Remote work"}</Button>;
}

export function MobileAgentsHost() {
  const { open, target, owner, page } = panel.use();
  const mobile = useMobile(), { user } = useCloud();
  const active = open && (!owner || user?.id === owner);
  const state = mobileAgents.use();
  useEffect(() => {
    if (open && !active) panel.set(closed);
  }, [open, active]);
  useEffect(() => () => panel.set(closed), []);
  useEffect(() => {
    if (!mobile) return;
    const receive = (event: Event) => {
      const value = (event as CustomEvent<MobileAgentTarget>).detail;
      if (!value || value.connection !== mobileAgents.get().connection?.id || ![value.project, value.conversation, value.request].every((v) => typeof v === "string" && v.length) || !Number.isInteger(value.generation) || value.generation < 1) return;
      panel.set({ open: true, target: value, owner: user?.id });
    };
    window.addEventListener("leadinglight:mobile-agent-request", receive);
    void initMobileNotifications();
    return () => window.removeEventListener("leadinglight:mobile-agent-request", receive);
  }, [mobile, user?.id]);
  return <Dialog modal={false} open={active} onOpenChange={(next) => { if (!next) panel.set(closed); }}>
    <DialogPopup className="ll-mobile-agents ll-remote-work" bottomStickOnMobile={false}>
      <DialogHeader className="shrink-0 pr-12">
        <DialogTitle>{page?.task?.title || "Remote work"}</DialogTitle>
        <DialogDescription className="sr-only">Work runs on your Mac, including while this app is closed.</DialogDescription>
      </DialogHeader>
      {active && <MobileProjects page={page} key={`${state.connection?.id}:${page?.project || ""}:${page?.task?.id || ""}`} target={target?.connection === state.connection?.id ? target : null} />}
    </DialogPopup>
  </Dialog>;
}

function MobileProjects({ target, page }: { target: MobileAgentTarget | null; page?: PageWork }) {
  const state = mobileAgents.use();
  const [projects, setProjects] = useState<Project[]>([]);
  const required = page ? locationOf(page.project) : target?.project;
  const [listTarget, setListTarget] = useState<string>();
  const [selected, setSelected] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await refreshMobileAgents();
        const host = mobileAgents.get().connection;
        if (host && !done) {
          const reply = await mobileCall<Project[]>("GET", "/v1/locations", undefined, host.id);
          if (reply.status !== 200 || !Array.isArray(reply.body)) throw new Error("Could not check the shared folders on this Mac.");
          const list = reply.body.filter((p) => !required || p.name === required);
          if (!done) {
            setProjects(list);
            setListTarget(required);
            setSelected((p) => list.find((x) => !x.missing && x.name === (required ?? p?.name)) ?? (list.length === 1 && !list[0].missing ? list[0] : null));
          }
        }
        if (!done) setError("");
      } catch (e) { if (!done) setError(message(e)); }
      finally { if (!done) { setLoaded(true); timer = setTimeout(refresh, 5000); } }
    };
    void refresh();
    return () => { done = true; clearTimeout(timer); };
  }, [required]);
  if (!state.connection) return <div className="px-6 pb-6">{loaded && <Button variant="outline" onClick={()=>{if(page){panel.set(closed);void import("~/lib/device-links").then(m=>m.connectionPicker.set({project:page.project}))}else connectionSettings()}}>Connect a Mac</Button>}</div>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {!state.online && !selected && <p role="status" className="px-6 pb-3 text-sm text-muted-foreground">Mac unavailable. Check the internet connection and keep the Mac awake. Your drafts are kept.</p>}
    {target && listTarget !== target.project && !error && <p role="status" className="px-6 pb-3 text-sm text-muted-foreground">Opening the notified project…</p>}
    {target && listTarget === target.project && !projects.some((p) => p.name === target.project && !p.missing) && <p role="alert" className="px-6 pb-3 text-sm text-muted-foreground">This project is no longer shared by your Mac.</p>}
    {error && (!selected || target && listTarget !== target.project) && <p role="alert" className="px-6 pb-3 text-sm text-destructive-foreground">{error}</p>}
    {selected ? <>
      {(!required && projects.length > 1) && <div className="ll-mobile-agent-back px-3 pb-2"><Button size="sm" variant="ghost" onClick={() => { clearTarget(); setSelected(null); }}><ArrowLeft />Shared projects</Button></div>}
      <MobileProjectChat hostName={state.connection.name} page={page} key={selected.name} project={selected} host={state.connection.id} online={state.online} target={target?.project === selected.name ? target : null} />
    </> : <div className="space-y-2 overflow-y-auto p-6 pt-0">
      {projects.map((p) => <Button key={p.name} variant="outline" className="w-full justify-start" disabled={p.missing} onClick={() => { clearTarget(); setSelected(p); }}>{label(p)}{p.missing ? " · Folder unavailable" : ""}</Button>)}
      {!projects.length && <p className="text-sm text-muted-foreground">{loaded ? page ? `Link and share the folder for ${page.projectTitle} on ${state.connection.name}. Link the project folder on that Mac, then request it again from this project.` : "No shared projects. Open a linked project and request its Mac." : "Loading shared projects…"}</p>}
    </div>}
  </div>;
}

function MobileProjectChat({ project, host, hostName, page, online, target }: { page?: PageWork; hostName: string; project: Project; host: string; online: boolean; target: MobileAgentTarget | null }) {
  const mobile = useMobile();
  const task = page?.task;
  const taskSession = task && `mobile-task-${task.id}`;
  const binding = taskConnection(task?.id);
  const boundConversation = binding?.conversation;
  const namespace = `mobile:${host}:${project.name}${task ? `:${task.id}` : ""}`;
  const freshTaskDraft = useRef(!!task && !binding && localStorage.getItem(`${namespace}:draft`) === null);
  const [list, setList] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [current, setCurrent] = useState<string | null>(() => boundConversation || read(`${namespace}:chosen`, null));
  const [agent, setAgent] = useState("claude");
  const [model, setModel] = useState("");
  const [text, setText] = useState(() => read(`${namespace}:draft`, boundConversation ? "" : task?.title || ""));
  const [pending, setPending] = useState<Intent | null>(() => read(`${namespace}:pending`, null));
  const [dismiss, setDismiss] = useState(false);
  const [dismissFeedback, setDismissFeedback] = useState(false);
  const [checked, setChecked] = useState<{ target: MobileAgentTarget; available: boolean } | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checkAgain, setCheckAgain] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [restoreNotice, setRestoreNotice] = useState("");
  const key = `${namespace}:${current || "new"}`;
  const chat = chatOf(key).use();
  const feedback = useApprovalFeedback(key, chat.requests);
  const chatReady = !!chat.synced && chat.conv?.id === current;
  useEffect(() => {
    const restored = chatOf(key).get().restore;
    if (!restored) return;
    const next = text ? `${text}\n\n${restored.text}` : restored.text;
    try { localStorage.setItem(`${namespace}:draft`, JSON.stringify(next)); }
    catch { setError("Your answer is kept. Free device storage before restoring it to the message field."); return; }
    setText(next);
    setRestoreNotice(restored.why || "Your unsent answer is back in the message field.");
    chatOf(key).set({ ...chatOf(key).get(), restore: null });
  }, [key, chat.restore, namespace, text]);
  const blockedTarget = !!target && !!pending && pending.conversation !== target.conversation;
  const conv = list.find((c) => c.id === current) ?? null;
  const mounted = useRef(true);
  const messages = useRef<HTMLDivElement>(null);
  const request = useRef<HTMLDivElement>(null);
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
    return macAsk<Conversation[]>("GET", `/v1/conversations?location=${encodeURIComponent(project.name)}&limit=200`).then((all) => { sameHost(); setList(all);
      if (taskSession) {
        const own = all.find((c) => c.session === taskSession);
        if (own && !boundConversation) {
          setCurrent(own.id);
          if (freshTaskDraft.current) setText((draft) => draft === task?.title ? "" : draft);
        }
        freshTaskDraft.current = false;
      }
      setConversationsLoaded(true); return all; });
  };
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refresh(); if (!done) setPollError(""); } catch (e) { if (!done) setPollError(message(e)); } finally { if (!done) timer = setTimeout(poll, 5000); } };
    void poll();
    return () => { done = true; clearTimeout(timer); };
  }, [project.name]);
  useEffect(() => conv ? watch(key, conv, { pollHost: !mobile }) : undefined, [key, conv?.id, conv?.session, conv?.live, mobile]);
  useEffect(() => { if (target && !blockedTarget) setCurrent(target.conversation); }, [target, blockedTarget]);
  useEffect(() => {
    if (!target || blockedTarget || !conv || conv.id !== target.conversation) return;
    let done = false;
    setChecked(null); setCheckError("");
    void (conv.live && conv.session ? macAsk<RuntimeRequest[]>("GET", `/v1/sessions/${encodeURIComponent(conv.session)}/requests`) : Promise.resolve([])).then((requests) => {
      sameHost();
      if (done) return;
      const state = chatOf(key).get();
      const known = state.requests.map((r) => r.id === target.request && r.generation === target.generation && !requests.some((fresh) => fresh.id === r.id && fresh.generation === r.generation) ? { ...r, state: "expired" as const } : r);
      chatOf(key).set({ ...state, requests: mergeRequests(known, requests) });
      setChecked({ target, available: requests.some((r) => r.id === target.request && r.generation === target.generation && ["pending", "recorded"].includes(r.state)) });
    }).catch((e) => { if (!done) setCheckError(message(e)); });
    return () => { done = true; };
  }, [target, blockedTarget, key, conv?.id, conv?.session, conv?.live, checkAgain]);
  const waiting = chat.requests.find((r) => r.state === "pending" || r.state === "recorded");
  const targeted = !!target && !blockedTarget && current === target.conversation;
  const front = !chatReady ? undefined : targeted ? checked?.target === target && checked.available ? chat.requests.find((r) => r.id === target.request && r.generation === target.generation && ["pending", "recorded"].includes(r.state)) : undefined : waiting;
  const draft = front ? chat.answers[front.id] : undefined;
  const delivery = front ? chat.deliveries[front.id]?.delivery ?? deliveryOf(front, draft, false, false) : "pending";
  useEffect(() => { if (request.current) request.current.scrollTop = 0; }, [front?.id, delivery, error, pollError, chat.error, online]);
  useEffect(() => { if (messages.current) messages.current.scrollTop = 0; }, [error, pollError, chat.error, online]);
  const answerBusy = !online || !!draft?.sent || !["pending", "failed"].includes(delivery);
  const choose = (choice: string, text?: string, retry = false) => {
    if (!front || answerBusy && !retry) return;
    try {
      if (conv?.agent === "codex" && (text || feedback.value?.request === front.id)) {
        if (!draft?.command || !conv.session) throw new Error("Open this conversation again before sending feedback.");
        feedback.save(front.id, draft.command, conv.session, text ?? "", { replaceRefused: !draft.sent });
      }
      answer(key, front, { choice, ...(conv?.agent !== "codex" && text ? { message: text } : {}) }, 0, true);
    } catch (e) { setError(message(e)); }
  };
  const retryAnswer = () => {
    if (!front || !draft) return;
    if (front.kind !== "question" && !draft.sent) choose(draft.answer.choice ?? "", draft.answer.message ?? (feedback.value?.request === front.id ? feedback.value.text : undefined), true);
    else answer(key, front, draft.answer, draft.index, true);
  };
  const feedbackBlocked = chat.requests.some((r) => ["pending", "recorded"].includes(r.state) && !(feedback.confirmed && r.id === feedback.value?.request && r.command === feedback.value.command));
  const feedbackElsewhere = !!feedback.value && chat.requests.some((r) => r.id === feedback.value?.request && r.command && r.command !== feedback.value.command);
  const feedbackEnded = !!feedback.value && (!conv?.live || conv.session !== feedback.value.session || !!chat.session?.exited);
  const working = chat.session?.agent_state === "running" || chat.session?.agent_state === "waiting";
  const keep = (intent: Intent | null) => { localStorage.setItem(`${namespace}:pending`, JSON.stringify(intent)); if (mounted.current) setPending(intent); };
  const send = async () => {
    if (busy || !online || !conversationsLoaded || !!current && !chatReady || waiting || feedback.sending || (!pending && !text.trim())) return;
    const intent = pending ?? { id: crypto.randomUUID(), name: taskSession ?? `mobile-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, text: text.trim(), agent, model: model || undefined, conversation: current ?? undefined };
    keep(intent); setBusy(true); setError(""); setRestoreNotice("");
    try {
      const all = await refresh();
      sameHost();
      let target = all.find((c) => intent.conversation ? c.id === intent.conversation : c.session === intent.name);
      if (task && target && !intent.conversation && !pending) {
        keep(null);
        setCurrent(target.id);
        throw new Error("This task already has a conversation. Review it before sending your draft.");
      }
      if (!intent.conversation && !target) {
        const result = await macCall("POST", "/v1/sessions", { name: intent.name, location: project.name, agent: intent.agent, driver: intent.agent, model: intent.model, prompt: intent.text, title: intent.text.split("\n")[0].slice(0, 200) });
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
      if (target && task && (!boundConversation || binding?.host !== host)) {
        const remoteWork = { host, name: hostName, project: project.name, conversation: target.id };
        await editPage(task.id, { properties: (props) => ({ ...props, remoteWork }) });
      }
      keep(null);
      if (mounted.current && target) { setCurrent(target.id); setText(""); await refresh(); }
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const turns = turnsOf(chat);
  const savedFeedback = feedback.value && <div className="space-y-2 py-3" role="group" aria-label="Saved feedback">
    <p className="text-sm font-medium">Feedback for Codex</p>
    <p className="whitespace-pre-wrap break-words text-sm">{feedback.value.text}</p>
    {feedbackElsewhere ? <p className="text-sm text-muted-foreground">Another device answered this request. Your feedback is saved for you to review.</p> : feedbackEnded && conversationsLoaded ? <p className="text-sm text-muted-foreground">This agent session ended. Your feedback is saved. Review it before sending it in the current conversation.</p> : !feedback.confirmed && <p className="text-sm text-muted-foreground">Your feedback stays saved until your decline is confirmed.</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!online || !chatReady || feedbackEnded || !feedback.confirmed || feedback.sending || !!pending || feedbackBlocked} onClick={() => { setError(""); void feedback.send(macCall).catch((e) => setError(message(e))); }}>{feedback.sending ? "Sending feedback…" : feedback.value.attempted ? "Retry feedback" : "Send feedback"}</Button><Button size="sm" variant="ghost" disabled={feedback.sending} onClick={() => setDismissFeedback(true)}>Dismiss feedback</Button></div>
  </div>;
  const notice = <>
      {restoreNotice && <p role="status" className="text-sm text-muted-foreground">{restoreNotice}</p>}
      {blockedTarget && <p role="status" className="text-sm text-muted-foreground">Check or dismiss your saved message before opening the notified conversation.</p>}
      {targeted && conversationsLoaded && !conv && !pollError && <p role="status" className="text-sm text-muted-foreground">This conversation is no longer available.</p>}
      {targeted && conv && !front && <p role="status" className="text-sm text-muted-foreground">{checked?.target === target && chatReady ? "This request was already handled." : checkError || "Checking this request…"} <Button size="sm" variant="ghost" onClick={() => checkError ? setCheckAgain(checkAgain + 1) : clearTarget()}>{checkError ? "Check request" : "See current requests"}</Button></p>}
      {!online && <p role="status" className="text-sm text-muted-foreground">Mac unavailable. Check the internet connection and keep the Mac awake. Your drafts are kept.</p>}
      {(error || online && (pollError || chat.error)) && <p role="alert" className="break-words text-sm text-destructive-foreground">{error || pollError || chat.error}</p>}
  </>;
  if (binding && conversationsLoaded && !list.some((c) => c.id === binding.conversation && c.location === binding.project)) {
    return <p role="status" className="px-4 pb-4 text-sm">This task’s conversation is unavailable here. Open its shared project on {binding.name || "the original Mac"} to continue.</p>;
  }
  return <div className="ll-mobile-agent-chat flex min-h-0 min-w-0 flex-1 flex-col" data-testid="mobile-agent-chat" data-request={!!front || undefined}>
    {((!task && list.length > 0) || working) && <div className="ll-mobile-agent-toolbar flex shrink-0 items-center gap-2 border-y px-4 py-2">
      {!task && <Select value={current || "new"} onValueChange={(value) => { clearTarget(); setCurrent(value === "new" ? null : value); }} disabled={busy || !!pending}>
        <SelectTrigger className="min-w-0 flex-1" aria-label="Conversation"><SelectValue placeholder="New chat">{conv?.title || "New chat"}</SelectValue></SelectTrigger>
        <SelectPopup><SelectItem value="new">New chat</SelectItem>{list.map((c) => <SelectItem key={c.id} value={c.id}>{c.title || c.agent}</SelectItem>)}</SelectPopup>
      </Select>}
      {working && <Button className="ll-mobile-agent-stop" size="sm" variant="outline" disabled={!online || busy} onClick={() => {
        if (!chat.conv?.session) return;
        setBusy(true); setError("");
        void macAsk("POST", `/v1/sessions/${chat.conv.session}/interrupt`).catch((e) => setError(message(e))).finally(() => setBusy(false));
      }}><Square />Stop</Button>}
      {!waiting && working && <span role="status" className="text-xs text-muted-foreground">Working</span>}
    </div>}
    <div ref={messages} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-label="Conversation messages">
      {!front && <>{notice}{savedFeedback}</>}
      {turns.map((turn, i) => <Turn key={i} items={turn.items} live={!!working && i === turns.length - 1} waiting={!!front} page={label(project)} onGoAhead={() => {}} />)}
      {!turns.length && current && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
    </div>
    {front && <div ref={request} className="ll-mobile-agent-request min-h-0 max-h-[45%] shrink-0 overflow-y-auto">
      <div className="px-4 pb-2"><DeliveryLine delivery={delivery} error={chat.deliveries[front.id]?.error} onRetry={retryAnswer} /></div>
      <div className="px-4">{notice}{savedFeedback}</div>
      {front.kind === "question" ? <QuestionCard request={front} answer={draft?.answer ?? {}} index={draft?.index ?? 0} busy={answerBusy} onAnswer={(a, i, submit) => answer(key, front, a, i, submit)} /> : <ApprovalCard request={front} busy={answerBusy} allowedChoices={["allow", "deny", "approve_each", "keep_planning"]} feedback={{ value: draft?.answer.message ?? (feedback.value?.request === front.id ? feedback.value.text : ""), onChange: (message) => answer(key, front, { ...draft?.answer, message }, 0, false), separate: conv?.agent === "codex" }} onChoose={choose} />}
    </div>}
    <div className="ll-remote-footer shrink-0 px-3 pb-3">
      <p className="mb-1 truncate text-xs text-muted-foreground">{hostName} · {page?.projectTitle || label(project)}{!online ? " · Offline" : waiting ? " · Needs review" : ""}</p>
      {!waiting && (!current || chatReady) && <RemoteComposer text={pending?.text ?? text} onText={setText} onSend={send} pending={!!pending} busy={busy}
        ready={online && conversationsLoaded && (!current || chatReady) && !feedback.sending}
        agent={conv?.agent || agent} model={conv?.model || model} started={!!current} onAgent={(value) => { setAgent(value); setModel(""); }} onModel={setModel} />}
      {pending && !busy && <Button size="xs" variant="ghost" onClick={() => setDismiss(true)}>Dismiss saved request</Button>}
    </div>
    <ConfirmDialog open={dismissFeedback} onOpenChange={setDismissFeedback} title="Dismiss saved feedback?" description={<span className="ll-mobile-agent-dismiss">{feedback.value?.attempted ? "The Mac may have received this feedback. Check the conversation before dismissing; sending the same words again may repeat them." : "This removes the saved feedback. Your decision on the request stays unchanged."}</span>} confirm="Dismiss feedback" onConfirm={feedback.dismiss} />
    <ConfirmDialog open={dismiss} onOpenChange={setDismiss} title="Dismiss saved request?" description={<span className="ll-mobile-agent-dismiss">Check the conversation on your Mac first. Dismissing does not stop an agent or undo a message. Sending these words again as a new request may repeat the work.</span>} confirm="Dismiss request" onConfirm={() => { if (pending) setText(pending.text); keep(null); setError(""); }} />
  </div>;
}
