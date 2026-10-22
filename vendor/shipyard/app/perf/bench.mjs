#!/usr/bin/env node
// The app's performance benchmark: long, busy chats, a terminal with a long
// history, and a sidebar and Home with hundreds of worktrees, on the demo's
// bench fixtures (src/lib/mock-bench.ts), in Chromium through Playwright
// and its DevTools protocol.
//
//   pnpm build && node perf/bench.mjs [--turns 50,500,2000] [--port 1431]
//        [--out perf-results] [--only chat,term,fleet] [--runs 1]
//        [--trace] [--shots] [--dist other/dist] [--worktrees 300]
//
// It serves dist/ (or --dist, another build to compare) with vite preview on --port (1421–1439 leave the dev
// app's 1420 alone) and writes numbers.json (and with --shots, screenshots
// of the longest chat mid-scroll, dark and light) to --out. What it
// measures, per chat size:
//
//   open        click on the worktree to its chat's rows drawn (first
//               render), and to the main thread going quiet (interactive:
//               the end of the last long task before 500 ms without one)
//   scroll      frame times of a scripted scroll from the top to the foot,
//               at reading speed (100 px a frame, 600 frames) and as a
//               sweep (the whole chat in 240 frames); dropped frames are
//               ones over 1.5 × the display's frame
//   memory      JS heap (after a GC) and DOM nodes, chat rows drawn
//   typing      input latency (Event Timing: key to next paint) typing in
//               the reply box, at rest and while a draft streams
//   draft       per update of a streaming draft: main-thread time (CDP
//               metrics) and the chat rows that rendered again (React's
//               commits, read through the DevTools hook)
//   switch      to the second long chat and back
//
// and with --only fleet (--worktrees, 300 by default) the sidebar, Home and
// the folded rail with that many more worktrees, each with an agent:
//
//   start       long tasks from load to quiet, JS heap, DOM nodes, the
//               sidebar's own elements, and the main thread at rest
//   sidebar     scrolled top to foot; its edge dragged wider and back; a
//               project folded and opened again;
//               a row's context menu (Shift+F10) and ⋯ menu opened; a row
//               renamed in place (double-click to the field, Enter to the
//               new name drawn)
//   home, rail  going to Home; folding the sidebar, then a start with it
//               folded
//
// It is a benchmark: numbers move with the machine. perf/guard.mjs checks
// generous limits on its output (pnpm perf:guard).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.split(/\s+/);
      return [k, v.length ? v.join(" ") : true];
    }),
);
const port = Number(args.port ?? process.env.E2E_PORT ?? 1431);
if (port === 1420) throw new Error("1420 is the dev app's port");
const sizes = String(args.turns ?? "50,500,2000").split(",").map(Number);
const only = new Set(String(args.only ?? "chat,term,fleet").split(","));
const out = resolve(String(args.out ?? join(app, "node_modules/.perf")));
const runs = Number(args.runs ?? 1);
mkdirSync(out, { recursive: true });

const base = `http://localhost:${port}`;
const CHAT_A = "devl/search-perf";
const CHAT_B = "gpu/ci-flake";
const SESSION_A = { box: "devl", session: "search-perf-claude" };

// ---- The server -------------------------------------------------------------

async function serve() {
  // Another server on the port would be measured in this build's place.
  const busy = await fetch(base).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`something already answers on ${port}: pick a free port with --port`);
  // Its own process group, so vite goes with pnpm when it is stopped.
  const p = spawn("pnpm", ["exec", "vite", "preview", "--port", String(port), "--strictPort", ...(args.dist ? ["--outDir", resolve(String(args.dist))] : [])], { cwd: app, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stop = () => {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  };
  let log = "";
  p.stdout.on("data", (d) => (log += d));
  p.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    if (p.exitCode !== null) break;
    try {
      const r = await fetch(base);
      if (r.ok) return { kill: stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  stop();
  throw new Error(`vite preview didn't start on ${port}:\n${log}`);
}

// ---- In the page --------------------------------------------------------------

// Installed before the app: long tasks, input event timing, and React's
// commits (through the DevTools hook, which production React calls too).
const INIT = () => {
  const w = window;
  w.__perf = { long: [], events: [], commits: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.long.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.events.push({ name: e.name, start: e.startTime, dur: e.duration, proc: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}
  // React DevTools' hook: on each commit, which chat rows had a component
  // render (mounted, or PerformedWork), and how many components rendered in
  // all. A fiber reached here with no alternate was made in this commit.
  const PERFORMED = 1;
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      this.renderers.set(1, r);
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!w.__perf.track) return;
      let rendered = 0;
      const rows = new Set();
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        // Only components (function, class, memo, forwardRef), not DOM nodes.
        if (typeof f.type === "function" || (f.type && typeof f.type === "object")) {
          const did = f.alternate === null || (f.flags & PERFORMED) !== 0;
          if (did) {
            rendered++;
            for (let p = f.return; p; p = p.return) {
              const el = p.stateNode;
              if (el && el.nodeType === 1 && el.dataset && el.dataset.chatRow !== undefined) {
                rows.add(el.dataset.chatRow);
                break;
              }
            }
          }
        }
        // A subtree React didn't touch keeps the same child fibers: skip it.
        if (f.child && (f.alternate === null || f.child !== f.alternate.child)) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
      w.__perf.commits.push({ at: performance.now(), rendered, rows: [...rows] });
    },
  };
};

// frames runs fn(i) once a frame for n frames and returns their intervals.
async function frames(page, script, n) {
  return page.evaluate(
    ({ script, n }) =>
      new Promise((done) => {
        // Each move follows a wheel event, as the person's would: the chat
        // stops following its foot only for the person's own scrolling.
        const move = new Function("i", "sc", script);
        const step = (i, sc) => {
          sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
          return move(i, sc);
        };
        const sc = document.querySelector("[data-bench-scroller]");
        const times = [];
        let i = 0;
        const tick = (t) => {
          times.push(t);
          if (i >= n || step(i++, sc) === false) return done(times.slice(1).map((x, k) => x - times[k]));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { script, n },
  );
}

function frameStats(dts, frame = 1000 / 60) {
  if (!dts.length) return { frames: 0 };
  const s = [...dts].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const dropped = dts.filter((d) => d > frame * 1.5).length;
  const missed = dts.reduce((n, d) => n + Math.max(0, Math.round(d / frame) - 1), 0);
  return { frames: dts.length, p50: r1(pct(50)), p95: r1(pct(95)), p99: r1(pct(99)), max: r1(s[s.length - 1]), droppedPct: r1((100 * dropped) / dts.length), missedFrames: missed, fps: r1((1000 * dts.length) / dts.reduce((a, b) => a + b, 0)) };
}
const r1 = (x) => Math.round(x * 10) / 10;
const pctl = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return r1(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function memory(page, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(200);
  const m = await metrics(cdp);
  const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, rows: document.querySelectorAll("[data-chat-row]").length, items: document.querySelectorAll("[data-testid=chat-item]").length }));
  return { heapMB: r1(m.JSHeapUsedSize / 2 ** 20), domNodes: dom.nodes, cdpNodes: m.Nodes, chatRows: dom.rows, chatItems: dom.items };
}

// quiet waits for the main thread to have had no long task for ms, and
// returns when the last one before that ended (page time).
async function quiet(page, since, ms = 500, max = 30_000) {
  const start = Date.now();
  for (;;) {
    const last = await page.evaluate((since) => {
      const l = window.__perf.long.filter((e) => e.start + e.dur >= since);
      return { end: l.length ? Math.max(...l.map((e) => e.start + e.dur)) : since, now: performance.now(), n: l.length, total: l.reduce((a, e) => a + e.dur, 0) };
    }, since);
    if (last.now - last.end >= ms || Date.now() - start > max) return last;
    await page.waitForTimeout(100);
  }
}

async function newPage(browser, params, theme = "dark") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 });
  await context.addInitScript(INIT);
  if (theme === "light")
    await context.addInitScript(() => {
      if (!localStorage.getItem("berth.ui")) localStorage.setItem("berth.ui", JSON.stringify({ themeId: "berth-light" }));
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const q = new URLSearchParams({ mock: "1", ...params });
  await page.goto(`${base}/?${q}`);
  await page.getByTestId("nav-home").waitFor();
  await page.locator("[aria-disabled=true]:has([data-testid=nav-home])").waitFor({ state: "detached" }).catch(() => {});
  return { context, page, cdp, errors };
}

// openChat clicks a worktree and times its chat: rows drawn, then quiet.
async function openChat(page, wt) {
  const t0 = await page.evaluate(() => performance.now());
  await page.locator(`[data-testid=worktree-row][data-worktree="${wt}"]`).click();
  const chat = page.locator("[data-testid=pane]:visible [data-testid=chat]");
  await chat.locator("[data-chat-row]").first().waitFor();
  const drawn = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now())))));
  const q = await quiet(page, t0);
  return { firstRenderMs: r1(drawn - t0), interactiveMs: r1(Math.max(drawn, q.end) - t0), longTasks: q.n, longTaskMs: r1(q.total) };
}

// ---- Chat --------------------------------------------------------------------

async function benchChat(browser, turns, shots) {
  const { context, page, cdp, errors } = await newPage(browser, { view: "conversation", bench: "chat", turns: String(turns) });
  const res = { turns };
  res.open = await openChat(page, CHAT_A);
  res.memory = await memory(page, cdp);

  // To the top, settled. The chat's scroller is marked for the frame loops.
  await page.locator("[data-testid=pane]:visible [data-testid=chat] .overflow-y-auto").first().evaluate((e) => e.setAttribute("data-bench-scroller", ""));
  const sc = "[data-bench-scroller]";
  const toTop = async () => {
    for (let i = 0; i < 40; i++) {
      const at = await page.$eval(sc, (e) => {
        e.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
        e.scrollTop = 0;
        return e.scrollTop;
      });
      await page.waitForTimeout(60);
      if (at === 0 && (await page.$eval(sc, (e) => e.scrollTop)) === 0) break;
    }
    await quiet(page, await page.evaluate(() => performance.now()), 300, 5000);
  };
  await toTop();
  res.scrollHeight = await page.$eval(sc, (e) => e.scrollHeight);
  // Reading speed: 100 px a frame for 600 frames (6,000 px/s).
  res.scrollRead = frameStats(await frames(page, "sc.scrollTop += 100; return sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1;", 600));
  await toTop();
  // A sweep: top to foot in 240 frames, wherever the foot is as rows measure.
  const m0 = await metrics(cdp);
  res.scrollSweep = frameStats(await frames(page, "const left = sc.scrollHeight - sc.clientHeight - sc.scrollTop; if (left <= 1) return false; sc.scrollTop += Math.max(200, left / Math.max(1, 240 - i));", 400));
  const m1 = await metrics(cdp);
  res.scrollSweep.scriptMs = r1((m1.ScriptDuration - m0.ScriptDuration) * 1000);
  res.scrollSweep.layoutMs = r1((m1.LayoutDuration - m0.LayoutDuration) * 1000);
  res.scrollSweep.styleMs = r1((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000);
  res.memoryAfterScroll = await memory(page, cdp);

  if (shots) {
    for (const theme of ["dark", "light"]) {
      const p = theme === "dark" ? page : (await newPage(browser, { view: "conversation", bench: "chat", turns: String(turns) }, "light")).page;
      if (theme === "light") {
        await openChat(p, CHAT_A);
        await p.locator("[data-testid=pane]:visible [data-testid=chat] .overflow-y-auto").first().evaluate((e) => e.setAttribute("data-bench-scroller", ""));
      }
      const mid = (e) => {
        e.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
        e.scrollTop = e.scrollHeight * 0.47;
      };
      await p.$eval(sc, mid);
      await p.waitForTimeout(700);
      await p.$eval(sc, mid);
      await p.waitForTimeout(700);
      // A code block near the top of the view, once highlighted.
      await p.$eval(sc, (e) => {
        const top = e.getBoundingClientRect().top;
        const pre = [...e.querySelectorAll(".cv-pre")].find((x) => x.getBoundingClientRect().top > top - 400);
        if (!pre) return;
        e.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
        e.scrollTop += pre.getBoundingClientRect().top - top - 120;
      });
      await p.waitForTimeout(1500);
      await p.waitForTimeout(800);
      mkdirSync(join(out, "shots"), { recursive: true });
      await p.screenshot({ path: join(out, "shots", `chat-${turns}-mid-${theme}.png`) });
      if (theme === "light") await p.context().close();
    }
  }

  // Back to the foot, then type (at rest).
  await page.$eval(sc, (e) => {
    e.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
    e.scrollTop = e.scrollHeight;
  });
  await page.waitForTimeout(1500);
  const box = page.locator("[data-testid=pane]:visible [data-testid=composer] textarea");
  const typing = async (label) => {
    await box.click();
    const words = "Look at the acme ledger retries and tell me what changed";
    const from = await page.evaluate(() => performance.now());
    const m0 = await metrics(cdp);
    await page.keyboard.type(words, { delay: 35 });
    const m1 = await metrics(cdp);
    const ev = await page.evaluate((from) => window.__perf.events.filter((e) => e.start >= from && /key|input/.test(e.name)), from);
    await box.fill("");
    const d = ev.map((e) => e.dur);
    // Event Timing's durations are rounded to 8 ms and include the wait for
    // the next frame, so the main thread's own time per key says more.
    return { label, events: ev.length, p50: pctl(d, 50), p95: pctl(d, 95), max: r1(Math.max(0, ...d)), mainThreadMsPerKey: r1(((m1.TaskDuration - m0.TaskDuration) * 1000) / words.length), styleMsPerKey: r1(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / words.length) };
  };
  res.typing = await typing("at rest");

  // A draft that streams: 3 words every 100 ms (the box reads every 600).
  const words = Array.from({ length: 400 }, (_, i) => (i % 40 === 39 ? "\n\n" : "") + ["the", "acme", "ledger", "retries", "now", "keep", "their", "key,", "so", "a", "repeat", "**finds**", "the", "row", "`once`"][i % 15]).join(" ").split(" ");
  await page.evaluate(
    ({ s, words }) => {
      let i = 3;
      window.__draftTimer = setInterval(() => {
        window.__berthDraft.show(s.box, s.session, words.slice(0, (i += 3)).join(" "));
      }, 100);
    },
    { s: SESSION_A, words },
  );
  await page.waitForTimeout(400);
  res.typingWhileDraft = await typing("while a draft streams");
  await page.evaluate(() => clearInterval(window.__draftTimer));

  // The cost of one draft update: 40 ticks, each waited out; timed first,
  // then again with React's commits read (which costs time of its own).
  const ticks = 40;
  const runTicks = async () => {
    await page.evaluate((s) => window.__berthDraft.clear(s.box, s.session), SESSION_A);
    await page.waitForTimeout(400);
    const tickMs = [];
    for (let k = 1; k <= ticks; k++) {
      const ms = await page.evaluate(
        ({ s, text }) =>
          new Promise((r) => {
            const t = performance.now();
            window.__berthDraft.show(s.box, s.session, text);
            // React renders in a task of its own; wait for it and a frame.
            requestAnimationFrame(() => setTimeout(() => r(performance.now() - t)));
          }),
        { s: SESSION_A, text: words.slice(0, k * 3).join(" ") },
      );
      tickMs.push(ms);
    }
    return tickMs;
  };
  const d0 = await metrics(cdp);
  const tickMs = await runTicks();
  const d1 = await metrics(cdp);
  await page.evaluate(() => {
    window.__perf.commits = [];
    window.__perf.track = true;
  });
  await runTicks();
  const commits = await page.evaluate(() => {
    window.__perf.track = false;
    return window.__perf.commits;
  });
  const rowsPer = commits.map((c) => c.rows.length);
  res.draft = {
    ticks,
    mainThreadMsPerTick: r1(((d1.TaskDuration - d0.TaskDuration) * 1000) / ticks),
    scriptMsPerTick: r1(((d1.ScriptDuration - d0.ScriptDuration) * 1000) / ticks),
    tickToFrameP50: pctl(tickMs, 50),
    tickToFrameP95: pctl(tickMs, 95),
    commits: commits.length,
    rowsRenderedPerCommitMax: Math.max(0, ...rowsPer),
    rowsRenderedPerCommitAvg: r1(rowsPer.reduce((a, b) => a + b, 0) / Math.max(1, rowsPer.length)),
    componentsPerCommitAvg: r1(commits.reduce((a, c) => a + c.rendered, 0) / Math.max(1, commits.length)),
  };
  await page.evaluate((s) => window.__berthDraft.clear(s.box, s.session), SESSION_A);

  // To the other long chat and back.
  const toB = await openChat(page, CHAT_B);
  const toA = await openChat(page, CHAT_A);
  res.switch = { toOther: toB, back: toA };
  res.memoryBothOpen = await memory(page, cdp);
  res.errors = errors;
  await context.close();
  return res;
}

// ---- Terminal -----------------------------------------------------------------

async function benchTerm(browser, lines, renderer) {
  const { context, page, cdp, errors } = await newPage(browser, { view: "terminal", bench: "term", lines: String(lines), ...(renderer === "xterm" ? {} : {}) });
  if (renderer === "xterm")
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("berth.prefs") ?? "{}");
      p.terminal = { ...(p.terminal ?? {}), renderer: "xterm" };
      localStorage.setItem("berth.prefs", JSON.stringify(p));
    });
  if (renderer === "xterm") {
    await page.reload();
    await page.getByTestId("nav-home").waitFor();
  }
  const t0 = await page.evaluate(() => performance.now());
  await page.locator('[data-testid=worktree-row][data-worktree="devl/checkout-fix"]').click();
  await page.waitForFunction(() => window.__benchTermDone === true, null, { timeout: 60_000 });
  const done = await page.evaluate(() => performance.now());
  const q = await quiet(page, t0, 500, 30_000);
  const res = { lines, renderer, writtenMs: r1(done - t0), quietMs: r1(Math.max(done, q.end) - t0), longTasks: q.n, longTaskMs: r1(q.total) };
  res.memory = await memory(page, cdp);
  // The wheel over the terminal: 240 notches, one a frame, up then down.
  const term = page.locator("[data-testid=pane]:visible [data-terminal]");
  const bb = await term.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const from = await page.evaluate(() => performance.now());
  const rec = page.evaluate(
    (n) =>
      new Promise((done) => {
        const times = [];
        const tick = (t) => {
          times.push(t);
          if (times.length > n) return done(times.slice(1).map((x, k) => x - times[k]));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    240,
  );
  for (let i = 0; i < 240; i++) {
    await page.mouse.wheel(0, i < 120 ? -40 : 40);
    await page.waitForTimeout(8);
  }
  res.wheel = frameStats(await rec);
  const ev = await page.evaluate((from) => window.__perf.events.filter((e) => e.start >= from && e.name === "wheel"), from);
  res.wheel.slowWheelEvents = ev.length;
  res.errors = errors;
  await context.close();
  return res;
}

// ---- Sidebar and Home -------------------------------------------------------------

// act runs fn in the page (a click, a key) and times it to the frame after
// the app's response is drawn (until(), polled each frame, says when), with
// the main thread's own time (CDP) and the long tasks it caused.
async function act(page, cdp, fn, until, arg) {
  const m0 = await metrics(cdp);
  const r = await page.evaluate(
    ({ fn, until, arg }) =>
      new Promise((done) => {
        const go = new Function("arg", fn);
        const ready = new Function("arg", until);
        const t0 = performance.now();
        go(arg);
        const start = performance.now();
        const tick = () => {
          if (ready(arg) || performance.now() - t0 > 10_000) return setTimeout(() => done({ t0, syncMs: start - t0, drawnMs: performance.now() - t0 }));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { fn, until, arg },
  );
  const q = await quiet(page, r.t0, 300, 10_000);
  const m1 = await metrics(cdp);
  return { ms: r1(r.drawnMs), syncMs: r1(r.syncMs), mainThreadMs: r1((m1.TaskDuration - m0.TaskDuration) * 1000 - 0), longTasks: q.n, longTaskMs: r1(q.total) };
}

// The sidebar's own size: its elements, and Base UI's roots and listeners
// are what made it slow (one context menu, ⋯ menu, + menu and tooltips a row).
const sidebarSize = (page, sel) =>
  page.evaluate((sel) => {
    const s = document.querySelector(sel);
    return { nodes: s ? s.getElementsByTagName("*").length + 1 : 0, rows: s ? s.querySelectorAll("[data-testid=worktree-row]").length : 0 };
  }, sel);

async function benchFleet(browser, worktrees) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const t0 = Date.now();
  await page.goto(`${base}/?mock=1&bench=fleet&worktrees=${worktrees}`);
  await page.locator("[data-testid=worktree-row]").nth(Math.min(worktrees, 200)).waitFor({ state: "attached", timeout: 60_000 }).catch(() => {});
  await page.locator("[data-testid=worktree-row]").first().waitFor({ state: "attached", timeout: 60_000 });
  const listed = Date.now() - t0;
  const q = await quiet(page, 0, 500, 30_000);
  const res = { worktrees, sidebarListedMs: listed, quietMs: r1(q.end), longTasks: q.n, longTaskMs: r1(q.total) };
  res.rows = await page.locator("[data-testid=worktree-row]").count();
  res.memory = await memory(page, cdp);
  res.sidebar = await sidebarSize(page, "[data-testid=sidebar]");
  // At rest: the main thread's time over 3 s with nothing happening (the
  // agents' state glyphs spin and pulse).
  const i0 = await metrics(cdp);
  await page.waitForTimeout(3000);
  const i1 = await metrics(cdp);
  res.idle = { mainThreadMsPerSec: r1(((i1.TaskDuration - i0.TaskDuration) * 1000) / 3), layoutMs: r1((i1.LayoutDuration - i0.LayoutDuration) * 1000), styleMs: r1((i1.RecalcStyleDuration - i0.RecalcStyleDuration) * 1000) };
  // The sidebar scrolled top to foot.
  const side = await page.evaluateHandle(() => {
    const row = document.querySelector("[data-testid=worktree-row]");
    let e = row;
    while (e && !(e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement;
    if (e) e.setAttribute("data-bench-side", "");
    return e;
  });
  const m0 = await metrics(cdp);
  res.sidebarScroll = frameStats(
    await page.evaluate(
      (sc) =>
        new Promise((done) => {
          if (!sc) return done([]);
          sc.scrollTop = 0;
          const times = [];
          const tick = (t) => {
            times.push(t);
            sc.scrollTop += 60;
            if (times.length > 400 || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) return done(times.slice(1).map((x, k) => x - times[k]));
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      side,
    ),
  );
  const m1 = await metrics(cdp);
  res.sidebarScroll.mainThreadMs = r1((m1.TaskDuration - m0.TaskDuration) * 1000);
  res.sidebarScroll.mainThreadMsPerFrame = r1(res.sidebarScroll.mainThreadMs / Math.max(1, res.sidebarScroll.frames));
  await page.evaluate(() => {
    const sc = document.querySelector("[data-bench-side]");
    if (sc) sc.scrollTop = 0;
  });
  await page.waitForTimeout(300);

  // The sidebar's edge dragged wider and back, 80 moves a frame apart.
  const handle = await page.locator("[data-sidebar-handle]").first().boundingBox();
  if (handle) {
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + 300;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    const rec = page.evaluate(
      () =>
        new Promise((done) => {
          const times = [];
          const tick = (t) => {
            times.push(t);
            if (window.__dragDone) return done(times.slice(1).map((x, k) => x - times[k]));
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const d0 = await metrics(cdp);
    for (let i = 0; i < 80; i++) {
      await page.mouse.move(hx + (i % 40 < 20 ? i % 20 : 20 - (i % 20)) * 4, hy);
      await page.waitForTimeout(16);
    }
    const d1 = await metrics(cdp);
    await page.evaluate(() => (window.__dragDone = true));
    res.sidebarDrag = frameStats(await rec);
    res.sidebarDrag.styleMs = r1((d1.RecalcStyleDuration - d0.RecalcStyleDuration) * 1000);
    res.sidebarDrag.mainThreadMs = r1((d1.TaskDuration - d0.TaskDuration) * 1000);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  // Fold a project and open it again (the first project, by its chevron;
  // the project's row says whether it is open, aria-expanded).
  const project = await page.evaluate(() => document.querySelector("[data-fold]")?.closest("[aria-expanded]")?.textContent?.trim().slice(0, 40));
  if (project) {
    const rowsNow = () => "return document.querySelectorAll('[data-testid=worktree-row]').length";
    const before = await page.evaluate(new Function(rowsNow()));
    const open = (v) => `return document.querySelector('[data-fold]').closest('[aria-expanded]').getAttribute('aria-expanded') === '${v}'`;
    res.collapse = await act(page, cdp, `document.querySelector('[data-fold]').click()`, open("false"), project);
    res.expand = await act(page, cdp, `document.querySelector('[data-fold]').click()`, open("true"), project);
    res.collapse.project = project;
    res.expand.rowsBack = (await page.evaluate(new Function(rowsNow()))) === before;
  }

  // A row's context menu, opened as the menu key does (Shift+F10).
  const wt = await page.evaluate(() => [...document.querySelectorAll("[data-testid=worktree-row]")].find((r) => !r.dataset.worktree.endsWith("/" + r.dataset.worktree.split("/")[0]) && r.getBoundingClientRect().top > 300)?.dataset.worktree);
  if (wt) {
    const row = `[data-testid=worktree-row][data-worktree="${wt}"]`;
    await page.locator(row).focus();
    res.contextMenu = await act(page, cdp, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }))`, `return !!document.querySelector("[role=menu]")`);
    await page.keyboard.press("Escape");
    await page.locator("[role=menu]").waitFor({ state: "detached" }).catch(() => {});
    await page.waitForTimeout(300);
    // The ⋯ menu: hover the row, then click its actions button.
    await page.locator(row).hover();
    await page.waitForTimeout(200);
    const dots = page.locator(row).locator("xpath=..").locator('[aria-label$=" actions"]');
    const bb = await dots.boundingBox();
    const d0 = await page.evaluate(() => performance.now());
    const dm0 = await metrics(cdp);
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.locator("[role=menu]").waitFor();
    const d1 = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now())))));
    const dq = await quiet(page, d0, 300, 10_000);
    const dm1 = await metrics(cdp);
    res.dotsMenu = { ms: r1(d1 - d0), mainThreadMs: r1((dm1.TaskDuration - dm0.TaskDuration) * 1000), longTasks: dq.n, longTaskMs: r1(dq.total) };
    await page.keyboard.press("Escape");
    await page.locator("[role=menu]").waitFor({ state: "detached" }).catch(() => {});
    await page.mouse.move(800, 400);
    await page.waitForTimeout(300);

    // Rename in place: double-click to the field, then Enter to the new name.
    res.renameOpen = await act(page, cdp, `document.querySelector(arg).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`, `return !!document.querySelector("[data-testid=worktree-rename] input")`, row);
    const field = page.locator("[data-testid=worktree-rename] input");
    await page.waitForTimeout(150);
    await field.fill("Acme bench rename");
    res.renameSave = await act(page, cdp, `document.querySelector("[data-testid=worktree-rename] input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`, `return !!document.querySelector('[data-testid=worktree-row][data-title="Acme bench rename"]')`);
    res.renameSave.worktree = wt;
  }

  // Home with every agent.
  const h0 = await page.evaluate(() => performance.now());
  await page.getByTestId("nav-home").click();
  await page.waitForTimeout(50);
  const hq = await quiet(page, h0, 500, 30_000);
  res.home = { quietMs: r1(Math.max(hq.end, h0) - h0), longTasks: hq.n, longTaskMs: r1(hq.total), ...(await memory(page, cdp)) };

  // The folded rail with every agent: folding to it, then a start with it.
  res.fold = await act(page, cdp, `document.querySelector('[aria-label="Hide the sidebar"]').click()`, `return !!document.querySelector("[data-testid=sidebar-rail] [data-testid=rail-agent]")`);
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator("[data-testid=rail-agent]").first().waitFor({ timeout: 60_000 });
  const rq = await quiet(page, 0, 500, 30_000);
  res.rail = { quietMs: r1(rq.end), longTasks: rq.n, longTaskMs: r1(rq.total), tiles: await page.locator("[data-testid=rail-agent]").count(), ...(await sidebarSize(page, "[data-testid=sidebar-rail]")), memory: await memory(page, cdp) };
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("berth.prefs") ?? "{}");
    localStorage.setItem("berth.prefs", JSON.stringify({ ...p, sidebarCollapsed: false }));
  });
  res.errors = errors;
  await context.close();
  return res;
}

// ---- Run -----------------------------------------------------------------------

const server = await serve();
const browser = await chromium.launch({ args: ["--enable-precise-memory-info", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
const results = { at: new Date().toISOString(), label: args.label ?? "", machine: `${process.platform} ${process.arch}`, chat: [], term: [], fleet: [] };
try {
  for (let run = 0; run < runs; run++) {
    if (only.has("chat"))
      for (const n of sizes) {
        process.stderr.write(`chat ${n} turns…\n`);
        const r = await benchChat(browser, n, args.shots && n === Math.max(...sizes) && run === 0);
        results.chat.push(r);
        process.stderr.write(`${JSON.stringify(r)}\n`);
      }
    if (only.has("term"))
      for (const renderer of ["ghostty", "xterm"]) {
        process.stderr.write(`terminal (${renderer})…\n`);
        const r = await benchTerm(browser, Number(args.lines ?? 50_000), renderer);
        results.term.push(r);
        process.stderr.write(`${JSON.stringify(r)}\n`);
      }
    if (only.has("fleet")) {
      process.stderr.write("fleet…\n");
      const r = await benchFleet(browser, Number(args.worktrees ?? 300));
      results.fleet.push(r);
      process.stderr.write(`${JSON.stringify(r)}\n`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(out, "numbers.json"), `${JSON.stringify(results, null, 2)}\n`);
process.stderr.write(`wrote ${join(out, "numbers.json")}\n`);
