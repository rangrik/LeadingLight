import { expect, type Locator, type Page, test } from "@playwright/test";

// Wide enough for the task and its report's own page side by side, each with its margin.
test.use({ viewport: { width: 1900, height: 900 } });

// A note on the word x px into a paragraph.
async function note(p: Locator, text: string, x = 4) {
  await p.dblclick({ position: { x, y: 10 } });
  await p.page().keyboard.press("Meta+Shift+M");
  await p.page().keyboard.type(text);
}

// A task with its agent and one report, open; the report shows under the task's words.
async function seed(page: Page) {
  await page.goto("/?mac");
  await expect(page.getByRole("navigation", { name: "Library" }).getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
  const ids = await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const task = await createPage({ title: "Write the summary", typeId: "task" });
    const agent = await createPage({ title: "Claude: Write the summary", typeId: "agent", properties: { "agent-task": [task.id], run: { conversation: "c1", session: "s1", location: "p", agent: "claude" } } });
    const report = await createPage({ title: "Summary", typeId: "report", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "It names the owner of each note." }] }] }, properties: { parent: task.id, report: { by: agent.id, session: "s1", to: task.id, at: Date.now(), command: "x", ready: true } } });
    openPage(task.id);
    return { task: task.id, report: report.id };
  });
  return { ...ids, task: page.getByRole("region", { name: "Write the summary", exact: true }) };
}

const stored = (page: Page, report: string) =>
  page.evaluate(async (id) => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const { pageOf } = await import(String("/src/lib/space.ts"));
    const thoughts = await objects.get(String(pageOf(id)?.properties.thoughts));
    const body = JSON.stringify((await objects.get(id))?.content);
    return { notes: JSON.stringify(thoughts?.content).match(/"text":"[^"]+"/g), marked: new Set(body.match(/"type":"note","attrs":\{"id":"[^"]+"/g)).size };
  }, report);

// Seam: one report in two editors (DECISIONS 24). Catches a note kept only in the task's copy, or
// one editor saving its copy of the report or its Thoughts page over the other's note.
test("a note on the report under its task is the report's, on both of its editors", async ({ page }) => {
  const { report, task } = await seed(page);
  await task.locator(`[data-report="${report}"]`).getByRole("button", { name: "Open", exact: true }).click({ modifiers: ["Shift"] });
  const own = page.getByRole("region", { name: "Summary", exact: true });
  await note(task.getByRole("textbox", { name: "Report: Summary" }).locator("p"), "Name them first.");
  await expect(own.locator(".ll-note .ProseMirror")).toHaveText(["Name them first."]);
  await note(own.getByRole("textbox", { name: "Page body" }).locator("p"), "And on its page.", 40);
  await expect(task.locator(".ll-note .ProseMirror")).toHaveText(["Name them first.", "And on its page."]);
  await expect.poll(() => stored(page, report)).toEqual({ notes: ['"text":"Name them first."', '"text":"And on its page."'], marked: 2 });
});

// Seam: Send on the card (feedback.feature). Catches a send that needs a dialog, or a batch not
// frozen and delivered to the task's own agent.
test("ticking a note and pressing Send 1 note sends it at once", async ({ page }) => {
  const sent: { text: string }[] = [];
  await page.route("**/__runtime/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/v1/sessions/s1/send")) sent.push(route.request().postDataJSON());
    return route.fulfill({ json: path.endsWith("/v1/conversations") ? [{ id: "c1", session: "s1", live: true }] : [] });
  });
  const { task } = await seed(page);
  await note(task.getByRole("textbox", { name: "Report: Summary" }).locator("p"), "Name them first.");
  await task.getByRole("checkbox", { name: "Send note 1 on “Summary” to Claude" }).click();
  await task.getByTestId("work-row").getByRole("button", { name: "Send 1 note", exact: true }).click();
  await expect(page.getByText("Sent to Claude")).toBeVisible();
  await expect(task.locator(".ll-note-sent")).toHaveText("Sent");
  const batch = await page.evaluate(async () => {
    const { space } = await import(String("/src/lib/space.ts"));
    return space.get().pages.find((p: { typeId: string }) => p.typeId === "feedback")?.properties.batch as { state: string; points: { text: string }[] };
  });
  expect(batch.state).toBe("sent");
  expect(batch.points.map((p) => p.text)).toEqual(["Name them first."]);
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain("Name them first.");
});
