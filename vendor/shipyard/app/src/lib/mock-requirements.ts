import type { Requirements } from "@/lib/requirements";

// GET /v1/requirements in mock mode: every box has what it needs, unless
// the URL says otherwise, for trying the install cards without
// uninstalling anything. ?tmux=missing takes tmux away (a Mac's box offers
// Homebrew; others their package manager), ?tmux=nobrew also Homebrew on a
// Mac, ?agents=none every agent CLI, and ?reqos=linux makes this Mac's box
// answer as a Linux box would.

const q = new URLSearchParams(location.search);
const tmux = q.get("tmux");
const noAgents = q.get("agents") === "none";
const osOverride = q.get("reqos");

// Whether tmux is there now: Check again in the mock "installs" it.
const installed = new Set<string>();

export function mockRequirements(box: string, local: boolean, checkAgain: number): Requirements {
  const os = osOverride ?? (local ? "darwin" : "linux");
  const mac = os === "darwin";
  // The second Check again finds it, as after running the command.
  if (checkAgain >= 2) installed.add(box);
  const missing = !!tmux && !installed.has(box);
  const brewMissing = mac && tmux === "nobrew";
  const install = mac ? "brew install tmux" : "sudo apt install tmux";
  return {
    os,
    tmux: missing
      ? { found: false, install, manager: mac ? "brew" : "apt", ...(brewMissing ? { manager_missing: true, help: "https://brew.sh" } : {}) }
      : { found: true, path: mac ? "/opt/homebrew/bin/tmux" : "/usr/bin/tmux" },
    agents: [
      { id: "claude", name: "Claude Code", command: "claude", found: !noAgents, ...(noAgents ? { install: "npm install -g @anthropic-ai/claude-code" } : { path: mac ? "/Users/me/.local/bin/claude" : "/home/me/.local/bin/claude" }) },
      { id: "codex", name: "Codex", command: "codex", found: !noAgents, ...(noAgents ? { install: "npm install -g @openai/codex" } : { path: "/usr/local/bin/codex" }) },
    ],
  };
}
