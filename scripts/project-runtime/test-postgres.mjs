// A disposable, authenticated PostgreSQL for the real runtime tests. This never
// consumes a caller's database URL or starts/stops a machine-wide service.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, appendFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForExit(exit, ms) {
  let timer;
  try { await Promise.race([exit, new Promise((done) => { timer = setTimeout(done, ms); })]); }
  finally { clearTimeout(timer); }
}

async function binary(name, binDir, env) {
  for (const dir of binDir ? [binDir] : (env.PATH || "").split(delimiter).filter(Boolean)) {
    const file = resolve(dir, name);
    try { await access(file, constants.X_OK); return file; } catch {}
  }
  throw new Error(`PostgreSQL fixture needs ${name}; install PostgreSQL or set LL_RUNTIME_POSTGRES_BIN to its bin directory`);
}

function killGroup(pid) {
  try { process.kill(-pid, "SIGKILL"); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
}

async function command(file, args, { env, signal, log, timeout = 30_000 }) {
  signal?.throwIfAborted();
  let output = "";
  let failure;
  const child = spawn(file, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const cancel = (reason) => {
    failure = reason;
    if (child.pid) killGroup(child.pid);
  };
  const abort = () => cancel(new Error("PostgreSQL fixture startup cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => cancel(new Error(`${file} timed out`)), timeout);
  try {
    const result = await new Promise((done) => {
      child.once("error", (error) => done({ error }));
      child.once("close", (code, signal) => done({ code, signal }));
    });
    if (log) await appendFile(log, `$ ${file} ${args.join(" ")}\n${output}`);
    if (failure) throw failure;
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`${file} failed (${result.code ?? result.signal}): ${output.trim()}`);
    return output;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((done, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", done);
  });
  const port = listener.address().port;
  await new Promise((done, reject) => listener.close((err) => err ? reject(err) : done()));
  return port;
}

// stateDir belongs to test-run.mjs. The optional AbortSignal also covers initdb
// and readiness; shutdown deliberately ignores that already-aborted signal.
export async function startPostgresFixture({ stateDir, env = process.env, binDir = env.LL_RUNTIME_POSTGRES_BIN, signal } = {}) {
  signal?.throwIfAborted();
  if (!stateDir) throw new Error("PostgreSQL fixture needs an owned test state directory");
  const state = await realpath(stateDir);
  const parent = await lstat(state);
  if (!parent.isDirectory() || parent.uid !== process.getuid()) throw new Error("unsafe PostgreSQL fixture state directory");
  const [initdb, postgres, psql] = await Promise.all(["initdb", "postgres", "psql"].map((name) => binary(name, binDir, env)));
  // Ignore ambient libpq service files, database addresses and passwords.
  const pgEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("PG")));
  pgEnv.TZ = "UTC";
  const dir = await mkdtemp(join(state, "pg."));
  const identity = await lstat(dir);
  const marker = randomBytes(16).toString("hex");
  const mark = join(dir, ".leadinglight-postgres-fixture");
  await writeFile(mark, marker, { mode: 0o600 });
  const data = join(dir, "data");
  const socket = join(dir, "socket");
  const log = join(dir, "setup.log");
  const serverLog = join(dir, "postgres.log");
  let server;
  let serverExit;
  let ended = false;
  let stopping;
  const stop = () => stopping ??= (async () => {
    if (server?.pid && !ended) {
      server.kill("SIGINT"); // PostgreSQL's fast shutdown: rollback and disconnect.
      await waitForExit(serverExit, 5000);
      if (!ended) {
        killGroup(server.pid);
        await waitForExit(serverExit, 5000);
      }
      if (!ended) throw new Error(`PostgreSQL fixture did not exit; kept ${dir}`);
    }
    const now = await lstat(dir);
    if (now.dev !== identity.dev || now.ino !== identity.ino || now.isSymbolicLink() ||
        dirname(await realpath(dir)) !== state || await readFile(mark, "utf8") !== marker) {
      throw new Error(`PostgreSQL fixture directory changed; kept ${dir}`);
    }
    await rm(dir, { recursive: true, force: true });
  })();
  try {
    await mkdir(socket, { mode: 0o700 });
    if (Buffer.byteLength(join(socket, ".s.PGSQL.65535")) >= 104) throw new Error("PostgreSQL fixture needs a shorter stateDir for Unix sockets (use /tmp)");
    const password = randomBytes(24).toString("hex");
    const passwordFile = join(dir, "password");
    await writeFile(passwordFile, password + "\n", { mode: 0o600 });
    await command(initdb, ["-D", data, "-U", "ll_runtime", "--pwfile", passwordFile,
      "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C"], { env: pgEnv, signal, log });
    await rm(passwordFile);
    signal?.throwIfAborted();
    const port = await unusedPort();
    const handle = await open(serverLog, "a", 0o600);
    try {
      server = spawn(postgres, ["-D", data, "-h", "127.0.0.1", "-p", String(port), "-k", socket,
        "-c", "timezone=UTC", "-c", "log_timezone=UTC", "-c", "fsync=off", "-c", "max_connections=40"],
      { env: pgEnv, detached: true, stdio: ["ignore", handle.fd, handle.fd] });
      serverExit = new Promise((done) => {
        server.once("error", (error) => { ended = true; done({ error }); });
        server.once("exit", (code, signal) => { ended = true; done({ code, signal }); });
      });
      await new Promise((done, reject) => { server.once("spawn", done); server.once("error", reject); });
    } finally { await handle.close(); }
    const deadline = Date.now() + 15_000;
    let ready = false;
    let lastError;
    while (!ended && Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        // Readiness uses the private socket: a TCP bind race can never validate
        // or run SQL against a database that was already on the machine.
        const answer = await command(psql, ["-X", "-A", "-t", "-w", "-h", socket, "-p", String(port),
          "-U", "ll_runtime", "-d", "postgres", "-c", "SELECT current_user, current_setting('TimeZone')"],
        { env: { ...pgEnv, PGPASSWORD: password, PGCONNECT_TIMEOUT: "2" }, signal, timeout: 3000 });
        if (answer.trim() !== "ll_runtime|UTC") throw new Error(`unexpected PostgreSQL fixture identity: ${answer.trim()}`);
        ready = true;
        break;
      } catch (err) { lastError = err; }
      await pause(100);
    }
    signal?.throwIfAborted();
    if (!ready || ended) throw new Error(`PostgreSQL fixture did not start: ${lastError?.message || "server exited"}\n${await readFile(serverLog, "utf8")}`);
    const url = `postgres://ll_runtime:${password}@127.0.0.1:${port}/postgres?sslmode=disable`;
    return { env: { BERTH_DATABASE_TEST_POSTGRES: url, BERTH_LEADLINE_TEST_POSTGRES: url }, stop, dir };
  } catch (err) {
    // Preserve diagnostics outside the fixture directory before removing data.
    for (const file of [log, serverLog]) {
      try { await appendFile(join(state, "postgres-fixture-failure.log"), await readFile(file)); } catch {}
    }
    await stop();
    throw err;
  }
}
