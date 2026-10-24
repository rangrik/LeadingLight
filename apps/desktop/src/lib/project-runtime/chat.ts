import { type AiPrefs, isClaude } from "~/lib/ai-prefs";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { emptyWindow, merge, type TranscriptPage, type Window } from "~/lib/project-runtime/transcript";
import { ask, type RuntimeEvent } from "~/lib/project-runtime/transport";
import { createStore } from "~/lib/state";

// A project's chats (features/project-chat.feature): conversations the runtime keeps, working in
// the page's folder. A chat is its conversation ID, which outlives the agent sessions it runs
// in; the runtime holds its record, so this keeps only what is on screen. Kept outside React, so
// a chat keeps up while another page is in front.

export type Conversation = { id: string; agent: string; location?: string; dir: string; session?: string; live?: boolean; mode?: string; model?: string; effort?: string; title?: string; created: string; updated?: string };
export type Ask = { tool?: string; input?: string; why?: string; message?: string; choices?: { key: string; label: string }[] };
export type Session = { name: string; agent_state?: string; exited?: boolean; ask?: Ask; driver?: string };
export type Turn = { n: number; state: string; started?: string; ended?: string };
export type Chat = {
  conv: Conversation | null;
  session: Session | null;
  window: Window;
  draft: string;
  turns: Turn[];
  // A message sent and not yet in the record.
  pending: string | null;
  error: string | null;
};

const blank = (): Chat => ({ conv: null, session: null, window: emptyWindow, draft: "", turns: [], pending: null, error: null });
const chats = new Map<string, ReturnType<typeof createStore<Chat>>>();
export const chatOf = (key: string) => {
  let s = chats.get(key);
  if (!s) chats.set(key, (s = createStore(blank())));
  return s;
};
const patch = (key: string, p: Partial<Chat>) => chatOf(key).set({ ...chatOf(key).get(), ...p });

export const listChats = (location: string) => ask<Conversation[]>("GET", `/v1/conversations?location=${encodeURIComponent(location)}&limit=200`);

// What the person picked in Settings › AI, as a Claude Code permission mode.
export const modeFor = (p: Pick<AiPrefs, "access" | "plan">) => (p.plan ? "plan" : { ask: "default", auto: "auto", full: "bypassPermissions" }[p.access]);

// The chat as the runtime has it now: its session, record, and turns.
export async function sync(key: string, conv: Conversation): Promise<void> {
  const name = conv.session;
  const sessions = await ask<Session[]>("GET", "/v1/sessions");
  const session = sessions.find((s) => s.name === name) ?? null;
  const w = chatOf(key).get().window;
  const page = name ? await ask<TranscriptPage>("GET", `/v1/sessions/${name}/transcript?since=${w.next}${w.gen ? `&gen=${w.gen}` : ""}`).catch(() => null) : null;
  const turns = session ? await ask<Turn[]>("GET", `/v1/sessions/${name}/turns`).catch(() => []) : [];
  const window = page && page.source !== "none" ? merge(w, page) : w;
  const pending = chatOf(key).get().pending;
  // Sent text shows as sent until the record has it.
  const landed = pending !== null && window.items.some((i) => i.kind === "user" && i.text?.trim() === pending.trim() && !w.items.some((o) => o.id === i.id));
  patch(key, { conv, session, window, turns, pending: landed ? null : pending });
}

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
    if (c.session?.agent_state !== "running" || !c.conv?.session) return c.draft && patch(key, { draft: "" });
    const d = await ask<{ text?: string }>("GET", `/v1/sessions/${c.conv.session}/draft`).catch(() => null);
    if (d && (d.text ?? "") !== c.draft) patch(key, { draft: d.text ?? "" });
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
export async function send(key: string, location: string, text: string, prefs: AiPrefs): Promise<Conversation> {
  patch(key, { pending: text, error: null });
  try {
    let conv = chatOf(key).get().conv;
    if (!conv) {
      const name = `chat-${crypto.randomUUID().slice(0, 8)}`;
      const model = isClaude(prefs.model) ? prefs.model : "opus";
      await ask("POST", "/v1/sessions", { name, location, agent: "claude", driver: "claude", mode: modeFor(prefs), model, effort: prefs.effort, prompt: text, title: text.split("\n")[0] });
      conv = (await listChats(location)).find((c) => c.session === name) ?? null;
      if (!conv) throw new Error("The runtime didn't keep the chat.");
    } else {
      if (!conv.live) {
        const s = await ask<Session>("POST", `/v1/conversations/${conv.id}/resume`, {});
        conv = { ...conv, session: s.name, live: true };
      }
      await ask("POST", `/v1/sessions/${conv.session}/send`, { text, when: "now", idem_key: crypto.randomUUID() });
    }
    patch(key, { conv });
    if (watching.has(key)) watching.set(key, { key, conv });
    await sync(key, conv);
    return conv;
  } catch (err) {
    patch(key, { pending: null, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function stop(key: string): Promise<void> {
  const name = chatOf(key).get().conv?.session;
  if (name) await ask("POST", `/v1/sessions/${name}/interrupt`).catch((err) => patch(key, { error: String(err.message ?? err) }));
}

// The waiting agent's permission, answered with one of its choices.
export const pick = (key: string, choice: string) => {
  const name = chatOf(key).get().conv?.session;
  return name ? ask("POST", `/v1/sessions/${name}/send`, { text: choice, enter: false }) : Promise.resolve();
};
