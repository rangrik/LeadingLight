import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1400, height: 900 } });

const questions = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => (await import(String("/src/lib/feed.ts"))).feedItems().filter((i: { kind: string }) => i.kind === "question").length);

// Seam: the card and the Feed answer through one chat (DECISIONS 23); the card's block numbers are
// the editor's. Catches a card keeping its own copy of the question, or bars on the wrong blocks.
test("the card answers the question for the Feed too, and marks what changed", async ({ page }) => {
  await page.goto("/?mac&demo");
  // The app shows its first page once seeded and reloaded; opened before that, the task is replaced.
  await expect.poll(() => page.evaluate(async () => !!(await import(String("/src/lib/panes.ts"))).panes.get().root).catch(() => false)).toBe(true);
  await page.evaluate(async () => {
    const { space } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    openPage(space.get().pages.find((p: { title: string }) => p.title === "Write the pricing page copy").id);
  });
  const task = page.getByRole("region", { name: "Write the pricing page copy", exact: true });
  const card = task.getByTestId("work-row");
  await expect(card.locator('[data-state="input"]')).toHaveText("Needs your input");
  await expect.poll(() => questions(page)).toBe(1);

  await card.getByRole("button", { name: "4 paragraphs changed", exact: true }).click();
  const bars = task.locator("[data-change-bar]");
  await expect(bars).toHaveCount(4);
  // Measured in one frame: the page is still scrolling to it.
  const block = task.getByRole("textbox", { name: "Report: Pricing copy, second draft" }).locator(":scope > *").nth(1);
  expect(Math.abs(await block.evaluate((b) => b.getBoundingClientRect().top - b.closest("article")!.querySelector("[data-change-bar]")!.getBoundingClientRect().top))).toBeLessThan(1);
  await expect(bars).toHaveCount(0, { timeout: 4000 });

  await card.getByRole("button", { name: /^Yearly/ }).click();
  await expect(card.getByRole("group", { name: "Question" })).toHaveCount(0);
  await expect.poll(() => questions(page)).toBe(0);
  await expect(card.locator('[data-state="working"]')).toHaveText("Working");
});
