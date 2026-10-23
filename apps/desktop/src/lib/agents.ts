import { isNative } from "~/lib/platform";

// Agents: a prompt, a name and maybe a model, in Claude Code's own agent-file shape.
// A few ship with the app; the rest come from ~/.claude/agents and the app's agents
// folder on this Mac (src-tauri/src/agent.rs). Mentioning one with @ in the composer
// puts its prompt in front of the question and uses its model.

export type Agent = { id: string; name: string; description?: string | null; model?: string | null; prompt: string; source: string };

export const BUILT_IN: Agent[] = [
  {
    id: "built-in:editor",
    name: "Editor",
    description: "Tightens prose without changing its meaning or voice",
    prompt: "You are a careful editor. Improve clarity, flow and word choice without changing the meaning or the author's voice. Return only the revised text, no commentary.",
    source: "Built in",
  },
  {
    id: "built-in:summarizer",
    name: "Summarizer",
    description: "The shortest faithful summary",
    prompt: "Summarize faithfully in the shortest form that keeps every fact and decision. Use bullets when the source is a list; otherwise one short paragraph.",
    source: "Built in",
  },
  {
    id: "built-in:critic",
    name: "Critic",
    description: "Finds the gaps, weak claims and missing evidence",
    model: "opus",
    prompt: "You are a demanding reader. Point out gaps, weak claims, missing evidence and unclear steps, each in one line with the words it concerns. Do not rewrite.",
    source: "Built in",
  },
];

let cached: Promise<Agent[]> | null = null;

export function listAgents(fresh = false): Promise<Agent[]> {
  if (cached && !fresh) return cached;
  cached = (async () => {
    if (!(await isNative)) return BUILT_IN;
    const { invoke } = await import("@tauri-apps/api/core");
    const own = await invoke<Agent[]>("agent_list").catch(() => []);
    return [...BUILT_IN, ...own];
  })();
  return cached;
}

// Opens the app's agents folder in the Finder, where a Claude Code agent file can be dropped.
export async function showAgentsFolder(): Promise<void> {
  if (!(await isNative)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(await invoke<string>("agent_folder"));
}
