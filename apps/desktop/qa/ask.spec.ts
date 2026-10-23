import { expect, type Page, test } from "@playwright/test";

// Scenarios from features/ask.feature, on the browser build's stand-in answers.
// The seam: the selection toolbar and ⌘J into the ask bar and the panel, the panel into
// the editor (insert), the keyboard staying out of the page, and the signed-out state.
const bar = (page: Page) => page.getByRole("toolbar", { name: "Ask Claude" });
const panel = (page: Page) => page.getByRole("region", { name: "Agent" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });
const question = (page: Page) => page.getByRole("textbox", { name: "Question" });

async function pageWith(page: Page, text: string, url = "/") {
  await page.goto(url);
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Cells");
  await title.press("Enter");
  await expect(body(page)).toBeFocused();
  await page.keyboard.type(text);
}

// Selects a word through the editor's dev hook, as a double-click would.
async function select(page: Page, word: string) {
  await page.evaluate((w) => {
    const ed = (window as unknown as { __editor: { state: { doc: { textContent: string } }; chain(): { focus(): { setTextSelection(r: { from: number; to: number }): { run(): void } } } } }).__editor;
    const i = ed.state.doc.textContent.indexOf(w);
    ed.chain().focus().setTextSelection({ from: i + 1, to: i + 1 + w.length }).run();
  }, word);
}

test("Ask from the selection toolbar through the bar, then insert the answer below", async ({ page }) => {
  await pageWith(page, "The mitochondria is the powerhouse of the cell.");
  await select(page, "powerhouse");
  await page.getByRole("button", { name: "Ask about this" }).click();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole("textbox", { name: "Ask Claude about this" })).toBeFocused();
  await page.keyboard.type("What does this mean?");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator("blockquote")).toHaveText("powerhouse");
  await expect(panel(page)).toContainText("What does this mean?");
  await expect(panel(page)).toContainText("About “powerhouse”");
  await panel(page).getByRole("button", { name: "Insert below" }).click();
  await expect(body(page)).toContainText("A stand-in answer");
  await expect(body(page).locator("p").first()).toHaveText("The mitochondria is the powerhouse of the cell.");
});

// The two bugs QA found on 2026-10-22: stale positions eating the wrong words, and a
// stream landing in another page's thread after switching pages.
test("Replace finds the words again after the page was edited", async ({ page }) => {
  await pageWith(page, "The mitochondria is the powerhouse of the cell.");
  await select(page, "powerhouse");
  await page.keyboard.press("Meta+J");
  await bar(page).getByRole("textbox", { name: "Ask Claude about this" }).fill("Simpler word?");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: "Replace" })).toBeVisible();
  await page.evaluate(() => {
    const ed = (window as unknown as { __editor: { commands: { insertContentAt(pos: number, text: string): boolean } } }).__editor;
    ed.commands.insertContentAt(1, "EDITED: ");
  });
  await panel(page).getByRole("button", { name: "Replace" }).click();
  await expect(body(page)).toContainText("EDITED: The mitochondria is the");
  await expect(body(page)).not.toContainText("the powerhouse of");
  await expect(panel(page).getByRole("button", { name: "Replace" })).toBeHidden();
});

test("A thread stays with its page while an answer streams", async ({ page }) => {
  await pageWith(page, "First page.");
  await page.keyboard.press("Meta+J");
  await question(page).fill("Hello?");
  await page.keyboard.press("Enter");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill("Second");
  await page.waitForTimeout(2500);
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Cells", exact: true }).click();
  await page.keyboard.press("Meta+J");
  await expect(panel(page)).toContainText("Hello?");
  await expect(panel(page)).toContainText("A stand-in answer");
});

test("Meta+J with nothing selected asks about the page; keys stay out of it; Escape goes back", async ({ page }) => {
  await pageWith(page, "A line.");
  await page.keyboard.press("Meta+J");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator("blockquote")).toHaveCount(0);
  await expect(question(page)).toHaveAttribute("placeholder", "Ask about this page…");
  await page.keyboard.type("hello");
  await expect(body(page)).toHaveText("A line.");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(body(page)).toBeFocused();
});

test("Stop ends a streaming answer", async ({ page }) => {
  await pageWith(page, "A line.");
  await page.keyboard.press("Meta+J");
  await question(page).fill("Tell me more");
  await page.keyboard.press("Enter");
  await panel(page).getByRole("button", { name: "Stop" }).click();
  await expect(panel(page).getByRole("button", { name: "Send" })).toBeVisible();
});

test("Not signed in: the panel says how, and Send waits", async ({ page }) => {
  await pageWith(page, "A line.", "/?agent=signed-out");
  await page.keyboard.press("Meta+J");
  await expect(panel(page)).toContainText("claude auth login");
  await expect(panel(page).getByRole("button", { name: "Check again" })).toBeVisible();
  await question(page).fill("hello");
  await expect(panel(page).getByRole("button", { name: "Send" })).toBeDisabled();
});

test("Settings › AI shows the account and keeps the model", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-ai").click();
  const section = page.getByTestId("settings-ai");
  await expect(section.getByRole("heading", { name: "AI" })).toBeVisible();
  await expect(section).toContainText("Signed in as you@example.com");
  await section.getByRole("button", { name: "Haiku", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ll.ai") ?? "{}").model)).toBe("haiku");
});
