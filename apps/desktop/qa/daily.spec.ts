import { expect, test } from "@playwright/test";

// Seam: a day not yet written in opens as a draft, stored by its first save (storeDraft in
// lib/space.ts). Catches browsing days leaving empty notes behind, and a draft's first edit lost.
test("Browsing days stores nothing; the first edit stores the day", async ({ page }) => {
  await page.goto("/");
  const title = page.getByRole("textbox", { name: "Title" });
  const days: string[] = [];
  await page.getByRole("button", { name: "Today", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    if (i) await page.getByRole("button", { name: "Previous day" }).click();
    await expect(title).not.toHaveValue(days.at(-1) ?? "");
    days.push(await title.inputValue());
  }
  await page.getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.type("kept");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(title).toHaveValue(days[1]);
  await page.reload();
  await page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Daily notes" }).click();
  await expect(page.getByRole("link", { name: days[2] })).toBeVisible();
  await expect(page.getByRole("link", { name: days[0] })).toHaveCount(0);
  await expect(page.getByRole("link", { name: days[1] })).toHaveCount(0);
  await page.getByRole("link", { name: days[2] }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("kept");
});

// Seam: ThisDay (components/daily-bar.tsx) reading a page's made and saved times against the day.
// Catches an edited page missing from its day, and a page made that day listed twice.
test("A day lists what was made and edited that day, newest first", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { createPage } = await import("/src/lib/" + "space.ts");
    const noon = new Date().setHours(-12, 0, 0, 0); // yesterday, noon
    await createPage({ title: "Kickoff", createdAt: noon, updatedAt: noon });
  });
  const nav = page.getByRole("navigation", { name: "Recent" });
  const body = page.getByRole("textbox", { name: "Page body" });
  await nav.getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Pricing page");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("draft");
  await nav.getByRole("button", { name: "Kickoff", exact: true }).click();
  await body.click();
  await page.keyboard.type("notes");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const day = page.getByRole("region", { name: "This day", exact: true });
  const rows = day.locator("[data-slot=collapsible-panel] button");
  await day.getByRole("button", { name: "This day · 2" }).click();
  await expect(rows).toHaveText([/^Kickoffedited\d{1,2}:\d\d/, /^Pricing pagemade\d{1,2}:\d\d/]);
  // Open is remembered from day to day.
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(rows).toHaveText([/^Kickoffmade/]);
});

// Seam: TodayStrip (components/today-strip.tsx) reading task states and the Feed's asks per project.
// Catches projects out of urgency order, a done task counted, and Accept missing or on the wrong task.
test("Today's strip puts the project that needs me first, with one press each", async ({ page }) => {
  await page.goto("/?mac&demo");
  // The demo fills the space, then reloads.
  await page.waitForFunction(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type === "reload");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const strip = page.getByRole("region", { name: "Where things stand" });
  await expect(strip.locator("[data-project]")).toHaveText([/^LeadingLight1 needs you · 1 ready · 1 workingAnswer$/, /^Home office1 readyAccept$/]);
  await expect(page.getByRole("region", { name: "This day", exact: true }).locator("[data-slot=collapsible-panel]")).toHaveCount(0);
  await strip.getByRole("button", { name: "Accept" }).click();
  await expect(strip.locator("[data-project]")).toHaveText([/^LeadingLight/]);
  const lamps = await page.evaluate(async () => (await import("/src/lib/" + "space.ts")).space.get().pages.find((p) => p.title === "Compare three desk lamps")?.properties);
  expect(lamps).toMatchObject({ done: true, accepted: { report: expect.any(String) } });
});
