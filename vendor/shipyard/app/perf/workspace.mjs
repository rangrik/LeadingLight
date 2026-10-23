// What perf/soak.mjs and perf/terminals.mjs share: serving the build, the
// stand-in dev server's pages, building the workspace in mock mode, and
// reading Chromium's numbers.

import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { noisyPage } from "./instrument.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const app = resolve(here, "..");
const run = promisify(execFile);
const PROXIED = /^https?:\/\/[^/]+\.localhost:1377(?:\/|$)/;
const DEVTOOLS = readFileSync(resolve(app, "../internal/proxy/devtools.js"), "utf8");
const PREVIEW = readFileSync(resolve(app, "../internal/proxy/preview.js"), "utf8");
export const r1 = (x) => Math.round(x * 10) / 10;
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .join(" ")
      .split(/\s*--/)
      .filter(Boolean)
      .map((a) => {
        const [k, ...v] = a.split(/\s+/);
        return [k, v.length ? v.join(" ") : true];
      }),
  );
}

export async function serve(port, distDir) {
  // A server already there (another run's, another worktree's) would be
  // measured instead of this build: refuse rather than reuse it.
  const busy = await fetch(`http://localhost:${port}`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`port ${port} is in use: pick another with --port (1421–1439, not 1420)`);
  // --dist serves another build (a copy of an earlier one, to compare).
  const dist = distDir ? ["--outDir", resolve(String(distDir))] : [];
  // Its own process group, so stopping it stops vite too, not only pnpm.
  const p = spawn("pnpm", ["exec", "vite", "preview", "--port", String(port), "--strictPort", ...dist], { cwd: app, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stop = () => {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  };
  process.on("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stop(), process.exit(1)));
  let text = "";
  p.stdout.on("data", (d) => (text += d));
  p.stderr.on("data", (d) => (text += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${port}`)).ok) return { kill: stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  stop();
  throw new Error(`vite preview didn't start on ${port}:\n${text}`);
}

// ---- The workspace ------------------------------------------------------------

export async function routes(context) {
  await context.route(PROXIED, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    const preview = u.searchParams.has("__berth_preview");
    const devtools = u.searchParams.has("__berth_devtools");
    const title = u.pathname.includes("orders") ? "Orders" : u.pathname.includes("cart") ? "Cart" : "Shop";
    return route.fulfill({ status: 200, contentType: "text/html", body: noisyPage(preview ? PREVIEW : devtools ? DEVTOOLS : "", title) });
  });
  // Nothing may reach a real laptop agent.
  await context.route(/^https?:\/\/(?:localhost|127\.0\.0\.1):(?:1377|1378|1379)\//, (r) => r.abort());
}

// The tab in front, and the worktree whose row shows it.
export async function activeTab(page) {
  const id = await page.locator('[data-tab-strip] [data-tab][aria-selected="true"]:visible').first().getAttribute("data-tab");
  const w = await page.locator('[data-testid=worktree-row][data-active="true"]').first().getAttribute("data-worktree");
  return { id, w };
}

export async function newTab(page, option) {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.getByRole("option", { name: option }).first().click();
}

export async function openBrowser(page, url) {
  await newTab(page, /New browser tab/);
  const pane = page.locator("[data-testid=browser-pane]:visible");
  const address = pane.getByRole("textbox", { name: "Address" });
  await address.fill(url);
  await address.press("Enter");
  await pane.frameLocator("iframe").getByRole("heading").first().waitFor();
  return pane;
}

export async function setup(page) {
  const views = {};
  const row = (w) => page.locator(`[data-testid=worktree-row][data-worktree="${w}"]`);
  await row("devl/checkout-fix").click();
  await page.locator("[data-testid=pane]:visible [data-testid=chat]").first().waitFor();
  // The second chat, split in beside the first (dragged onto its edge).
  const area = await page.locator("[data-pane-area]").boundingBox();
  const r = await row("devl/search-perf").boundingBox();
  const m = page.mouse;
  await m.move(r.x + r.width / 2, r.y + r.height / 2);
  await m.down();
  await m.move(r.x + r.width / 2 + 20, r.y + r.height / 2, { steps: 4 });
  await m.move(area.x + area.width * 0.9, area.y + area.height * 0.5, { steps: 12 });
  await page.waitForTimeout(200);
  await m.up();
  await page.locator("[data-pane-area] [data-testid=chat]:visible").nth(1).waitFor();
  views.chats = await activeTab(page);
  // Back to checkout-fix's own tabs, where its dev server is.
  await row("devl/checkout-fix").click();

  // A Browser tab with its Network drawer, and one with its Console.
  let pane = await openBrowser(page, "http://checkout-fix.shop.devl.localhost:1377/cart");
  await page.keyboard.press("Meta+Alt+KeyI");
  await pane.getByTestId("devtools-drawer").waitFor();
  await pane.getByTestId("devtools-drawer").getByRole("tab", { name: /Network/ }).click();
  views.browser = await activeTab(page);
  pane = await openBrowser(page, "http://checkout-fix.shop.devl.localhost:1377/orders");
  await page.keyboard.press("Meta+Alt+KeyI");
  await pane.getByTestId("devtools-drawer").waitFor();
  views.browser2 = await activeTab(page);

  // A Preview tab.
  await newTab(page, /^Preview/);
  const frame = page.locator("[data-testid=preview-pane]:visible [data-testid=preview-frame]").first();
  const ask = page.locator('input[placeholder^="Port (3000)"]:visible').first();
  await frame.or(ask).first().waitFor();
  if (await ask.isVisible().catch(() => false)) {
    await ask.fill("http://checkout-fix.shop.devl.localhost:1377/");
    await ask.press("Enter");
  }
  await frame.waitFor();
  views.preview = await activeTab(page);

  // The Files panel.
  await page.keyboard.press("Meta+Shift+E");
  await page.getByTestId("files-panel").waitFor();

  // Another worktree's tabs as a group (its agent is at work).
  await row("devl/qa-deck").click({ modifiers: ["Alt"] });
  await page.waitForTimeout(500);
  views.group = await activeTab(page);
  return views;
}

export async function show(page, views, view) {
  if (view === "home") {
    await page.getByTestId("nav-home").click();
    return;
  }
  const { id, w } = views[view];
  const tab = page.locator(`[data-tab-strip] [data-tab="${id}"]`).first();
  await page.locator(`[data-testid=worktree-row][data-worktree="${w}"]`).click();
  // Grouped worktrees share a strip: the tab may be in either.
  if (!(await tab.isVisible().catch(() => false))) {
    for (const other of ["devl/checkout-fix", "devl/search-perf", "devl/qa-deck"]) {
      await page.locator(`[data-testid=worktree-row][data-worktree="${other}"]`).click();
      if (await tab.isVisible().catch(() => false)) break;
    }
  }
  await tab.click();
}

// ---- Measuring ----------------------------------------------------------------

export async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

export async function processes(bcdp) {
  try {
    const { processInfo } = await bcdp.send("SystemInfo.getProcessInfo");
    return processInfo.map((p) => ({ pid: p.id, type: p.type, cpu: p.cpuTime }));
  } catch {
    return [];
  }
}

export async function detached(cdp) {
  try {
    const r = await cdp.send("DOM.getDetachedDomNodes");
    return r.detachedNodes?.length ?? 0;
  } catch {
    return null;
  }
}

// macOS: idle wakeups and CPU of the given processes over secs, from top's
// second sample (the first covers no interval).
export async function wakeups(pids, secs) {
  if (process.platform !== "darwin" || !pids.length) return null;
  try {
    const { stdout } = await run("top", ["-l", "2", "-s", String(secs), "-stats", "pid,cpu,idlew,power", ...pids.flatMap((p) => ["-pid", String(p)])], { timeout: (secs + 15) * 1000 });
    const blocks = stdout.split(/\n(?=Processes:)/);
    const last = blocks[blocks.length - 1];
    const rows = {};
    for (const line of last.split("\n")) {
      const m = /^(\d+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)/.exec(line.trim());
      if (m) rows[m[1]] = { cpuPct: Number(m[2]), idleWakeups: Number(m[3]), wakeupsPerSec: r1(Number(m[3]) / secs), power: Number(m[4]) };
    }
    return rows;
  } catch {
    return null;
  }
}

