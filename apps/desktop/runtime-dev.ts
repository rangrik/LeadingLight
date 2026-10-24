// The project runtime for the browser build (DECISIONS.md, 18): the berthd the Mac app bundles,
// started by the dev server for this checkout with its own state, tmux server and ports, and
// reached at /__runtime as the app reaches it through src-tauri/src/runtime.rs.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Connect, Plugin } from "vite";

const here = import.meta.dirname;
const bin = path.join(here, "src-tauri/binaries/berthd-aarch64-apple-darwin");
const hash = createHash("sha256").update(here).digest("hex").slice(0, 8);
// Under Caches: a unix socket's path must stay short.
const home = path.join(os.homedir(), "Library/Caches/leadinglight-runtime", `dev-${hash}`);
const sock = path.join(home, "box/berthd.sock");

type Status = { state: "stopped" | "ready" | "failed"; version?: string | null; error?: string | null; home: string };

const call = (method: string, p: string, body?: Buffer) =>
  new Promise<{ status: number; body: Buffer }>((ok, fail) => {
    const req = request({ socketPath: sock, method, path: p, headers: { "content-type": "application/json" } }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
    });
    req.on("error", fail);
    req.setTimeout(3000, () => req.destroy(new Error("timed out")));
    req.end(body);
  });
const info = () => call("GET", "/v1/info").then((r) => (r.status === 200 ? (JSON.parse(r.body.toString()) as { build: string; version: string }) : null), () => null);
// The binary's version and build. A running berthd says its build from its file, which a rebuild
// replaces, so the version (which names the patch set) is compared too.
const buildOf = () => {
  try {
    const m = /berthd (\S+) \(build ([0-9a-f]+)/.exec(execFileSync(bin, ["version"]).toString());
    return m ? { version: m[1], build: m[2] } : null;
  } catch {
    return null;
  }
};
let loginPath: string | undefined;
const shellPath = () => (loginPath ??= execFileSync(process.env.SHELL ?? "/bin/zsh", ["-ilc", "printenv PATH"]).toString().trim().split("\n").pop());

// This Mac's Codex, its account and models, read as the app reads them (src-tauri/src/clis.rs):
// project chats run it for real, so the browser build offers its real models.
function codexStatus(): Promise<{ status: number; body: unknown }> {
  return new Promise((done) => {
    const p = spawn("codex", ["app-server"], { env: { ...process.env, PATH: shellPath() }, stdio: ["pipe", "pipe", "ignore"] });
    const got: Record<number, unknown> = {};
    let buf = "";
    const end = (status: number, body: unknown) => (p.kill(), done({ status, body }));
    const timer = setTimeout(() => end(504, { error: "Codex didn't answer" }), 15000);
    p.on("error", () => (clearTimeout(timer), end(500, { error: "Codex is not installed" })));
    p.stdout.on("data", (d: Buffer) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m: { id?: number };
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 0) for (const x of [{ method: "initialized" }, { method: "account/read", id: 1, params: {} }, { method: "model/list", id: 2, params: {} }]) p.stdin.write(`${JSON.stringify(x)}\n`);
        if (m.id === 1 || m.id === 2) got[m.id] = m;
        if (got[1] && got[2]) (clearTimeout(timer), end(200, { account: got[1], models: got[2] }));
      }
    });
    p.stdin.write(`${JSON.stringify({ method: "initialize", id: 0, params: { clientInfo: { name: "leadinglight", version: "dev" }, capabilities: { experimentalApi: true } } })}\n`);
  });
}

let starting: Promise<Status> | null = null;
async function ensure(restart: boolean): Promise<Status> {
  const want = buildOf();
  if (!want) return { state: "failed", error: "No runtime built yet: run pnpm runtime:build.", home };
  const running = await info();
  if (running && running.build === want.build && running.version === want.version && !restart) return { state: "ready", version: running.version, home };
  if (running) {
    const pid = Number(fs.existsSync(path.join(home, "berthd.pid")) && fs.readFileSync(path.join(home, "berthd.pid"), "utf8"));
    if (pid) process.kill(pid, "SIGTERM");
    for (let i = 0; i < 100 && (await info()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  fs.mkdirSync(path.join(home, "user"), { recursive: true });
  const log = fs.openSync(path.join(home, "berthd.log"), "a");
  const env = {
    HOME: os.homedir(), USER: process.env.USER, LOGNAME: process.env.LOGNAME, SHELL: process.env.SHELL, TMPDIR: process.env.TMPDIR,
    LANG: "en_US.UTF-8", PATH: shellPath(), BERTH_HOME: home, BERTH_USER_DIR: path.join(home, "user"), BERTH_EMBEDDED: "1",
    BERTH_TMUX_SOCKET: `leadinglight-dev-${hash}`, BERTH_PORT_BASE: String(48000 + (parseInt(hash, 16) % 9) * 100),
  };
  // Detached, as the app starts it: stopping the dev server leaves agents and runs going.
  const child = spawn(bin, ["serve", "--listen", "127.0.0.1:0"], { env, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  fs.writeFileSync(path.join(home, "berthd.pid"), String(child.pid));
  fs.writeFileSync(path.join(home, "instance"), `tmux=${env.BERTH_TMUX_SOCKET}\nports=${env.BERTH_PORT_BASE}\n`);
  for (let i = 0; i < 130; i++) {
    const up = await info();
    if (up) return { state: "ready", version: up.version, home };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { state: "failed", error: fs.readFileSync(path.join(home, "berthd.log"), "utf8").trim().split("\n").pop(), home };
}

const handler: Connect.NextHandleFunction = (req, res) => {
  const url = new URL(req.url ?? "/", "http://box");
  if (url.pathname === "/codex") {
    void codexStatus().then(({ status, body }) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)));
    return;
  }
  if (url.pathname === "/status") {
    const start = url.searchParams.has("start") || url.searchParams.has("restart");
    const status = start ? (starting ??= ensure(url.searchParams.has("restart")).finally(() => (starting = null))) : info().then<Status>((i) => (i ? { state: "ready", version: i.version, home } : { state: "stopped", home }));
    void status.then((s) => res.setHeader("content-type", "application/json").end(JSON.stringify(s)));
    return;
  }
  // Everything else goes to berthd as it is, streams included (its events).
  const up = request({ socketPath: sock, method: req.method, path: url.pathname + url.search, headers: { "content-type": "application/json" } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { "content-type": r.headers["content-type"] ?? "application/json" });
    r.pipe(res);
    // berthd gone mid-answer (a restart): the answer ends, so a stream's reader opens it again.
    r.on("close", () => res.end());
  });
  up.on("error", (e) => (res.headersSent ? res.destroy() : res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ code: "runtime_down", error: e.message }))));
  res.on("close", () => up.destroy());
  req.pipe(up);
};

export function projectRuntime(): Plugin {
  return { name: "project-runtime", apply: "serve", configureServer: (server) => void server.middlewares.use("/__runtime", handler) };
}
