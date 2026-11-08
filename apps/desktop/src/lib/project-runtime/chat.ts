import { type Access, type AiPrefs, isClaude } from "~/lib/ai-prefs";
import { annotationImageName, appendBrowserContext, stripBrowserContext, type BrowserImageReference } from "~/lib/browser-context";
import { folders, refresh as refreshFolders } from "~/lib/project-runtime/folders";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { type Answer, type Delivery, type Draft, mergeRequests, reconcile, restoreDraft, type RuntimeRequest, sendAnswer } from "~/lib/project-runtime/requests";
import { acceptMessageSubmission, beginMessageSubmission, getActiveMessageSubmissions, type MessageSubmissionRecord, observeMessageSubmissionCanonical, rejectMessageSubmission } from "~/lib/project-runtime/submission";
import { emptyWindow, merge, said, type TranscriptPage, type Window } from "~/lib/project-runtime/transcript";
import { ask, call, type RuntimeEvent } from "~/lib/project-runtime/transport";
import { createStore } from "~/lib/state";
import { mobileCall } from "~/lib/mobile-agents";

// A project's chats (features/project-chat.feature): conversations the runtime keeps, working in
// the page's folder. A chat is its conversation ID, which outlives the agent sessions it runs
// in; the runtime holds its record, so this keeps only what is on screen. Kept outside React, so
// a chat keeps up while another page is in front.

export type Conversation = { id: string; agent: string; location?: string; dir: string; session?: string; live?: boolean; mode?: string; model?: string; effort?: string; title?: string; by?: string; created: string; updated?: string };
export type Session = { name: string; agent_state?: string; state_since?: string; exited?: boolean; driver?: string; agent?: string; created?: string; queued?: number };
export type Turn = { n: number; state: string; started?: string; ended?: string; origin?: string };
// A message the runtime holds until the agent is idle (slice 12): the start of its words.
export type Queued = { turn: string; preview: string; length: number; at: string; typed?: boolean };
// One typed into the running turn (Send now, ⌘↩): on its way until the agent reads it.
export type Steered = { id: string; text: string; at: number };
// A file an agent wrote, kept by the runtime as that write left it (slice 7).
export type Output = { id: string; path: string; tool: string; at: number; size: number; kept: boolean; missing?: boolean };
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
  outputs: Output[];
  // Messages held for after the agent's turn, oldest first; and ones sent into it, not yet read.
  queued: Queued[];
  steered: Steered[];
  // Workers and runs its agent started and still waits on, and every session's state (theirs among them).
  workers: string[];
  runs: string[];
  sessions: Session[];
  answers: Record<string, AnswerDraft>;
  deliveries: Record<string, { delivery: Delivery; error?: string }>;
  // Read from the runtime at least once since it opened.
  synced?: boolean;
  // Words given back to the composer: a message not sent, or an answer that can't go now, and why.
  restore: { text: string; at: number; why?: string } | null;
  error: string | null;
};

const blank = (): Chat => ({ conv: null, session: null, window: emptyWindow, draft: "", turns: [], submissions: [], texts: {}, requests: [], outputs: [], queued: [], steered: [], workers: [], runs: [], sessions: [], answers: {}, deliveries: {}, restore: null, error: null });
const restoreKey = (key: string) => `ll.restore.${key}`;
const loadRestore = (key: string): Chat["restore"] => {
  try {
    const value = JSON.parse(localStorage.getItem(restoreKey(key)) ?? "null");
    return value && typeof value.text === "string" && typeof value.at === "number" ? value : null;
  } catch { return null; }
};
const chats = new Map<string, ReturnType<typeof createStore<Chat>>>();
export const chatOf = (key: string) => {
  let s = chats.get(key);
  if (!s) {
    const mobile = key.startsWith("mobile:");
    const initial = blank();
    if (mobile) initial.restore = loadRestore(key);
    s = createStore(initial);
    if (mobile) {
      const store = s, set = store.set;
      store.set = (next) => {
        if (next.restore !== store.get().restore) {
          if (next.restore) localStorage.setItem(restoreKey(key), JSON.stringify(next.restore));
          else localStorage.removeItem(restoreKey(key));
        }
        set(next);
      };
    }
    chats.set(key, s);
  }
  return s;
};
const patch = (key: string, p: Partial<Chat>) => chatOf(key).set({ ...chatOf(key).get(), ...p });
const callIn: (key: string, ...args: Parameters<typeof call>) => ReturnType<typeof call> = (key, method, path, body) => key.startsWith("mobile:") ? mobileCall(method, path, body, key.split(":")[1]) : call(method, path, body);
async function askIn<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await callIn(key, method, path, body);
  if (response.status >= 400) throw new Error((response.body as { error?: string })?.error || `The runtime answered ${response.status}`);
  return response.body as T;
}
// A new chat takes its own key once the runtime names it; the new-chat key starts afresh. A send
// that waited on the new-chat key follows it, and its own end adopts nothing again: the new-chat
// key is blank by then.
const adopted = new Map<string, string>();
export function adopt(from: string, to: string) {
  if (adopted.get(from) === to) return;
  chatOf(to).set(chatOf(from).get());
  chatOf(from).set(blank());
  adopted.set(from, to);
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
  const [said, list] = stripBrowserContext(text).split(ATTACHED);
  return { said, files: list ? list.split("\n").filter(Boolean) : [] };
};
const base64 = async (f: File) => {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const upload = (session: string, files: File[]) => Promise.all(files.map(async (f) => (await ask<{ path: string }>("POST", `/v1/sessions/${session}/attachments`, { name: f.name, data: await base64(f) })).path));
async function uploadBrowserImages(session: string, images: BrowserImageReference[]) {
  const paths: string[] = [];
  for (const image of images.slice(0, 20)) {
    if (!annotationImageName(image.name) || !image.route.startsWith("/v1/worktrees/") || !image.route.includes(`/browser/shots/${image.name}/data?tab=`)) throw new Error("The browser comment has an invalid screenshot.");
    const file = await ask<{ name: string; mime: string; data: string }>("GET", image.route).catch(() => { throw new Error("A comment screenshot is no longer available. Remove that comment and select the page again before sending."); });
    if (file.name !== image.name || file.mime !== "image/png" || file.data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 || !file.data.startsWith("iVBORw0KGgo")) throw new Error("A comment screenshot is invalid or larger than 20 MB.");
    paths.push((await ask<{ path: string }>("POST", `/v1/sessions/${session}/attachments`, { name: image.name, data: file.data })).path);
  }
  return paths;
}

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
const mobileSyncs = new Map<string, Promise<void>>();
export function sync(key: string, conv: Conversation): Promise<void> {
  if (!key.startsWith("mobile:")) return syncChat(key, conv);
  const pending = mobileSyncs.get(key);
  if (pending) return pending;
  const work = syncChat(key, conv).finally(() => mobileSyncs.delete(key));
  mobileSyncs.set(key, work);
  return work;
}
async function syncChat(key: string, conv: Conversation): Promise<void> {
  const ask = <T,>(method: string, path: string, body?: unknown) => askIn<T>(key, method, path, body);
  const name = conv.session;
  const at0 = Date.now();
  const sessions = await ask<Session[]>("GET", "/v1/sessions");
  const session = sessions.find((s) => s.name === name) ?? null;
  const before = chatOf(key).get();
  const w = before.window;
  const cursor = `since=${w.next}${w.gen ? `&gen=${encodeURIComponent(w.gen)}` : ""}`;
  let page = session && name ? await ask<TranscriptPage>("GET", `/v1/sessions/${name}/transcript?${cursor}`).catch(() => null) : null;
  // The saved record outlives its session. Reading history never resumes an
  // agent or sends a model prompt, including after an app/runtime restart.
  if (!page || page.source === "none") page = await ask<TranscriptPage>("GET", `/v1/conversations/${encodeURIComponent(conv.id)}/transcript?${cursor}`);
  const turns = session ? await ask<Turn[]>("GET", `/v1/sessions/${name}/turns`).catch(() => []) : [];
  const fresh = session ? await ask<RuntimeRequest[]>("GET", `/v1/sessions/${name}/requests`).catch(() => []) : [];
  // The workers its agent started and hasn't heard back from yet.
  const watches = name && !key.startsWith("mobile:") ? await ask<{ parent: string; kind?: string; session?: string; run?: string }[]>("GET", "/v1/notify").catch(() => null) : null;
  // What its agents wrote, kept with the conversation; there with no session too.
  const outputs = key.startsWith("mobile:") ? [] : await ask<Output[]>("GET", `/v1/conversations/${conv.id}/outputs`).catch(() => null);
  // The session's own mode: approving a plan changes it without the conversation's record.
  const controls = session && !session.exited ? await ask<{ mode?: string }>("GET", `/v1/sessions/${name}/controls`).catch(() => null) : null;
  // What the runtime holds for after its turn; read only while one side says it holds something.
  const queued = !session || session.exited ? [] : session.queued || chatOf(key).get().queued.length ? await ask<Queued[] | null>("GET", `/v1/sessions/${name}/queue`).catch(() => null) : null;
  const window = page && page.source !== "none" ? merge(w, page) : w;
  // A sent message is sending until the record has it.
  const plain = (s: string) => s.replace(/\s+/g, " ").trim();
  const added = window.items.filter((i) => said(i) !== null && !w.items.some((o) => o.id === i.id)).map((i) => plain(splitAttached(said(i) ?? "").said));
  const seen = Object.entries(before.texts).filter(([, text]) => added.includes(plain(text))).map(([id]) => id);
  const now = chatOf(key).get();
  // A session gone or ended can't take what its agent asked; the runtime would refuse it too.
  const ended = !session || session.exited;
  const requests = mergeRequests(now.requests, fresh ?? []).map((r) => (ended && (r.state === "pending" || r.state === "recorded") ? { ...r, state: "expired" as const } : r));
  // The reply being written stays until a read brings its words (the record can lag the turn's
  // end), at most a few seconds, so it never blinks out.
  const running = session?.agent_state === "running";
  // A message sent into the turn is read once the record has it; the turn ending reads it or not.
  // A message is known by its words, or by its preview: the runtime's ends a long one with "…".
  const head = (s: string) => plain(s.replace(/…$/, ""));
  const steered = now.steered.filter((s) => running && !added.some((a) => a.startsWith(head(s.text))));
  // One held while this read was out isn't in its list yet: it stays until the next read. One typed
  // at the turn's end (gone from the list, its turn not over: the turns were read first, so they can
  // still say queued) stays, as sent, until the record has it, so it never blinks out between.
  const typed = (q: Queued) => turns.some((t) => `${name}#${t.n}` === q.turn && (t.state === "queued" || t.state === "pending" || t.state === "running")) && !window.items.some((i) => plain(splitAttached(said(i) ?? "").said).startsWith(head(q.preview)));
  const held = queued ? [...queued, ...now.queued.filter((q) => !queued.some((x) => x.turn === q.turn)).flatMap((q) => (Date.parse(q.at) >= at0 - 500 ? [q] : typed(q) ? [{ ...q, typed: true }] : []))] : now.queued;
  const keep = !!now.draft && !inRecord(window, now.draft) && (running || Date.now() - (kept.get(key) ?? Date.now()) < 3000);
  if (keep && !running && !kept.has(key)) kept.set(key, Date.now());
  if (!keep || running) kept.delete(key);
  if (keep && !running) setTimeout(() => void sync(key, conv).catch(() => {}), 400);
  const draft = keep ? now.draft : "";
  // A mode set while this read was out is newer than both the conversation and the session's.
  const changed = watching.get(key)?.conv.id === conv.id && watching.get(key)!.conv !== conv;
  const latest = changed ? watching.get(key)!.conv : { ...conv, mode: controls?.mode ?? conv.mode };
  const mine = (watches ?? []).filter((x) => x.parent === name);
  const workers = [...new Set(mine.filter((x) => x.session).map((x) => x.session as string))];
  const runs = [...new Set(mine.filter((x) => x.kind === "run" && x.run).map((x) => x.run as string))];
  patch(key, { synced: true, sessions, workers, runs, outputs: outputs ?? chatOf(key).get().outputs, queued: held, steered, conv: latest, session, window, turns, requests, draft, submissions: observeMessageSubmissionCanonical(now.submissions, seen), answers: Object.keys(now.answers).length ? now.answers : loadAnswers(key.startsWith("mobile:") ? key : conv.id) });
  if (key.startsWith("mobile:")) patch(key, { error: null });
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
    } else if (a.sent && r.state === "pending" && !r.command && !c.deliveries[r.id]) {
      if (key.startsWith("mobile:")) patch(key, { deliveries: { ...chatOf(key).get().deliveries, [r.id]: { delivery: "failed", error: "The Mac has not confirmed this answer. Retry when connected." } } });
      else void deliver(key, r, true);
    }
  }
  patch(key, { restore });
  saveAnswers(key.startsWith("mobile:") ? key : c.conv.id, answers);
  patch(key, { answers });
}

const kept = new Map<string, number>();
// The record has the words being written once its last turn has a text starting as they do.
export const inRecord = (w: Window, draft: string) =>
  w.items.slice(w.items.map((i) => said(i) !== null).lastIndexOf(true) + 1).some((i) => i.kind === "text" && (i.text ?? "").trim().startsWith(draft.trim().slice(0, 60)));

// The runtime says what changed; the chat on screen reads it again. Followed only while a chat
// is on screen.
const watching = new Map<string, { key: string; conv: Conversation }>();
let unlisten: (() => void) | null = null;
const heard = (e: RuntimeEvent) => {
  const name = (e.data?.session ?? e.data?.name) as string | undefined;
  for (const { key, conv } of watching.values())
    // Its own session's news, or a worker's it waits on.
    if (e.type === "runtime.connected" || (name && (name === conv.session || chatOf(key).get().workers.includes(name)))) void sync(key, conv).catch((err) => patch(key, { error: String(err.message ?? err) }));
};

// Follows a chat while it is on screen: its changes, and the reply being written. The Feed follows
// every agent's chat too, without the reply (reply: false); a chat stays followed while either does.
const followers = new Map<string, number>();
export function watch(key: string, conv: Conversation, { reply = true } = {}): () => void {
  if (watching.get(key)?.conv.id !== conv.id || !followers.get(key)) watching.set(key, { key, conv });
  followers.set(key, (followers.get(key) ?? 0) + 1);
  unlisten ??= onRuntimeEvent(heard);
  void sync(key, conv).catch((err) => patch(key, { error: String(err.message ?? err) }));
  const poll = reply
    ? window.setInterval(async () => {
        if (key.startsWith("mobile:") && document.visibilityState === "hidden") return;
        const c = chatOf(key).get();
        if (c.session?.agent_state !== "running" || !c.conv?.session) return;
        const d = await askIn<{ text?: string }>(key, "GET", `/v1/sessions/${c.conv.session}/draft`).catch(() => null);
        // An agent clears its draft as a message ends, before the record has it: the words stay till then.
        if (d?.text && d.text !== c.draft) patch(key, { draft: d.text });
      }, key.startsWith("mobile:") ? 1500 : 250)
    : 0;
  return () => {
    window.clearInterval(poll);
    const left = (followers.get(key) ?? 1) - 1;
    if (left > 0) return void followers.set(key, left);
    followers.delete(key);
    watching.delete(key);
    if (!watching.size) {
      unlisten?.();
      unlisten = null;
    }
  };
}

// The runtime's refusal to type into an agent waiting on a question, in our words.
const refused = (err: unknown, conv: Conversation | null) =>
  err instanceof Error && /waiting for someone/.test(err.message) ? new Error(`${conv?.agent === "codex" ? "Codex" : "Claude"} is waiting for your answer first.`) : err;

// Sends text: a new chat starts its agent in the folder; an ended one is resumed first. Each
// message carries a key of its own, so a send repeated after a lost answer is one message. Sent
// "idle" while the agent works, the runtime holds it until the turn ends (slice 12).
const sends = new Map<string, Promise<unknown>>();
export async function send(key: string, location: string, text: string, prefs: Pick<AiPrefs, "model" | "effort" | "access" | "plan"> & { branch?: boolean }, files: File[] = [], context = "", browserImages: BrowserImageReference[] = [], when: "now" | "idle" = "now"): Promise<Conversation> {
  const id = crypto.randomUUID();
  const c0 = chatOf(key).get();
  patch(key, { submissions: beginMessageSubmission(c0.submissions, { clientMessageId: id }), texts: { ...c0.texts, [id]: text }, restore: null, error: null });
  // One at a time per chat: a message typed while the first is still starting the chat waits for
  // it, then goes to that chat rather than starting another.
  const prev = sends.get(key);
  const run = prev ? prev.catch(() => {}).then(() => sendTo(adopted.get(key) ?? key, id, location, text, prefs, files, context, browserImages, when)) : sendTo(key, id, location, text, prefs, files, context, browserImages, when);
  sends.set(key, run);
  run.catch(() => {}).finally(() => sends.get(key) === run && sends.delete(key));
  return run;
}
async function sendTo(key: string, id: string, location: string, text: string, prefs: Pick<AiPrefs, "model" | "effort" | "access" | "plan"> & { branch?: boolean }, files: File[], context: string, browserImages: BrowserImageReference[], when: "now" | "idle"): Promise<Conversation> {
  try {
    // A folder gone since the page opened: no agent starts, in its place or anywhere else.
    await refreshFolders();
    if ([...folders.get().values()].some((f) => f.folder.location === location && f.missing)) throw new Error("The folder isn't there any more.");
    let conv = chatOf(key).get().conv;
    const hasFiles = files.length + browserImages.length > 0;
    const full = async (session: string) => {
      const paths = [...await upload(session, files), ...await uploadBrowserImages(session, browserImages)];
      return appendBrowserContext(paths.length ? `${text}${ATTACHED}${paths.join("\n")}` : text, context);
    };
    if (!conv) {
      const name = `chat-${crypto.randomUUID().slice(0, 8)}`;
      const agent = agentOf(prefs.model);
      // Its own branch: a worktree the runtime keeps, so the checkout is left as it is.
      const where = prefs.branch ? `${location}/${(await ask<{ name: string }>("POST", `/v1/locations/${location}/worktrees`, { name, branch: `ll/${name}` })).name}` : location;
      // With files the agent starts without a prompt, so they are there before the message naming them.
      await ask("POST", "/v1/sessions", { name, location: where, agent, driver: agent, mode: modeFor(prefs, agent), model: prefs.model, effort: prefs.effort, title: text.split("\n")[0], ...(!hasFiles && { prompt: appendBrowserContext(text, context) }) });
      conv = (await listChats(location)).find((c) => c.session === name) ?? null;
      if (!conv) throw new Error("The runtime didn't keep the chat.");
      if (hasFiles) {
        // A failed image upload retries in this chat instead of starting another empty agent.
        patch(key, { conv });
        await ask("POST", `/v1/sessions/${name}/send`, { text: await full(name), when: "now", idem_key: id });
      }
    } else {
      // The list can be behind: a session gone or ended since is resumed too.
      const s0 = chatOf(key).get().session;
      if (!conv.live || !s0 || s0.exited) {
        const s = await ask<Session>("POST", `/v1/conversations/${conv.id}/resume`, {});
        conv = { ...conv, session: s.name, live: true };
      }
      const r = await ask<{ queued?: boolean; turn?: string; at?: string }>("POST", `/v1/sessions/${conv.session}/send`, { text: await full(conv.session ?? ""), when, idem_key: id }).catch((e) => { throw refused(e, conv); });
      const c = chatOf(key).get();
      const running = c.turns.find((t) => t.state === "running");
      // Held by the runtime: it isn't on its way into the record, it waits in the queue.
      if (r.queued && r.turn) patch(key, { submissions: observeMessageSubmissionCanonical(c.submissions, [id]), queued: [...c.queued.filter((q) => q.turn !== r.turn), { turn: r.turn, preview: text.slice(0, 280), length: text.length, at: r.at ?? new Date().toISOString() }] });
      // Typed into the running turn: no turn of its own, so no new one starts on screen; it shows
      // as sent until the agent reads it.
      else if (running && r.turn === `${conv.session}#${running.n}`) patch(key, { submissions: observeMessageSubmissionCanonical(c.submissions, [id]), steered: [...c.steered, { id, text, at: Date.now() }] });
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

// A queued message typed into the running turn now, or taken out of the queue; the runtime refuses
// to type into a question the agent waits on, and says so.
export async function sendNow(key: string, turn: string): Promise<void> {
  const c = chatOf(key).get();
  if (!c.conv?.session) return;
  await ask("POST", `/v1/sessions/${c.conv.session}/queue/${encodeURIComponent(turn)}/send`, {}).catch((e) => { throw refused(e, c.conv); });
  // Typed into the turn: it shows as sent until the agent reads it, as one sent with ⌘↩ does.
  const c1 = chatOf(key).get();
  const q = c1.queued.find((x) => x.turn === turn);
  patch(key, { queued: c1.queued.filter((x) => x.turn !== turn), steered: q ? [...c1.steered, { id: turn, text: q.preview, at: Date.now() }] : c1.steered });
  await sync(key, c.conv);
}
export async function unqueue(key: string, turn: string): Promise<void> {
  const c = chatOf(key).get();
  if (!c.conv?.session) return;
  await ask("DELETE", `/v1/sessions/${c.conv.session}/queue/${encodeURIComponent(turn)}`);
  patch(key, { queued: chatOf(key).get().queued.filter((q) => q.turn !== turn) });
  await sync(key, c.conv);
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
  saveAnswers(key.startsWith("mobile:") ? key : c.conv.id, answers);
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
  const bound = (method: string, path: string, body?: unknown) => callIn(key, method, path, body);
  const outcome = again ? await reconcile(bound, session, r, draft) : await sendAnswer(bound, session, r, draft);
  if (outcome.request) patch(key, { requests: mergeRequests(chatOf(key).get().requests, [outcome.request]) });
  set(outcome.delivery, outcome.error);
  // A known refusal: the next try is a new command. A lost reply: asked again shortly.
  if (outcome.delivery === "failed") {
    const answers = { ...chatOf(key).get().answers, [r.id]: { ...draft, command: crypto.randomUUID(), sent: false } };
    patch(key, { answers });
  } else if (outcome.delivery === "sending") {
    if (key.startsWith("mobile:")) set("failed", outcome.error || "The Mac has not confirmed this answer. Retry when connected.");
    else window.setTimeout(() => (set("pending"), void deliver(key, r, true)), 1500);
  }
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
  if (name) await askIn(key, "POST", `/v1/sessions/${name}/interrupt`).catch((err) => patch(key, { error: String(err.message ?? err) }));
}

