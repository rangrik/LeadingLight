import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1600, height: 900 } });

// Seam: openReview against the pane tree (lib/review.ts, lib/panes.ts). Catches a second press
// adding a pane, Review next opening new panes instead of reusing the two, and a strip left behind.
test("Review puts the report beside its task, reuses both panes, and closes back to the task", async ({ page }) => {
  await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/?mac");
  await expect(page.getByRole("navigation", { name: "Types" })).toBeVisible();
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const made = async (title: string, n: number) => {
      const task = await createPage({ title, typeId: "task", createdAt: Date.now() - n });
      const agent = await createPage({ title: `Claude: ${title}`, typeId: "agent", properties: { "agent-task": [task.id], run: { conversation: `c${n}`, session: `s${n}`, location: "p", agent: "claude" } } });
      await createPage({ title: `${title} report`, typeId: "report", properties: { parent: task.id, report: { by: agent.id, session: `s${n}`, to: task.id, at: Date.now() - n, command: `x${n}`, ready: true } } });
      return task.id;
    };
    openPage(await made("Write the summary", 1));
    await made("Audit the notes", 2);
  });
  const panes = page.locator("section[data-pane]");
  const strip = page.getByTestId("review-strip");
  await page.getByRole("region", { name: "Write the summary", exact: true }).getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("region", { name: "Write the summary report" }).getByTestId("review-strip")).toBeVisible();
  await page.getByRole("region", { name: "Write the summary", exact: true }).getByRole("button", { name: "Review", exact: true }).click();
  await expect(panes).toHaveCount(2);
  await strip.getByRole("button", { name: "Review next" }).click();
  await expect(page.getByRole("region", { name: "Audit the notes", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit the notes report" }).getByTestId("review-strip")).toBeVisible();
  await expect(panes).toHaveCount(2);
  await strip.getByRole("button", { name: "Accept" }).click();
  await expect(strip).toContainText("Accepted");
  await page.getByRole("region", { name: "Audit the notes report" }).getByRole("button", { name: "Close page" }).click();
  await expect(panes).toHaveCount(1);
  await expect(strip).toHaveCount(0);
});
