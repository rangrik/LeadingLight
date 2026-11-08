import { expect, test } from "@playwright/test";

// Seam: three components (feed, suggestions, captures) mark the rows the Inbox walks and feed its one
// count; one losing its mark makes ↓ skip a section, and a key mixed up opens the wrong section.
test("the Inbox counts all three, opens at a section and walks across them", async ({ page }) => {
  await page.goto("/?demo");
  const inbox = page.getByRole("complementary", { name: "Inbox", exact: true });
  const section = (name: string) => inbox.getByRole("region", { name, exact: true });
  const n = async (name: string) => Number((await section(name).getByRole("heading").first().textContent())?.match(/\d+$/)?.[0]);
  const count = page.locator("#bar-count-inbox");
  // The demo seeds, then reloads itself; one more load waits that out.
  await expect(count).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(count).toBeVisible();
  await page.keyboard.press("Meta+Alt+k");
  await expect(section("Captured").locator(":focus")).toHaveCount(1);
  await expect(section("Needs you").getByRole("heading")).toHaveText(/2$/);
  // Suggestions shown are seen, so only the other two sections count now.
  await expect(count).toHaveText(String((await n("Needs you")) + (await n("Captured"))));
  await page.keyboard.press("ArrowUp");
  await expect(inbox.locator("[data-section=suggested], [data-section=here]").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(section("Captured").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Meta+Alt+f");
  await expect(section("Needs you").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
  // A new suggestion, unseen while the Inbox is closed, adds one.
  const before = Number(await count.textContent());
  await page.evaluate(async () => {
    const { tail } = await import(String("/src/lib/tail.ts"));
    const { space } = await import(String("/src/lib/space.ts"));
    const where = space.get().pages.find((p: { title: string }) => p.title === "Pricing notes").id;
    tail.set([...tail.get(), { id: "qa-new", where, block: 0, words: ["A new one"], nod: "Do it", act: async () => {} }]);
  });
  await expect(count).toHaveText(String(before + 1));
});
