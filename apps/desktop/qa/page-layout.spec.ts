import { expect, test } from "@playwright/test";

// Seam: saved width reaches the mounted page and adapts to the pane without losing edits.
test("Content width is editable, persistent, and fits a narrow pane", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Width check");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Words kept while changing width.");
  await page.keyboard.press("Meta+Comma");
  await page.getByTestId("settings-nav-appearance").click();
  const width = page.getByRole("textbox", { name: "Content width" });
  await width.fill("800");
  await width.press("Enter");
  await expect(width).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body).toHaveCSS("width", "800px");
  await expect(body).toHaveText("Words kept while changing width.");
  await page.reload();
  await expect(body).toHaveCSS("width", "800px");
  await page.keyboard.press("Meta+Comma");
  await page.getByTestId("settings-nav-appearance").click();
  await width.fill("900");
  await width.press("Escape");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
  await expect(body).toHaveCSS("width", "900px");
  await page.reload();
  await expect(body).toHaveCSS("width", "900px");
  await page.keyboard.press("Meta+Comma");
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByRole("switch", { name: "Full width" }).click();
  await expect(width).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await body.boundingBox())!.width).toBeGreaterThan(800);
  await page.keyboard.press("Meta+Comma");
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByRole("switch", { name: "Full width" }).click();
  await expect(width).toHaveValue("900");
  await width.fill("2000");
  await width.press("Tab");
  await expect(width).toHaveValue("1,600");
  await width.fill("800");
  await width.press("Tab");
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page.screenshot({ path: "qa/report/content-width-settings.png" });
  await page.keyboard.press("Escape");
  await expect.poll(() => body.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(17);
  await expect.poll(() => page.getByRole("textbox", { name: "Title" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(38);
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(() => page.locator("[data-page-scroller]").evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await page.screenshot({ path: "qa/report/content-width-narrow.png" });
});

// Seam: typing scrolls only the active page, while pointer selection and Focus keep their rules.
test("Ordinary typing keeps the cursor above the bottom", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.type(`Line ${i}`);
    await page.keyboard.press("Enter");
  }
  const gap = () => page.evaluate(() => {
    const editor = (window as any).__editor;
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    return document.querySelector("[data-page-scroller]")!.getBoundingClientRect().bottom - caret.bottom;
  });
  await expect.poll(gap).toBeGreaterThanOrEqual(119);
  const box = page.locator("[data-page-scroller]");
  const top = await box.evaluate((el) => el.scrollTop);
  const body = page.getByRole("textbox", { name: "Page body" });
  await body.locator("p").nth(25).click();
  await page.waitForTimeout(100);
  expect(await box.evaluate((el) => el.scrollTop)).toBe(top);
  await page.screenshot({ path: "qa/report/caret-reading-room.png" });
});
