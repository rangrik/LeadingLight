#!/usr/bin/env node
// Many terminals at once: a dozen and more terminal tabs and splits over
// several worktrees, every one printing lines (mock mode, bench=noisy: N
// lines a second each, lib/mock-bench.ts), for each renderer.
//
//   pnpm build && node perf/terminals.mjs [--port 1433] [--rate 20]
//        [--renderers ghostty,xterm] [--out dir] [--label after] [--dist dir]
//        [--worktrees 5]
//
// For each renderer it measures:
//
//   memory      the renderer process's resident memory and JS heap (after
//               a GC) with no terminal, then with all of them: per terminal
//   typing      key to next paint (Event Timing) and main-thread time per
//               key, typing into one terminal while every other streams
//   switch      click on another terminal's tab to its screen drawn (two
//               frames), and whether it caught up: its last line is the
//               newest the box sent, with none missing on screen
//   hidden      main-thread and process CPU, animation frames and canvas
//               draws a minute while the terminals stream and none shows
//               (Home in front), and while one shows
//
// Writes numbers.json to --out.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

import { INSTRUMENT } from "./instrument.mjs";
import { app, cdpMetrics, log, parseArgs, processes, r1, serve } from "./workspace.mjs";

const run = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.E2E_PORT ?? 1433);
if (port === 1420) throw new Error("1420 is the dev app's port");
const rate = Number(args.rate ?? 20);
const renderers = String(args.renderers ?? "ghostty,xterm").split(",");
const out = resolve(String(args.out ?? join(app, "node_modules/.perf/terminals")));
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
// --worktrees N uses the first N (each gets three or four terminals).
const WORKTREES = ["devl/checkout-fix", "devl/search-perf", "devl/order-export", "devl/qa-deck", "devl/https-linear-app-acme"].slice(0, Number(args.worktrees ?? 5));

// Canvas draws, by whether the canvas is on screen: a hidden terminal
// should draw nothing.
const DRAWS = () => {
  if (window !== window.top) return;
  const P = CanvasRenderingContext2D.prototype;
  window.__draws = { shown: 0, hidden: 0 };
  for (const k of ["fillText", "fillRect", "clearRect", "drawImage"]) {
    const f = P[k];
    P[k] = function (...a) {
      const c = this.canvas;
      if (c.isConnected) window.__draws[c.offsetParent ? "shown" : "hidden"]++;
      return f.apply(this, a);
    };
  }
};

// Clicks that a toast or a popover in the way can make miss: Escape and
// again.
async function click(page, loc) {
  for (let i = 0; ; i++) {
    // Quiet worktrees fold under "N more worktrees" in the sidebar.
    if (!(await loc.count())) {
      const more = page.getByText(/^\d+ more worktrees?$/);
      for (const m of await more.all()) await m.click().catch(() => {});
    }
    try {
      // A page busy drawing (the old renderer, nineteen terminals) can
      // starve the stability check: after a first try, click regardless.
      return await loc.click({ timeout: 15_000, force: i > 0 });
    } catch (err) {
      if (i >= 3) throw err;
      await page.keyboard.press("Escape");
      await loc.scrollIntoViewIfNeeded().catch(() => {});
    }
  }
}

async function rss(pid) {
  try {
    const { stdout } = await run("ps", ["-o", "rss=", "-p", String(pid)]);
    return Number(stdout.trim()) / 1024;
  } catch {
    return null;
  }
}

async function measure(browser, bcdp, renderer) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 1 });
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(DRAWS);
  await context.addInitScript((renderer) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("berth.prefs", JSON.stringify({ terminal: { renderer }, version: 3, labsChosen: true }));
    }
    // Event Timing for typing.
    window.__ev = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__ev.push({ name: e.name, start: e.startTime, dur: e.duration });
      }).observe({ type: "event", durationThreshold: 16, buffered: true });
    } catch {}
    window.__long = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  }, renderer);
  await context.route(/^https?:\/\/(?:[^/]*\.)?(?:localhost|127\.0\.0\.1):(?:1377|1378|1379)\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>stub</h1>" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  await page.goto(`${base}/?mock=1&still&bench=noisy&rate=${rate}&view=terminal`);
  await page.getByTestId("nav-home").waitFor();
  await page.waitForTimeout(1500);
  const pid = async () => (await processes(bcdp)).find((p) => p.type === "renderer")?.pid;

  const gc = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(500);
    const m = await cdpMetrics(cdp);
    return { heapMB: r1(m.JSHeapUsedSize / 2 ** 20), rssMB: r1((await rss(await pid())) ?? 0) };
  };
  // Renderer processes: one per site; the app's is the busiest.
  const res = { renderer, rate };
  res.empty = await gc();

  // Terminals: each worktree's agent (a terminal in this view), two more
  // tabs, and in the first worktree a split.
  const tabs = [];
  for (const [i, w] of WORKTREES.entries()) {
    await click(page, page.locator(`[data-testid=worktree-row][data-worktree="${w}"]`));
    await page.waitForTimeout(400);
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press("Meta+KeyT");
      await page.waitForTimeout(400);
    }
    if (i === 0) {
      await page.keyboard.press("Meta+KeyD");
      await page.waitForTimeout(400);
    }
    for (const id of await page.locator("[data-tab-strip] [data-tab]:visible").evaluateAll((e) => e.map((x) => x.getAttribute("data-tab")))) if (!tabs.some((t) => t.id === id)) tabs.push({ w, id });
  }
  await page.waitForTimeout(3000);
  res.terminals = await page.locator("[data-terminal]").count();
  res.canvases = await page.locator("[data-terminal] canvas").count();
  log(renderer, "terminals", res.terminals);
  // Settled with all of them streaming, then measured.
  await page.waitForTimeout(5000);
  res.full = await gc();
  res.perTerminal = { heapMB: r1((res.full.heapMB - res.empty.heapMB) / res.terminals), rssMB: r1((res.full.rssMB - res.empty.rssMB) / res.terminals) };

  const window_ = async (ms) => {
    const a = { m: await cdpMetrics(cdp), s: await page.evaluate(() => ({ ...window.__soak.read(), draws: { ...window.__draws } })), p: await processes(bcdp) };
    await page.waitForTimeout(ms);
    const b = { m: await cdpMetrics(cdp), s: await page.evaluate(() => ({ ...window.__soak.read(), draws: { ...window.__draws } })), p: await processes(bcdp) };
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
  };

  // None shows: Home in front.
  await page.getByTestId("nav-home").click();
  await page.waitForTimeout(2000);
  res.hidden = await window_(30_000);
  log(renderer, "all hidden", JSON.stringify(res.hidden));

  // One shows (the last tab made), the rest stream behind it.
  const last = tabs[tabs.length - 1];
  await click(page, page.locator(`[data-testid=worktree-row][data-worktree="${last.w}"]`));
  await page.locator(`[data-tab-strip] [data-tab="${last.id}"]`).first().click();
  await page.waitForTimeout(2000);
  res.oneShown = await window_(30_000);
  log(renderer, "one shown", JSON.stringify(res.oneShown));

  // Typing into it (the mock echoes at once): while it streams too, and
  // while it is quiet and the others stream behind it.
  const term = page.locator("[data-testid=pane]:visible [data-terminal]").first();
  await term.click();
  await page.waitForTimeout(500);
  const typing = async () => {
    const from = await page.evaluate(() => performance.now());
    const m0 = await cdpMetrics(cdp);
    const words = "echo acme ledger retries look fine";
    await page.keyboard.type(words, { delay: 60 });
    const m1 = await cdpMetrics(cdp);
    const ev = await page.evaluate((from) => window.__ev.filter((e) => e.start >= from && e.name === "keydown"), from);
    const d = ev.map((e) => e.dur).sort((a, b) => a - b);
    const keys = words.length;
    // Event Timing reports events of 16 ms and more: the rest were quicker.
    const pct = (p) => {
      const i = Math.floor((p / 100) * keys) - (keys - d.length);
      return i < 0 ? "<16" : r1(d[Math.min(d.length - 1, i)]);
    };
    return { keys, over16ms: d.length, p50: pct(50), p95: pct(95), max: d.length ? r1(d[d.length - 1]) : "<16", mainThreadMsPerKey: r1(((m1.TaskDuration - m0.TaskDuration) * 1000) / keys) };
  };
  res.typingStreaming = await typing();
  const quieted = await page.evaluate(() => window.__berthNoise?.quietLatest());
  await page.waitForTimeout(1500);
  res.typing = quieted ? await typing() : null;
  res.oneShownQuiet = quieted ? await window_(20_000) : null;
  log(renderer, "typing", JSON.stringify({ streaming: res.typingStreaming, quiet: res.typing, oneShownQuiet: res.oneShownQuiet }));

  // Switching tabs: to each hidden terminal tab in another worktree and
  // back, timed to two frames after the click, and checked for catching up.
  const switches = [];
  for (const t of tabs.slice(0, 8)) {
    await click(page, page.locator(`[data-testid=worktree-row][data-worktree="${t.w}"]`));
    await page.waitForTimeout(300);
    // Away from it a while, so it has output waiting.
    const other = tabs.find((x) => x.w === t.w && x.id !== t.id) ?? tabs.find((x) => x.w !== t.w);
    await page.locator(`[data-tab-strip] [data-tab="${other.id}"]`).first().click();
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async (id) => {
      const tab = document.querySelector(`[data-tab-strip] [data-tab="${id}"]`);
      const longFrom = performance.now();
      const t0 = performance.now();
      tab.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const ms = performance.now() - t0;
      const long = window.__long.filter((e) => e.start + e.dur >= longFrom).reduce((a, e) => a + e.dur, 0);
      // The screen: its last numbered line, and whether those shown run on
      // without a gap.
      const pane = [...document.querySelectorAll("[data-testid=pane]")].find((p) => p.style.display !== "none" && p.querySelector("[data-terminal]"));
      const host = pane?.querySelector("[data-terminal] > div");
      const em = host?.__berthTerm;
      let check = null;
      if (em?.buffer?.active) {
        const b = em.buffer.active;
        const nums = [];
        for (let y = 0; y < em.rows; y++) {
          const line = b.getLine((b.viewportY ?? b.baseY ?? 0) + y)?.translateToString(true) ?? b.getLine(y)?.translateToString(true) ?? "";
          const m = /^\s*(\d+) /.exec(line);
          if (m) nums.push(Number(m[1]));
        }
        const gaps = nums.slice(1).filter((n, i) => n !== nums[i] + 1).length;
        check = { lines: nums.length, last: nums[nums.length - 1] ?? null, gaps };
      }
      return { ms, long, check };
    }, t.id);
    // The newest line the mock sent to this terminal is about rate × age;
    // what matters is that it is drawn whole and contiguous.
    switches.push({ ms: r1(r.ms), longTaskMs: r1(r.long), ...r.check });
  }
  const ms = switches.map((s) => s.ms).sort((a, b) => a - b);
  res.switch = { n: switches.length, p50: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1], gaps: switches.reduce((a, s) => a + (s.gaps ?? 0), 0), checked: switches.filter((s) => s.lines).length, each: switches };
  log(renderer, "switch", JSON.stringify({ ...res.switch, each: undefined }));
  res.errors = errors;
  await context.close();
  return res;
}

const server = await serve(port, args.dist);
const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const bcdp = await browser.newBrowserCDPSession();
const results = { at: new Date().toISOString(), label: args.label ?? "", machine: `${process.platform} ${process.arch}`, rate, runs: [] };
try {
  for (const r of renderers) results.runs.push(await measure(browser, bcdp, r));
} catch (err) {
  console.error(err);
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "numbers.json"), JSON.stringify(results, null, 1));
  await browser.close();
  server.kill();
}
