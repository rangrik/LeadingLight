#!/usr/bin/env node
// The soak test: the app left open for a long time with a realistic
// workspace, measured as it goes. Mock mode (?mock=1&still: the fixtures
// at rest, so anything that moves is the harness's own doing), production
// build, Chromium through Playwright and its DevTools protocol.
//
//   pnpm build && node perf/soak.mjs [--minutes 60] [--port 1432]
//        [--out dir] [--label before] [--compress 480]
//
// The workspace: devl/checkout-fix's chat split with devl/search-perf's
// (which streams a reply while busy), two Browser tabs on a stand-in dev
// server's pages that log to the console, one with its Network drawer open
// and one its Console, a Preview tab, the Files panel, a second worktree's
// tabs as a group, and Home.
//
// It runs in cycles of five minutes, each showing one view (chats, a
// Browser tab, the Preview tab, Home, in turn):
//
//   busy    2 min   a reply streams in the second chat and lands; pages log
//   quiet   2 min   nothing changes anywhere: what the app costs at rest
//   hidden  1 min   the page is hidden (document.hidden, visibilitychange),
//                   as a minimised or covered window is
//
// Every --sample seconds (15) it records the JS heap, DOM nodes, listeners
// (CDP's count, and window's and document's by type), live intervals and
// where they were made, timeouts and animation frames run, sockets, the
// app's requests to the (mock) agent by path, the renderer's main-thread
// time (TaskDuration) and every Chromium process's CPU time. At the end of
// each quiet phase it collects garbage and counts heap, nodes and detached
// nodes. On macOS, top's idle wakeups (IDLEW) for the renderer and GPU
// processes are sampled over the quiet and hidden phases: energy impact
// itself can't be read headlessly, wakeups and CPU are its proxies.
//
// --compress N runs the same workspace on Playwright's fake clock instead,
// N simulated minutes (in --minutes of real time at most): timers, frames
// and Date move as fast as the page can run them. CPU there means nothing;
// heap, listeners, timers and requests per simulated minute do.
//
// Writes samples.json, phases.json and summary.json to --out.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

import { INSTRUMENT } from "./instrument.mjs";
import { app, cdpMetrics, detached, log, parseArgs, processes, r1, routes, serve, setup, show, wakeups } from "./workspace.mjs";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.E2E_PORT ?? 1432);
if (port === 1420) throw new Error("1420 is the dev app's port");
const minutes = Number(args.minutes ?? 60);
const sampleS = Number(args.sample ?? 15);
const compress = args.compress ? Number(args.compress) : 0;
const out = resolve(String(args.out ?? join(app, "node_modules/.perf/soak")));
const headed = !!args.headed;
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;

// ---- Run ----------------------------------------------------------------------

const server = await serve(port, args.dist);
const browser = await chromium.launch({ headless: !headed, args: ["--enable-precise-memory-info"] });
const bcdp = await browser.newBrowserCDPSession();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 1 });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
await context.addInitScript(INSTRUMENT);
await routes(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
await cdp.send("DOM.enable").catch(() => {});
if (compress) await page.clock.install();

const samples = [];
const phases = [];
const started = Date.now();
let simMs = 0;
const elapsedMin = () => (compress ? simMs : Date.now() - started) / 60_000;

async function snapshot(phase, view, extra = {}) {
  const [m, s, procs] = await Promise.all([cdpMetrics(cdp), page.evaluate(() => window.__soak.read()), processes(bcdp)]);
  const sample = {
    t: r1(elapsedMin() * 60),
    phase,
    view,
    heapMB: r1(m.JSHeapUsedSize / 2 ** 20),
    heapTotalMB: r1(m.JSHeapTotalSize / 2 ** 20),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    documents: m.Documents,
    frames: m.Frames,
    taskS: m.TaskDuration,
    scriptS: m.ScriptDuration,
    layoutS: m.LayoutDuration,
    styleS: m.RecalcStyleDuration,
    layouts: m.LayoutCount,
    styles: m.RecalcStyleCount,
    procs,
    ...s,
    ...extra,
  };
  samples.push(sample);
  return sample;
}

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
function delta(a, b) {
  const mins = (b.t - a.t) / 60 || 1e-9;
  const calls = {};
  for (const [k, v] of Object.entries(b.calls)) {
    const d = v - (a.calls[k] ?? 0);
    if (d) calls[k] = r1(d / mins);
  }
  const fetches = {};
  for (const [k, v] of Object.entries(b.fetchByPath)) {
    const d = v - (a.fetchByPath[k] ?? 0);
    if (d) fetches[k] = r1(d / mins);
  }
  const cpu = {};
  for (const p of b.procs) {
    const was = a.procs.find((x) => x.pid === p.pid);
    if (was) cpu[p.type] = r1((cpu[p.type] ?? 0) + ((p.cpu - was.cpu) * 1000) / mins);
  }
  return {
    minutes: r1(mins),
    mainThreadMsPerMin: r1(((b.taskS - a.taskS) * 1000) / mins),
    scriptMsPerMin: r1(((b.scriptS - a.scriptS) * 1000) / mins),
    layoutsPerMin: r1((b.layouts - a.layouts) / mins),
    stylesPerMin: r1((b.styles - a.styles) / mins),
    framesPerMin: r1((b.frames - a.frames) / mins),
    timeoutsPerMin: r1((b.timeoutsMade - a.timeoutsMade) / mins),
    callsPerMin: r1((sum(b.calls) - sum(a.calls)) / mins),
    fetchesPerMin: r1((b.fetches - a.fetches) / mins),
    calls,
    fetches,
    processCpuMsPerMin: cpu,
  };
}

// The second chat's streaming reply, while busy: a few words every 250ms,
// landing every 20s as a message.
const WORDS = "The ledger retries now carry an idempotency key, so a slow answer from the payment provider can't make a second order; the test sends the same webhook twice and checks there is one order and one charge.".split(" ");
async function stream(ms) {
  const end = Date.now() + ms;
  let n = 0;
  let landed = Date.now();
  while (Date.now() < end) {
    n = (n + 3) % (WORDS.length + 3);
    await page.evaluate((t) => window.__berthDraft?.show("devl", "search-perf-claude", t), WORDS.slice(0, n).join(" ")).catch(() => {});
    if (Date.now() - landed > 20_000) {
      landed = Date.now();
      await page.evaluate((t) => window.__berthDraft?.land("devl", "search-perf-claude", t), WORDS.join(" ")).catch(() => {});
      await page.evaluate(() => window.__berthDraft?.clear("devl", "search-perf-claude")).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.__berthDraft?.clear("devl", "search-perf-claude")).catch(() => {});
}

async function noise(on) {
  for (const f of page.frames()) if (f !== page.mainFrame()) await f.evaluate((v) => (window.__noise = v), on).catch(() => {});
}

// wait passes ms of the run's time: real, or simulated on the fake clock
// (in steps, with a moment of real time between for React and promises).
async function wait(ms) {
  if (!compress) return page.waitForTimeout(ms);
  const step = 5000;
  for (let left = ms; left > 0; left -= step) {
    await page.clock.runFor(Math.min(step, left));
    simMs += Math.min(step, left);
    await page.waitForTimeout(15);
  }
}

async function phase(name, view, ms, during) {
  const a = await snapshot(name, view);
  const pids = a.procs.filter((p) => p.type === "renderer" || p.type === "GPU").map((p) => p.pid);
  const parts = [];
  const steps = Math.max(1, Math.round(ms / (sampleS * 1000)));
  let wake = null;
  if (!compress && (name === "quiet" || name === "hidden")) wake = wakeups(pids, Math.min(60, Math.floor(ms / 1000) - 10));
  const work = during ? during(ms) : null;
  for (let i = 0; i < steps; i++) {
    if (!work || compress) await wait(ms / steps);
    else await page.waitForTimeout(ms / steps);
    parts.push(await snapshot(name, view));
  }
  if (work) await work;
  const b = parts[parts.length - 1];
  const p = { name, view, at: a.t, ...delta(a, b), intervals: b.intervals, timeoutsPending: b.timeoutsPending, wsOpen: b.wsOpen, heapMB: b.heapMB, nodes: b.nodes, listeners: b.listeners };
  if (wake) {
    const w = await wake;
    if (w) p.wakeups = Object.fromEntries(Object.entries(w).map(([pid, v]) => [a.procs.find((x) => String(x.pid) === pid)?.type ?? pid, v]));
  }
  if (name === "quiet") {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(300);
    const g = await snapshot("gc", view, { detached: await detached(cdp) });
    p.gc = { heapMB: g.heapMB, nodes: g.nodes, domNodes: g.domNodes, listeners: g.listeners, detached: g.detached };
  }
  phases.push(p);
  log(`${name.padEnd(6)} ${view.padEnd(8)} main ${String(p.mainThreadMsPerMin).padStart(7)} ms/min  calls ${String(p.callsPerMin).padStart(6)}/min  frames ${String(p.framesPerMin).padStart(6)}/min  heap ${p.heapMB} MB  listeners ${p.listeners}  intervals ${p.intervals}${p.gc ? `  gc heap ${p.gc.heapMB} MB nodes ${p.gc.nodes} detached ${p.gc.detached}` : ""}${p.wakeups ? `  wakeups ${JSON.stringify(Object.fromEntries(Object.entries(p.wakeups).map(([k, v]) => [k, v.wakeupsPerSec])))}/s` : ""}`);
  writeFileSync(join(out, "phases.json"), JSON.stringify(phases, null, 1));
  writeFileSync(join(out, "samples.json"), JSON.stringify(samples));
  return p;
}

const summary = { at: new Date().toISOString(), label: args.label ?? "", machine: `${process.platform} ${process.arch}`, minutes, compress, sampleS };
try {
  await page.goto(`${base}/?mock=1&still&view=conversation`);
  await page.getByTestId("nav-home").waitFor();
  await page.locator("[aria-disabled=true]:has([data-testid=nav-home])").waitFor({ state: "detached" }).catch(() => {});
  if (compress) await page.clock.pauseAt(Date.now() + 1000);
  const views = compress ? await setupOnClock() : await setup(page);
  summary.views = views;
  log("workspace ready", JSON.stringify(views));
  await snapshot("start", "chats", { detached: await detached(cdp) });

  const order = ["chats", "browser", "preview", "home"];
  const cycleMin = 5;
  const cycles = Math.max(1, Math.floor((compress || minutes) / cycleMin));
  const deadline = started + minutes * 60_000;
  for (let c = 0; c < cycles; c++) {
    if (Date.now() > deadline + 60_000) break;
    const view = order[c % order.length];
    await show(page, views, view);
    await noise(true);
    await phase("busy", view, 2 * 60_000, compress ? null : stream);
    await noise(false);
    await phase("quiet", view, 2 * 60_000);
    await page.evaluate(() => window.__soakHide(true));
    await phase("hidden", view, 60_000);
    await page.evaluate(() => window.__soakHide(false));
  }
} catch (err) {
  summary.failure = String(err?.stack ?? err);
  console.error(err);
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  summary.errors = errors;
  summary.intervalsAtEnd = samples.at(-1)?.intervalsByWhere;
  summary.listenersAtEnd = samples.at(-1)?.listenersByType;
  writeFileSync(join(out, "phases.json"), JSON.stringify(phases, null, 1));
  writeFileSync(join(out, "samples.json"), JSON.stringify(samples));
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1));
  await browser.close();
  server.kill();
}

// On the fake clock the workspace is set up the same way, with the clock
// let run in real time while it is (clicks wait on timers).
async function setupOnClock() {
  await page.clock.resume();
  const v = await setup(page);
  await page.clock.pauseAt(Date.now() + 1000);
  return v;
}
