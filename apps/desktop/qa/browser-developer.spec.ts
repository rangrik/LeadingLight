import { createServer } from "node:http";
import { expect, test as base } from "@playwright/test";

// Seam: a page approval controls the CDP UI; catches accidental grants and commands reaching another tab.
const test = base.extend<{ developer: { calls: { tab: string; method?: string; allow?: boolean }[] } }>({
  developer: async ({ page }, use) => {
    const preview = await page.context().newPage();
    await preview.setContent("<h1>Developer fixture</h1>");
    const data = (await preview.screenshot({ type: "jpeg" })).toString("base64"); await preview.close();
    const tabs = new Map<string, { name: string; url: string; title: string; viewport: { width: number; height: number; scale: number } }>();
    const grants = new Map<string, { state: string; id: string; reason: string }>();
    const calls: { tab: string; method?: string; allow?: boolean }[] = [];
    let enabled = false;
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson", "access-control-allow-origin": "*" });
      const url = new URL(req.url!, "http://localhost"), tab = url.searchParams.get("tab")!;
      const send = () => { const value = tabs.get(tab); res.write(url.pathname === "/events" ? "\n" : JSON.stringify({ data, w: value?.viewport.width ?? 640, h: value?.viewport.height ?? 400, url: value?.url }) + "\n"); };
      send(); const timer = setInterval(send, 1000); req.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await page.route("**/__runtime/**", async (route) => {
      const req = route.request(), url = new URL(req.url()), action = url.pathname.split("/").at(-1)!;
      const tab = url.searchParams.get("tab") ?? "", body = req.postDataJSON() as Record<string, unknown> | null;
      const reply = (json: unknown) => route.fulfill({ json });
      const status = () => ({ enabled, state: enabled ? grants.get(tab)?.state ?? "none" : "disabled", id: grants.get(tab)?.id, origin: "https://fixture.test", reason: grants.get(tab)?.reason, text: enabled ? "Developer access is scoped to this page." : "Developer access is off. Enable it in Browser settings." });
      if (url.pathname.endsWith("/v1/browser/developer")) { if (req.method() === "PUT") { enabled = !!body?.enabled; if (!enabled) grants.clear(); } return reply({ enabled }); }
      if (url.pathname.includes("/developer")) {
        if (action === "developer") { if (req.method() === "DELETE") grants.delete(tab); return reply(status()); }
        if (action === "request") { grants.set(tab, { state: "pending", id: `${tab}-request`, reason: String(body?.reason) }); return reply(status()); }
        if (action === "decide") { calls.push({ tab, allow: !!body?.allow }); const grant = grants.get(tab)!; grant.state = body?.allow ? "allowed" : "denied"; return reply(status()); }
        if (action === "cdp") { calls.push({ tab, method: String(body?.method) }); return reply({ result: { root: { nodeName: "#document", nodeId: 1 } } }); }
        if (action === "events") return reply({ events: [{ sequence: 1, method: "Runtime.consoleAPICalled", params: { text: "Fixture console" } }], sequence: 1, dropped: 0 });
      }
      if (action === "events" || action === "screencast") return route.continue({ url: `http://127.0.0.1:${port}/${action === "events" ? "events" : "frames"}${url.search}` });
      if (action === "workspace") return reply({ location: "personal", worktree: "main", port: 1420 });
      if (action === "locations" || action === "sessions") return reply([]);
      if (action === "status") return reply({ state: "ready", home: "/tmp/developer-qa", running: true });
      if (action === "permissions") return reply({ hosts: [] });
      if (action === "tabs") return reply({ tabs: [...tabs.values()] });
      if (action === "navigate" || action === "open") { const old = tabs.get(tab); tabs.set(tab, { name: tab, url: String(body?.url ?? old?.url), title: "Developer fixture", viewport: old?.viewport ?? { width: 640, height: 400, scale: 1 } }); grants.delete(tab); return reply({}); }
      if (action === "resize") { const value = tabs.get(tab); const [width, height] = String(body?.size).split("x").map(Number); if (value) value.viewport = { width, height, scale: 1 }; return reply({}); }
      if (action === "state") { const value = tabs.get(tab); return reply({ running: !!value, url: value?.url ?? "", title: value?.title ?? "", viewport: value?.viewport, zoom: 1, loading: false, canGoBack: false, canGoForward: false }); }
      return reply({});
    });
    try { await use({ calls }); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  },
});

test("Developer access requires its setting and a separate page approval", async ({ page, developer }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  const browser = page.getByTestId("agent-browser");
  await browser.getByLabel("Address", { exact: true }).fill("https://fixture.test/");
  await browser.getByLabel("Address", { exact: true }).press("Enter");
  await browser.getByRole("button", { name: "Browser menu" }).click();
  await page.getByRole("menuitem", { name: "Developer tools", exact: true }).click();
  const panel = page.getByTestId("browser-developer");
  await expect(panel).toContainText("Developer access is off");
  await expect(panel.getByRole("button", { name: "Run command", exact: true })).toHaveCount(0);
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-browser").click();
  await page.getByRole("switch", { name: "Allow page developer access", exact: true }).click();
  await page.keyboard.press("Escape");
  await panel.getByRole("textbox", { name: "Developer task", exact: true }).fill("Inspect the layout before changing it.");
  await panel.getByRole("button", { name: "Request access", exact: true }).click();
  await expect(panel).toContainText("Inspect the layout before changing it.");
  expect(developer.calls).toEqual([]);
  await panel.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Request access", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Request access", exact: true }).click();
  await panel.getByRole("button", { name: "Allow for this page", exact: true }).click();
  await panel.getByRole("button", { name: "DOM", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Command result", exact: true })).toHaveValue(/#document/);
  expect(developer.calls.map((call) => call.allow ?? call.method)).toEqual([false, true, "DOM.getDocument"]);
  expect(new Set(developer.calls.map((call) => call.tab)).size).toBe(1);
  await expect(panel).toContainText("Fixture console");
  await page.screenshot({ path: testInfo.outputPath("developer-approved.png") });
  await panel.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Command result", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Run command", exact: true })).toHaveCount(0);
});
