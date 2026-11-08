import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.use({ serviceWorkers: "block", viewport: { width: 820, height: 1180 }, hasTouch: true });
test.setTimeout(60_000);

// A lost network acknowledgement must not duplicate a launch or fall back to this device's runtime.
async function mac(page: Page, paired = true) {
  const state = { paired, online: true, dropStart: false, dropApproval: false, dropFeedback: false, failStop: false, approval: true };
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
    if (action === "connect") { state.paired = true; if (args.code === "llmac2:second") Object.assign(connection, { id: "mac-b", name: "Travel Mac" }); return route.fulfill({ json: { connection, online: true } }); }
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
    else if (path.endsWith("/send")) {
      if (!sends.some((s) => s.idem_key === value.idem_key)) { sends.push({ ...value, session }); transcripts.get(session)!.push({ kind: "user", id: `user-${sends.length + 1}`, text: value.text }); }
      body = { queued: false };
      if (state.dropFeedback) { state.dropFeedback = false; return route.abort("connectionreset"); }
    }
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

// Native keyboards resize visualViewport without shrinking the CSS layout viewport.
for (const device of ["iphone", "ipad"] as const) test(`${device} agent composer follows the keyboard through rotation`, async ({ page, browserName }) => {
  const portrait = device === "iphone" ? { width: 390, height: 844 } : { width: 820, height: 1180 };
  await page.setViewportSize(portrait);
  await page.addInitScript(({ width, height }) => {
    Object.defineProperty(window, "visualViewport", { value: Object.assign(new EventTarget(), { width, height, offsetTop: 0, offsetLeft: 0, scale: 1 }) });
  }, portrait);
  const mock = await mac(page); mock.state.approval = false;
  await page.goto(`/?${device}`);
  if (device === "iphone") await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Notes", exact: true }).click();
  await openAgents(page);
  const dialog = page.getByRole("dialog"), field = dialog.getByRole("textbox", { name: "Message to agent" });
  await field.fill("Keep my message through rotation");
  const views = [
    { ...portrait, visible: device === "iphone" ? 350 : 620, top: 12 },
    { width: portrait.height, height: portrait.width, visible: device === "iphone" ? 150 : 320, top: 0 },
    ...(device === "iphone" ? [{ width: 844, height: 390, visible: 110, top: 8 }, { width: 375, height: 667, visible: 350, top: 0, font: 24 }] : []),
  ];
  for (const view of views) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.evaluate((v) => {
      document.documentElement.style.fontSize = `${v.font || 16}px`;
      Object.assign(window.visualViewport!, { width: v.width, height: v.visible, offsetTop: v.top });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    }, view);
    for (const control of [field, dialog.getByRole("button", { name: "Send", exact: true }), dialog.getByRole("button", { name: "Close", exact: true })]) {
      await expect.poll(async () => {
        const b = await control.boundingBox();
        return b !== null && b.y >= view.top && b.y + b.height <= view.top + view.visible + 1;
      }).toBe(true);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    await expect(field).toHaveValue("Keep my message through rotation");
    await page.screenshot({ path: `qa/report/mobile-agents/${device}-${browserName}-keyboard-${view.visible}${view.font ? "-large" : ""}.png` });
  }
  await dialog.getByRole("button", { name: "Send", exact: true }).tap();
  await expect.poll(() => mock.starts.length).toBe(1);
  expect(mock.starts[0].prompt).toBe("Keep my message through rotation");
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: innerHeight, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(dialog.getByRole("combobox", { name: "Conversation", exact: true })).toBeVisible();
});

test("connect a Mac and start, approve, continue and stop its shared project agent", async ({ page }) => {
  const mock = await mac(page, false);
  await page.goto("/?ipad");
  await sidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-nav-devices")).toBeVisible();
  await page.getByTestId("settings-nav-devices").click();
  await page.getByLabel("Mac connection code", { exact: true }).fill("llmac2:test-code");
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

// Keyboard compression must not hide permission failures or the way to stop work.
test("short mobile keyboard keeps failed approvals and Stop reachable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "visualViewport", { value: Object.assign(new EventTarget(), { width: 820, height: 1180, offsetTop: 0, offsetLeft: 0, scale: 1 }) });
  });
  const mock = await mac(page); mock.state.dropApproval = true;
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Keep approval controls available");
  await page.getByRole("button", { name: "Send", exact: true }).tap();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { width: 844, height: 110, offsetTop: 8 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toBeHidden();
  await page.getByRole("button", { name: /Allow once/ }).tap();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  for (const control of [retry, page.getByRole("button", { name: "Stop", exact: true })]) {
    await expect.poll(async () => control.evaluate((el) => {
      const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return b.y >= 8 && b.bottom <= 118 && !!hit && el.contains(hit);
    })).toBe(true);
  }
  await retry.tap();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  expect(mock.calls.filter((call) => call.path.endsWith("/respond"))).toHaveLength(2);
  mock.sessions[0].agent_state = "running";
  await page.getByRole("button", { name: "Stop", exact: true }).tap();
  expect(mock.stops).toEqual([mock.starts[0].name]);
});

test("an ambiguous start is found after reopening without starting a second agent", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "visualViewport", { value: Object.assign(new EventTarget(), { width: 820, height: 1180, offsetTop: 0, offsetLeft: 0, scale: 1 }) });
  });
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
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { width: 844, height: 110, offsetTop: 8 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("button", { name: "Dismiss saved request", exact: true }).tap();
  const confirmation = page.getByRole("alertdialog");
  for (const name of ["Cancel", "Dismiss request"]) {
    await expect.poll(async () => {
      const b = await confirmation.getByRole("button", { name, exact: true }).boundingBox();
      return !!b && b.y >= 8 && b.y + b.height <= 118;
    }).toBe(true);
  }
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.getByRole("button", { name: "Check and retry", exact: true }).click();
  await expect(page.getByText("I found the project on your Mac.", { exact: true })).toBeVisible();
  expect(mock.starts).toHaveLength(1);
  expect(mock.stops).toEqual([]);
  expect(mock.local).toEqual([]);
});

// The phone shell must retain a route to the paired Mac without its desktop sidebar.
test("iPhone pairs in Devices and opens Mac agents from Notes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await mac(page, false); mock.state.approval = false;
  await page.goto("/?iphone");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await page.getByTestId("settings-nav-devices").click();
  await page.getByLabel("Mac connection code", { exact: true }).fill("llmac2:test-code");
  await page.getByRole("button", { name: "Connect Mac", exact: true }).click();
  await expect(page.getByText("Studio Mac", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await page.getByRole("button", { name: /Back to app/ }).click();
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Notes", exact: true }).click();
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Review this disposable project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("I found the project on your Mac.", { exact: true })).toBeVisible();
  expect(mock.starts).toHaveLength(1);
  expect(mock.local).toEqual([]);
  await page.screenshot({ path: "qa/report/mobile-agents/iphone-notes-agent.png", fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("main", { name: "Today", exact: true })).toBeVisible();
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

// A lost response must preserve the exact decision; Codex feedback is a separate explicit send.
for (const agent of ["claude", "codex"]) test(`${agent} decline feedback survives an uncertain response`, async ({ page }) => {
  const mock = await mac(page); mock.state.dropApproval = true;
  await page.goto("/?ipad");
  await openAgents(page);
  if (agent === "codex") {
    await page.getByRole("combobox", { name: "Agent", exact: true }).click();
    await page.getByRole("option", { name: "Codex", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Ask before changing this file");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const feedback = page.getByRole("textbox", { name: /^Feedback for agent/ });
  await feedback.fill("Keep the original file; write a separate draft.");
  await page.getByRole("button", { name: /^Decline,/ }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(feedback).toBeDisabled();
  await expect(feedback).toHaveValue("Keep the original file; write a separate draft.");
  await expect(page.getByRole("button", { name: /^Allow once,/ })).toBeDisabled();
  await page.reload();
  await openAgents(page);
  await expect(feedback).toBeDisabled();
  expect(mock.calls.filter((c) => c.path.endsWith("/respond"))).toHaveLength(1);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  const responses = mock.calls.filter((c) => c.path.endsWith("/respond"));
  expect(responses).toHaveLength(2);
  expect(responses[1].body).toEqual(responses[0].body);
  expect(responses[0].body.choice).toBe("deny");
  expect(mock.sends).toHaveLength(0);
  if (agent === "claude") expect(responses[0].body.message).toBe("Keep the original file; write a separate draft.");
  else {
    expect(responses[0].body).not.toHaveProperty("message");
    mock.state.dropFeedback = true;
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry feedback", exact: true })).toBeVisible();
    await page.reload();
    await openAgents(page);
    expect(mock.sends).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Retry feedback", exact: true })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Retry feedback", exact: true }).click();
    await expect(page.getByRole("group", { name: "Saved feedback", exact: true })).toBeHidden();
    const sent = mock.calls.filter((c) => c.path.endsWith("/send"));
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toEqual(sent[0].body);
    expect(mock.sends).toHaveLength(1);
    expect(mock.sends[0].session).toBe(mock.starts[0].name);
  }
});

test("expired approval feedback returns to a saved message draft", async ({ page }) => {
  const mock = await mac(page);
  await page.goto("/?ipad");
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Ask before editing");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("textbox", { name: /^Feedback for agent/ }).fill("Keep my unsent feedback");
  mock.requests.get(mock.starts[0].name)![0].state = "expired";
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("Keep my unsent feedback");
  await page.reload();
  await openAgents(page);
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("Keep my unsent feedback");
  expect(mock.calls.filter((c) => c.path.endsWith("/respond"))).toHaveLength(0);
  expect(mock.sends).toHaveLength(0);
});

// Notification navigation is a read, including from Today while Notes search hides its button.
test("notification opens only its current Mac request without answering", async ({ page }) => {
  const mock = await mac(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?iphone");
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Notes", exact: true }).click();
  await openAgents(page);
  await page.getByRole("textbox", { name: "Message to agent" }).fill("First notification conversation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Second notification conversation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.starts.length).toBe(2);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search notes" }).fill("No matching notes");
  await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  const target = { connection: "mac-a", project: "p-shared", conversation: "conv-1", request: "request:one", generation: 1 };
  const notify = (detail: typeof target) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent("leadinglight:mobile-agent-request", { detail })), detail);
  await notify(target);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Conversation", exact: true })).toContainText("First notification conversation");
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeVisible();
  await notify({ ...target, generation: 2 });
  await expect(page.getByText("This request was already handled.", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  mock.requests.set(mock.starts[0].name, []);
  await notify(target);
  await expect(page.getByText("This request was already handled.", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await notify({ ...target, connection: "another-mac" });
  await expect(page.getByRole("main", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mock.calls.filter((c) => c.path.endsWith("/respond"))).toHaveLength(0);
  expect(mock.sends).toHaveLength(0);
});

test("Mac settings share only checked projects and can disable the grant", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const changes: any[] = [];
  let host = { enabled: false, projects: [] as string[], name: "Host Mac", code: "llmac2:test-code" };
  const relay = { channel: "00000000-0000-4000-8000-000000000001", hostToken: "a".repeat(43), clientToken: "b".repeat(43) };
  await page.route("**/api/config", (route) => route.fulfill({ json: { ready: true, allowed: true, providers: [] } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { id: "test-owner", name: "Test account" } }));
  await page.route("**/api/mobile-relay/channels", (route) => route.fulfill({ json: relay }));
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
  expect(changes).toEqual([{ projects: ["p-one"] }, { enabled: true, relay }]);
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
  await page.getByLabel("Mac connection code", { exact: true }).fill("llmac2:second");
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
