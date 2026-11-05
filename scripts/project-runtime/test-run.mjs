#!/usr/bin/env node
// Run the isolated runtime tests in their own process group. The caller creates
// both marked directories and execs this process with the test environment.
import { spawn } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { constants } from "node:os";
import { startPostgresFixture } from "./test-postgres.mjs";
import { liveFixtureEnv } from "./live-fixture-env.mjs";
import { stopTestTmux } from "./test-tmux.mjs";
import { stopTestHelpers } from "./test-helpers.mjs";

const [buildArg, stateArg, ...testArgs] = process.argv.slice(2);

async function checkedDir(arg, name, marker, parent) {
  if (!arg || !isAbsolute(arg) || !name.test(basename(arg))) throw new Error(`invalid temporary directory: ${arg}`);
  const st = await lstat(arg);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error(`unsafe temporary directory: ${arg}`);
  const dir = await realpath(arg);
  if (parent && dirname(dir) !== await realpath(parent)) throw new Error(`unexpected temporary directory parent: ${arg}`);
  if (dirname(dir) === resolve("/")) throw new Error(`unsafe temporary directory parent: ${arg}`);
  const mark = await lstat(`${dir}/${marker}`);
  if (!mark.isFile() || mark.isSymbolicLink() || mark.uid !== process.getuid()) throw new Error(`missing temporary directory marker: ${arg}`);
  return { arg, dir, marker, dev: st.dev, ino: st.ino };
}

async function removeChecked(d, name, parent) {
  const now = await checkedDir(d.arg, name, d.marker, parent);
  if (now.dir !== d.dir || now.dev !== d.dev || now.ino !== d.ino) throw new Error(`temporary directory changed: ${d.arg}`);
  await rm(now.dir, { recursive: true, force: true });
}

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (err) { if (err.code === "ESRCH") return false; throw err; }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let child;
let received;
let timer;
const startup = new AbortController();
function cancel(signal) {
  if (received) return;
  received = signal;
  startup.abort();
  if (child?.pid) {
    signalGroup(child.pid, signal);
    timer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 2000);
  }
}
process.on("SIGINT", () => cancel("SIGINT"));
process.on("SIGTERM", () => cancel("SIGTERM"));

const buildName = /^build\.[a-zA-Z0-9]{6}$/;
const stateName = /^ll-rt\.[a-zA-Z0-9]{6}$/;
let build, state, postgres;
let cleanupAllowed = false;
async function validateState() {
  const now = await checkedDir(state.arg, stateName, state.marker, "/tmp");
  if (now.dir !== state.dir || now.dev !== state.dev || now.ino !== state.ino) throw new Error("runtime test state changed; kept temporary directories");
}
try {
  build = await checkedDir(buildArg, buildName, ".leadinglight-runtime-build");
  state = await checkedDir(stateArg, stateName, ".leadinglight-runtime-test-state", "/tmp");
  if (!relative(build.dir, state.dir) || !relative(state.dir, build.dir) ||
      !relative(build.dir, state.dir).startsWith("..") || !relative(state.dir, build.dir).startsWith("..")) {
    throw new Error("runtime test directories must be separate");
  }

  cleanupAllowed = true;
  startup.signal.throwIfAborted();
  const env = { ...process.env, ...await liveFixtureEnv(process.env.LL_RUNTIME_LIVE_FIXTURE, process.env) };
  env.BERTH_TEST_TMUX_ROOT = `${state.dir}/tmux`;
  if (process.env.LL_RUNTIME_TEST_FIXTURES === "1") {
    postgres = await startPostgresFixture({ stateDir: state.dir, env, signal: startup.signal });
    Object.assign(env, postgres.env, {
      BERTH_TEST_SHOTS: "1", BERTH_E2E_LOCALBOX: "1", BERTH_ROUTE_NUMBERS: "1",
      BERTH_TRANSCRIPT_SAMPLE: `claude-host:${build.dir}/internal/transcript/testdata/claude_host_ask.jsonl`,
    });
  }
  startup.signal.throwIfAborted();
  cleanupAllowed = false; // Never remove a live test process's files.
  child = spawn("go", ["test", "-count=1", "-timeout=20m", ...testArgs], {
    cwd: build.dir, env, stdio: "inherit", detached: true,
  });
  const result = await new Promise((done) => {
    child.once("error", (err) => done({ error: err }));
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  if (timer) clearTimeout(timer);
  // A test can exit while a descendant remains. Stop the rest of this group
  // before deleting its working directory and test state.
  if (child.pid && groupExists(child.pid)) {
    signalGroup(child.pid, "SIGKILL");
    const deadline = Date.now() + 5000;
    while (groupExists(child.pid) && Date.now() < deadline) await pause(25);
    if (groupExists(child.pid)) throw new Error(`test process group ${child.pid} did not exit; temporary directories kept`);
  }
  if (timer) clearTimeout(timer);
  child = undefined;
  cleanupAllowed = true;
  if (result.error) throw result.error;
  process.exitCode = received ? 128 + constants.signals[received] :
    result.signal ? 128 + constants.signals[result.signal] : result.code;
} catch (err) {
  if (!received) console.error(`runtime tests: ${err.message}`);
  process.exitCode = received ? 128 + constants.signals[received] : 1;
} finally {
  if (timer) clearTimeout(timer);
  if (cleanupAllowed) {
    try {
      await validateState();
      await stopTestHelpers(state.dir);
    } catch (err) {
      cleanupAllowed = false;
      console.error(`runtime tests: ${err.message}`);
      process.exitCode = 1;
    }
  }
  try { await postgres?.stop(); }
  catch (err) {
    cleanupAllowed = false;
    console.error(`runtime tests: ${err.message}`);
    process.exitCode = 1;
  }
  if (cleanupAllowed) {
    try {
      // Revalidate the parent before following any test-created socket path.
      await validateState();
      await stopTestTmux(`${state.dir}/tmux`);
      await removeChecked(state, stateName, "/tmp");
      await removeChecked(build, buildName);
    } catch (err) {
      console.error(`runtime tests: ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (received) process.exitCode = 128 + constants.signals[received];
}
