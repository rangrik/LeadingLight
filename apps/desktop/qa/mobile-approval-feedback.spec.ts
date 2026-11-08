import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(60_000);

// This seam guards the exact provider answer and retry ID, including saved feedback.
async function fixture(page: Page, agent = "claude", kind = "approval") {
  const connection = { id: "mac-feedback", name: "Studio Mac", url: "https://100.88.1.2:1380" };
  const state = { dropAnswer: false, dropFeedback: false, refuseAnswer: false, answerState: "resolved" };
  const calls: any[] = [], local: string[] = [];
  const requests: any[] = [{ id: "request:feedback", generation: 1, kind, blocking: true, tool: kind === "plan" ? "ExitPlanMode" : "Bash", input: agent === "codex" ? { threadId: "codex-thread", command: "pnpm test" } : { command: "pnpm test" }, state: "pending", opened: Date.now() }];
  const session = { name: "mobile-feedback", agent, driver: agent, agent_state: "waiting", exited: false };
  const conversation = { id: "conv-feedback", session: session.name, location: "p-shared", dir: "/Users/test/Shared Research", agent, mode: agent === "codex" ? "untrusted" : "default", title: "Review a change", live: true, created: new Date().toISOString() };
  const replies = () => calls.filter((c) => c.path.endsWith("/respond"));
  const sends = () => calls.filter((c) => c.path.endsWith("/send"));
  let held: { began: () => void; wait: Promise<void> } | undefined;
  await page.addInitScript(() => localStorage.setItem("mobile:mac-feedback:p-shared:chosen", JSON.stringify("conv-feedback")));
  await page.route("**/__runtime/**", (route) => { local.push(route.request().url()); return route.abort(); });
  await page.route("**/__mobile/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const args = route.request().postDataJSON();
    if (action === "status") return route.fulfill({ json: { connection, online: true } });
    if (action !== "request") return route.fulfill({ json: null });
    calls.push(args);
    const { path, method, body: value } = args;
    let body: any = [], status = 200;
    if (path === "/v1/locations") body = [{ name: "p-shared", path: "/Users/test/Shared Research" }];
    else if (path.startsWith("/v1/conversations?")) body = [conversation];
    else if (path === "/v1/sessions") body = [session];
    else if (path.endsWith("/requests")) { if (held) { const hold = held; held = undefined; hold.began(); await hold.wait; } body = requests; }
    else if (path.endsWith("/respond")) {
      if (state.dropAnswer) { state.dropAnswer = false; return route.abort("connectionreset"); }
      if (state.refuseAnswer) { state.refuseAnswer = false; return route.fulfill({ json: { status: 400, body: { error: "The answer was refused before delivery" } } }); }
      const request = requests.find((r) => r.id === decodeURIComponent(path.split("/")[5]));
      Object.assign(request, { state: state.answerState, command: value.command });
      session.agent_state = "idle";
      body = { request, receipt: { command: value.command, state: "written" } };
    } else if (path.endsWith("/send")) {
      if (state.dropFeedback) { state.dropFeedback = false; return route.abort("connectionreset"); }
      body = { sent: true, duplicate: sends().length > 1 };
    } else if (path.includes("/transcript")) body = { items: [{ kind: "user", id: "prompt", text: "Review a change" }], next: 1, gen: "one", source: agent };
    else if (path.endsWith("/turns")) body = [{ n: 1, state: session.agent_state === "idle" ? "finished" : "running", started: new Date().toISOString() }];
    else if (path.endsWith("/controls")) body = { mode: conversation.mode };
    else if (path.endsWith("/draft")) body = { agent, text: "" };
    else if (path === "/v1/info") body = { mobile: true, version: 1, name: connection.name };
    else if (method !== "GET") { status = 403; body = { error: "Unexpected mutation" }; }
    return route.fulfill({ json: { status, body } });
  });
  return { state, calls, requests, session, replies, sends, local, holdRequests() {
    let release!: () => void, began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    held = { began, wait: new Promise<void>((resolve) => { release = resolve; }) };
    return { started, release };
  } };
}

async function open(page: Page) {
  await page.goto("/?ipad");
  await expect(page.getByRole("button", { name: "Toggle sidebar" }).first()).toBeVisible();
  if (!await page.getByRole("button", { name: "Agents on Mac", exact: true }).first().isVisible()) await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await page.getByRole("button", { name: "Agents on Mac", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Shared Research", exact: true }).click();
}

test("decline feedback survives reload and retries the exact answer without broader permission", async ({ page }) => {
  const mock = await fixture(page);
  await open(page);
  await page.getByRole("textbox", { name: /^Feedback for agent/ }).fill("Use the test database instead");
  mock.state.dropAnswer = true;
  await page.getByRole("button", { name: /^Decline/ }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  expect(mock.replies()).toHaveLength(1);
  await open(page);
  const feedback = page.getByRole("textbox", { name: /^Feedback for agent/ });
  await expect(feedback).toHaveValue("Use the test database instead");
  await expect(feedback).toBeDisabled();
  await expect(page.getByRole("button", { name: /Allow once/ })).toBeDisabled();
  expect(mock.replies()).toHaveLength(1);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("group", { name: "Approval", exact: true })).toBeHidden();
  expect(mock.replies()).toHaveLength(2);
  expect(mock.replies()[1].body).toEqual(mock.replies()[0].body);
  expect(mock.replies()[1].body).toMatchObject({ choice: "deny", message: "Use the test database instead" });
  expect(mock.sends()).toHaveLength(0);
  expect(mock.local).toEqual([]);
});

test("Codex decline is confirmed before a separate feedback message and an ambiguous send keeps its ID", async ({ page }) => {
  const mock = await fixture(page, "codex");
  await open(page);
  await page.getByRole("textbox", { name: /^Feedback for agent/ }).fill("Inspect the tests first");
  mock.state.dropAnswer = true;
  await page.getByRole("button", { name: /^Decline/ }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  expect(mock.replies()[0].body).toMatchObject({ choice: "deny" });
  expect(mock.replies()[0].body).not.toHaveProperty("message");
  expect(mock.sends()).toHaveLength(0);
  await open(page);
  mock.state.answerState = "recorded";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const sendFeedback = page.getByRole("button", { name: "Send feedback", exact: true });
  await expect(sendFeedback).toBeEnabled();
  await fs.mkdir("qa/report/mobile-approval-feedback", { recursive: true });
  await page.screenshot({ path: "qa/report/mobile-approval-feedback/iphone-codex-feedback.png", fullPage: true });
  mock.state.dropFeedback = true;
  await sendFeedback.click();
  await expect.poll(() => mock.sends().length).toBe(1);
  await open(page);
  const retry = page.getByRole("button", { name: /^(?:Retry feedback|Check and retry feedback)$/ });
  await expect(retry).toBeEnabled();
  expect(mock.sends()).toHaveLength(1);
  await retry.click();
  await expect.poll(() => mock.sends().length).toBe(2);
  expect(mock.sends()[1].body).toEqual(mock.sends()[0].body);
  expect(mock.sends()[1].body).toMatchObject({ text: "Feedback on the declined request:\nInspect the tests first", when: "now" });
  expect(mock.calls.every((c) => c.expectedConnection === "mac-feedback")).toBe(true);
  expect(mock.local).toEqual([]);
});

test("plan feedback stays in planning and multiple-choice answers retain typed words", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const mock = await fixture(page, "claude", "plan");
  await open(page);
  await page.getByRole("textbox", { name: /^Feedback for agent/ }).fill("Add a rollback step");
  await expect(page.getByRole("button", { name: /accepting edits/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Keep planning", exact: true }).click();
  await expect.poll(() => mock.replies().length).toBe(1);
  expect(mock.replies()[0].body).toMatchObject({ choice: "keep_planning", message: "Add a rollback step" });
  mock.requests.push({ id: "request:question", generation: 1, kind: "question", blocking: true, state: "pending", opened: Date.now(), questions: [{ question: "What should I check?", multi: true, options: [{ label: "Unit tests" }, { label: "Browser tests" }] }] });
  await page.getByRole("textbox", { name: "Your own answer", exact: true }).fill("Also check migrations");
  await page.getByRole("button", { name: "Unit tests", exact: true }).click();
  await page.getByRole("button", { name: "Browser tests", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your own answer", exact: true })).toHaveValue("Also check migrations");
  await fs.mkdir("qa/report/mobile-approval-feedback", { recursive: true });
  await page.screenshot({ path: "qa/report/mobile-approval-feedback/ipad-question-feedback.png", fullPage: true });
  await page.getByRole("group", { name: "Question", exact: true }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.replies().length).toBe(2);
  expect(mock.replies()[1].body.answers).toEqual([{ picks: ["Unit tests", "Browser tests"], other: "Also check migrations" }]);
});

for (const revise of [false, true]) test(`a known refusal allows ${revise ? "revised" : "retried"} Codex feedback on the new decline command`, async ({ page }) => {
  const mock = await fixture(page, "codex");
  await open(page);
  const feedback = page.getByRole("textbox", { name: /^Feedback for agent/ });
  await feedback.fill("Original feedback");
  mock.state.refuseAnswer = true;
  await page.getByRole("button", { name: /^Decline/ }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(feedback).toBeEnabled();
  if (revise) {
    await feedback.fill("Revised feedback");
    await page.getByRole("button", { name: /^Decline/ }).click();
  } else await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("button", { name: "Send feedback", exact: true }).click();
  await expect.poll(() => mock.sends().length).toBe(1);
  expect(mock.replies()).toHaveLength(2);
  expect(mock.replies()[1].body.command).not.toBe(mock.replies()[0].body.command);
  expect(mock.sends()[0].body.text).toBe(`Feedback on the declined request:\n${revise ? "Revised" : "Original"} feedback`);
});

for (const storageFailure of [false, true]) test(`an answer expiring after the dialog closes returns once after reload${storageFailure ? " despite a failed restore write" : ""}`, async ({ page }) => {
  const mock = await fixture(page);
  await open(page);
  await page.getByRole("textbox", { name: /^Feedback for agent/ }).fill("Keep this unsent feedback");
  const hold = mock.holdRequests();
  await hold.started;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Agents on Studio Mac", exact: true })).toBeHidden();
  mock.requests[0].state = "expired";
  if (storageFailure) await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("ll.restore.")) { Storage.prototype.setItem = set; throw new DOMException("Storage is full", "QuotaExceededError"); }
      return set.call(this, key, value);
    };
  });
  hold.release();
  if (storageFailure) {
    await expect.poll(() => page.evaluate(async () => { const path = "/src/lib/project-runtime/chat.ts"; return (await import(/* @vite-ignore */ path)).chatOf("mobile:mac-feedback:p-shared:conv-feedback").get().error; })).toContain("Storage is full");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ll.answers.mobile:mac-feedback:p-shared:conv-feedback") ?? "{}")["request:feedback"]?.answer.message)).toBe("Keep this unsent feedback");
  } else await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ll.restore.mobile:mac-feedback:p-shared:conv-feedback") ?? "null")?.text)).toBe("Keep this unsent feedback");
  await open(page);
  const message = page.getByRole("textbox", { name: "Message to agent", exact: true });
  await expect(message).toHaveValue("Keep this unsent feedback");
  await open(page);
  await expect(message).toHaveValue("Keep this unsent feedback");
  expect(mock.replies()).toHaveLength(0);
  expect(mock.sends()).toHaveLength(0);
});

test("typing after a single choice cancels the delayed submission", async ({ page }) => {
  const mock = await fixture(page, "claude", "question");
  mock.requests[0].questions = [{ question: "Which database?", options: [{ label: "Production" }, { label: "Staging" }] }];
  await open(page);
  await expect(page.getByRole("button", { name: "Production", exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Production", exact: true }).click();
  await page.getByRole("textbox", { name: "Your own answer", exact: true }).fill("Use a disposable test database");
  await page.clock.runFor(300);
  expect(mock.replies()).toHaveLength(0);
  await page.getByRole("group", { name: "Question", exact: true }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => mock.replies().length).toBe(1);
  expect(mock.replies()[0].body.answers).toEqual([{ picks: [], other: "Use a disposable test database" }]);
});
