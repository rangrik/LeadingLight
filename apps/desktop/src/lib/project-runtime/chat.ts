import { type Access, type AiPrefs, isClaude } from "~/lib/ai-prefs";
import { folders, refresh as refreshFolders } from "~/lib/project-runtime/folders";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { type Answer, type Delivery, type Draft, mergeRequests, reconcile, restoreDraft, type RuntimeRequest, sendAnswer } from "~/lib/project-runtime/requests";
import { acceptMessageSubmission, beginMessageSubmission, getActiveMessageSubmissions, type MessageSubmissionRecord, observeMessageSubmissionCanonical, rejectMessageSubmission } from "~/lib/project-runtime/submission";
import { emptyWindow, merge, type TranscriptPage, type Window } from "~/lib/project-runtime/transcript";
import { ask, call, type RuntimeEvent } from "~/lib/project-runtime/transport";
import { createStore } from "~/lib/state";

// A project's chats (features/project-chat.feature): conversations the runtime keeps, working in
// the page's folder. A chat is its conversation ID, which outlives the agent sessions it runs
// in; the runtime holds its record, so this keeps only what is on screen. Kept outside React, so
// a chat keeps up while another page is in front.

export type Conversation = { id: string; agent: string; location?: string; dir: string; session?: string; live?: boolean; mode?: string; model?: string; effort?: string; title?: string; created: string; updated?: string };
export type Session = { name: string; agent_state?: string; exited?: boolean; driver?: string };
export type Turn = { n: number; state: string; started?: string; ended?: string; origin?: string };
// An answer being written, and how far it has got (features/agent-interactions.feature).
export type AnswerDraft = Draft & { index: number; sent?: boolean };
export type Chat = {
  conv: Conversation | null;
  session: Session | null;
  window: Window;
  draft: string;
  turns: Turn[];
  // Messages sent and not yet in the record (Paseo's submission model), with their words.
  submissions: MessageSubmissionRecord[];
  texts: Record<string, string>;
  requests: RuntimeRequest[];
  answers: Record<string, AnswerDraft>;
  deliveries: Record<string, { delivery: Delivery; error?: string }>;
  // Words given back to the composer: a message not sent, or an answer that can't go now, and why.
  restore: { text: string; at: number; why?: string } | null;
  error: string | null;
};

const blank = (): Chat => ({ conv: null, session: null, window: emptyWindow, draft: "", turns: [], submissions: [], texts: {}, requests: [], answers: {}, deliveries: {}, restore: null, error: null });
const chats = new Map<string, ReturnType<typeof createStore<Chat>>>();
export const chatOf = (key: string) => {
  let s = chats.get(key);
  if (!s) chats.set(key, (s = createStore(blank())));
  return s;
};
const patch = (key: string, p: Partial<Chat>) => chatOf(key).set({ ...chatOf(key).get(), ...p });
// A new chat takes its own key once the runtime names it; the new-chat key starts afresh.
export function adopt(from: string, to: string) {
  chatOf(to).set(chatOf(from).get());
  chatOf(from).set(blank());
}

export const listChats = (location: string) => ask<Conversation[]>("GET", `/v1/conversations?location=${encodeURIComponent(location)}&limit=200`);

// A chat runs Claude Code, or Codex for a GPT model.
export type Agent = "claude" | "codex";
export const agentOf = (model: string): Agent => (isClaude(model) ? "claude" : "codex");
// Access as each agent's permission mode. Codex's untrusted asks before each command; its default
// works freely inside the folder and asks before leaving it.
const MODES: Record<Agent, Record<Access, string>> = { claude: { ask: "default", auto: "auto", full: "bypassPermissions" }, codex: { ask: "untrusted", auto: "default", full: "bypassPermissions" } };
export const modeFor = (p: Pick<AiPrefs, "access" | "plan">, agent: Agent) => (p.plan ? "plan" : MODES[agent][p.access]);
export const accessOf = (mode: string | undefined, agent: Agent) => ({
  access: ((Object.keys(MODES[agent]) as Access[]).find((a) => MODES[agent][a] === mode) ?? "ask") as Access,
  plan: mode === "plan",
});

// A message's files go with it as their paths, which is how agents take them; the runtime keeps
// them with the conversation, out of the folder.
const ATTACHED = "\n\nAttached:\n";
export const splitAttached = (text: string) => {
  const [said, list] = text.split(ATTACHED);
  return { said, files: list ? list.split("\n").filter(Boolean) : [] };
};
const base64 = async (f: File) => {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const upload = (session: string, files: File[]) => Promise.all(files.map(async (f) => (await ask<{ path: string }>("POST", `/v1/sessions/${session}/attachments`, { name: f.name, data: await base64(f) })).path));

// Answers being written are kept on this Mac by conversation, so a reload keeps them.
const answersKey = (conv: string) => `ll.answers.${conv}`;
const loadAnswers = (conv: string): Record<string, AnswerDraft> => {
  try {
    return JSON.parse(localStorage.getItem(answersKey(conv)) ?? "{}");
  } catch {
    return {};
  }
};
const saveAnswers = (conv: string, answers: Record<string, AnswerDraft>) => localStorage.setItem(answersKey(conv), JSON.stringify(answers));

// The chat as the runtime has it now: its session, record, turns and requests.
export async function sync(key: string, conv: Conversation): Promise<void> {
  const name = conv.session;
  const sessions = await ask<Session[]>("GET", "/v1/sessions");
  const session = sessions.find((s) => s.name === name) ?? null;
  const before = chatOf(key).get();
  const w = before.window;
  const page = name ? await ask<TranscriptPage>("GET", `/v1/sessions/${name}/transcript?since=${w.next}${w.gen ? `&gen=${w.gen}` : ""}`).catch(() => null) : null;
  const turns = session ? await ask<Turn[]>("GET", `/v1/sessions/${name}/turns`).catch(() => []) : [];
  const fresh = session ? await ask<RuntimeRequest[]>("GET", `/v1/sessions/${name}/requests`).catch(() => []) : [];
  // The session's own mode: approving a plan changes it without the conversation's record.
  const controls = session && !session.exited ? await ask<{ mode?: string }>("GET", `/v1/sessions/${name}/controls`).catch(() => null) : null;
  const window = page && page.source !== "none" ? merge(w, page) : w;
  // A sent message is sending until the record has it.
  const added = window.items.filter((i) => i.kind === "user" && !w.items.some((o) => o.id === i.id)).map((i) => splitAttached(i.text ?? "").said.trim());
  const seen = Object.entries(before.texts).filter(([, text]) => added.includes(text.trim())).map(([id]) => id);
  const now = chatOf(key).get();
  // A session gone or ended can't take what its agent asked; the runtime would refuse it too.
  const ended = !session || session.exited;
  const requests = mergeRequests(now.requests, fresh ?? []).map((r) => (ended && (r.state === "pending" || r.state === "recorded") ? { ...r, state: "expired" as const } : r));
  // The reply being written stays until a read brings its words (the record can lag the turn's
  // end), at most a few seconds, so it never blinks out.
  const running = session?.agent_state === "running";
  const keep = !!now.draft && !inRecord(window, now.draft) && (running || Date.now() - (kept.get(key) ?? Date.now()) < 3000);
  if (keep && !running && !kept.has(key)) kept.set(key, Date.now());
  if (!keep || running) kept.delete(key);
  if (keep && !running) setTimeout(() => void sync(key, conv).catch(() => {}), 400);
  const draft = keep ? now.draft : "";
  // A mode set while this read was out is newer than both the conversation and the session's.
  const changed = watching.get(key)?.conv.id === conv.id && watching.get(key)!.conv !== conv;
  const latest = changed ? watching.get(key)!.conv : { ...conv, mode: controls?.mode ?? conv.mode };
  patch(key, { conv: latest, session, window, turns, requests, draft, submissions: observeMessageSubmissionCanonical(now.submissions, seen), answers: Object.keys(now.answers).length ? now.answers : loadAnswers(conv.id) });
  settleAnswers(key);
}

// What became of answers whose requests settled, or whose reply was lost (a reload).
function settleAnswers(key: string) {
  const c = chatOf(key).get();
  if (!c.conv) return;
  const answers = { ...c.answers };
  let restore = c.restore;
  for (const r of c.requests) {
    const a = answers[r.id];
    if (!a) continue;
    if (r.state === "resolved" || (r.command && r.command !== a.command)) delete answers[r.id];
    else if (r.state === "cancelled" || r.state === "expired") {
      // Nothing typed is lost: back to the composer.
      const text = restoreDraft(a);
      if (text && !(r.command && r.command === a.command)) restore = { text, at: Date.now(), why: "The agent stopped before you answered, so your answer is back here." };
      delete answers[r.id];
    } else if (a.sent && r.state === "pending" && !r.command && !c.deliveries[r.id]) void deliver(key, r, true);
  }
  saveAnswers(c.conv.id, answers);
  patch(key, { answers, restore });
}

const kept = new Map<string, number>();
// The record has the words being written once its last turn has a text starting as they do.
export const inRecord = (w: Window, draft: string) =>
  w.items.slice(w.items.map((i) => i.kind).lastIndexOf("user") + 1).some((i) => i.kind === "text" && (i.text ?? "").trim().startsWith(draft.trim().slice(0, 60)));

// The runtime says what changed; the chat on screen reads it again. Followed only while a chat
// is on screen.
const watching = new Map<string, { key: string; conv: Conversation }>();
let unlisten: (() => void) | null = null;
const heard = (e: RuntimeEvent) => {
  const name = (e.data?.session ?? e.data?.name) as string | undefined;
  for (const { key, conv } of watching.values())
    if (e.type === "runtime.connected" || (name && name === conv.session)) void sync(key, conv).catch((err) => patch(key, { error: String(err.message ?? err) }));
};

// Follows a chat while it is on screen: its changes, and the reply being written.
export function watch(key: string, conv: Conversation): () => void {
  watching.set(key, { key, conv });
  unlisten ??= onRuntimeEvent(heard);
  void sync(key, conv).catch((err) => patch(key, { error: String(err.message ?? err) }));
  const poll = window.setInterval(async () => {
    const c = chatOf(key).get();
    if (c.session?.agent_state !== "running" || !c.conv?.session) return;
    const d = await ask<{ text?: string }>("GET", `/v1/sessions/${c.conv.session}/draft`).catch(() => null);
    // An agent clears its draft as a message ends, before the record has it: the words stay till then.
    if (d?.text && d.text !== c.draft) patch(key, { draft: d.text });
  }, 250);
  return () => {
    watching.delete(key);
    window.clearInterval(poll);
    if (!watching.size) {
      unlisten?.();
      unlisten = null;
    }
  };
}

// Sends text: a new chat starts its agent in the folder; an ended one is resumed first. Each
// message carries a key of its own, so a send repeated after a lost answer is one message.
export async function send(key: string, location: string, text: string, prefs: Pick<AiPrefs, "model" | "effort" | "access" | "plan">, files: File[] = []): Promise<Conversation> {
  const id = crypto.randomUUID();
  const c0 = chatOf(key).get();
  patch(key, { submissions: beginMessageSubmission(c0.submissions, { clientMessageId: id }), texts: { ...c0.texts, [id]: text }, restore: null, error: null });
  try {
    // A folder gone since the page opened: no agent starts, in its place or anywhere else.
    await refreshFolders();
    if ([...folders.get().values()].some((f) => f.folder.location === location && f.missing)) throw new Error("The folder isn't there any more.");
    let conv = chatOf(key).get().conv;
    const full = async (session: string) => (files.length ? `${text}${ATTACHED}${(await upload(session, files)).join("\n")}` : text);
    if (!conv) {
      const name = `chat-${crypto.randomUUID().slice(0, 8)}`;
      const agent = agentOf(prefs.model);
      // With files the agent starts without a prompt, so they are there before the message naming them.
      await ask("POST", "/v1/sessions", { name, location, agent, driver: agent, mode: modeFor(prefs, agent), model: prefs.model, effort: prefs.effort, title: text.split("\n")[0], ...(!files.length && { prompt: text }) });
      conv = (await listChats(location)).find((c) => c.session === name) ?? null;
      if (!conv) throw new Error("The runtime didn't keep the chat.");
      if (files.length) await ask("POST", `/v1/sessions/${name}/send`, { text: await full(name), when: "now", idem_key: id });
    } else {
      // The list can be behind: a session gone or ended since is resumed too.
      const s0 = chatOf(key).get().session;
      if (!conv.live || !s0 || s0.exited) {
        const s = await ask<Session>("POST", `/v1/conversations/${conv.id}/resume`, {});
        conv = { ...conv, session: s.name, live: true };
      }
      await ask("POST", `/v1/sessions/${conv.session}/send`, { text: await full(conv.session ?? ""), when: "now", idem_key: id });
    }
    patch(key, { conv, submissions: acceptMessageSubmission(chatOf(key).get().submissions, id) });
    if (watching.has(key)) watching.set(key, { key, conv });
    await sync(key, conv);
    return conv;
  } catch (err) {
    // Not taken: the words go back to the composer. Taken already: nothing to take back.
    const { outcome, submissions } = rejectMessageSubmission(chatOf(key).get().submissions, id);
    patch(key, { submissions, ...(outcome === "rejected" && { restore: { text, at: Date.now() }, error: err instanceof Error ? err.message : String(err) }) });
    throw err;
  }
}

// The messages still sending, by their words.
export const sending = (c: Chat) => getActiveMessageSubmissions(c.submissions).map((s) => c.texts[s.clientMessageId] ?? "");

// Keeps the person's answer to a request as it is written; with submit, sends it.
export function answer(key: string, r: RuntimeRequest, value: Answer, index: number, submit: boolean) {
  const c = chatOf(key).get();
  if (!c.conv) return;
  const prev = c.answers[r.id];
  const draft: AnswerDraft = { command: prev?.command ?? crypto.randomUUID(), answer: value, questions: r.questions, index, sent: prev?.sent || submit };
  const answers = { ...c.answers, [r.id]: draft };
  saveAnswers(c.conv.id, answers);
  patch(key, { answers });
  if (submit) void deliver(key, r, false);
}

// Sends a request's kept answer once; again only after its outcome is known.
async function deliver(key: string, r: RuntimeRequest, again: boolean) {
  const c = chatOf(key).get();
  const draft = c.answers[r.id];
  const session = c.conv?.session;
  if (!draft || !session || c.deliveries[r.id]?.delivery === "sending") return;
  const set = (delivery: Delivery, error?: string) => patch(key, { deliveries: { ...chatOf(key).get().deliveries, [r.id]: { delivery, error } } });
  set("sending");
  const outcome = again ? await reconcile(call, session, r, draft) : await sendAnswer(call, session, r, draft);
  if (outcome.request) patch(key, { requests: mergeRequests(chatOf(key).get().requests, [outcome.request]) });
  set(outcome.delivery, outcome.error);
  // A known refusal: the next try is a new command. A lost reply: asked again shortly.
  if (outcome.delivery === "failed") {
    const answers = { ...chatOf(key).get().answers, [r.id]: { ...draft, command: crypto.randomUUID(), sent: false } };
    patch(key, { answers });
  } else if (outcome.delivery === "sending") window.setTimeout(() => (set("pending"), void deliver(key, r, true)), 1500);
  settleAnswers(key);
}

// Access, Plan mode, model and effort, changed in a started chat: its agent takes them from its
// next step, and the chat keeps them.
async function change(key: string, route: "mode" | "model", next: Partial<Conversation>): Promise<void> {
  const c = chatOf(key).get();
  if (!c.conv?.session || !c.session || c.session.exited) return;
  await ask("POST", `/v1/sessions/${c.conv.session}/${route}`, next);
  const conv = { ...c.conv, ...next };
  if (watching.has(key)) watching.set(key, { key, conv });
  patch(key, { conv });
}
export const setMode = (key: string, mode: string) => change(key, "mode", { mode });
export const setModel = (key: string, model: string, effort: string) => change(key, "model", { model, effort });

export async function stop(key: string): Promise<void> {
  const name = chatOf(key).get().conv?.session;
  if (name) await ask("POST", `/v1/sessions/${name}/interrupt`).catch((err) => patch(key, { error: String(err.message ?? err) }));
}

