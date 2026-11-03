#!/usr/bin/env node
// Run the isolated runtime tests in their own process group. The caller creates
// both marked directories and execs this process with the test environment.
import { spawn } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { constants } from "node:os";

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
function cancel(signal) {
  if (received) return;
  received = signal;
  if (child?.pid) {
    signalGroup(child.pid, signal);
    timer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 2000);
  }
}
process.on("SIGINT", () => cancel("SIGINT"));
process.on("SIGTERM", () => cancel("SIGTERM"));

try {
  const buildName = /^build\.[a-zA-Z0-9]{6}$/;
  const stateName = /^ll-rt\.[a-zA-Z0-9]{6}$/;
  const build = await checkedDir(buildArg, buildName, ".leadinglight-runtime-build");
  const state = await checkedDir(stateArg, stateName, ".leadinglight-runtime-test-state", "/tmp");
  if (!relative(build.dir, state.dir) || !relative(state.dir, build.dir) ||
      !relative(build.dir, state.dir).startsWith("..") || !relative(state.dir, build.dir).startsWith("..")) {
    throw new Error("runtime test directories must be separate");
  }

  if (received) {
    await removeChecked(state, stateName, "/tmp");
    await removeChecked(build, buildName);
    process.exit(128 + constants.signals[received]);
  }
  child = spawn("go", ["test", "-count=1", "-timeout=20m", ...testArgs], {
    cwd: build.dir, env: process.env, stdio: "inherit", detached: true,
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
  await removeChecked(state, stateName, "/tmp");
  await removeChecked(build, buildName);
  if (result.error) throw result.error;
  process.exitCode = received ? 128 + constants.signals[received] :
    result.signal ? 128 + constants.signals[result.signal] : result.code;
} catch (err) {
  console.error(`runtime tests: ${err.message}`);
  process.exitCode = 1;
}
