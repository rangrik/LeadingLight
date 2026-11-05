// Stop helpers launched by the isolated runtime tests after their Go process
// exits. Scope discovery to executable mappings under the run's private TMPDIR;
// never inspect the environment or signal a process found elsewhere.
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function command(file, args) {
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false;
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 15_000);
  try {
    const result = await new Promise((done) => {
      child.once("error", (error) => done({ error }));
      child.once("close", (code, signal) => done({ code, signal }));
    });
    if (timedOut) throw new Error(`${file} timed out`);
    if (result.error) throw new Error(`cannot run ${file}: ${result.error.message}`);
    return { ...result, stdout, stderr };
  } finally { clearTimeout(timer); }
}

function within(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

// lsof may return 1 even while emitting matching records on macOS.
async function mappings(root, pid) {
  const args = ["-nP", "-a", ...(pid ? ["-p", String(pid)] : []), "-d", "txt", "+D", root, "-Fpn"];
  const result = await command("lsof", args);
  if (![0, 1].includes(result.code) || result.stderr.trim()) {
    throw new Error(`lsof could not inspect test helpers: ${result.stderr.trim() || `exit ${result.code ?? result.signal}`}`);
  }
  const entries = [];
  let current;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) {
      if (!/^p[1-9][0-9]*$/.test(line)) throw new Error("unexpected lsof process record");
      current = Number(line.slice(1));
    } else if (line.startsWith("n")) {
      if (!current || !within(root, line.slice(1))) throw new Error("unexpected lsof executable path");
      entries.push({ pid: current, path: line.slice(1) });
    }
  }
  return entries;
}

async function identity(pid) {
  const result = await command("ps", ["-p", String(pid), "-o", "lstart=", "-o", "pgid="]);
  if (result.code === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
  if (result.code !== 0 || result.stderr.trim()) throw new Error(`could not inspect helper ${pid}`);
  const match = result.stdout.trim().match(/^(.+\S)\s+([0-9]+)$/);
  if (!match) throw new Error(`could not read helper ${pid} identity`);
  return { start: match[1], group: Number(match[2]) };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { if (err.code === "ESRCH") return false; throw err; }
}

async function matches(root, entry, id) {
  const now = await identity(entry.pid);
  if (!now || now.start !== id.start || now.group !== id.group) return false;
  const found = await mappings(root, entry.pid);
  return found.some((item) => item.pid === entry.pid && item.path === entry.path);
}

function send(pid, signal) {
  try { process.kill(pid, signal); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
}

// The caller validates and owns stateDir and keeps it until this returns.
export async function stopTestHelpers(stateDir) {
  const state = await realpath(stateDir);
  const tmp = resolve(state, "tmp");
  const stat = await lstat(tmp);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || await realpath(tmp) !== tmp) {
    throw new Error("unsafe runtime test helper directory; kept temporary directories");
  }
  const found = await mappings(tmp);
  const unique = new Map(found.map((entry) => [entry.pid, entry]));
  for (const entry of unique.values()) {
    const id = await identity(entry.pid);
    if (!id || !await matches(tmp, entry, id)) continue;
    const target = id.group === entry.pid ? -entry.pid : entry.pid;
    send(target, "SIGTERM");
    const deadline = Date.now() + 2000;
    while (alive(target) && Date.now() < deadline) await pause(25);
    if (alive(target)) {
      // Recheck the leader immediately before escalation. If only an
      // unidentifiable group remains, keep the state for manual inspection.
      if (!await matches(tmp, entry, id)) throw new Error(`helper ${entry.pid} group still exists but its leader changed; kept temporary directories`);
      send(target, "SIGKILL");
      const end = Date.now() + 5000;
      while (alive(target) && Date.now() < end) await pause(25);
      if (alive(target)) throw new Error(`helper ${entry.pid} did not exit; kept temporary directories`);
    }
  }
  if ((await mappings(tmp)).length) throw new Error("test helper processes still hold executables in the test directory; kept temporary directories");
}
