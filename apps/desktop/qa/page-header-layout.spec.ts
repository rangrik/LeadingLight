import { expect, type Page, test } from "@playwright/test";

async function create(page: Page, title: string) {
  const nav = page.getByRole("navigation", { name: "Recent" });
  const count = await nav.getByRole("listitem").count();
  await nav.getByRole("button", { name: "New page" }).click();
  await expect(nav.getByRole("listitem")).toHaveCount(count + 1);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
}

// Seam: header label breakpoints use the content lane, not the wider pane around its gutters.
test("Narrow split and single pages keep every header control inside the pane", async ({ page }) => {
  await page.goto("/");
  await create(page, "Alpha");
  await page.keyboard.type("Alpha body");
  await create(page, "Beta");
  await page.keyboard.type("Beta body");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Alpha", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-page-scroller]")).toHaveCount(2);
  await page.keyboard.press("Meta+\\");
  const fits = () => expect.poll(() => page.locator("[data-page-scroller]").evaluateAll((boxes) => boxes.map((box) => box.scrollWidth - box.clientWidth))).toEqual([0, 0]);
  for (const width of [960, 1000]) {
    await page.setViewportSize({ width, height: 720 });
    await fits();
    for (const name of ["Alpha", "Beta"]) {
      const card = page.getByRole("region", { name, exact: true });
      await card.getByRole("textbox", { name: "Title" }).hover();
      const edge = (await card.boundingBox())!.x + (await card.boundingBox())!.width;
      for (const label of ["Add icon", "Add cover", "Add tag", "Add description"]) {
        const button = card.getByRole("button", { name: label, exact: true });
        await expect(button).toBeVisible();
        const rect = (await button.boundingBox())!;
        expect(rect.x + rect.width).toBeLessThanOrEqual(edge);
      }
    }
    await fits();
  }
  const beta = page.getByRole("region", { name: "Beta", exact: true });
  await beta.getByRole("button", { name: "Add description", exact: true }).click();
  await expect(beta.getByRole("textbox", { name: "Description" })).toBeFocused();
  await page.getByRole("region", { name: "Alpha", exact: true }).getByRole("button", { name: "Close page", exact: true }).click();
  await page.setViewportSize({ width: 520, height: 800 });
  await expect.poll(() => page.locator("[data-page-scroller]").evaluate((box) => box.scrollWidth - box.clientWidth)).toBe(0);
  await beta.getByRole("textbox", { name: "Title" }).hover();
  await beta.getByRole("button", { name: "Add icon", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search emoji" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox", { name: "Search emoji" })).toBeHidden();
  await page.screenshot({ path: "qa/report/header-controls-520.png" });
});

// Seam: the editor reports its gutter before the page paints, without animating from no gutter.
test("Opening a saved page with headings does not slide its text sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await create(page, "Headings");
  await page.keyboard.type("# First\nWords\n# Second\nMore words");
  await create(page, "Other");
  await page.evaluate(() => {
    (window as any).positions = [];
    let frames = 0;
    const record = () => {
      const editor = document.querySelector(".ll-editor");
      if (editor?.querySelectorAll("h1").length === 2) (window as any).positions.push(editor.getBoundingClientRect().left);
      if (++frames < 45) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Headings", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).positions.length)).toBeGreaterThan(12);
  const positions: number[] = await page.evaluate(() => (window as any).positions);
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
});
