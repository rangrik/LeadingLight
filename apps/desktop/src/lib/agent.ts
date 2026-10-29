import { isNative } from "~/lib/platform";
import { remoteAsk, remoteCancel, remoteReply, remoteStatus, selectedPair } from "~/lib/remote";

// Claude, through the Claude Code signed in on this Mac, or GPT through Codex's app server
// (src-tauri/src/agent.rs). A turn is one process: its JSON lines come to onEvent, and its
// requests (a page tool, an approval) are answered with reply(). In a browser build a stand-in
// plays both (lib/agent-standin.ts); ?agent=signed-out and ?agent=missing show Claude's states.

export const LOCAL_AGENTS_MESSAGE = "Agents run in the installed Mac app using your existing Claude Code or Codex sign-in.";

export type AgentStatus = {
  installed: boolean;
  logged_in: boolean;
  email?: string | null;
  plan?: string | null;
  version?: string | null;
  error?: string | null;
};

// One JSON line, read loosely: it is the tools' protocol, and lib/turn.ts picks out what the
// panel shows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { type?: string } & Record<string, any>;
export type AgentEvent = { type: "line"; line: Line } | { type: "error"; message: string };
export type Mode = "ask" | "auto" | "full" | "plan";
// tail: a tail turn (lib/tail.ts), with no tools at all.
export type AskRequest = { id: string; prompt: string; system: string; model: string; effort: string; access: Mode; resume?: string; provider: "claude" | "codex"; tail?: boolean };

const fakeMode = () => new URLSearchParams(location.search).get("agent");
const standIn = () => import("~/lib/agent-standin");
const remoteRuns = new Set<string>();

export async function agentStatus(): Promise<AgentStatus> {
  if (await isNative) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStatus>("agent_status");
  }
  if (selectedPair()) return remoteStatus();
  if (!import.meta.env.DEV) return { installed: false, logged_in: false, error: LOCAL_AGENTS_MESSAGE };
  const mode = fakeMode();
  if (mode === "missing") return { installed: false, logged_in: false };
  if (mode === "signed-out") return { installed: true, logged_in: false, version: "browser build" };
  return { installed: true, logged_in: true, email: "you@example.com", plan: "stand-in", version: "browser build" };
}

// Starts a turn; resolves once it is on its way.
export async function ask(req: AskRequest, onEvent: (e: AgentEvent) => void): Promise<void> {
  if (!(await isNative)) {
    if (selectedPair()) { remoteRuns.add(req.id); return remoteAsk(req, onEvent); }
    if (!import.meta.env.DEV) throw new Error(LOCAL_AGENTS_MESSAGE);
    return (await standIn()).ask(req, onEvent);
  }
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const channel = new Channel<AgentEvent>();
  channel.onmessage = onEvent;
  await invoke("agent_ask", { ask: req, onEvent: channel });
}

export async function reply(id: string, message: object): Promise<void> {
  if (remoteRuns.has(id)) return remoteReply(id, message);
  if (!(await isNative)) {
    if (!import.meta.env.DEV || selectedPair()) throw new Error("This agent turn is no longer connected.");
    return (await standIn()).reply(id, message);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("agent_reply", { id, message });
}

export async function cancel(id: string): Promise<void> {
  if (remoteRuns.has(id)) return remoteCancel(id);
  if (!(await isNative)) {
    if (!import.meta.env.DEV || selectedPair()) throw new Error("This agent turn is no longer connected.");
    return (await standIn()).cancel(id);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("agent_cancel", { id });
}
