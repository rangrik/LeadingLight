#!/usr/bin/env node
// Explicit, real-provider checks. Credentials are read once and copied into a
// private fixture; provider configuration and history never use the real home.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tests = {
  codex: "TestALiveCodexSessionWorks",
  claude: "TestALiveClaudeSessionWorks",
  acp: "TestALiveACPSessionWorks",
  browser: "TestRealAgentBrowserGoesWithItsSession",
  turncheck: "TestTurnCheckLive",
};
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`Usage: node scripts/project-runtime/test-providers.mjs [${Object.keys(tests).join("|")}|all] ...
Runs real integrations sequentially in disposable homes. Default: all.
Codex: existing CODEX_HOME/auth.json; optional BERTH_LIVE_CODEX_MODEL.
Claude: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or existing Claude credentials.
ACP: installed opencode, existing auth if present; default model opencode/big-pickle.
Browser: installed agent-browser or a temporary pinned install; BERTH_CHROMIUM optional.
Turn check: BERTH_TURNCHECK_LIVE_KEY_FILE and BERTH_TURNCHECK_LIVE_MODEL,
  or the existing gateway configuration and key in BERTH_HOME.
Exit 1: a check failed. Exit 2: a required provider fixture is unavailable.
No login or persistent configuration changes are performed.`);
  process.exit(0);
}
if (args.some((g) => g !== "all" && !(g in tests))) throw new Error("unknown provider group; use --help");
const groups = [...new Set(args.length === 0 || args.includes("all") ? Object.keys(tests) : args)];

class Unavailable extends Error {}
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
function executable(name) {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, name);
    try { if (lstatSync(realpathSync(p)).isFile()) return realpathSync(p); } catch {}
  }
  throw new Unavailable(`${name} is not installed on PATH`);
}
function json(path) { return JSON.parse(readFileSync(path, "utf8")); }
function secret(path, data) { writeFileSync(path, data, { mode: 0o600 }); }
function copySecret(from, to) {
  const st = lstatSync(from);
  if (!st.isFile() || st.isSymbolicLink()) throw new Unavailable(`credential must be a regular file: ${from}`);
  secret(to, readFileSync(from));
}
function run(command, argv, env, cwd, timeout = 30000) {
  const r = spawnSync(command, argv, { env, cwd, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${command.split("/").at(-1)} failed${r.error ? `: ${r.error.code}` : ` (exit ${r.status})`}`);
  return r.stdout;
}
function claudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const credentials = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json");
  let auth;
  if (existsSync(credentials)) auth = json(credentials).claudeAiOauth;
  else if (platform() === "darwin") {
    // Read the existing credential. Never ask Claude to refresh or write Keychain.
    const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { encoding: "utf8", timeout: 10000 });
    if (r.status === 0) { try { auth = JSON.parse(r.stdout).claudeAiOauth; } catch {} }
  }
  if (!auth?.accessToken) throw new Unavailable("Claude has no saved access token; a valid Claude login or ANTHROPIC_API_KEY is required");
  if (typeof auth.expiresAt === "number" && auth.expiresAt <= Date.now()) throw new Unavailable("Claude's saved access token is expired; a fresh login or ANTHROPIC_API_KEY is required");
  return auth.accessToken;
}

async function prepare(group, fixture) {
  const env = {};
  for (const name of ["bin", "config", "data", "cache"]) mkdirSync(join(fixture, name), { mode: 0o700 });
  // Some machines have an unusable global node. Reuse the working interpreter
  // without installing anything or linking back to a writable user directory.
  writeFileSync(join(fixture, "bin/node"), `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o700 });
  env.XDG_CONFIG_HOME = join(fixture, "config");
  env.XDG_DATA_HOME = join(fixture, "data");
  env.XDG_CACHE_HOME = join(fixture, "cache");
  if (group === "codex") {
    executable("codex");
    const auth = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
    if (!existsSync(auth)) throw new Unavailable("Codex requires an existing CODEX_HOME/auth.json login");
    const credential = json(auth);
    if (!credential.OPENAI_API_KEY && !credential.tokens?.access_token) throw new Unavailable("Codex auth.json has no API key or access token");
    env.CODEX_HOME = join(fixture, "codex");
    mkdirSync(env.CODEX_HOME, { mode: 0o700 });
    copySecret(auth, join(env.CODEX_HOME, "auth.json"));
    secret(join(env.CODEX_HOME, "config.toml"), 'cli_auth_credentials_store = "file"\n[features]\napps = false\nremote_plugin = false\n');
    env.BERTH_LIVE_CODEX = "1";
    if (process.env.BERTH_LIVE_CODEX_MODEL) env.BERTH_LIVE_CODEX_MODEL = process.env.BERTH_LIVE_CODEX_MODEL;
  } else if (group === "claude") {
    executable("claude");
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    else env.CLAUDE_CODE_OAUTH_TOKEN = claudeToken();
    env.CLAUDE_CONFIG_DIR = join(fixture, "claude");
    mkdirSync(env.CLAUDE_CONFIG_DIR, { mode: 0o700 });
    secret(join(env.CLAUDE_CONFIG_DIR, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }));
    env.BERTH_LIVE_CLAUDE = "1";
  } else if (group === "acp") {
    executable("opencode");
    const auth = join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "opencode/auth.json");
    mkdirSync(join(env.XDG_DATA_HOME, "opencode"), { mode: 0o700 });
    if (existsSync(auth)) copySecret(auth, join(env.XDG_DATA_HOME, "opencode/auth.json"));
    env.OPENCODE_CONFIG = join(fixture, "opencode.json");
    secret(env.OPENCODE_CONFIG, "{}\n");
    env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
    env.BERTH_LIVE_ACP = "opencode";
    env.BERTH_LIVE_ACP_MODEL = process.env.BERTH_LIVE_ACP_MODEL || "opencode/big-pickle";
  } else if (group === "browser") {
    let browser = process.env.BERTH_CHROMIUM || process.env.AGENT_BROWSER_EXECUTABLE_PATH;
    if (!browser) {
      browser = run(process.execPath, ["--input-type=module", "-e", 'import { chromium } from "@playwright/test"; console.log(chromium.executablePath());'], process.env, join(root, "apps/desktop")).trim();
      // Headless shell avoids full Chrome's macOS Keychain initialization.
      const headless = browser.replace(/chromium-(\d+)\/chrome-mac-arm64\/Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing$/, "chromium_headless_shell-$1/chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(headless)) browser = headless;
    }
    if (!existsSync(browser)) throw new Unavailable("Chromium is unavailable; set BERTH_CHROMIUM to an installed browser executable");
    let ab;
    try { ab = executable("agent-browser"); } catch (err) {
      if (!(err instanceof Unavailable)) throw err;
      const npm = executable("npm");
      const npmEnv = { HOME: fixture, PATH: `${join(fixture, "bin")}:${process.env.PATH}`, XDG_CACHE_HOME: env.XDG_CACHE_HOME };
      run(process.execPath, [npm, "install", "--prefix", join(fixture, "agent-browser"), "--cache", join(fixture, "npm-cache"), "--ignore-scripts", "--no-audit", "--no-fund", "agent-browser@0.41.2"], npmEnv, fixture, 60000);
      ab = join(fixture, `agent-browser/node_modules/agent-browser/bin/agent-browser-${platform()}-${arch()}`);
      chmodSync(ab, 0o700);
    }
    // Keep installed npm wrappers in place so relative binary lookup works.
    writeFileSync(join(fixture, "bin/agent-browser"), `#!/bin/sh\nexec ${quote(ab)} "$@"\n`, { mode: 0o700 });
    env.AGENT_BROWSER_EXECUTABLE_PATH = browser;
    env.AGENT_BROWSER_ARGS = [process.env.AGENT_BROWSER_ARGS, platform() === "darwin" ? "--use-mock-keychain" : ""].filter(Boolean).join(",");
    env.AGENT_BROWSER_SOCKET_DIR = join(fixture, "browser-sockets");
    mkdirSync(env.AGENT_BROWSER_SOCKET_DIR, { mode: 0o700 });
    env.BERTH_TEST_REAL_AGENT_BROWSER = "1";
  } else if (group === "turncheck") {
    const home = process.env.BERTH_HOME || join(homedir(), ".berth");
    const path = join(home, "turncheck.json");
    const cfg = existsSync(path) ? json(path) : {};
    const key = process.env.BERTH_TURNCHECK_LIVE_KEY_FILE || (cfg.provider === "gateway" ? join(home, "turncheck.key") : "");
    const model = process.env.BERTH_TURNCHECK_LIVE_MODEL || (cfg.provider === "gateway" && cfg.model);
    if (!key || !existsSync(key) || !model) throw new Unavailable(`Vercel AI Gateway requires BERTH_TURNCHECK_LIVE_KEY_FILE and BERTH_TURNCHECK_LIVE_MODEL (or an existing gateway key and config in BERTH_HOME)${model ? `; configured model: ${model}` : ""}`);
    if (!readFileSync(key, "utf8").trim()) throw new Unavailable("Vercel AI Gateway key file is empty");
    env.BERTH_TURNCHECK_LIVE_KEY_FILE = join(fixture, "turncheck.key");
    copySecret(key, env.BERTH_TURNCHECK_LIVE_KEY_FILE);
    env.BERTH_TURNCHECK_LIVE_MODEL = model;
  }
  secret(join(fixture, "env.json"), JSON.stringify(env));
}

let current;
let stopped;
function cancel(signal) {
  stopped = signal;
  if (current) current.kill(signal);
}
process.on("SIGINT", () => cancel("SIGINT"));
process.on("SIGTERM", () => cancel("SIGTERM"));
async function check(group, fixture) {
  const child = spawn(join(root, "scripts/project-runtime/build.sh"), ["--test", "./internal/box", "-run", `^${tests[group]}$`, "-json", "-count=1", "-timeout=6m"], {
    cwd: root, env: { ...process.env, LL_RUNTIME_LIVE_FIXTURE: fixture }, stdio: ["ignore", "pipe", "pipe"],
  });
  current = child;
  let pending = "", passed = false, skipped = false;
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.Test === tests[group]) { passed ||= event.Action === "pass"; skipped ||= event.Action === "skip"; }
        if (event.Output) process.stdout.write(event.Output);
      } catch { console.log(line); }
    }
  });
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill("SIGTERM"), 8 * 60 * 1000);
  let code;
  try { code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); }); }
  finally { clearTimeout(timer); current = undefined; }
  if (code !== 0 || !passed || skipped) throw new Error(`${tests[group]} ${skipped ? "was skipped despite its fixture" : !passed ? "did not pass" : `failed (exit ${code})`}`);
}

const results = [];
for (const group of groups) {
  if (stopped) break;
  const fixture = mkdtempSync("/tmp/ll-live.");
  secret(join(fixture, ".leadinglight-live-fixture"), "LeadingLight live provider fixture\n");
  try {
    await prepare(group, fixture);
    if (stopped) break;
    console.log(`\nRunning ${tests[group]} with isolated provider state`);
    await check(group, fixture);
    results.push({ group, test: tests[group], status: "passed" });
  } catch (err) {
    const status = err instanceof Unavailable ? "unavailable" : "failed";
    results.push({ group, test: tests[group], status, reason: err.message });
    console.error(`${group}: ${status}: ${err.message}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
console.log("\nLive provider results:");
for (const result of results) console.log(`${result.group}: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`);
console.log(`LIVE_PROVIDER_RESULTS ${JSON.stringify({ results })}`);
process.exitCode = stopped ? 130 : results.some((r) => r.status === "failed") ? 1 : results.some((r) => r.status === "unavailable") ? 2 : 0;
