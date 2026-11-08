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
// Seam: DayTimeline (components/day-timeline.tsx) reading a page's made and saved times against
// the day, and its toggle kept in this browser. Catches a lost entry, a wrong order or wording,
// and "Just my words" forgotten on reload.
test("A day's timeline lists what was made and edited, earliest first", async ({ page }) => {
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
  const day = page.getByRole("region", { name: "Timeline", exact: true });
  await expect(day.getByRole("listitem")).toHaveText([/^\d{1,2}:\d\d.*made Pricing page$/, /^\d{1,2}:\d\d.*edited Kickoff$/]);
  await day.getByRole("radio", { name: "Just my words" }).click();
  await expect(day.getByRole("listitem")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(day.getByRole("radio", { name: "Just my words" })).toBeChecked();
  await day.getByRole("radio", { name: "Day" }).click();
  await expect(day.getByRole("listitem")).toHaveText([/made Kickoff$/]);
});
