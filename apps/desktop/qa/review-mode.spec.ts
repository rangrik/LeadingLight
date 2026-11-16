import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1500, height: 900 } });

// Seam: a verdict crosses the editor's selection bar, the note store and the task's feedback drafts
// (review-mode.feature). Catches a verdict note that isn't ticked or doesn't start with its word, and
// an Esc that leaves the pane stuck in review mode.
test("a verdict in review mode adds a ticked note, and Esc returns to the task", async ({ page }) => {
  await page.goto("/?mac");
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const task = await createPage({ title: "Write the summary", typeId: "task", content: para("Summarise the notes.") });
    const agent = await createPage({ title: "Claude: Write the summary", typeId: "agent", properties: { "agent-task": [task.id], run: { conversation: "c1", session: "s1", location: "p", agent: "claude" } } });
    const report = (title: string, text: string, at: number) =>
      createPage({ title, typeId: "report", content: para(text), createdAt: at, properties: { parent: task.id, report: { by: agent.id, session: "s1", to: task.id, at, command: title } } });
    await report("First", "It names each note.", Date.now() - 60_000);
    await report("Second", "It names the owner of each note.", Date.now());
    openPage(task.id);
  });
  const task = page.getByRole("region", { name: "Write the summary", exact: true });
  await task.getByRole("article", { name: "Report: Second" }).getByRole("button", { name: "Review", exact: true }).click();
  const bar = task.getByRole("toolbar", { name: "Review" });
  await expect(bar).toContainText("No notes ticked");
  await expect(task.getByRole("button", { name: "Changes since “First”" })).toBeVisible();

  const words = task.getByRole("textbox", { name: "Report: Second" }).locator("p");
  await words.dblclick({ position: { x: 4, y: 10 } });
  await task.getByRole("button", { name: /^Change,/ }).click();
  await page.keyboard.type("Shorter.");
  await expect(task.locator(".ll-note .ProseMirror p")).toHaveText(["Change", "Shorter."]);
  await expect(task.getByRole("checkbox", { name: "Send note 1 on “Second” to Claude" })).toBeChecked();
  await expect(bar).toContainText("1 note ticked");

  await words.click();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(task.getByTestId("work-row")).toBeVisible();
});
