// Drives the built runtime against real Claude Code and Codex: launch, send,
// answer, approve, restart, resume, an agent's browser in a plain folder, and requests
// answered once by id.
// Run after every runtime update.
//   node scripts/project-runtime/probe.mjs [claude|codex|browser|requests]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const bin = resolve("apps/desktop/src-tauri/binaries/berthd-aarch64-apple-darwin");
if (!existsSync(bin)) {
  console.error(`No runtime at ${bin}: run pnpm runtime:build first.`);
  process.exit(1);
}
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
const watched = [join(homedir(), ".claude", "settings.json"), join(homedir(), ".codex", "config.toml"), join(homedir(), ".codex", "hooks.json")];
const mtimes = () => watched.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0));
const before = mtimes();
// Claude Code writes ~/.claude.json itself; the person's MCP servers in it must stay theirs.
const mcp = () => { try { return JSON.stringify(JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8")).mcpServers ?? null); } catch { return ""; } };
const mcpBefore = mcp();
const theirs = () => tmuxList("berth").sort().join();
const theirsBefore = theirs();
// The probe's own tmux server, as seen while its agents run.
const ours = new Set();
const seeOurs = () => tmuxList(tmux).forEach((n) => ours.add(n));

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
    BERTH_HOME: state, BERTH_USER_DIR: join(root, "user"), BERTH_TMUX_SOCKET: tmux, BERTH_EMBEDDED: "1", BERTH_PORT_BASE: "47500" };
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
      // A file's content comes as it is, not as JSON.
      const parse = () => { try { return JSON.parse(text); } catch { return text; } };
      res.on("end", () => ok({ status: res.statusCode, json: text ? parse() : null }));
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

// The question asked, with the options it was told to offer; two answers at once, of which
// exactly one goes to the agent, which then shows it answered with that.
async function answerTwice(s, q, words, options, picks) {
  const asked = q.questions?.[0];
  if (!asked?.question.toLowerCase().includes(words) || options.some((o) => !asked.options?.some((x) => x.label === o))) throw new Error(`asked ${JSON.stringify(asked)}`);
  const body = { tool: q.tool, answers: [{ picks }] };
  const [a, b] = await Promise.all([api("POST", `/v1/sessions/${s}/answer`, body), api("POST", `/v1/sessions/${s}/answer`, body)]);
  const codes = [a.status, b.status].sort();
  if (codes.join() !== "200,409") throw new Error(`answers gave ${codes}`);
  const done = await until("question done", async () => (await items(s)).find((i) => i.tool === q.tool && i.done));
  if (done.answers?.join() !== picks.join()) throw new Error(`answered ${done.answers}`);
  return { asked: asked.question, codes, answers: done.answers };
}
const offers = (session, labels) => labels.every((l) => session.ask.choices?.some((c) => c.label === l)) || failWith(`offered ${JSON.stringify(session.ask)}`);
const failWith = (m) => {
  throw new Error(m);
};
async function resume(conv) {
  const r = await api("POST", `/v1/conversations/${conv}/resume`, {});
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return r.json;
}
const convOf = async (s) => (await api("GET", "/v1/conversations")).json.find((c) => c.session === s).id;

async function claude() {
  const s = "probe-claude";
  let resumed;
  await check("claude: launches in the folder", async () => {
    const r = await api("POST", "/v1/sessions", { name: s, location: "plain", agent: "claude", driver: "claude", mode: "default", model: "sonnet", effort: "low",
      prompt: "Use the AskUserQuestion tool to ask me one single-choice question: which colour do I prefer, options Red and Blue. Then use the Write tool to write my answer to answer.txt, then reply DONE." });
    if (r.status !== 200 || r.json.dir !== folder.replace(/^\/tmp/, "/private/tmp")) throw new Error(JSON.stringify(r.json));
    return r.json.dir;
  });
  await check("claude: a question answered twice at once reaches it once", async () => answerTwice(s, await openQuestion(s), "colour", ["Red", "Blue"], ["Blue"]));
  await check("claude: an approval reaches the person and is given", async () => {
    offers(await asking(s, "Write"), ["Yes", "No"]);
    seeOurs();
    await pick(s, "1");
    await until("answer.txt", async () => readFileSync(join(folder, "answer.txt"), "utf8").trim() === "Blue");
  });
  await check("claude: agents outlive the runtime restarting", async () => {
    await stop();
    await start();
    if (!(await session(s))) throw new Error("session gone after restart");
    const q = await until("its conversation", async () => (await items(s)).find((i) => i.kind === "question"));
    if (q.answers?.join() !== "Blue") throw new Error("its conversation is gone");
    // The same agent, still running, answers under the new runtime.
    const n = (await items(s)).length;
    await send(s, "Reply with the single word STILL.", "claude-restart");
    await replyAfter(s, n, "STILL");
  });
  await check("claude: resumes with its model and context; a repeated send is one turn", async () => {
    const conv = await convOf(s);
    await api("DELETE", `/v1/sessions/${s}`);
    const r = await resume(conv);
    resumed = r.name;
    if (!r.command.includes("--model sonnet") || !r.command.includes("--effort low")) throw new Error(`resumed without its model or effort: ${r.command}`);
    const n = (await items(r.name)).length;
    const [a, b] = [await send(r.name, "What colour did I pick? One word.", "claude-1"), await send(r.name, "What colour did I pick? One word.", "claude-1")];
    if (a.status !== 200 || !b.json.duplicate || a.json.turn !== b.json.turn) throw new Error(`sends ${JSON.stringify([a.json, b.json])}`);
    await replyAfter(r.name, n, "Blue");
  });
  await check("claude: a model and effort set while it runs reach it", async () => {
    await until("idle", async () => (await session(resumed))?.agent_state === "finished");
    const r = await api("POST", `/v1/sessions/${resumed}/model`, { model: "haiku", effort: "medium" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.json));
    const n = (await items(resumed)).length;
    await send(resumed, "Reply with the single word OK.", "claude-m");
    await replyAfter(resumed, n, "OK");
    const log = readFileSync(join(state, "box", "conversations", await convOf(resumed), "events.jsonl"), "utf8");
    const last = [...log.matchAll(/"model":"(claude-[^"]+)"/g)].at(-1)?.[1];
    if (!last?.includes("haiku")) throw new Error(`answered by ${last}`);
    const meta = (await api("GET", "/v1/conversations")).json.find((c) => c.session === resumed);
    if (meta.model !== "haiku" || meta.effort !== "medium") throw new Error(`kept ${meta.model} ${meta.effort}`);
    return { model: last };
  });
  await check("claude: an attachment stays out of the folder, and the agent reads it unasked", async () => {
    const word = `kiwi${Date.now() % 100000}`;
    const a = await api("POST", `/v1/sessions/${resumed}/attachments`, { name: "note.txt", data: Buffer.from(`The word is ${word}.`).toString("base64") });
    if (a.status !== 200 || a.json.path.startsWith(folder.replace(/^\/tmp/, "/private/tmp")) || a.json.path.startsWith(folder)) throw new Error(JSON.stringify(a.json));
    const n = (await items(resumed)).length;
    await send(resumed, `Read the file ${a.json.path} and reply with only the word in it.`, "claude-a");
    await replyAfter(resumed, n, word);
    const asked = ((await api("GET", `/v1/sessions/${resumed}/requests`)).json ?? []).filter((x) => x.opened > Date.now() - 120000 && x.tool === "Read");
    if (asked.length) throw new Error("it asked to read its own attachment");
    return { path: a.json.path };
  });
}

async function codex() {
  const s = "probe-codex";
  await check("codex: an approval reaches the person, not Codex's auto-review", async () => {
    // No effort asked for: Codex keeps the person's own.
    await api("POST", "/v1/sessions", { name: s, location: "plain", agent: "codex", driver: "codex", mode: "default",
      prompt: "Run exactly: curl -sI https://example.com | head -1 . The sandbox blocks network, so request approval with escalated permissions. Then reply with the status line." });
    offers(await asking(s, "Bash"), ["Yes", "No"]);
    seeOurs();
    const n = (await items(s)).length;
    await pick(s, "1");
    // Any status line: the command ran with the network the approval gave it.
    await replyAfter(s, n, "HTTP/");
    // Codex itself says the request is resolved, not only that the answer was written.
    const log = readFileSync(join(state, "box", "conversations", await convOf(s), "events.jsonl"), "utf8");
    if (!log.includes('"serverRequest/resolved"')) throw new Error("Codex never said the approval was resolved");
    const lines = log.trim().split("\n").map((l) => JSON.parse(l).data ?? {});
    const own = lines.find((d) => d.result?.thread)?.result.reasoningEffort;
    const sent = lines.find((d) => d.method === "turn/start")?.params.collaborationMode?.settings.reasoning_effort;
    if (!own || sent !== own) throw new Error(`thread's effort ${own}, turn sent ${sent}`);
    return { effort: own };
  });
  await check("codex: asks its question in plan mode, answered once", async () => {
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    await api("POST", `/v1/sessions/${s}/mode`, { mode: "plan" });
    await send(s, "Before planning anything, use request_user_input to ask me one question: which fruit do I prefer, options Apple and Pear. Then reply with only the fruit.", "codex-q");
    const answered = await answerTwice(s, await openQuestion(s), "fruit", ["Apple", "Pear"], ["Pear"]);
    // The plan turn takes the person's plan effort from their config, when they set one.
    const lines = readFileSync(join(state, "box", "conversations", await convOf(s), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).data ?? {});
    const own = lines.find((d) => d.result?.config)?.result.config.plan_mode_reasoning_effort;
    const sent = lines.find((d) => d.method === "turn/start" && d.params.collaborationMode?.mode === "plan")?.params.collaborationMode.settings.reasoning_effort;
    if (own && sent !== own) throw new Error(`plan effort ${own} in config, plan turn sent ${sent}`);
    return { ...answered, planEffort: sent };
  });
  await check("codex: an edit approval names its file and its lines", async () => {
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    await api("POST", `/v1/sessions/${s}/mode`, { mode: "untrusted" });
    await send(s, "Create edit.txt containing the line hello codex, with your patch tool (apply_patch), not a shell command.", "codex-e");
    // Untrusted asks before every command too; those are allowed on the way to the edit.
    const edit = await until("an edit approval", async () => {
      const open = ((await api("GET", `/v1/sessions/${s}/requests`)).json ?? []).filter((r) => r.state === "pending");
      for (const r of open.filter((r) => r.tool === "Bash")) await api("POST", `/v1/sessions/${s}/requests/${encodeURIComponent(r.id)}/respond`, { command: `probe-${r.id}`, choice: "allow" });
      return open.find((r) => r.tool === "Edit");
    });
    const change = edit.input?.changes?.[0];
    if (!change?.path?.endsWith("edit.txt") || !change.diff?.includes("hello codex")) throw new Error(JSON.stringify(edit.input));
    await api("POST", `/v1/sessions/${s}/requests/${encodeURIComponent(edit.id)}/respond`, { command: "probe-e1", choice: "allow" });
    await until("edit.txt", async () => readFileSync(join(folder, "edit.txt"), "utf8").includes("hello codex"));
    const kept = await until("its output", async () => (await api("GET", `/v1/conversations/${await convOf(s)}/outputs`)).json?.find((o) => o.path.endsWith("edit.txt") && o.kept));
    if (!kept) throw new Error("Codex's file change wasn't kept");
    return { path: change.path.split("/").at(-1) };
  });
  await check("codex: a model and effort set while it runs reach its next turn", async () => {
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    const conv = await convOf(s);
    const log = () => readFileSync(join(state, "box", "conversations", conv, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).data ?? {});
    // Its own model again, so the check needs no particular account; the effort is what changes.
    const model = log().find((d) => d.result?.thread)?.result.model;
    const r = await api("POST", `/v1/sessions/${s}/model`, { model, effort: "low" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.json));
    await api("POST", `/v1/sessions/${s}/mode`, { mode: "default" });
    const n = (await items(s)).length;
    await send(s, "Reply with the single word OK.", "codex-m");
    await replyAfter(s, n, "OK");
    const turn = log().filter((d) => d.method === "turn/start").at(-1)?.params;
    if (turn?.model !== model || turn?.effort !== "low") throw new Error(`next turn ${turn?.model} ${turn?.effort}`);
    return { model, effort: turn.effort };
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

// Workers (patch 0018): a lead hands work to another agent with the runtime's own commands, told
// of them in its instructions, and the result comes back to it without anyone copying it over.
async function workers() {
  const lead = "probe-lead";
  await check("workers: a lead hands work to a Codex worker, and its result comes back by itself", async () => {
    await api("POST", "/v1/sessions", { name: lead, location: "plain", agent: "claude", driver: "claude", mode: "bypassPermissions", model: "sonnet", effort: "low",
      prompt: "Hand this task to a Codex worker, not doing it yourself: 'Reply with the single word MANGO.' Then end your turn. When the worker's result reaches you, reply with only the word it gave." });
    const reply = await until("the worker's word, back with the lead", async () => (await items(lead)).some((i) => i.kind === "report") && (await items(lead)).filter((i) => i.kind === "text").at(-1)?.text?.includes("MANGO"), 300_000);
    const all = (await api("GET", "/v1/sessions")).json;
    const worker = all.find((x) => x.name !== lead && x.agent === "codex" && x.location?.startsWith("plain"));
    if (!reply || !worker) throw new Error(`sessions ${JSON.stringify(all.map((x) => [x.name, x.agent]))}`);
    // Started by a lead with full access, it has it too: nobody else is there to answer its asks.
    const mode = (await api("GET", "/v1/conversations")).json.find((c) => c.session === worker.name)?.mode;
    if (mode !== "bypassPermissions") throw new Error(`the worker's mode is ${mode}`);
    return { worker: worker.name, mode };
  });
  await check("workers: a checked loop repairs within its bound", async () => {
    // A task the first try won't meet, and a check that says why: the loop feeds that back.
    await api("POST", "/v1/sessions", { name: "probe-fixer", location: "plain", agent: "claude", driver: "claude", mode: "bypassPermissions", model: "sonnet", effort: "low" });
    rmSync(join(folder, "n.txt"), { force: true });
    const check = 'test "$(cat n.txt)" = 3 || { echo "n.txt must hold 3, it holds $(cat n.txt)"; exit 1; }';
    // Started as the lead would, from its session: the lead hears how it ended.
    const said = execFileSync(bin, ["loop", "probe-fixer", "--prompt", "Write the number 1 to n.txt, nothing else.", "--check", check, "--max", "3", "--detach"], { env: { ...process.env, BERTH_HOME: state, BERTH_SESSION: lead } }).toString();
    const id = /Loop run (\S+) started/.exec(said)?.[1];
    if (!id) throw new Error(said);
    const run = await until("the loop ended", async () => { const r = (await api("GET", `/v1/runs/${id}`)).json; return ["succeeded", "failed", "cancelled"].includes(r?.status) && r; }, 400_000);
    const n = readFileSync(join(folder, "n.txt"), "utf8").trim();
    if (run.status !== "succeeded" || n !== "3") throw new Error(`run ${run.status}, n.txt ${n}`);
    await until("the lead told of the run", async () => (await items(lead)).some((i) => i.kind === "report" && i.report?.run === id), 120_000);
    return { run: id, status: run.status };
  });
  await check("workers: the same worker launched twice is one", async () => {
    const body = { name: "probe-once", location: "plain", agent: "claude", driver: "claude", mode: "default", model: "haiku", effort: "low" };
    const [a, b] = [await api("POST", "/v1/sessions", body), await api("POST", "/v1/sessions", body)];
    const n = (await api("GET", "/v1/sessions")).json.filter((x) => x.name === "probe-once").length;
    if (a.status !== 200 || b.status < 400 || n !== 1) throw new Error(`${a.status} ${b.status}, ${n} sessions`);
  });
}

// The runtime's requests (patch 0007): each asked thing named once, answered once by command.
async function requests() {
  const s = "probe-requests";
  const open = (kind) => until(`a pending ${kind}`, async () => (await api("GET", `/v1/sessions/${s}/requests`)).json?.find((r) => r.kind === kind && r.state === "pending"));
  const respond = (id, body) => api("POST", `/v1/sessions/${s}/requests/${encodeURIComponent(id)}/respond`, body);
  let question;
  await check("requests: a question is named by its process and Claude's own id", async () => {
    await api("POST", "/v1/sessions", { name: s, location: "plain", agent: "claude", driver: "claude", mode: "default", model: "sonnet", effort: "low",
      prompt: "Use AskUserQuestion to ask me one single-choice question: which season do I prefer, options Summer and Winter. Then use the Write tool to write my answer to season.txt, then reply DONE." });
    question = await open("question");
    if (!/^\d+-/.test(question.id) || question.questions?.[0]?.options?.length !== 2) throw new Error(JSON.stringify(question));
    return question.id;
  });
  await check("requests: the same command twice is one answer and one receipt; another command is refused", async () => {
    const body = { command: "probe-q1", answers: [{ picks: ["Winter"] }] };
    const [a, b] = await Promise.all([respond(question.id, body), respond(question.id, body)]);
    if (a.status !== 200 || b.status !== 200 || a.json.receipt.state !== "written" || JSON.stringify(a.json.receipt) !== JSON.stringify(b.json.receipt)) throw new Error(JSON.stringify([a.json, b.json]));
    const other = await respond(question.id, { command: "probe-q2", answers: [{ picks: ["Summer"] }] });
    if (other.status !== 409) throw new Error(`another command: ${other.status} ${JSON.stringify(other.json)}`);
    const done = await until("resolved", async () => (await api("GET", `/v1/sessions/${s}/requests`)).json.find((r) => r.id === question.id && r.state === "resolved"));
    const asked = (await items(s)).find((i) => i.kind === "question");
    if (asked?.answers?.join() !== "Winter") throw new Error(`answered ${asked?.answers}`);
    return { state: done.state, command: done.command };
  });
  await check("requests: an approval is answered by id, and what an ended process asked can't be answered", async () => {
    const approval = await open("approval");
    const r = await respond(approval.id, { command: "probe-a1", choice: "allow" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.json));
    await until("season.txt", async () => readFileSync(join(folder, "season.txt"), "utf8").includes("Winter"));
    // The file as Claude's write left it is kept, and stays so when the file changes.
    const id = (await api("GET", "/v1/conversations")).json.find((c) => c.session === s).id;
    const out = await until("its output", async () => (await api("GET", `/v1/conversations/${id}/outputs`)).json?.find((o) => o.path.endsWith("season.txt") && o.kept));
    writeFileSync(join(folder, "season.txt"), "changed since");
    const kept = await api("GET", `/v1/conversations/${id}/outputs/${out.id}`);
    if (!String(kept.json).includes("Winter")) throw new Error(`kept ${JSON.stringify(kept.json)}`);
    await until("idle", async () => (await session(s))?.agent_state === "finished");
    // A new question, then the agent's process ends before it's answered.
    await send(s, "Use AskUserQuestion to ask me which drink I prefer, options Tea and Coffee.", "probe-r2");
    const left = await open("question");
    await api("DELETE", `/v1/sessions/${s}`);
    const conv = (await api("GET", "/v1/conversations")).json.find((c) => c.session === s).id;
    const back = (await resume(conv)).name;
    // Stopping it ends its turn (cancelled) or its process (expired): either way, never answered.
    const late = await api("POST", `/v1/sessions/${back}/requests/${encodeURIComponent(left.id)}/respond`, { command: "probe-r3", answers: [{ picks: ["Tea"] }] });
    if (![409, 410].includes(late.status) || !["cancelled", "expired"].includes(late.json?.request?.state)) throw new Error(`an ended process's question: ${late.status} ${JSON.stringify(late.json)}`);
    const log = readFileSync(join(state, "box", "conversations", conv, "events.jsonl"), "utf8");
    const native = left.id.slice(left.id.indexOf("-") + 1);
    if (log.split("\n").some((l) => l.includes('"dir":"in"') && l.includes(native))) throw new Error("an answer reached the agent");
    return { state: late.json.request.state };
  });
}

// A plain folder's own page, driven by an agent through its browser while an observer
// watches that tab, with nothing written into the folder.
async function browser() {
  const site = join(root, "site folder");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), '<!doctype html><title>Probe page</title><h1 id="h">Not pressed</h1><button onclick="h.textContent=\'Pressed\'">Press me</button><script>console.error("probe-console")</script>');
  const loc = (await api("POST", "/v1/locations", { name: "site", path: site })).json;
  const ws = loc.worktrees?.[0];
  await check("browser: a plain folder is its own workspace, with ports of the runtime's own", async () => {
    if (loc.repo || ws?.path !== loc.path || !(ws.port >= 47500)) throw new Error(JSON.stringify(loc));
    return ws;
  });
  const server = spawn("python3", ["-I", "-m", "http.server", String(ws.port), "--bind", "127.0.0.1"], { cwd: site, stdio: "ignore" });
  try {
    const s = "probe-browser";
    let frames = 0;
    let seen = "";
    const shown = new Set();
    await check("browser: the agent drives the folder's page and an observer sees that tab", async () => {
      await api("POST", "/v1/sessions", { name: s, location: "site", agent: "claude", driver: "claude", mode: "bypassPermissions", model: "sonnet", effort: "low",
        prompt: "Using only shell commands, in order: `command -v berthd`; `berthd browser open /`; `berthd browser snapshot`; click the button named Press me with `berthd browser click @REF`; `berthd browser snapshot`. Then reply with the heading you see and what command -v printed." });
      const tab = `/v1/worktrees/site/site/browser`;
      // Its tab is its own, named after its session.
      const own = `?tab=${s}`;
      await until("its browser", async () => (await api("GET", `${tab}/tabs`)).json?.tabs?.some((t) => t.name === s));
      // The observer: the tab's frames, as the app's live view reads them, until the agent is done.
      await new Promise((ok) => {
        const req = request({ socketPath: sock, path: `${tab}/screencast${own}` }, (res) => {
          let rest = "";
          res.on("data", (d) => {
            const lines = (rest + d).split("\n");
            rest = lines.pop();
            for (const l of lines.filter(Boolean)) {
              const f = JSON.parse(l);
              // A real picture of the tab: JPEG data, and more than one look as the page changes.
              if (Buffer.from(f.data ?? "", "base64").subarray(0, 2).toString("hex") === "ffd8") (frames++, shown.add(f.data));
              seen = f.url;
            }
          });
        });
        req.end();
        until("the agent done", async () => (await session(s))?.agent_state === "finished", 180_000).finally(() => (req.destroy(), ok()));
      });
      const reply = (await items(s)).filter((i) => i.kind === "text").at(-1)?.text ?? "";
      const page = (await api("POST", `${tab}/snapshot${own}`, {})).json.text;
      if (!reply.includes("Pressed") || !page.includes('heading "Pressed"')) throw new Error(`agent said ${reply}; the tab shows ${page}`);
      if (!reply.includes(join(state, "box", "bin", "berthd"))) throw new Error(`the agent's berthd is not the runtime's: ${reply}`);
      if (frames < 2 || shown.size < 2 || !seen.startsWith("http://site.")) throw new Error(`observer saw ${frames} frames (${shown.size} different) of ${seen}`);
      // A watcher's look at the console leaves the agent's unread messages unread.
      const peek = (await api("GET", `${tab}/console?peek=1&tab=${s}`)).json.text;
      await api("POST", `${tab}/eval${own}`, { js: 'console.error("probe-later")' });
      const agents = (await api("GET", `${tab}/console${own}`)).json.text;
      if (!peek.includes("probe-console") || !agents.includes("probe-later")) throw new Error(`peek ${peek}; agent then read ${agents}`);
      return { frames, different: shown.size, seen };
    });
    await check("browser: two agents in one workspace each have their own tab and cookies", async () => {
      const tab = `/v1/worktrees/site/site/browser`;
      const ask = (who) => `Using only shell commands, in order: \`berthd browser open /\`; \`berthd browser eval 'document.cookie="who=${who}"'\`; wait 5 seconds; \`berthd browser eval 'document.cookie'\`. Then reply with exactly what the last command printed.`;
      for (const who of ["A", "B"]) await api("POST", "/v1/sessions", { name: `probe-tab-${who}`, location: "site", agent: "claude", driver: "claude", mode: "bypassPermissions", model: "sonnet", effort: "low", prompt: ask(who) });
      for (const who of ["A", "B"]) await until(`${who} done`, async () => (await session(`probe-tab-${who}`))?.agent_state === "finished", 180_000);
      const said = {};
      for (const who of ["A", "B"]) said[who] = (await items(`probe-tab-${who}`)).filter((i) => i.kind === "text").at(-1)?.text ?? "";
      const tabs = (await api("GET", `${tab}/tabs`)).json.tabs.map((t) => t.name);
      if (!said.A.includes("who=A") || said.A.includes("who=B") || !said.B.includes("who=B") || said.B.includes("who=A")) throw new Error(`A saw ${said.A}; B saw ${said.B}`);
      if (!tabs.includes("probe-tab-A") || !tabs.includes("probe-tab-B")) throw new Error(`tabs ${tabs}`);
      return { tabs };
    });
    await check("browser: the folder holds only what it held", async () => {
      const left = execFileSync("find", [site, "-mindepth", "1"]).toString().trim().split("\n");
      if (left.join() !== join(site, "index.html")) throw new Error(`folder now holds ${left}`);
    });
  } finally {
    server.kill();
  }
}

try {
  await start();
  await api("POST", "/v1/locations", { name: "plain", path: folder });
  if (!only || only === "claude") await claude();
  if (!only || only === "codex") await codex();
  if (!only || only === "browser") await browser();
  if (!only || only === "requests") await requests();
  if (!only || only === "workers") await workers();
  await check("leaves the person's setup alone", async () => {
    if (mtimes().join() !== before.join()) throw new Error("agent config changed");
    if (mcp() !== mcpBefore) throw new Error("the person's MCP servers changed");
    seeOurs();
    if (!ours.size) throw new Error("the probe's agents were never in its own tmux server");
    if (theirs() !== theirsBefore) throw new Error("the person's tmux server changed");
    // Only the drivers' own turns, in the ledger and its archive: none from the person's berth hooks
    // firing inside the agents, nor a resumed conversation told twice.
    const archive = join(state, "box", "turns-archive.jsonl");
    const turns = readFileSync(join(state, "box", "turns.json"), "utf8") + (existsSync(archive) ? readFileSync(archive, "utf8") : "");
    if (/"origin":\s*"terminal"/.test(turns)) throw new Error("a turn no send started was recorded");
    return { ownServer: [...ours] };
  });
} finally {
  for (const x of (await api("GET", "/v1/sessions").catch(() => ({ json: [] }))).json ?? []) await api("DELETE", `/v1/sessions/${x.name}`).catch(() => {});
  await stop().catch(() => {});
  try { execFileSync("tmux", ["-L", tmux, "kill-server"], { stdio: "ignore" }); } catch {}
  rmSync(join("/private/tmp", `tmux-${process.getuid()}`, tmux), { force: true });
  writeFileSync(join(root, "report.json"), JSON.stringify({ binary: bin, version: execFileSync(bin, ["version"]).toString().trim(), checks }, null, 2));
  console.log(`report: ${join(root, "report.json")}`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}
