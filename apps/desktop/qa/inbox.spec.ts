import { expect, test } from "@playwright/test";

// Seam: three components (feed, suggestions, captures) mark the rows the Inbox walks, and only the
// feed's reach its one count. Catches ↓ skipping a section, a key opening the wrong one, and a
// suggestion or a capture counted on the icon.
test("the Inbox counts what agents wait on, opens at a section and walks across them", async ({ page }) => {
  await page.goto("/?demo");
  const inbox = page.getByRole("complementary", { name: "Inbox", exact: true });
  const section = (name: string) => inbox.getByRole("region", { name, exact: true });
  const n = async (name: string) => Number((await section(name).getByRole("heading").first().textContent())?.match(/\d+$/)?.[0]);
  const count = page.locator("#bar-count-inbox");
  // The demo seeds, then reloads itself. A reload of ours before that would cut the seed short.
  await page.waitForFunction(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload", null, { timeout: 20_000 });
  await expect(count).toBeVisible();
  await page.keyboard.press("Meta+Alt+k");
  await expect(section("Captured").locator(":focus")).toHaveCount(1);
  await expect(section("Needs you").getByRole("heading")).toHaveText(/3$/);
  expect(await n("Captured")).toBeGreaterThan(0);
  await expect(count).toHaveText(String(await n("Needs you")));
  // Tail's own rows land a moment after the load; a row added mid-walk would take the next ↓.
  await expect(section("Suggested")).toContainText("4 ideas");
  // A new suggestion adds a row to Suggested and nothing to the count.
  const suggested = await n("Suggested");
  await page.evaluate(async () => {
    const { tail } = await import(String("/src/lib/tail.ts"));
    const { space } = await import(String("/src/lib/space.ts"));
    const where = space.get().pages.find((p: { title: string }) => p.title === "Pricing notes").id;
    tail.set([...tail.get(), { id: "qa-new", where, block: 0, words: ["A new one"], nod: "Do it", act: async () => {} }]);
  });
  await expect(section("Suggested").getByRole("heading").first()).toHaveText(new RegExp(`${suggested + 1}$`));
  await expect(count).toHaveText(String(await n("Needs you")));
  await page.keyboard.press("ArrowUp");
  await expect(inbox.locator("[data-section=suggested], [data-section=here]").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(section("Captured").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Meta+Alt+f");
  await expect(section("Needs you").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
});
