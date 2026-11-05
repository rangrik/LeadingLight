import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.use({ serviceWorkers: "block", viewport: { width: 820, height: 1180 }, hasTouch: true });
test.setTimeout(60_000);

// A lost network acknowledgement must not duplicate a launch or fall back to this device's runtime.
async function mac(page: Page, paired = true) {
  const state = { paired, online: true, dropStart: false, dropApproval: false, failStop: false, approval: true };
  const calls: { method: string; path: string; body: any; expectedConnection: string }[] = [];
  const starts: any[] = [], sends: any[] = [], stops: string[] = [], local: string[] = [];
  const conversations: any[] = [], sessions: any[] = [];
  const requests = new Map<string, any[]>(), transcripts = new Map<string, any[]>();
  const connection = { id: "mac-a", name: "Studio Mac", url: "https://100.88.1.2:1380" };
  let held: { began: () => void; wait: Promise<void> } | undefined;
  await page.route("**/__runtime/**", async (route) => { local.push(route.request().url()); await route.fulfill({ status: 503, json: { error: "Mobile must not use local runtime" } }); });
  await page.route("**/__mobile/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const args = route.request().postDataJSON();
    if (action === "status") return route.fulfill({ json: { connection: state.paired ? connection : null, online: state.paired && state.online, error: state.online ? "" : "Mac is offline" } });
    if (action === "connect") { state.paired = true; if (args.code === "llmac1:second") Object.assign(connection, { id: "mac-b", name: "Travel Mac" }); return route.fulfill({ json: { connection, online: true } }); }
    if (action === "disconnect") { state.paired = false; return route.fulfill({ json: null }); }
    calls.push(args);
    if (!state.online) return route.abort("connectionrefused");
    let status = 200, body: any = {};
    const path = args.path as string, method = args.method as string, value = args.body;
    const session = path.split("/")[3];
    if (path === "/v1/locations") body = [{ name: "p-shared", path: "/Users/test/Projects/Shared Research" }];
    else if (path.startsWith("/v1/conversations?")) { if (held) { const hold = held; held = undefined; hold.began(); await hold.wait; } body = conversations; }
    else if (path === "/v1/sessions" && method === "GET") body = sessions;
    else if (path === "/v1/sessions" && method === "POST") {
      if ("mode" in value) return route.fulfill({ json: { status: 400, body: { error: "Invalid device request: unknown field mode" } } });
      starts.push(value);
      if (sessions.some((s) => s.name === value.name)) { status = 409; body = { error: "Already started" }; }
      else {
        sessions.push({ name: value.name, agent_state: state.approval ? "waiting" : "idle", agent: value.agent, driver: value.driver, exited: false });
        conversations.push({ id: `conv-${sessions.length}`, session: value.name, location: value.location, dir: "/Users/test/Projects/Shared Research", agent: value.agent, mode: value.agent === "codex" ? "untrusted" : "default", title: value.title, live: true, created: new Date().toISOString() });
        transcripts.set(value.name, [{ kind: "user", id: "user-1", text: value.prompt }, { kind: "text", id: "text-1", text: "I found the project on your Mac." }]);
        requests.set(value.name, state.approval ? [{ id: "request:one", generation: 1, kind: "approval", blocking: true, tool: "Write", input: { file_path: "summary.md" }, state: "pending", opened: Date.now() }] : []);
        body = sessions.at(-1);
      }
      if (state.dropStart) { state.dropStart = false; return route.abort("connectionreset"); }
    } else if (path.endsWith("/transcript" ) || path.includes("/transcript?")) body = { items: transcripts.get(session) ?? [], next: 100, gen: "one", source: "claude" };
    else if (path.endsWith("/turns")) body = [{ n: 1, state: sessions.find((s) => s.name === session)?.agent_state === "idle" ? "finished" : "running", started: new Date().toISOString() }];
    else if (path.endsWith("/requests") && method === "GET") body = requests.get(session) ?? [];
    else if (path.includes("/requests/") && path.endsWith("/respond")) {
      if (state.dropApproval) { state.dropApproval = false; return route.abort("connectionreset"); }
      const request = requests.get(session)!.find((r) => r.id === decodeURIComponent(path.split("/")[5])); request.state = "resolved"; request.command = value.command;
      sessions.find((s) => s.name === session).agent_state = "idle";
      body = { request, receipt: { state: "accepted" } };
    } else if (path.endsWith("/controls")) body = { mode: "default" };
    else if (path.endsWith("/outputs") || path.endsWith("/queue") || path === "/v1/notify") body = [];
    else if (path.endsWith("/send")) { sends.push({ ...value, session }); body = { queued: false }; transcripts.get(session)!.push({ kind: "user", id: `user-${sends.length + 1}`, text: value.text }); }
    else if (path.endsWith("/interrupt")) {
      stops.push(session);
      if (state.failStop) { status = 503; body = { error: "Stop could not be confirmed" }; }
      else { sessions.find((s) => s.name === session).agent_state = "idle"; requests.set(session, []); }
    } else if (path === "/v1/info") body = { mobile: true, version: 1, name: connection.name };
    else { status = 403; body = { error: `Route unavailable: ${path}` }; }
    await route.fulfill({ json: { status, body } });
  });
  return { state, calls, starts, sends, stops, local, conversations, sessions, requests, transcripts,
    holdConversations() {
      let release!: () => void, began!: () => void;
      const started = new Promise<void>((resolve) => { began = resolve; });
      held = { began, wait: new Promise<void>((resolve) => { release = resolve; }) };
      return { started, release };
    },
  };
}

async function sidebar(page: Page) {
  if (!await page.getByRole("button", { name: "Settings", exact: true }).isVisible()) await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
}

async function openAgents(page: Page) {
  await sidebar(page);
  await page.getByRole("button", { name: "Agents on Mac", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Agents on Studio Mac" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Shared Research", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toBeVisible();
}

test("connect a Mac and start, approve, continue and stop its shared project agent", async ({ page }) => {
  const mock = await mac(page, false);
  await page.goto("/?ipad");
  await sidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-nav-devices")).toBeVisible();
  await page.getByTestId("settings-nav-devices").click();
  await page.getByLabel("Mac connection code", { exact: true }).fill("llmac1:test-code");
  await page.getByRole("button", { name: "Connect Mac", exact: true }).click();
  await expect(page.getByText("Studio Mac", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agents on Mac", exact: true }).last().click();
  await page.getByRole("dialog").getByRole("button", { name: "Shared Research", exact: true }).click();
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Summarize this project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Always allow/ })).toHaveCount(0);
  await fs.mkdir("qa/report/mobile-agents", { recursive: true });
  await page.screenshot({ path: "qa/report/mobile-agents/ipad-approval-chat.png", fullPage: true });
  await page.getByRole("button", { name: /Allow once/ }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  await expect(page.getByText("I found the project on your Mac.", { exact: true })).toBeVisible();
  mock.requests.get(mock.starts[0].name)!.push({ id: "request:question", generation: 1, kind: "question", blocking: true, state: "pending", opened: Date.now(), questions: [{ question: "Which format should I use?", options: [{ label: "Short summary" }, { label: "Detailed outline" }] }] });
  await page.getByRole("button", { name: "Short summary", exact: true }).click();
  await expect(page.getByRole("group", { name: "Question", exact: true })).toBeHidden();
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Continue with a short summary");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.sends.length).toBe(1);
  expect(mock.starts).toHaveLength(1);
  expect(mock.starts[0]).toMatchObject({ location: "p-shared", agent: "claude", driver: "claude" });
  expect(mock.starts[0]).not.toHaveProperty("mode");
  const replies = mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("/respond"));
  expect(replies).toHaveLength(2);
  expect(replies[1].body.answers).toEqual([{ picks: ["Short summary"] }]);
  mock.sessions[0].agent_state = "running";
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  mock.state.failStop = true;
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Stop could not be confirmed" })).toBeVisible();
  expect(mock.stops).toEqual([mock.starts[0].name]);
  expect(mock.local).toEqual([]);
  expect(mock.calls.every((c) => c.expectedConnection === "mac-a")).toBe(true);
  await fs.mkdir("qa/report/mobile-agents", { recursive: true });
  await page.screenshot({ path: "qa/report/mobile-agents/ipad-stop-failure.png", fullPage: true });
});

test("an ambiguous start is found after reopening without starting a second agent", async ({ page }) => {
  const mock = await mac(page); mock.state.dropStart = true; mock.state.approval = false;
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Keep working while my phone is closed");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check and retry", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await openAgents(page);
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("Keep working while my phone is closed");
  await expect(page.getByRole("button", { name: "Check and retry", exact: true })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Check and retry", exact: true }).click();
  await expect(page.getByText("I found the project on your Mac.", { exact: true })).toBeVisible();
  expect(mock.starts).toHaveLength(1);
  expect(mock.stops).toEqual([]);
  expect(mock.local).toEqual([]);
});

test("offline phone keeps its draft and Codex starts only after explicit send", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await mac(page); mock.state.approval = false;
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("combobox", { name: "Agent", exact: true }).click();
  await page.getByRole("option", { name: "Codex", exact: true }).click();
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Review my local files");
  mock.state.online = false;
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled({ timeout: 10_000 });
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("Review my local files");
  await fs.mkdir("qa/report/mobile-agents", { recursive: true });
  await page.screenshot({ path: "qa/report/mobile-agents/iphone-offline-draft.png", fullPage: true });
  const overflow = await page.getByRole("dialog").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
  const caption = await page.getByText("Approval required", { exact: true }).boundingBox();
  const sendButton = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
  expect(caption && sendButton && Math.min(caption.x + caption.width, sendButton.x + sendButton.width) - Math.max(caption.x, sendButton.x) > 1 && Math.min(caption.y + caption.height, sendButton.y + sendButton.height) - Math.max(caption.y, sendButton.y) > 1).toBe(false);
  mock.state.online = true;
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByRole("alert").filter({ hasText: "Failed to fetch" })).toHaveCount(0, { timeout: 10_000 });
  expect(mock.starts).toEqual([]);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.starts.length).toBe(1);
  expect(mock.starts[0]).toMatchObject({ agent: "codex", driver: "codex" });
  expect(mock.starts[0]).not.toHaveProperty("mode");
  expect(mock.local).toEqual([]);
});

test("a lost approval is kept across reload and retried only when the person asks", async ({ page }) => {
  const mock = await mac(page); mock.state.dropApproval = true;
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Write a summary");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: /Allow once/ }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.reload();
  await openAgents(page);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  const answers = () => mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("/respond"));
  expect(answers()).toHaveLength(1);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  expect(answers()).toHaveLength(2);
  expect(answers()[1].body.command).toBe(answers()[0].body.command);
  expect(mock.starts).toHaveLength(1);
  expect(mock.stops).toEqual([]);
});

test("Mac settings share only checked projects and can disable the grant", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const changes: any[] = [];
  let host = { enabled: false, projects: [] as string[], name: "Host Mac", token: "a".repeat(48), certificate: "cHVibGljLWNlcnRpZmljYXRl", url: "https://100.88.1.2:48001" };
  await page.route("**/__runtime/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/status")) body = { state: "ready", home: "/tmp/fixture" };
    if (path.endsWith("/v1/mobile")) {
      if (route.request().method() === "PUT") { const change = route.request().postDataJSON(); changes.push(change); host = { ...host, ...change }; }
      body = host;
    }
    if (path.endsWith("/v1/locations")) body = [{ name: "p-one", path: "/Projects/One" }, { name: "p-two", path: "/Projects/Two" }];
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const module = "/src/lib/objects.ts";
    const { objects } = await import(/* @vite-ignore */ module);
    for (const [pageId, location, path] of [["one", "p-one", "/Projects/One"], ["two", "p-two", "/Projects/Two"]]) {
      await objects.putFolder({ pageId, location, path, folderId: pageId, createdAt: 1, updatedAt: 1 });
    }
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-devices").click();
  await page.getByRole("checkbox", { name: "One", exact: true }).click();
  await page.getByRole("switch", { name: "Mobile access", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy code", exact: true })).toBeEnabled();
  expect(changes).toEqual([{ projects: ["p-one"] }, { enabled: true }]);
  await expect(page.getByRole("checkbox", { name: "Two", exact: true })).not.toBeChecked();
  await page.getByRole("switch", { name: "Mobile access", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy code", exact: true })).toBeDisabled();
  expect(changes.at(-1)).toEqual({ enabled: false });
});

test("switching Macs cannot send an old pending prompt to the new connection", async ({ page }) => {
  const mock = await mac(page); mock.state.approval = false;
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Only run on Studio Mac");
  const hold = mock.holdConversations();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await hold.started;
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-devices").click();
  await page.getByLabel("Mac connection code", { exact: true }).fill("llmac1:second");
  await page.getByRole("button", { name: "Connect Mac", exact: true }).click();
  await expect(page.getByText("Travel Mac", { exact: true })).toBeVisible();
  hold.release();
  await page.getByRole("button", { name: "Agents on Mac", exact: true }).last().click();
  await page.getByRole("dialog").getByRole("button", { name: "Shared Research", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("");
  expect(mock.starts).toEqual([]);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Now run on Travel Mac");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.starts.length).toBe(1);
  expect(mock.starts[0].prompt).toBe("Now run on Travel Mac");
  expect(mock.calls.find((c) => c.method === "POST" && c.path === "/v1/sessions")?.expectedConnection).toBe("mac-b");
});
