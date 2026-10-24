import { localPrefs } from "~/lib/local-prefs";
import { isNative } from "~/lib/platform";
import { createStore } from "~/lib/state";

// The Claude Code and Codex command-line tools (src-tauri/src/clis.rs): what is installed, the
// newest version where each install updates from, and updating them, after synara. In a browser
// build a stand-in plays both; ?clis=current, ?clis=fail and ?clis=missing show those cases.

export type Source = "native" | "npm" | "bun" | "pnpm" | "brew-cask" | "brew" | "other";
export type Cli = { id: "claude" | "codex"; name: string; path: string | null; version: string | null; source: Source | null; npm: string; brew: string; command: string[] | null };
export type Tool = Cli & { latest: string | null; updating?: boolean; error?: string };

export const SOURCE: Record<Source, string> = { native: "its own installer", npm: "npm", bun: "bun", pnpm: "pnpm", "brew-cask": "Homebrew", brew: "Homebrew", other: "an installer the app doesn't know" };
export const INSTALL: Record<Cli["id"], string> = { claude: "https://claude.com/code", codex: "https://developers.openai.com/codex/cli" };

// shown: when the update toast last showed, so a relaunch doesn't bring it back within the hour.
export const cliPrefs = localPrefs("ll.clis", { check: true, dismissed: "", shown: 0 });
export const tools = createStore<Tool[]>([]);

// Is a newer than b? Numbers part by part; a prerelease comes before its release.
export function newer(a: string, b: string): boolean {
  const [na, pa] = a.split("-", 2);
  const [nb, pb] = b.split("-", 2);
  const x = na.split(".").map(Number);
  const y = nb.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return !pa && !!pb;
}

export const behind = (t: Tool) => !!(t.version && t.latest && t.command && newer(t.latest, t.version));
export const commandOf = (t: Cli) => t.command?.map((w) => (w.includes(" ") ? `"${w}"` : w)).join(" ") ?? null;

const mode = () => new URLSearchParams(location.search).get("clis");
let fakeCodex = mode() === "current" ? "0.163.0" : "0.153.4";
const fakes = (): Cli[] => [
  { id: "claude", name: "Claude Code", path: "~/.local/bin/claude", version: "2.1.308", source: "native", npm: "@anthropic-ai/claude-code", brew: "claude-code", command: ["claude", "update"] },
  mode() === "missing"
    ? { id: "codex", name: "Codex", path: null, version: null, source: null, npm: "@openai/codex", brew: "codex", command: null }
    : { id: "codex", name: "Codex", path: "/opt/homebrew/bin/codex", version: fakeCodex, source: "brew-cask", npm: "@openai/codex", brew: "codex", command: ["brew", "upgrade", "--cask", "codex"] },
];

async function info(): Promise<Cli[]> {
  if (!(await isNative)) return fakes();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Cli[]>("cli_info");
}

// The newest version where the install updates from, kept for an hour. Its own installer
// (Claude's) says nothing about that, so there is no prompt for it.
const found = new Map<string, { at: number; version: string | null }>();
async function latestOf(c: Cli): Promise<string | null> {
  if (!(await isNative)) return c.id === "codex" ? "0.163.0" : null;
  const src = c.source;
  const url =
    src === "npm" || src === "bun" || src === "pnpm"
      ? `https://registry.npmjs.org/${c.npm.replace("/", "%2f")}/latest`
      : src === "brew-cask" || src === "brew"
        ? `https://formulae.brew.sh/api/${src === "brew" ? "formula" : "cask"}/${c.brew}.json`
        : null;
  if (!url) return null;
  const hit = found.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.version;
  const j = await fetch(url, { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const version: string | null = (src === "brew" ? j?.versions?.stable : j?.version) ?? null;
  found.set(url, { at: Date.now(), version });
  return version;
}

export async function loadTools(): Promise<Tool[]> {
  const list = await info().catch(() => []);
  const next = await Promise.all(list.map(async (c) => ({ ...c, latest: c.path ? await latestOf(c) : null })));
  tools.set(next);
  return next;
}

const patch = (id: Cli["id"], p: Partial<Tool>) => tools.set(tools.get().map((t) => (t.id === id ? { ...t, ...p } : t)));

// Runs the tool's own update; then reads its version again, as the update may not have moved it.
export async function updateTool(id: Cli["id"]): Promise<void> {
  patch(id, { updating: true, error: undefined });
  try {
    if (await isNative) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("cli_update", { id });
    } else {
      await new Promise((r) => setTimeout(r, 1500));
      if (mode() === "fail") throw new Error("brew upgrade --cask codex didn't finish.\nError: Download failed: the stand-in has no network.");
      if (id === "codex") fakeCodex = "0.163.0";
    }
    const fresh = (await info()).find((c) => c.id === id);
    if (fresh) patch(id, { ...fresh, updating: false });
    const now = tools.get().find((x) => x.id === id);
    if (now && behind(now)) throw new Error(`It finished, but ${now.name} is still ${now.version}, not ${now.latest}.`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    patch(id, { updating: false, error });
    throw new Error(error);
  }
}
