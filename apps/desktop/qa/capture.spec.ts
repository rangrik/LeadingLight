import { expect, type Page, test } from "@playwright/test";

const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });
const box = (page: Page) => page.getByRole("dialog", { name: "New idea" });
const notes = (page: Page) => box(page).getByRole("textbox", { name: "Notes" });

// Seam: the box writes a daily note's body by hand (lib/capture.ts), with no editor in between,
// and its own body is the block editor. Catches a shape the editor can't read (Today opening
// read-only or without its list), the line missing from a note open in a pane, an idea listed
// twice under "Created this day", a missing tag, and Escape closing the box under an open menu.
test("A captured idea lands in Today, open or not, and reads back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New idea" }).click();
  const title = box(page).getByRole("textbox", { name: "Idea" });
  await expect(title).toBeFocused();
  await title.pressSequentially("Walk the long way");
  await title.press("Enter");
  await expect(notes(page)).toBeFocused();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu).toBeVisible();
  // Over the box, not under it: the point inside the menu hits the menu.
  expect(await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + 8, r.top + 8)?.closest("[role=listbox]") === el;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(box(page)).toBeVisible();
  // A click on a menu's option is not a click outside the box.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("/");
  await menu.getByRole("option", { name: /Heading 2/ }).click();
  await expect(box(page)).toBeVisible();
  await page.keyboard.type("Plan");
  await expect(notes(page).locator("h2")).toHaveText("Plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Along the river");
  await expect(notes(page).locator("ul li")).toHaveText("Along the river");
  await expect(box(page).getByText("Saved")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Walk the long way" })).toBeVisible();
  await page.screenshot({ path: "qa/report/capture-box.png" });
  await page.keyboard.press("Escape");
  await expect(box(page)).toHaveCount(0);

  // Today was made by the capture and never opened: the line went to the stored body.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(body(page)).toHaveAttribute("contenteditable", "true");
  await expect(body(page).locator("h3")).toHaveText("Ideas");
  await expect(body(page).locator("ul li .node-mention")).toContainText("Walk the long way");
  await expect(page.getByRole("region", { name: "Created this day" })).toHaveCount(0);

  // Today is open now: the next idea goes through its editor, and survives a reload. Escape
  // gives the keyboard back to the body, not to the sidebar row that opened the box.
  await body(page).click();
  await page.getByRole("button", { name: "New idea" }).click();
  await box(page).getByRole("textbox", { name: "Idea" }).pressSequentially("Second");
  await expect(box(page).getByText("Saved")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(body(page)).toBeFocused();
  await expect(body(page).locator("ul li")).toHaveCount(2);
  await expect(body(page).locator("h3")).toHaveCount(1);
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(body(page).locator("ul li .node-mention")).toHaveCount(2);
  await page.screenshot({ path: "qa/report/capture-today.png" });

  // ⌘↩ opens the idea with the cursor in its body; its list and tag came along.
  await page.getByRole("button", { name: "New idea" }).click();
  await box(page).getByRole("textbox", { name: "Idea" }).pressSequentially("Third");
  await page.keyboard.press("Meta+Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Third");
  await expect(body(page)).toBeFocused();
  await expect(page.getByText("in-the-middle", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Walk the long way" }).click();
  await expect(body(page).locator("h2")).toHaveText("Plan");
  await expect(body(page).locator("ul li")).toHaveText("Along the river");
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Tags" })).toBeVisible();
});
