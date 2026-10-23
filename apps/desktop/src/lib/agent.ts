import { isNative } from "~/lib/platform";

// Claude, through the Claude Code signed in on this Mac (src-tauri/src/agent.rs). In a
// browser build there is no Claude Code, so a stand-in answers; ?agent=signed-out and
// ?agent=missing show those two states for QA.

export type AgentStatus = {
  installed: boolean;
  logged_in: boolean;
  email?: string | null;
  plan?: string | null;
  version?: string | null;
  error?: string | null;
};

export type AgentEvent = { type: "delta"; text: string } | { type: "done"; session_id?: string | null } | { type: "error"; message: string };

export type AskRequest = { id: string; prompt: string; system: string; model: string; effort: string; resume?: string };

const fakeMode = () => new URLSearchParams(location.search).get("agent");

export async function agentStatus(): Promise<AgentStatus> {
  if (await isNative) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStatus>("agent_status");
  }
  const mode = fakeMode();
  if (mode === "missing") return { installed: false, logged_in: false };
  if (mode === "signed-out") return { installed: true, logged_in: false, version: "browser build" };
  return { installed: true, logged_in: true, email: "you@example.com", plan: "stand-in", version: "browser build" };
}

const fakes = new Map<string, number>();

// Streams the answer through onEvent; resolves once the question is on its way.
export async function ask(req: AskRequest, onEvent: (e: AgentEvent) => void): Promise<void> {
  if (await isNative) {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const channel = new Channel<AgentEvent>();
    channel.onmessage = onEvent;
    await invoke("agent_ask", { ask: req, onEvent: channel });
    return;
  }
  const quote = /^> (.*)$/m.exec(req.prompt)?.[1];
  const answer = quote
    ? `**About “${quote}”**\n\nA stand-in answer: the browser build has no Claude Code. In the Mac app, Claude answers through your own sign-in.\n\n- One point about it\n- Another point`
    : "A stand-in answer about the whole page. In the Mac app, Claude answers through your own sign-in.";
  const words = answer.split(/(?<=\s)/);
  let i = 0;
  const tick = () => {
    if (i < words.length) {
      onEvent({ type: "delta", text: words[i++] });
      fakes.set(req.id, window.setTimeout(tick, 40));
    } else {
      fakes.delete(req.id);
      onEvent({ type: "done", session_id: "stand-in" });
    }
  };
  tick();
}

export async function cancel(id: string): Promise<void> {
  const timer = fakes.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    fakes.delete(id);
    return;
  }
  if (await isNative) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("agent_cancel", { id });
  }
}
