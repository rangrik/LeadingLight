import { expect, type Page, test } from "@playwright/test";

// Scenarios from features/composer.feature, on the browser build's stand-in answers.
// The seams: the ask bar beside the words into the panel (quoted, or left), the
// composer's @ and / menus into the question, and the footer picker into the preferences.
const bar = (page: Page) => page.getByRole("toolbar", { name: "Ask Claude" });
const panel = (page: Page) => page.getByRole("region", { name: "Agent" });
const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });
const question = (page: Page) => page.getByRole("textbox", { name: "Question" });

async function pageWith(page: Page, text: string) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Cells");
  await title.press("Enter");
  await expect(body(page)).toBeFocused();
  await page.keyboard.type(text);
}

// Selects a word through the editor's dev hook, as a double-click would, in any paragraph.
// The view is focused directly: TipTap's focus command lands a frame later, and would take
// the keyboard back from a bar opened in between.
async function select(page: Page, word: string) {
  await page.evaluate((w) => {
    type Node = { isText: boolean; text?: string };
    const ed = (
      window as unknown as {
        __editor: { state: { doc: { descendants(f: (node: Node, pos: number) => boolean): void } }; view: { focus(): void }; commands: { setTextSelection(r: { from: number; to: number }): boolean } };
      }
    ).__editor;
    let hit: { from: number; to: number } | undefined;
    ed.state.doc.descendants((node, pos) => {
      const i = node.isText ? (node.text ?? "").indexOf(w) : -1;
      if (i >= 0 && !hit) hit = { from: pos + i, to: pos + i + w.length };
      return !hit;
    });
    ed.view.focus();
    if (hit) ed.commands.setTextSelection(hit);
  }, word);
}

// The bar's send path is in ask.spec.ts (the first test).
test("Quote in reply carries the words into the panel without sending", async ({ page }) => {
  await pageWith(page, "The mitochondria is the powerhouse of the cell.");
  await select(page, "the cell");
  await page.keyboard.press("Meta+J");
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole("button", { name: "Quote in reply" }).click();
  await expect(bar(page)).toBeHidden();
  await expect(panel(page).locator("blockquote")).toHaveText("the cell");
  await expect(question(page)).toBeFocused();
  await expect(panel(page).getByRole("button", { name: "Send" })).toBeDisabled();
});

test("Escape leaves the bar for the text", async ({ page }) => {
  await pageWith(page, "A line to ask about.");
  await select(page, "line");
  await page.keyboard.press("Meta+J");
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect(body(page)).toBeFocused();
});

// The two bugs the live QA found on 2026-10-22: the bar opened once per load, and closed
// on the first scroll. Both because a DOM range kept from opening collapses when the
// editor redraws on losing focus.
test("The bar opens again, and follows the page as it scrolls", async ({ page }) => {
  await pageWith(page, "First line to ask about.");
  // The last key's caret scroll (editor's caret-scroll.ts) runs a frame later, at the caret then;
  // inserted before it, the caret is 80 lines down and the page follows it there.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    const ed = (window as unknown as { __editor: { commands: { insertContentAt(pos: number, html: string): boolean } } }).__editor;
    ed.commands.insertContentAt(26, Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 2}</p>`).join(""));
  });
  await select(page, "Line 10");
  await page.keyboard.press("Meta+J");
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await select(page, "Line 10");
  await page.keyboard.press("Meta+J");
  await expect(bar(page)).toBeVisible();
  const before = (await bar(page).boundingBox())!.y;
  await page.locator("[data-page-scroller]").evaluate((el) => el.scrollBy(0, 40));
  // The scroll event lands a frame after scrollBy, so the position is polled.
  await expect.poll(async () => (await bar(page).boundingBox())?.y).toBeCloseTo(before - 40, 0);
  await page.locator("[data-page-scroller]").evaluate((el) => el.scrollBy(0, 2000));
  await expect(bar(page)).toBeHidden();
});

test("@ mentions an agent or a page, as tokens in the text", async ({ page }) => {
  await pageWith(page, "Glossary of terms.");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill("Notes");
  await page.keyboard.press("Meta+J");
  await question(page).pressSequentially("@");
  const menu = page.getByTestId("composer-menu");
  await expect(menu).toContainText("Editor");
  await expect(menu).toContainText("Critic");
  await menu.getByRole("option", { name: /Editor/ }).click();
  await question(page).pressSequentially(" @Cel");
  await expect(menu).toContainText("Cells");
  await page.keyboard.press("Enter");
  await expect(question(page).locator("[data-slot=composer-token]")).toHaveText(["Editor", "Cells"]);
});

test("/ offers things to do with the words, and Shorten sends at once", async ({ page }) => {
  await pageWith(page, "The mitochondria is the powerhouse of the cell.");
  await select(page, "powerhouse");
  await page.keyboard.press("Meta+J");
  await bar(page).getByRole("button", { name: "Quote in reply" }).click();
  await question(page).fill("/");
  const menu = page.getByTestId("composer-menu");
  await expect(menu).toContainText("Shorten");
  await expect(menu).toContainText("Translate");
  await menu.getByRole("option", { name: /Shorten/ }).click();
  await expect(panel(page)).toContainText("Shorten this");
  await expect(panel(page)).toContainText("About “powerhouse”");
});

test("Model and effort sit in the footer and are kept", async ({ page }) => {
  await pageWith(page, "A line.");
  await page.keyboard.press("Meta+J");
  const picker = panel(page).getByRole("button", { name: "Model and effort" });
  await expect(picker).toHaveText(/Opus\s*Medium/);
  await picker.click();
  await page.getByRole("radio", { name: /Sonnet/ }).click();
  await page.getByRole("slider", { name: "Effort" }).press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveText(/Sonnet\s*High/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ll.ai") ?? "{}"))).toMatchObject({ model: "sonnet", effort: "high" });
});

test("Settings › AI lists the agents", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-ai").click();
  const section = page.getByTestId("settings-ai");
  await expect(section).toContainText("Editor");
  await expect(section).toContainText("Summarizer");
  await expect(section).toContainText("Built in");
});
