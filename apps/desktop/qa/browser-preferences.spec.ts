import { createServer } from "node:http";
import { expect, test as base, type Page } from "@playwright/test";

type Call = { action: string; method: string; body: Record<string, unknown> };
type Runtime = { calls: Call[]; refuseClear: boolean };
const key = "ll.browser.workspace:/v1/worktrees/personal/main/browser";
const pane = (page: Page) => page.getByTestId("agent-browser");
const address = (page: Page) => pane(page).getByLabel("Address", { exact: true });
const test = base.extend<{ runtime: Runtime }>({
  runtime: async ({ page }, use) => {
    const fixture = await page.context().newPage();
    await fixture.setContent("<p>History fixture</p>");
    const image = (await fixture.screenshot()).toString("base64"); await fixture.close();
    const tabs = new Map<string, { name: string; url: string; title: string; viewport: { width: number; height: number; scale: number } }>();
    const runtime: Runtime = { calls: [], refuseClear: false };
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      res.writeHead(200, { "content-type": "application/x-ndjson", "access-control-allow-origin": "*" });
      const send = () => { const tab = tabs.get(url.searchParams.get("tab") ?? ""); res.write(url.pathname === "/events" ? "\n" : JSON.stringify({ data: image, mime: "image/png", url: tab?.url, w: tab?.viewport.width ?? 640, h: tab?.viewport.height ?? 400 }) + "\n"); };
      send(); const timer = setInterval(send, 100); req.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await page.route("**/__runtime/**", async (route) => {
      const req = route.request(), url = new URL(req.url()), action = url.pathname.split("/").at(-1)!;
      const body = req.postDataJSON() ?? {}, tabName = url.searchParams.get("tab") ?? "";
      runtime.calls.push({ action, method: req.method(), body });
      const reply = (json: unknown) => route.fulfill({ json });
      if (action === "events" || action === "screencast") return route.continue({ url: `http://127.0.0.1:${port}/${action === "events" ? "events" : "frames"}${url.search}` });
      if (action === "workspace") return reply({ location: "personal", worktree: "main", port: 1420 });
      if (action === "status") return reply({ state: "ready", running: true, home: "/tmp/browser-preferences-qa", status: { refused_hosts: [] } });
      if (action === "download-settings") return reply({ enabled: false, ask: false, directory: "/tmp/test/Downloads", defaultDirectory: "/tmp/test/Downloads" });
      if (action === "developer") return reply({ enabled: false, state: "disabled" });
      if (action === "permissions") return reply({ hosts: [] });
      if (action === "tabs") return reply({ tabs: [...tabs.values()] });
      if (action === "open" || action === "navigate") { tabs.set(tabName, { name: tabName, url: body.url, title: new URL(body.url).pathname.slice(1), viewport: { width: 640, height: 400, scale: 1 } }); return reply({}); }
      if (action === "close") { tabs.delete(tabName); return reply({}); }
      if (action === "resize") { const tab = tabs.get(tabName); const [width, height] = String(body.size).split("x").map(Number); if (tab) tab.viewport = { width, height, scale: 1 }; return reply({}); }
      if (action === "state") { const tab = tabs.get(tabName); return reply({ ...tab, running: !!tab, loading: false, zoom: 1, refusedHosts: [] }); }
      if (action === "profile") { if (runtime.refuseClear) return route.fulfill({ status: 409, json: { error: "Close agent tabs before clearing website data." } }); tabs.clear(); return reply({}); }
      if (["sessions", "locations"].includes(action)) return reply([]);
      return reply({});
    });
    await page.addInitScript(({ key }) => {
      if (localStorage.getItem(key)) return;
      const entry = (path: string, age: number) => ({ title: path, url: `http://localhost:1420/${encodeURIComponent(path)}`, time: Date.now() - age });
      localStorage.setItem(key, JSON.stringify({ tabs: [], closed: [], selected: "", history: [entry("Useful recent", 1000), entry("Useful old", 2 * 86400000)], bookmarks: [entry("Keep bookmark", 0)] }));
    }, { key });
    try { await use(runtime); } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  },
});
async function open(page: Page) { await page.goto("/"); await page.getByRole("button", { name: "Browser", exact: true }).click(); await expect(address(page)).toBeVisible(); }
async function menu(page: Page, name: string) { await pane(page).getByRole("button", { name: "Browser menu", exact: true }).click(); await page.getByRole("menuitem", { name, exact: true }).click(); }
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

// Seam: the global comment quota must remain recoverable after its pages or workspaces are forgotten.
test("Saved feedback can be removed across workspaces after confirmation", async ({ page, runtime }) => {
  void runtime;
  await page.addInitScript(() => {
    const data = Object.fromEntries(["old-project", "personal"].map((workspace, i) => [JSON.stringify([workspace, "https://example.com/forgotten"]), [{ id: String(i), comment: "Saved note", element: { tag: "p", text: "Evidence", url: "https://example.com/forgotten" }, screenshot: { name: `annotation-${"a".repeat(32)}.png`, mime: "image/png", capturedAt: "2026-10-28T20:00:00Z" } }]]));
    localStorage.setItem("ll.browser.annotations.v1", JSON.stringify(data));
  });
  await open(page); await menu(page, "Browser settings");
  const settings = page.getByTestId("settings-browser");
  await expect(settings.getByText("2 saved comments", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Remove saved comments…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove saved browser comments?", exact: true });
  await expect(dialog).toContainText("already attached to a chat stay");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings.getByText("2 saved comments", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Remove saved comments…", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove saved comments", exact: true }).click();
  await expect(settings.getByText("0 saved comments", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ll.browser.annotations.v1"))).toBe("{}");
});

// Seam: free text and combobox selection share an address; Enter must navigate exactly once.
test("Address supports free text, keyboard history, Escape, and reopening after the last tab", async ({ page, runtime }) => {
  await open(page);
  await address(page).fill("useful"); await expect(page.getByRole("option")).toHaveCount(2);
  await address(page).press("ArrowDown"); await address(page).press("Enter");
  await expect.poll(() => runtime.calls.filter((c) => ["open", "navigate"].includes(c.action)).length).toBe(1);
  expect(runtime.calls.find((c) => c.action === "open")?.body.url).toBe("http://localhost:1420/Useful%20recent");
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  await address(page).fill("Useful"); await expect(page.getByRole("option")).toHaveCount(2);
  await address(page).press("Escape"); await expect(page.getByRole("option")).toHaveCount(0);
  expect(runtime.calls.filter((c) => ["open", "navigate"].includes(c.action))).toHaveLength(1);
  await address(page).fill("localhost:1420/typed"); await address(page).press("Enter");
  await expect(pane(page).getByRole("button", { name: "Close typed", exact: true })).toBeVisible();
  await pane(page).getByRole("button", { name: "Close typed", exact: true }).click();
  await address(page).fill("localhost:1420/typed"); await address(page).press("Enter");
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  await expect.poll(() => runtime.calls.filter((c) => c.action === "open").length).toBe(2);
});

// Seam: destructive backend clearing must succeed before removing any local history or tabs.
test("Selective history clearing keeps bookmarks, website data and older visits; failed clearing keeps records", async ({ page, runtime }) => {
  await open(page); await menu(page, "Clear browsing data…");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Cookies, website data and cache" }).uncheck();
  await dialog.getByRole("combobox", { name: "History time range" }).click(); await page.getByRole("option", { name: "Last hour", exact: true }).click();
  await dialog.getByRole("button", { name: "Clear browsing data", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await saved(page)).history.map((x: { title: string }) => x.title)).toEqual(["Useful old"]);
  expect((await saved(page)).bookmarks).toHaveLength(1);
  expect(runtime.calls.filter((c) => c.action === "profile")).toHaveLength(0);
  await menu(page, "Clear browsing data…"); runtime.refuseClear = true;
  await dialog.getByRole("button", { name: "Clear browsing data", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Close agent tabs");
  expect((await saved(page)).history).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  runtime.refuseClear = false;
  await menu(page, "Clear browsing data…"); await dialog.getByRole("checkbox", { name: "Browsing history", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Clear browsing data", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect((await saved(page)).history).toHaveLength(1);
});

// Seam: Settings uses the personal browser store and can open a page after its browser pane remounts.
test("Browser settings search, remove and reopen history without enabling native download writes in web QA", async ({ page, runtime }, info) => {
  await open(page); await menu(page, "Browser settings");
  const settings = page.getByTestId("settings-browser");
  await expect(settings.getByRole("button", { name: "Choose folder…" })).toBeDisabled();
  await expect(settings.getByRole("switch", { name: "Ask where to save downloads" })).toBeChecked();
  await settings.getByRole("textbox", { name: "Search browser history" }).fill("old");
  await settings.getByRole("button", { name: "Remove history Useful old", exact: true }).click();
  await expect(settings.getByText("No matching pages.")).toBeVisible();
  await settings.getByRole("textbox", { name: "Search browser history" }).fill("");
  await page.screenshot({ path: info.outputPath("browser-settings.png"), animations: "disabled" });
  await settings.getByRole("button", { name: /^Useful recent http/ }).click();
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  await expect(address(page)).toHaveValue("http://localhost:1420/Useful%20recent");
  expect((await saved(page)).history.some((x: { title: string }) => x.title === "Useful old")).toBe(false);
  expect(runtime.calls.filter((c) => c.action === "download-settings" && c.method === "PUT")).toHaveLength(0);
});

// Seam: restored tab state must not turn a history removal into a fresh visit.
test("Cleared current-page history stays removed across Settings and reload until actual navigation", async ({ page, runtime }) => {
  await open(page);
  await address(page).fill("localhost:1420/current"); await address(page).press("Enter");
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  await expect.poll(async () => (await saved(page)).history.some((entry: { title: string }) => entry.title === "current")).toBe(true);
  await menu(page, "Browser settings");
  const settings = page.getByTestId("settings-browser");
  await settings.getByRole("button", { name: "Clear browsing data…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Cookies, website data and cache" }).uncheck();
  await dialog.getByRole("button", { name: "Clear browsing data", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect((await saved(page)).history).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  await page.reload();
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  expect((await saved(page)).history).toHaveLength(0);
  const reads = runtime.calls.filter((call) => call.action === "state").length;
  await expect.poll(() => runtime.calls.filter((call) => call.action === "state").length).toBeGreaterThan(reads);
  expect((await saved(page)).history).toHaveLength(0);
  await address(page).fill("localhost:1420/current"); await address(page).press("Enter");
  await expect.poll(async () => (await saved(page)).history.map((entry: { title: string }) => entry.title)).toEqual(["current"]);
  await menu(page, "Browser settings");
  await settings.getByRole("button", { name: "Remove history current", exact: true }).click();
  await page.keyboard.press("Escape"); await page.reload();
  await expect(pane(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
  expect((await saved(page)).history).toHaveLength(0);
});
