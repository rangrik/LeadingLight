import { create } from "zustand";

import type { OrchestrateDraft, WorktreeDraft } from "@/lib/store";

// The composer is the one way to start work: what to do, where, and with
// which agents (one is a task, several are attempts), or a prompt for agents
// already running (one, or several at once). It lives inline on home, in an
// empty worktree and before an agent's first prompt, and in a dialog
// (⌘N, ⌘K's "Try N ways" and "Send to several agents", a session's
// Orchestrate menu). openComposer opens the dialog with a draft.

export interface AgentPick {
  agent: string;
  // The CLI's own names; "" is its default.
  model: string;
  effort: string;
}

export interface ComposerTarget {
  box: string;
  session: string;
}

export interface ComposerDraft {
  // start: new work; send: a prompt for agents already running.
  mode?: "start" | "send";
  box?: string;
  location?: string;
  where?: "new" | "main";
  text?: string;
  // The agents to start, each with its model and effort if picked; several
  // are attempts. noAgent makes the worktree alone.
  agents?: { agent: string; model?: string; effort?: string }[];
  noAgent?: boolean;
  // What the worktree starts from: a name, #1234, a branch or a link.
  name?: string;
  template?: string;
  // Every attempt's base branch.
  base?: string;
  // Open on the attempts' options (Try N ways).
  attempts?: boolean;
  // Send: who to, a saved prompt to start from, and whether to loop until
  // a check passes.
  targets?: ComposerTarget[];
  promptId?: string;
  loop?: boolean;
  // Work that follows a session: hand it off, or review it.
  from?: { kind: "handoff" | "review"; box: string; session: string };
  // Show the last send to several agents, as it goes.
  results?: boolean;
}

interface ComposerState {
  draft?: ComposerDraft;
  // Bumped on every open, so a new draft starts a fresh form.
  seq: number;
}

export const useComposer = create<ComposerState>()(() => ({ seq: 0 }));

export function openComposer(d: ComposerDraft = {}) {
  useComposer.setState((s) => ({ draft: d, seq: s.seq + 1 }));
}

export const closeComposer = () => useComposer.setState({ draft: undefined });

// openAttempts opens the composer on "Try N ways": two agents to start
// with, and the attempts' options open.
export function openAttempts(d: { box?: string; location?: string; prompt?: string; base?: string } = {}) {
  openComposer({ box: d.box, location: d.location, text: d.prompt, base: d.base, attempts: true });
}

// fromWorktreeDraft is ⌘N's draft (lib/store) as the composer's.
export const fromWorktreeDraft = (d: WorktreeDraft): ComposerDraft => ({
  box: d.box,
  location: d.location,
  template: d.template,
  name: d.name,
  agents: d.agent ? [{ agent: d.agent }] : undefined,
});

// fromOrchestrateDraft is a session's Orchestrate action as the composer's
// draft: a prompt for it, a loop on it, or work that follows it.
export function fromOrchestrateDraft(d: OrchestrateDraft): ComposerDraft {
  const target = { box: d.box, session: d.session };
  if (d.kind === "send") return { mode: "send", targets: [target], text: d.prompt };
  if (d.kind === "loop") return { mode: "send", targets: [target], text: d.prompt, loop: true };
  return { from: { kind: d.kind, ...target }, text: d.prompt };
}
