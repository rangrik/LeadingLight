import { createServer } from "node:http";
import { expect, test as base, type Page } from "@playwright/test";

type Call = { action: string; body: Record<string, unknown>; tab: string };
type Tab = { name: string; url: string; title: string; viewport: { width: number; height: number; scale: number } };
type Runtime = { calls: Call[]; messages: string[]; uploads: { name: string; data: string }[]; png: string; expireImages: boolean; failReset: boolean; workspace: string; created: number; holdHover?: { arrive: () => void; wait: Promise<void> } };
const browser = (page: Page) => page.getByTestId("agent-browser");
const address = (page: Page) => browser(page).getByLabel("Address", { exact: true });
const test = base.extend<{ runtime: Runtime }>({
  runtime: async ({ page }, use) => {
    const fixture = await page.context().newPage();
    await fixture.setViewportSize({ width: 640, height: 400 });
    await fixture.setContent("<h1>Annotation fixture</h1><button>Do not activate</button>");
    const png = (await fixture.screenshot()).toString("base64");
    await fixture.close();
    const tabs = new Map<string, Tab>();
    const runtime: Runtime = { calls: [], messages: [], uploads: [], png, expireImages: false, failReset: false, workspace: "personal", created: 0 };
    let image = 0, handle = 0;
    let conversation: Record<string, unknown> | undefined, session: Record<string, unknown> | undefined;
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      res.writeHead(200, { "content-type": "application/x-ndjson", "access-control-allow-origin": "*", "cache-control": "no-store" });
      const frame = () => { const tab = tabs.get(url.searchParams.get("tab")!); res.write(url.pathname === "/events" ? "\n" : JSON.stringify({ data: png, mime: "image/png", w: tab?.viewport.width ?? 640, h: tab?.viewport.height ?? 400, url: tab?.url }) + "\n"); };
      frame(); const timer = setInterval(frame, 80); req.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await page.route("**/__runtime/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), action = url.pathname.split("/").at(-1)!;
      const body = request.postDataJSON() as Record<string, unknown> ?? {}, name = url.searchParams.get("tab") ?? "";
      runtime.calls.push({ action, body, tab: name });
      const reply = (json: unknown) => route.fulfill({ json });
      if (action === "events" || action === "screencast") return route.continue({ url: `http://127.0.0.1:${port}/${action === "events" ? "events" : "frames"}${url.search}` });
      if (action === "workspace") return reply({ location: runtime.workspace, worktree: "main", port: 1420 });
      if (action === "status") return reply({ state: "ready", running: true, home: "/tmp/browser-qa", status: { refused_hosts: [] } });
      if (action === "permissions") return reply({ hosts: [] });
      if (action === "tabs") return reply({ tabs: [...tabs.values()] });
      if (action === "open" || action === "navigate") {
        const tab = tabs.get(name) ?? { name, url: "", title: "", viewport: { width: 640, height: 400, scale: 1 } };
        if (body.url) { tab.url = String(body.url); tab.title = new URL(tab.url).pathname.slice(1) || "Fixture"; }
        tabs.set(name, tab); return reply({});
      }
      if (action === "close") { tabs.delete(name); return reply({}); }
      if (action === "resize") { const [width, height] = String(body.size).split("x").map(Number); const tab = tabs.get(name); if (tab) tab.viewport = { width, height, scale: 1 }; return reply({}); }
      if (action === "state") { const tab = tabs.get(name); return reply({ running: !!tab, url: tab?.url, title: tab?.title, viewport: tab?.viewport, loading: false, zoom: 1, refusedHosts: [], canGoBack: false, canGoForward: false }); }
      if (action === "lease") return reply(request.method() === "DELETE" ? {} : { lease: body.lease ?? `lease-${runtime.calls.length}`, expiresAt: Date.now() + 15000 });
      if (["inspect", "hover", "reveal", "style", "reset"].includes(action)) {
        if (action === "reset" && runtime.failReset) return route.fulfill({ status: 503, json: { error: "Preview reset temporarily unavailable." } });
        const answer = { handle: action === "inspect" ? `element-${++handle}` : body.handle, tag: "button", text: "Do not activate <untrusted>", selector: "button#target", url: tabs.get(name)?.url, frame: { url: "https://frame.example/embedded", path: ["frame-1"] }, bounds: { x: 20, y: 20, width: 180, height: 40 }, styles: { color: action === "style" ? body.value : "black" } };
        if (action === "hover" && runtime.holdHover) { const hold = runtime.holdHover; runtime.holdHover = undefined; hold.arrive(); await hold.wait; }
        return reply(answer);
      }
      if (action === "area") return reply({ url: body.expectedURL, bounds: body.handle ? { x: 20, y: 20, width: 180, height: 40 } : { x: body.x, y: body.y, width: body.width, height: body.height }, viewport: body.viewport, capturedAt: "2026-10-28T20:00:00Z", screenshot: { name: `annotation-${(++image).toString(16).padStart(32, "0")}.png`, mime: "image/png" }, ...(body.handle ? { element: { handle: body.handle, tag: "button", text: "Do not activate <untrusted>", selector: "button#target", url: tabs.get(name)?.url, frame: { url: "https://frame.example/embedded", path: ["frame-1"] }, bounds: { x: 20, y: 20, width: 180, height: 40 }, styles: { color: "black" } } } : {}) });
      if (action === "data") return runtime.expireImages ? route.fulfill({ status: 404, json: { error: "Screenshot expired" } }) : reply({ name: url.pathname.split("/").at(-2), mime: "image/png", data: png });
      if (action === "sessions") {
        if (request.method() === "POST") {
          runtime.created++; session = { name: body.name, agent: body.agent, driver: body.driver, agent_state: "idle" };
          conversation = { id: "annotation-chat", session: body.name, agent: body.agent, location: "personal", dir: "/tmp/browser-qa", live: true, mode: body.mode, model: body.model, title: body.title, created: "2026-10-28T20:00:00Z" };
          if (typeof body.prompt === "string") runtime.messages.push(body.prompt);
        }
        return reply(request.method() === "POST" ? session : session ? [session] : []);
      }
      if (action === "resume") return reply(session);
      if (action === "conversations") return reply(conversation ? [conversation] : []);
      if (action === "attachments") { runtime.uploads.push(body as { name: string; data: string }); return reply({ path: `/tmp/annotation-chat/attachments/${body.name}` }); }
      if (action === "send") { runtime.messages.push(String(body.text)); return reply({}); }
      if (action === "transcript") return reply({ items: runtime.messages.flatMap((text, i) => [{ kind: "user", id: `user-${i}`, text }, { kind: "text", id: `answer-${i}`, text: `Annotation reply ${i + 1}` }]), next: runtime.messages.length, source: "claude" });
      if (action === "controls") return reply({ mode: "default" });
      if (action === "commands") return reply({ commands: [] });
      if (["locations", "turns", "requests", "notify", "outputs"].includes(action)) return reply([]);
      return reply({});
    });
    try { await use(runtime); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  },
});

// Seam: local save and remote reset commit separately; a reset retry must not duplicate saved evidence.
test("A saved comment stays single when preview reset fails and is retried", async ({ page, runtime }) => {
  await open(page); await annotate(page);
  await browser(page).getByTestId("browser-frame").click({ position: { x: 50, y: 40 } });
  const feedback = page.getByTestId("browser-feedback");
  await feedback.getByRole("textbox", { name: "Value", exact: true }).fill("red");
  await feedback.getByRole("button", { name: "Preview", exact: true }).click();
  await feedback.getByRole("textbox", { name: "Your feedback", exact: true }).fill("Keep this only once.");
  runtime.failReset = true;
  await feedback.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(feedback.getByRole("alert")).toContainText("reset temporarily unavailable");
  await expect(feedback.getByRole("button", { name: "Save comment", exact: true })).toBeDisabled();
  await expect(feedback.getByText("Comment saved.", { exact: true })).toBeVisible();
  runtime.failReset = false;
  await feedback.getByRole("button", { name: "Reset", exact: true }).click();
  await feedback.getByRole("button", { name: "Close element feedback", exact: true }).click();
  await expect(page.getByTestId("browser-comments")).toContainText("1 comment");
  expect(runtime.calls.filter((call) => call.action === "area")).toHaveLength(1);
});

// Seam: nested popup dismissal must not discard its parent feedback draft or preview.
test("Escape closes the Style menu before the feedback draft and resets previews only on closing feedback", async ({ page, runtime }) => {
  await open(page); await annotate(page);
  await browser(page).getByTestId("browser-frame").click({ position: { x: 50, y: 40 } });
  const feedback = page.getByTestId("browser-feedback");
  const comment = feedback.getByRole("textbox", { name: "Your feedback", exact: true });
  await comment.fill("Keep this draft while choosing a style.");
  await feedback.getByRole("textbox", { name: "Value", exact: true }).fill("navy");
  await feedback.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(feedback.getByText("1 style change previewed.")).toBeVisible();
  const style = feedback.getByRole("combobox", { name: "Style", exact: true });
  await style.click();
  await expect(page.getByRole("option", { name: "Padding", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "Padding", exact: true })).toBeHidden();
  await expect(style).toBeFocused();
  await expect(comment).toHaveValue("Keep this draft while choosing a style.");
  await expect(feedback.getByText("1 style change previewed.")).toBeVisible();
  expect(runtime.calls.filter((call) => call.action === "reset")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(feedback).toHaveCount(0);
  await expect.poll(() => runtime.calls.filter((call) => call.action === "reset").length).toBe(1);
  await browser(page).getByRole("button", { name: "Enter full view" }).click();
  await browser(page).getByRole("button", { name: "Focus page", exact: true }).click();
  await expect(browser(page).getByRole("textbox", { name: "Browser page keyboard", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(browser(page).getByRole("button", { name: "Enter full view" })).toBeVisible();
});

// Seam: the storage writer and loader share a size budget; a successful save must survive reload.
test("A full comment store rejects another save without replacing existing evidence", async ({ page, runtime }) => {
  await page.addInitScript(() => {
    const key = "ll.browser.annotations.v1";
    if (localStorage.getItem(key)) return;
    const note = { id: "prior", comment: "Earlier comment", element: { tag: "p", text: "x".repeat(2 * 1024 * 1024 - 1200), url: "http://localhost:1420/earlier" }, screenshot: { name: "annotation-11111111111111111111111111111111.png", mime: "image/png", capturedAt: "2026-10-28T20:00:00Z" } };
    localStorage.setItem(key, JSON.stringify({ [JSON.stringify(["/v1/worktrees/personal/main/browser", "http://localhost:1420/earlier"])]: [note] }));
  });
  await open(page); await annotate(page);
  await browser(page).getByTestId("browser-frame").click({ position: { x: 50, y: 40 } });
  const feedback = page.getByTestId("browser-feedback");
  const before = await page.evaluate(() => localStorage.getItem("ll.browser.annotations.v1"));
  await feedback.getByRole("textbox", { name: "Your feedback", exact: true }).fill("a".repeat(2000));
  await feedback.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(feedback.getByRole("alert")).toContainText("Remove old comments");
  expect(await page.evaluate(() => localStorage.getItem("ll.browser.annotations.v1"))).toBe(before);
  await page.reload(); await navigate(page, "earlier");
  await expect(page.getByTestId("browser-comments")).toContainText("1 comment");
  expect(runtime.messages).toHaveLength(0);
});

async function navigate(page: Page, path = "alpha") {
  await address(page).fill(`http://localhost:1420/${path}`); await address(page).press("Enter");
  await expect(browser(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "Browser", exact: true }).click(); await navigate(page);
  await browser(page).getByRole("button", { name: "Browser menu" }).click();
  await page.getByRole("menuitem", { name: "Desktop viewport", exact: true }).click();
  await expect(browser(page).getByRole("button", { name: "Focus page", exact: true })).toBeEnabled();
}
async function annotate(page: Page) {
  await browser(page).getByRole("button", { name: "Browser menu" }).click();
  await page.getByRole("menuitem", { name: /^(Comment on an element|Annotate)$/ }).click();
  await expect(browser(page).getByTestId("browser-frame")).toHaveCSS("opacity", "1");
  await expect(browser(page).getByText("Updating page size…", { exact: true })).toHaveCount(0);
}
async function drag(page: Page) {
  const frame = (await browser(page).getByTestId("browser-frame").boundingBox())!;
  await page.mouse.move(frame.x + 20, frame.y + 30); await page.mouse.down(); await page.mouse.move(frame.x + 180, frame.y + 110, { steps: 5 }); await page.mouse.up();
  await expect(page.getByTestId("browser-area-feedback")).toBeVisible();
}

// Seam: image coordinates and asynchronous hover; selection must never activate the remote page.
test("Annotation hover is read-only, late hover is discarded, and cancelled drags create nothing", async ({ page, runtime }) => {
  await open(page); await annotate(page);
  const frame = browser(page).getByTestId("browser-frame");
  await frame.hover({ position: { x: 50, y: 40 } });
  await expect(browser(page).getByTestId("browser-annotation-outline")).toBeVisible();
  expect(runtime.calls.filter((call) => call.action === "inspect")).toHaveLength(0);
  let arrive!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  runtime.holdHover = { arrive, wait: new Promise<void>((resolve) => { release = resolve; }) };
  await frame.hover({ position: { x: 100, y: 60 } }); await arrived;
  await navigate(page, "beta"); release();
  await expect(browser(page).getByTestId("browser-annotation-outline")).toHaveCount(0);
  await annotate(page);
  const rect = (await frame.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 30); await page.mouse.down(); await page.mouse.move(rect.x + 150, rect.y + 100, { steps: 4 }); await page.keyboard.press("Escape"); await page.mouse.up();
  await annotate(page);
  await page.mouse.move(rect.x + 20, rect.y + 30); await page.mouse.down(); await page.mouse.move(rect.x + 150, rect.y + 100, { steps: 4 });
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(browser(page).getByTestId("browser-annotation-outline")).toHaveCount(0);
  await page.mouse.up();
  expect(runtime.calls.filter((call) => call.action === "area")).toHaveLength(0);
  expect(runtime.calls.filter((call) => call.action === "input" && ["mousePressed", "mouseReleased"].includes(String(call.body.type)))).toHaveLength(0);
});

async function saveComments(page: Page, runtime: Runtime) {
  await open(page); await annotate(page);
  await browser(page).getByTestId("browser-frame").click({ position: { x: 50, y: 40 } });
  const element = page.getByTestId("browser-feedback");
  await element.getByRole("textbox", { name: "Your feedback", exact: true }).fill("Make the embedded button clearer.");
  await element.getByRole("button", { name: "Save comment", exact: true }).click();
  const comments = page.getByTestId("browser-comments");
  await expect(comments).toContainText("1 comment");
  expect(runtime.calls.find((call) => call.action === "area")?.body).toMatchObject({ handle: expect.any(String), lease: expect.any(String), expectedURL: "http://localhost:1420/alpha" });
  await annotate(page); await drag(page);
  const area = page.getByTestId("browser-area-feedback");
  await expect(area.getByRole("img", { name: "Frozen screenshot of the commented region" })).toBeVisible();
  await area.getByRole("textbox", { name: "Your feedback", exact: true }).fill("Tighten spacing in this area.");
  await area.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(comments).toContainText("2 comments");
  return comments;
}

// Seam: persistence is scoped by workspace and URL, independently of a tab's lifetime.
test("Saved element and area comments survive reload and reopening within their workspace", async ({ page, runtime }) => {
  const comments = await saveComments(page, runtime);
  await navigate(page, "beta"); await expect(comments).toHaveCount(0);
  await navigate(page, "alpha"); await expect(comments).toContainText("2 comments");
  await page.reload(); await expect(comments).toContainText("2 comments");
  await browser(page).getByRole("button", { name: "Close alpha", exact: true }).click();
  await navigate(page, "alpha"); await expect(comments).toContainText("2 comments");
  runtime.workspace = "other";
  await page.reload(); await expect(address(page)).toHaveValue("http://localhost:1420/alpha"); await expect(comments).toHaveCount(0);
});

// Seam: attaching a batch freezes its metadata and uploads the original images despite later edits.
test("Element and area comments send their original cropped screenshots as an immutable batch", async ({ page, runtime }, info) => {
  const comments = await saveComments(page, runtime);
  await comments.getByRole("button", { name: "Ask about comments", exact: true }).click();
  const chat = page.getByTestId("project-chat");
  await expect(chat.getByTestId("browser-chat-context")).toContainText("2 saved screenshots");
  await comments.getByRole("button", { name: "1. Make the embedded button clearer.", exact: true }).click();
  await comments.getByRole("button", { name: "Remove comment 1", exact: true }).click();
  await expect(comments).toContainText("1 comment");
  await expect(chat.getByTestId("browser-chat-context")).toContainText("Make the embedded button clearer.");
  await chat.getByRole("textbox", { name: "Question", exact: true }).fill("Address both saved comments.");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Annotation reply 1", { exact: true })).toBeVisible();
  expect(runtime.uploads).toHaveLength(2);
  expect(runtime.uploads.every((file) => file.data === runtime.png)).toBe(true);
  expect(runtime.messages[0]).toContain("\n\nAttached:\n/tmp/annotation-chat/attachments/annotation-");
  expect(runtime.messages[0]).toContain("Tighten spacing in this area.");
  expect(runtime.messages[0]).toContain('"frame":{"url":"https://frame.example/embedded"');
  expect(runtime.messages[0]).toContain("Comment 2:");
  expect(runtime.calls.filter((call) => call.action === "input" && ["mousePressed", "mouseReleased"].includes(String(call.body.type)))).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("browser-comments-batch.png"), animations: "disabled" });
});

// Seam: expired screenshot to agent send; no prompt may claim an image that was never attached.
test("An expired comment screenshot keeps the message unsent and retry uses the same chat", async ({ page, runtime }) => {
  await open(page); await annotate(page); await drag(page);
  const area = page.getByTestId("browser-area-feedback");
  await area.getByRole("textbox", { name: "Your feedback", exact: true }).fill("Review this area.");
  await area.getByRole("button", { name: "Ask with feedback", exact: true }).click();
  const chat = page.getByTestId("project-chat");
  await expect(chat.getByTestId("browser-chat-context")).toContainText("Review this area.");
  runtime.expireImages = true;
  await chat.getByRole("textbox", { name: "Question", exact: true }).fill("Apply my feedback.");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText(/A comment screenshot is no longer available/)).toBeVisible();
  expect(runtime.messages).toHaveLength(0); expect(runtime.uploads).toHaveLength(0); expect(runtime.created).toBe(1);
  await expect(chat.getByRole("textbox", { name: "Question", exact: true })).toHaveText("Apply my feedback.");
  await chat.getByRole("button", { name: "Remove browser page", exact: true }).click();
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Annotation reply 1", { exact: true })).toBeVisible();
  expect(runtime.created).toBe(1); expect(runtime.messages[0]).toBe("Apply my feedback.");
});
