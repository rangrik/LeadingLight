import { expect, test } from "@playwright/test";

// Seam: our block-selection keymap runs before TipTap's suggestion plugin.
// Catches Escape in the slash menu selecting the block, so the next Backspace deletes it.
test("Escape in the slash menu, then Backspace, only edits text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("keep me");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/qu");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body.locator("p").first()).toHaveText("keep me");
});

// Seam: the browser's own right-click (on macOS it selects a word) against our block selection.
// Catches the block menu opening on a word, so its Delete removes nothing.
test("Right-clicking selected blocks opens the block menu for all of them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("one\ntwo words\nthree words");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowUp");
  const paragraphs = page.getByRole("textbox", { name: "Page body" }).locator("p");
  await paragraphs.nth(2).click({ button: "right", position: { x: 10, y: 10 } });
  await page.getByRole("menu", { name: "Block" }).getByRole("menuitem", { name: /^Delete/ }).click();
  await expect(paragraphs).toHaveText(["one"]);
});

// Seam: the browser's own drag start, from a real pointer on the handle, into our drop handler.
// Catches a drag that never starts (a cancelled mousedown did that); synthetic drag events can't.
test("Dragging the handle with a real mouse moves the block", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("one\ntwo\nthree");
  const paragraphs = page.getByRole("textbox", { name: "Page body" }).locator("p");
  await paragraphs.nth(2).hover();
  const handle = (await page.getByRole("button", { name: "Drag to move" }).boundingBox())!;
  const first = (await paragraphs.first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(handle.x + 200, handle.y + ((first.y + 2 - handle.y) * i) / 10);
  await page.mouse.up();
  await expect(paragraphs).toHaveText(["three", "one", "two"]);
});
