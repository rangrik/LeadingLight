#!/usr/bin/env node
// Explicit, real-provider checks. Credentials are read once and copied into a
// private fixture; provider configuration and history never use the real home.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, arch, constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTestBrowser } from "./test-browser.mjs";
import { claudeCredentialStore, gatewayFixture, Unavailable } from "./provider-credentials.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tests = {
  codex: "TestALiveCodexSessionWorks",
  claude: "TestALiveClaudeSessionWorks",
  acp: "TestALiveACPSessionWorks",
  browser: "TestRealAgentBrowserGoesWithItsSession",
  turncheck: "TestTurnCheckLive",
};
const defaultGroups = Object.keys(tests).filter((group) => group !== "turncheck");
const listOnly = process.argv.includes("--list");
const args = process.argv.slice(2).filter((arg) => arg !== "--list");
if (args.includes("--help")) {
  console.log(`Usage: node scripts/project-runtime/test-providers.mjs [${Object.keys(tests).join("|")}|all] ... [--list]
Runs real integrations sequentially in disposable homes.
Default and "all": ${defaultGroups.join(", ")}. Gateway requires explicit "turncheck".
--list prints the selected checks without reading credentials or running providers.
Codex: existing CODEX_HOME/auth.json; optional BERTH_LIVE_CODEX_MODEL.
Claude: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or existing Claude credentials.
ACP: installed opencode, existing auth if present; default model opencode/big-pickle.
Browser: installed agent-browser or a temporary pinned install; BERTH_CHROMIUM optional.
Turn check: BERTH_TURNCHECK_LIVE_KEY_FILE, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN
  (in that order), plus BERTH_TURNCHECK_LIVE_MODEL or a configured gateway model;
  or an existing gateway config and pasted key: embedded LeadingLight first,
  then the local berth runtime. BERTH_HOME/BERTH_USER_DIR select a runtime.
Exit 1: a check failed. Exit 2: a required provider fixture is unavailable.
No login or persistent configuration changes are performed.`);
  process.exit(0);
}
if (args.some((g) => g !== "all" && !(g in tests))) throw new Error("unknown provider group; use --help");
const groups = [...new Set(args.length === 0 ? defaultGroups : args.flatMap((group) => group === "all" ? defaultGroups : [group]))];
if (listOnly) {
  console.log(JSON.stringify(groups.map((group) => ({ group, test: tests[group] }))));
  process.exit(0);
}

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
function executable(name) {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, name);
    try { if (lstatSync(realpathSync(p)).isFile()) return realpathSync(p); } catch {}
  }
  throw new Unavailable(`${name} is not installed on PATH`);
}
function json(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`cannot read provider configuration: ${path}`); }
}
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
  const store = claudeCredentialStore();
  let auth;
  if (existsSync(store.file)) auth = json(store.file).claudeAiOauth;
  else if (platform() === "darwin") {
    // Read the existing credential. Never ask Claude to refresh or write Keychain.
    const r = spawnSync("/usr/bin/security", store.keychainArgs, { encoding: "utf8", timeout: 10000 });
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
    // The live check explicitly exercises bypass mode, including the terminal
    // handoff. Record its first-run consent only in this disposable config.
    secret(join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify({ skipDangerousModePermissionPrompt: true }));
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
      browser = await resolveTestBrowser(join(root, "apps/desktop"));
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
    const { key, keyValue, model } = gatewayFixture();
    if (!(key ? readFileSync(key, "utf8") : keyValue).trim()) throw new Unavailable("Vercel AI Gateway credential is empty");
    env.BERTH_TURNCHECK_LIVE_KEY_FILE = join(fixture, "turncheck.key");
    if (key) copySecret(key, env.BERTH_TURNCHECK_LIVE_KEY_FILE);
    else secret(env.BERTH_TURNCHECK_LIVE_KEY_FILE, keyValue);
    env.BERTH_TURNCHECK_LIVE_MODEL = model;
  }
  secret(join(fixture, "env.json"), JSON.stringify(env));
}

let current;
let stopped;
function signalGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
}
function groupExists(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (err) { if (err.code === "ESRCH") return false; throw err; }
}
function cancel(signal) {
  stopped ||= signal;
  current?.stop(stopped);
}
process.on("SIGINT", () => cancel("SIGINT"));
process.on("SIGTERM", () => cancel("SIGTERM"));
async function check(group, fixture) {
  const child = spawn(join(root, "scripts/project-runtime/build.sh"), ["--test", "./internal/box", "-run", `^${tests[group]}$`, "-json", "-count=1", "-timeout=6m"], {
    cwd: root, env: { ...process.env, LL_RUNTIME_LIVE_FIXTURE: fixture }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let escalation;
  function stop(signal) {
    if (escalation) return;
    // This also reaches git/curl/compiler children before build.sh execs the
    // test runner. That runner forwards the signal to its separate Go group.
    signalGroup(child.pid, signal);
    // Allow Go escalation and the bounded helper/PostgreSQL cleanup to finish before forcing
    // this group down, including children that keep our output pipes open.
    escalation = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 45000);
  }
  current = { stop };
  child.once("exit", () => {
    // An exited build may still have a child holding stdout/stderr. Waiting
    // only for 'close' would leave the credential fixture alive indefinitely.
    if (groupExists(child.pid)) stop("SIGTERM");
  });
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
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop("SIGTERM"); }, 8 * 60 * 1000);
  let code;
  try { code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); }); }
  finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    // Descendants can close their pipes without exiting. Stop any survivors
    // from this owned group before the caller removes its private fixture.
    if (groupExists(child.pid)) signalGroup(child.pid, "SIGKILL");
    current = undefined;
  }
  if (timedOut) throw new Error(`${tests[group]} exceeded the eight-minute build/test timeout`);
  if (code !== 0 || !passed || skipped) throw new Error(`${tests[group]} ${skipped ? "was skipped despite its fixture" : !passed ? "did not pass" : `failed (exit ${code})`}`);
}

const results = [];
for (const group of groups) {
  if (stopped) break;
  const fixture = realpathSync(mkdtempSync("/tmp/ll-live."));
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
process.exitCode = stopped ? 128 + osConstants.signals[stopped] : results.some((r) => r.status === "failed") ? 1 : results.some((r) => r.status === "unavailable") ? 2 : 0;
