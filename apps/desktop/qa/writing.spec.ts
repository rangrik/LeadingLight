import { expect, type Page, test } from "@playwright/test";

const open = async (page: Page, tools: object) => {
  await page.addInitScript((t) => localStorage.setItem("ll.writing", JSON.stringify(t)), tools);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
};

// Seam: style check's marks are mapped while typing and re-checked after a pause (writing.ts).
// Catches a strike left on words that are gone, or none on words just typed.
test("Style check follows edits", async ({ page }) => {
  await open(page, { style: true });
  await page.keyboard.type("Basically fine");
  const struck = page.getByRole("textbox", { name: "Page body" }).locator(".ll-style");
  await expect(struck).toHaveText(["Basically"]);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("at the end of the day");
  await expect(struck).toHaveText(["Basically", "at the end of the day"]);
  await page.keyboard.press("Shift+Meta+ArrowLeft");
  await page.keyboard.type("fine");
  await expect(struck).toHaveCount(0);
});

// Seam: the editor centres the line in whatever scrolls the page, which is the pane's.
// Catches centring that stops when the pane's layout changes.
test("Focus mode keeps the line being written in the middle", async ({ page }) => {
  await open(page, { focus: true, focusOn: "typewriter" });
  for (let i = 0; i < 40; i++) await page.keyboard.type(`\nLine ${i}`);
  const off = await page.evaluate(() => {
    const caret = window.getSelection()!.getRangeAt(0).getClientRects()[0];
    const pane = document.querySelector(".ll-editor")!.closest(".overflow-y-auto")!.getBoundingClientRect();
    return (caret.top + caret.bottom) / 2 - (pane.top + pane.height / 2);
  });
  expect(Math.abs(off)).toBeLessThan(4);
});

// Seam: Harper's wasm and worker load through the bundler and report back to the editor and header.
// Catches a build where grammar never arrives, so nothing is underlined or counted.
test("Grammar check underlines and counts a misspelling", async ({ page }) => {
  await open(page, {});
  await page.keyboard.type("I recieved it.");
  await expect(page.getByRole("textbox", { name: "Page body" }).locator(".ll-spelling")).toHaveText("recieved", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "Counts" })).toContainText("1 misspelling");
});
