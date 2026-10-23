import type { Check } from "@/lib/api";

// Copy diagnostics in mock mode (?mock=1): the laptop's `berth doctor`
// (GET /v1/doctor) and a box's own doctor, fixed so the report is the same
// every time. They carry a home folder, an email and an op:// reference on
// purpose: the copied report must show none of them (lib/diagnostics-format).

const HOME = "/Users/mockuser";
const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 120));

const LAPTOP: Check[] = [
  { area: "This computer", name: "starts at login", status: "ok", detail: "background agent installed" },
  { area: "This computer", name: "agent", status: "ok", detail: "running" },
  { area: "This computer", name: "local URLs", status: "ok", detail: "http://PORT.BOX.localhost:1377" },
  { area: "This computer", name: "short URLs", status: "info", detail: "URLs include :1377", fix: "berth setup port80" },
  { area: "This computer", name: "image generation", status: "ok", detail: `codex at ${HOME}/.local/bin/codex, key from op://Private/OpenAI/credential` },
  { area: "Networks", name: "work", status: "fail", detail: "signed out (mock.user@example.com)", fix: "berth network login work" },
  { area: "Boxes", name: "devl", status: "ok", detail: "online, 38ms" },
  { area: "Boxes", name: "gpu", status: "ok", detail: "online, 112ms" },
  { area: "Boxes", name: "old-vps", status: "warn", detail: "offline: dial tcp: i/o timeout", fix: "Check the box is on, then on it: berthd doctor" },
  { area: "Tools on this computer", name: "Claude Code", status: "ok", detail: `connected (${HOME}/.claude/settings.json)` },
  { area: "Tools on this computer", name: "Cursor", status: "info", detail: "not connected", fix: "berth integrations install cursor" },
  { area: "Tools on this computer", name: "Codex", status: "info", detail: "not connected", fix: "berth integrations install codex" },
];

// mockDiagnosticsCall answers the laptop's GET /v1/doctor.
export function mockDiagnosticsCall(method: string, path: string): Promise<unknown> | undefined {
  if (method !== "GET" || path !== "/v1/doctor") return undefined;
  return later({ version: "0.3.6", build: "5e1f0c2d9a7b", os: "macOS 26.3", arch: "arm64", home: HOME, checks: LAPTOP });
}

// mockBoxDoctor answers a box's GET doctor: its tools as its own PATH finds them.
export function mockBoxDoctor(box: string, local: boolean, method: string, path: string): Promise<unknown> | undefined {
  if (method !== "GET" || path !== "doctor") return undefined;
  const home = local ? "/Users/me" : "/home/me";
  const checks: Check[] = [
    { area: "berthd", name: "service", status: "ok", detail: local ? "launchd, starts at login" : "systemd user service, linger on" },
    { area: "Worktrees and sessions", name: "git", status: "ok", detail: "/usr/bin/git" },
    { area: "Worktrees and sessions", name: "tmux", status: "ok", detail: local ? "/opt/homebrew/bin/tmux" : "/usr/bin/tmux" },
    { area: "Worktrees and sessions", name: "cloudflared", status: "info", detail: "not installed; needed for public shares" },
    { area: "Agents", name: "claude", status: "ok", detail: `${home}/.local/bin/claude` },
    { area: "Agents", name: "codex", status: box === "gpu" ? "ok" : "info", detail: box === "gpu" ? `${home}/.npm-global/bin/codex` : "not installed; needed for Codex sessions", fix: "npm install -g @openai/codex" },
    { area: "Worktrees and sessions", name: "PATH", status: "info", detail: `${home}/.local/bin:${local ? "/opt/homebrew/bin:" : ""}/usr/local/bin:/usr/bin:/bin` },
  ];
  return later(checks);
}
