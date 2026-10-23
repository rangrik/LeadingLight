#!/usr/bin/env node
// The app against a real laptop agent and box (your own test instances,
// never the laptop's: see the README's "measuring" notes), in Chromium.
//
//   node perf/live.mjs --agent http://127.0.0.1:7472 --token T --box soak
//        [--worktrees shop/checkout-fix,shop/search-perf] [--terminals 4]
//        [--port 1427] [--dist dir] [--out dir] [--label after]
//        [--idle 10] [--debug-agent http://127.0.0.1:7481]
//        [--debug-box http://127.0.0.1:7482] [--renderer ghostty]
//
// It opens --terminals new terminals (⌘T) in each worktree and starts a
// loop printing 20 lines a second in each, plus one quiet one to type in,
// then measures, as perf/terminals.mjs does on the mock: CPU and draws
// with every terminal hidden and with one shown; a key's echo through the
// box (keydown to the character on the terminal's screen); tab switches.
// Then it stops the loops, closes nothing, and leaves the app at rest for
// --idle minutes: requests a minute to the agent by path, and the agent's
// and berthd's goroutines, open files and CPU (BERTH_DEBUG_ADDR on each).
//
// The app is served on localhost (the agent only answers its own origins:
// localhost:1420–1439), with ?perf so the terminals' screens can be read.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

import { INSTRUMENT } from "./instrument.mjs";
import { app, cdpMetrics, log, parseArgs, processes, r1, serve } from "./workspace.mjs";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 1427);
if (port === 1420) throw new Error("1420 is the dev app's port");
const agent = String(args.agent ?? "");
if (!agent || /:(1377|1378|1379)\b/.test(agent)) throw new Error("--agent must be your own test agent, not the laptop's (1377–1379)");
const token = String(args.token ?? "");
const box = String(args.box ?? "soak");
const worktrees = String(args.worktrees ?? "shop/checkout-fix,shop/search-perf,shop/order-export").split(",");
const perWorktree = Number(args.terminals ?? 4);
const idleMin = Number(args.idle ?? 10);
const renderer = String(args.renderer ?? "ghostty");
const out = resolve(String(args["out"] ?? join(app, "node_modules/.perf/live")));
mkdirSync(out, { recursive: true });
const LOOP = `i=0; while :; do i=$((i+1)); printf '%7d acme build step %d ok\\n' $i $i; sleep 0.05; done`;

const debug = async (url) => {
  if (!url) return null;
  try {
    return await (await fetch(`${url}/debug/berth`)).json();
  } catch {
    return null;
  }
};

const server = await serve(port, args.dist);
const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const bcdp = await browser.newBrowserCDPSession();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 1 });
await context.addInitScript(INSTRUMENT);
await context.addInitScript((renderer) => {
  if (window !== window.top) return;
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("berth.prefs", JSON.stringify({ terminal: { renderer }, version: 3, labsChosen: true }));
  }
  const w = window;
  w.__draws = { shown: 0, hidden: 0 };
  const P = CanvasRenderingContext2D.prototype;
  for (const k of ["fillText", "fillRect", "clearRect"]) {
    const f = P[k];
    P[k] = function (...a) {
      if (this.canvas.isConnected) w.__draws[this.canvas.offsetParent ? "shown" : "hidden"]++;
      return f.apply(this, a);
    };
  }
}, renderer);
const requests = {};
const agentHost = new URL(agent).host;
context.on("request", (r) => {
  const u = new URL(r.url());
  if (u.host !== agentHost) return;
  const k = `${r.method()} ${u.pathname.replace(/\/sessions\/[^/]+/, "/sessions/:s").replace(/\/worktrees\/[^/]+\/[^/]+/, "/worktrees/:w")}`;
  requests[k] = (requests[k] ?? 0) + 1;
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
const res = { at: new Date().toISOString(), label: args.label ?? "", renderer, agent, box, worktrees, perWorktree };

const row = (w) => page.locator(`[data-testid=worktree-row][data-worktree="${box}/${w.split("/").pop()}"]`);
const visibleTerm = () => page.locator("[data-testid=pane]:visible [data-terminal]").first();

async function window_(ms) {
  const read = async () => ({ m: await cdpMetrics(cdp), s: await page.evaluate(() => ({ ...window.__soak.read(), draws: { ...window.__draws } })), p: await processes(bcdp) });
  const a = await read();
  await page.waitForTimeout(ms);
  const b = await read();
  const per = 60_000 / ms;
  const cpu = {};
  for (const p of b.p) {
    const was = a.p.find((x) => x.pid === p.pid);
    if (was) cpu[p.type] = r1((cpu[p.type] ?? 0) + (p.cpu - was.cpu) * 1000 * per);
  }
  return {
    mainThreadMsPerMin: r1((b.m.TaskDuration - a.m.TaskDuration) * 1000 * per),
    framesPerMin: r1((b.s.frames - a.s.frames) * per),
    hiddenDrawsPerMin: r1((b.s.draws.hidden - a.s.draws.hidden) * per),
    shownDrawsPerMin: r1((b.s.draws.shown - a.s.draws.shown) * per),
    processCpuMsPerMin: cpu,
    heapMB: r1(b.m.JSHeapUsedSize / 2 ** 20),
  };
}

// echo types keys into the shown terminal and times each from the key to
// its character on the screen (read from the emulator each frame).
async function echo(text) {
  const times = [];
  for (const ch of text) {
    await page.evaluate((ch) => {
      const host = [...document.querySelectorAll("[data-testid=pane]")].find((p) => p.style.display !== "none")?.querySelector("[data-terminal] > div");
      const t = host?.__berthTerm;
      const b = t?.buffer?.active;
      const line = () => (b ? (b.getLine((b.baseY ?? 0) + (b.cursorY ?? 0))?.translateToString(true) ?? "") : "");
      const before = line();
      window.__echo = new Promise((done) => {
        const t0 = performance.now();
        const look = () => {
          const now = line();
          if (now !== before && now.endsWith(ch)) return done(performance.now() - t0);
          if (performance.now() - t0 > 3000) return done(-1);
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
    }, ch);
    await page.keyboard.type(ch);
    times.push(await page.evaluate(() => window.__echo));
    await page.waitForTimeout(80);
  }
  const ok = times.filter((t) => t >= 0).sort((a, b) => a - b);
  return { keys: text.length, seen: ok.length, p50: r1(ok[Math.floor(ok.length / 2)] ?? -1), p95: r1(ok[Math.floor(ok.length * 0.95)] ?? -1), max: r1(ok[ok.length - 1] ?? -1) };
}

try {
  await page.goto(`http://localhost:${port}/?token=${encodeURIComponent(token)}&agent=${encodeURIComponent(agent)}&perf=1&view=terminal`);
  await page.getByTestId("nav-home").waitFor();
  await page.locator("[aria-disabled=true]:has([data-testid=nav-home])").waitFor({ state: "detached" }).catch(() => {});
  await page.waitForTimeout(2000);
  // Quiet worktrees fold under "N more worktrees".
  const more = page.getByText(/^\d+ more worktrees?$/).first();
  if (await more.isVisible().catch(() => false)) await more.click();
  res.debugStart = { agent: await debug(args["debug-agent"]), box: await debug(args["debug-box"]) };

  // Terminals: per worktree, perWorktree loops, and one quiet one last.
  const tabs = [];
  for (const [i, w] of worktrees.entries()) {
    await row(w).click();
    await page.waitForTimeout(800);
    const n = perWorktree + (i === worktrees.length - 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      await page.keyboard.press("Meta+KeyT");
      const term = visibleTerm();
      await term.waitFor();
      await page.waitForTimeout(1500);
      const id = await page.locator('[data-tab-strip] [data-tab][aria-selected="true"]:visible').first().getAttribute("data-tab");
      const quiet = i === worktrees.length - 1 && k === n - 1;
      if (!quiet) {
        await term.click();
        await page.keyboard.type(LOOP);
        await page.keyboard.press("Enter");
      }
      tabs.push({ w, id, quiet });
    }
  }
  res.terminals = await page.locator("[data-terminal]").count();
  log("terminals", res.terminals);
  await page.waitForTimeout(5000);
  await cdp.send("HeapProfiler.collectGarbage");
  res.memory = { heapMB: r1((await cdpMetrics(cdp)).JSHeapUsedSize / 2 ** 20) };

  await page.getByTestId("nav-home").click();
  await page.waitForTimeout(2000);
  if (args.profile) {
    // --profile: where the main thread goes while every terminal is hidden.
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  res.hidden = await window_(30_000);
  log("all hidden", JSON.stringify(res.hidden));
  if (args.profile) {
    const { profile } = await cdp.send("Profiler.stop");
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const self = new Map();
    const incl = new Map();
    profile.samples.forEach((id, i) => {
      const dt = (profile.timeDeltas[i] ?? 0) / 1000;
      const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
      self.set(name(byId.get(id)), (self.get(name(byId.get(id))) ?? 0) + dt);
      const seen = new Set();
      for (let x = id; x; x = parent.get(x)) {
        const k = name(byId.get(x));
        if (!seen.has(k)) incl.set(k, (incl.get(k) ?? 0) + dt), seen.add(k);
      }
    });
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${Math.round(v)} ${k}`);
    res.hiddenProfile = { self: top(self), inclusive: top(incl) };
  }

  const noisy = tabs.filter((t) => !t.quiet);
  const shown = noisy[noisy.length - 1];
  await row(shown.w).click();
  await page.locator(`[data-tab-strip] [data-tab="${shown.id}"]`).first().click();
  await page.waitForTimeout(2000);
  res.oneShown = await window_(30_000);
  log("one shown", JSON.stringify(res.oneShown));

  const quiet = tabs.find((t) => t.quiet);
  await row(quiet.w).click();
  await page.locator(`[data-tab-strip] [data-tab="${quiet.id}"]`).first().click();
  await page.waitForTimeout(1500);
  await visibleTerm().click();
  res.echo = await echo("echo acme ledger");
  await page.keyboard.press("Control+KeyU");
  log("echo while the others stream", JSON.stringify(res.echo));

  // Switching to a noisy terminal that was hidden for a while.
  const sw = [];
  for (const t of noisy.slice(0, 6)) {
    await row(t.w).click();
    const other = tabs.find((x) => x.w === t.w && x.id !== t.id);
    await page.locator(`[data-tab-strip] [data-tab="${other.id}"]`).first().click();
    await page.waitForTimeout(3000);
    sw.push(
      await page.evaluate(async (id) => {
        const t0 = performance.now();
        document.querySelector(`[data-tab-strip] [data-tab="${id}"]`).click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, t.id),
    );
  }
  sw.sort((a, b) => a - b);
  res.switch = { n: sw.length, p50: r1(sw[Math.floor(sw.length / 2)]), max: r1(sw[sw.length - 1]) };
  log("switch", JSON.stringify(res.switch));

  // Stop every loop (Ctrl-C), then rest.
  for (const t of noisy) {
    await row(t.w).click();
    await page.locator(`[data-tab-strip] [data-tab="${t.id}"]`).first().click();
    await visibleTerm().click();
    await page.keyboard.press("Control+KeyC");
    await page.waitForTimeout(150);
  }
  await row(worktrees[0]).click();
  await page.keyboard.press("Meta+Shift+E").catch(() => {});
  await page.waitForTimeout(5000);
  const idle = [];
  for (let m = 0; m < idleMin; m++) {
    const before = { ...requests };
    const d0 = { agent: await debug(args["debug-agent"]), box: await debug(args["debug-box"]) };
    const w = await window_(60_000);
    const d1 = { agent: await debug(args["debug-agent"]), box: await debug(args["debug-box"]) };
    const req = Object.fromEntries(Object.entries(requests).flatMap(([k, v]) => (v - (before[k] ?? 0) ? [[k, v - (before[k] ?? 0)]] : [])));
    const go = (k) => (d0[k] && d1[k] ? { cpuMsPerMin: r1((d1[k].cpu_seconds - d0[k].cpu_seconds) * 1000), goroutines: d1[k].goroutines, openFiles: d1[k].open_files, heapMB: r1(d1[k].heap_alloc / 2 ** 20) } : null);
    idle.push({ minute: m + 1, requestsPerMin: Object.values(req).reduce((a, b) => a + b, 0), requests: req, app: w, agent: go("agent"), berthd: go("box") });
    log(`idle minute ${m + 1}`, idle[idle.length - 1].requestsPerMin, "requests", JSON.stringify({ agent: idle[idle.length - 1].agent, berthd: idle[idle.length - 1].berthd }));
    writeFileSync(join(out, "live.json"), JSON.stringify({ ...res, idle }, null, 1));
  }
  res.idle = idle;
} catch (err) {
  res.failure = String(err?.stack ?? err);
  console.error(err);
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  res.errors = errors;
  res.debugEnd = { agent: await debug(args["debug-agent"]), box: await debug(args["debug-box"]) };
  writeFileSync(join(out, "live.json"), JSON.stringify(res, null, 1));
  await browser.close();
  server.kill();
}
