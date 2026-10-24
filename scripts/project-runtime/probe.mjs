// Drives the built runtime against real Claude Code and Codex: launch, send,
// answer, approve, restart, resume. Run after every runtime update.
//   node scripts/project-runtime/probe.mjs [claude|codex]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const bin = resolve("apps/desktop/src-tauri/binaries/berthd-aarch64-apple-darwin");
const only = process.argv[2];
const root = mkdtempSync("/tmp/ll-probe-");
const tmux = `ll-probe-${root.slice(-6)}`;
const state = join(root, "state");
const sock = join(state, "box", "berthd.sock");
const folder = join(root, "plain folder");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "notes.txt"), "hello\n");
const checks = [];
const loginPath = execFileSync("/bin/zsh", ["-lc", "echo $PATH"]).toString().trim();
// The person's own setup, which the runtime must leave alone.
const watched = [join(homedir(), ".claude", "settings.json"), join(homedir(), ".codex", "config.toml")];
const mtimes = () => watched.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0));
const before = mtimes();
const berthSessions = () => tmuxList("berth");

function tmuxList(name) {
  try {
    return execFileSync("tmux", ["-L", name, "ls", "-F", "#S"], { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let daemon;
function start() {
  const env = { HOME: homedir(), USER: process.env.USER, SHELL: "/bin/zsh", LANG: "en_US.UTF-8", TMPDIR: process.env.TMPDIR, PATH: loginPath,
    BERTH_HOME: state, BERTH_USER_DIR: join(root, "user"), BERTH_TMUX_SOCKET: tmux, BERTH_EMBEDDED: "1" };
  daemon = spawn(bin, ["serve", "--listen", "127.0.0.1:0"], { env, stdio: ["ignore", "ignore", "pipe"] });
  daemon.stderr.on("data", (d) => writeFileSync(join(root, "berthd.log"), d, { flag: "a" }));
  return until("berthd answers", () => api("GET", "/v1/info").then((r) => r.status === 200), 15_000);
}
async function stop() {
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.once("exit", r));
}

function api(method, path, body) {
  return new Promise((ok, fail) => {
    const req = request({ socketPath: sock, method, path, headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => ok({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on("error", fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out: ${what}`);
}
async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, ok: true, ms: Date.now() - t, detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, ms: Date.now() - t, detail: String(e.message ?? e) });
    console.log(`FAIL ${name}: ${e.message ?? e}`);
  }
}
const items = async (s) => (await api("GET", `/v1/sessions/${s}/transcript`)).json.items;
const session = async (s) => (await api("GET", "/v1/sessions")).json.find((x) => x.name === s);
const send = (s, text, idem) => api("POST", `/v1/sessions/${s}/send`, { text, when: "now", idem_key: idem });
const pick = (s, key) => api("POST", `/v1/sessions/${s}/send`, { text: key, enter: false });
const openQuestion = (s) => until("a question", async () => (await items(s)).find((i) => i.kind === "question" && !i.done));
const replyAfter = (s, n, word) => until(`a reply with ${word}`, async () => (await items(s)).slice(n).find((i) => i.kind === "text" && i.text.includes(word)));
const asking = (s, tool) => until(`asks for ${tool}`, async () => { const x = await session(s); return x?.agent_state === "waiting" && x.ask?.tool === tool && x; });

// Two answers at once: exactly one goes to the agent.
async function answerTwice(s, q, picks) {
  const body = { tool: q.tool, answers: [{ picks }] };
  const [a, b] = await Promise.all([api("POST", `/v1/sessions/${s}/answer`, body), api("POST", `/v1/sessions/${s}/answer`, body)]);
  const codes = [a.status, b.status].sort();
  if (codes.join() !== "200,409") throw new Error(`answers gave ${codes}`);
  await until("question done", async () => (await items(s)).find((i) => i.tool === q.tool && i.done));
  return codes;
}
async function resume(conv) {
  const r = await api("POST", `/v1/conversations/${conv}/resume`, {});
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return r.json;
}
const convOf = async (s) => (await api("GET", "/v1/conversations")).json.find((c) => c.session === s).id;

async function claude() {
  const s = "probe-claude";
  await check("claude: launches in the folder", async () => {
    const r = await api("POST", "/v1/sessions", { name: s, location: "plain", agent: "claude", driver: "claude", mode: "default", model: "sonnet", effort: "low",
      prompt: "Use the AskUserQuestion tool to ask me one single-choice question: which colour do I prefer, options Red and Blue. Then use the Write tool to write my answer to answer.txt, then reply DONE." });
    if (r.status !== 200 || r.json.dir !== folder.replace(/^\/tmp/, "/private/tmp")) throw new Error(JSON.stringify(r.json));
    return r.json.dir;
  });
  await check("claude: a question answered twice at once reaches it once", async () => answerTwice(s, await openQuestion(s), ["Blue"]));
  await check("claude: an approval reaches the person and is given", async () => {
    await asking(s, "Write");
    await pick(s, "1");
    await until("answer.txt", async () => readFileSync(join(folder, "answer.txt"), "utf8").trim() === "Blue");
  });
  await check("claude: agents outlive the runtime restarting", async () => {
    await stop();
    await start();
    if (!(await session(s))) throw new Error("session gone after restart");
  });
  await check("claude: resumes with its model and context; a repeated send is one turn", async () => {
    const conv = await convOf(s);
    await api("DELETE", `/v1/sessions/${s}`);
    const r = await resume(conv);
    if (!r.command.includes("--model sonnet")) throw new Error("resumed without its model");
    const n = (await items(r.name)).length;
    const [a, b] = [await send(r.name, "What colour did I pick? One word.", "claude-1"), await send(r.name, "What colour did I pick? One word.", "claude-1")];
    if (a.status !== 200 || !b.json.duplicate || a.json.turn !== b.json.turn) throw new Error(`sends ${JSON.stringify([a.json, b.json])}`);
    await replyAfter(r.name, n, "Blue");
  });
}

async function codex() {
  const s = "probe-codex";
  await check("codex: an approval reaches the person, not Codex's auto-review", async () => {
    await api("POST", "/v1/sessions", { name: s, location: "plain", agent: "codex", driver: "codex", mode: "default", effort: "low",
      prompt: "Run exactly: curl -sI https://example.com | head -1 . The sandbox blocks network, so request approval with escalated permissions. Then reply with the status line." });
    await asking(s, "Bash");
    const n = (await items(s)).length;
    await pick(s, "1");
    await replyAfter(s, n, "200");
  });
  await check("codex: asks its question in plan mode, answered once", async () => {
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    await api("POST", `/v1/sessions/${s}/mode`, { mode: "plan" });
    await send(s, "Before planning anything, use request_user_input to ask me one question: which fruit do I prefer, options Apple and Pear. Then reply with only the fruit.", "codex-q");
    return answerTwice(s, await openQuestion(s), ["Pear"]);
  });
  await check("codex: resumed and sent to at once, it carries on", async () => {
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    const conv = await convOf(s);
    await api("DELETE", `/v1/sessions/${s}`);
    const r = await resume(conv);
    const n = (await items(r.name)).length;
    const sent = await send(r.name, "Which fruit did I pick earlier? One word.", "codex-1");
    if (sent.status !== 200) throw new Error(JSON.stringify(sent.json));
    await replyAfter(r.name, n, "Pear");
  });
}

try {
  await start();
  await api("POST", "/v1/locations", { name: "plain", path: folder });
  if (only !== "codex") await claude();
  if (only !== "claude") await codex();
  await check("leaves the person's setup alone", async () => {
    if (mtimes().join() !== before.join()) throw new Error("agent config changed");
    const mine = tmuxList(tmux);
    if (berthSessions().some((n) => n.startsWith("probe-") || mine.includes(n))) throw new Error("a probe session is in the person's tmux server");
    return { ownServer: mine };
  });
} finally {
  for (const x of (await api("GET", "/v1/sessions").catch(() => ({ json: [] }))).json ?? []) await api("DELETE", `/v1/sessions/${x.name}`).catch(() => {});
  await stop().catch(() => {});
  try { execFileSync("tmux", ["-L", tmux, "kill-server"], { stdio: "ignore" }); } catch {}
  writeFileSync(join(root, "report.json"), JSON.stringify({ binary: bin, version: execFileSync(bin, ["version"]).toString().trim(), checks }, null, 2));
  console.log(`report: ${join(root, "report.json")}`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}
