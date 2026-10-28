import { CLAUDE_EFFORTS, isClaude } from "~/lib/ai-prefs";
import { isNative } from "~/lib/platform";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { createStore } from "~/lib/state";

// Codex, for GPT models (src-tauri/src/clis.rs): whether it is on this Mac and signed in, and
// the models it offers, read from its app server. In a browser build a stand-in answers;
// ?codex=missing and ?codex=signed-out show those states. With project chats on, which run
// this Mac's Codex for real, the browser build asks it through the dev server instead.

export type GptModel = { id: string; name: string; efforts: string[]; effort: string; description: string };
export type CodexState = { state: "checking" | "missing" | "signed-out" | "ready"; email?: string; plan?: string; models: GptModel[]; error?: string };
export const codex = createStore<CodexState>({ state: "checking", models: [] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const efforts = (ultra: boolean) => ["low", "medium", "high", "xhigh", "max", ...(ultra ? ["ultra"] : [])].map((reasoningEffort) => ({ reasoningEffort }));

const standIn = (): Json => {
  const mode = new URLSearchParams(location.search).get("codex");
  if (mode === "missing") throw new Error("Codex is not installed");
  return {
    account: { result: { account: mode === "signed-out" ? null : { type: "chatgpt", email: "you@example.com", planType: "pro" } } },
    models: {
      result: {
        data: [
          { id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", description: "Latest workhorse model", supportedReasoningEfforts: efforts(true), defaultReasoningEffort: "low", hidden: false },
          { id: "gpt-6-luna", displayName: "GPT-6-Luna", description: "Fast and affordable", supportedReasoningEfforts: efforts(false), defaultReasoningEffort: "medium", hidden: false },
        ],
      },
    },
  };
};

let loading: Promise<void> | null = null;
export function loadCodex(fresh = false): Promise<void> {
  if (loading && !fresh) return loading;
  loading = (async () => {
    let r: Json;
    try {
      if (await isNative) {
        const { invoke } = await import("@tauri-apps/api/core");
        r = await invoke("codex_status");
      } else if (projectPrefs.get().enabled && !new URLSearchParams(location.search).has("codex")) {
        const res = await fetch("/__runtime/codex");
        r = await res.json();
        if (!res.ok) throw new Error(r.error);
      } else r = standIn();
    } catch (e) {
      const error = String(e);
      codex.set({ state: /not installed/i.test(error) ? "missing" : "signed-out", models: [], error });
      return;
    }
    const account = r?.account?.result?.account;
    // Codex 0.164 lists some models with no efforts; the standard ones keep the control there.
    const models: GptModel[] = (r?.models?.result?.data ?? [])
      .filter((m: Json) => !m.hidden)
      .map((m: Json) => ({ id: m.id, name: m.displayName ?? m.id, description: m.description ?? "", effort: m.defaultReasoningEffort, efforts: (m.supportedReasoningEfforts?.length ? m.supportedReasoningEfforts : efforts(false)).map((e: Json) => e.reasoningEffort) }));
    codex.set({ state: account ? "ready" : "signed-out", email: account?.email, plan: account?.planType, models });
  })();
  return loading;
}

export const gptModel = (id: string) => codex.get().models.find((m) => m.id === id);

// The effort levels a model takes, and the chosen one kept to them.
export const effortsFor = (model: string) => (isClaude(model) ? CLAUDE_EFFORTS.map((e) => e.value) : (gptModel(model)?.efforts ?? []));
export function effortFor(model: string, effort: string): string {
  const list = effortsFor(model);
  if (!list.length || list.includes(effort)) return effort;
  return isClaude(model) ? "max" : (gptModel(model)?.effort ?? list[0]);
}
