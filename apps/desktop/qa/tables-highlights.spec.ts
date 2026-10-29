import { expect, test, type Page } from "@playwright/test";

const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });
async function newPage(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Table and highlight QA");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
}

// Seam: our Enter keymap against table insertion and cell selection; catches typing in the old row.
test("Table Enter inserts a row and Shift-Enter keeps a line in its cell", async ({ page }) => {
  await newPage(page);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await expect(body(page).locator("tr")).toHaveCount(3);
  await body(page).locator("tr").last().locator("td").nth(1).click();
  await page.keyboard.type("Before");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After");
  await expect(body(page).locator("tr")).toHaveCount(4);
  await expect(body(page).locator("tr").last().locator("td").nth(1)).toHaveText("After");
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.type("One");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Two");
  await expect(body(page).locator("tr")).toHaveCount(5);
  await expect(body(page).locator("tr").last().locator("td").nth(1)).toHaveText("OneTwo");
  await expect(body(page).locator("tr").last().locator("td").nth(1).locator("br")).toHaveCount(1);
});

// Seam: a direct handle must target its row, regardless of where the text cursor was left.
test("Table handles operate on their own row and column", async ({ page }, testInfo) => {
  await newPage(page);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Header");
  await body(page).locator("tr").last().locator("td").last().click();
  await page.keyboard.type("Last");
  await page.getByRole("button", { name: "Row 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
  await expect(body(page).locator("tr")).toHaveCount(2);
  await expect(body(page)).not.toContainText("Header");
  await expect(body(page)).toContainText("Last");
  await page.getByRole("button", { name: "Column 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add column right", exact: true }).click();
  await expect(body(page).locator("tr").last().locator("td")).toHaveCount(4);
  await expect(body(page).locator("tr").last().locator("td").last()).toHaveText("Last");
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath("table-handles.png") });
});

// Seam: popup focus and persisted mark attributes; catches a colour applied to a collapsed selection.
test("Highlight colours apply to selected words, persist, and can be removed", async ({ page }, testInfo) => {
  await newPage(page);
  await page.keyboard.type("Keep these words");
  for (let i = 0; i < 11; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Blue highlight" }).click();
  await expect(body(page).locator("mark")).toHaveAttribute("data-color", "blue");
  await expect(body(page).locator("mark")).toHaveText("these words");
  await expect(page.getByRole("menu", { name: "Highlight", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Pink highlight" }).click();
  await expect(body(page).locator("mark")).toHaveAttribute("data-color", "pink");
  await expect(page.getByRole("menu", { name: "Highlight", exact: true })).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(body(page).locator("mark")).toHaveAttribute("data-color", "pink");
  await body(page).locator("p").first().click({ clickCount: 3 });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove highlight" }).click();
  await expect(body(page).locator("mark")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(body(page).locator("mark")).toHaveAttribute("data-color", "pink");
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: testInfo.outputPath("highlight-pink.png") });
});

// Seam: COSS's menu owns focus, so the editor keymap cannot receive its advertised shortcuts.
test("Block menu supports its displayed keyboard shortcuts", async ({ page }) => {
  await newPage(page);
  await page.keyboard.type("One\nTwo\nThree");
  await page.keyboard.press("Meta+/");
  await expect(page.getByRole("menu", { name: "Block" })).toBeVisible();
  await page.keyboard.press("Meta+d");
  await expect(body(page).locator("p")).toHaveText(["One", "Two", "Three", "Three"]);
  await expect(page.getByRole("menu", { name: "Block" })).toHaveCount(0);
  await expect(body(page)).toBeFocused();
  await page.keyboard.press("Meta+/");
  await expect(page.getByRole("menu", { name: "Block" })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(body(page).locator("p")).toHaveText(["One", "Two", "Three"]);
  await expect(body(page)).toBeFocused();
  await page.keyboard.press("Meta+z");
  await expect(body(page).locator("p")).toHaveText(["One", "Two", "Three", "Three"]);
});

// Seam: a merged cell's rectangle spans several rows; handles must edit just the named row/column.
test("Handles edit a single row or column through merged cells", async ({ page }) => {
  await newPage(page);
  await page.evaluate(() => (window as unknown as { __editor: { commands: { setContent(value: string): void } } }).__editor.commands.setContent(
    '<table><tr><td rowspan="2"><p>Shared</p></td><td colspan="2"><p>Wide</p></td></tr><tr><td><p>Second</p></td><td><p>Third</p></td></tr><tr><td><p>Bottom</p></td><td><p>Keep</p></td><td><p>Last</p></td></tr></table><p></p>',
  ));
  await body(page).locator("td").last().click();
  await page.getByRole("button", { name: "Row 2", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
  await expect(body(page).locator("tr")).toHaveCount(2);
  await expect(body(page)).toContainText("Shared");
  await expect(body(page)).not.toContainText("Second");
  await page.getByRole("button", { name: "Column 2", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete column", exact: true }).click();
  await expect(body(page).locator("tr").last().locator("td")).toHaveText(["Bottom", "Last"]);
  await expect(body(page).locator("tr").first().locator("td")).toHaveText(["Shared", "Wide"]);
});

// Seam: named colour attributes must not break the existing keyboard and Markdown mark rules.
test("Highlight shortcut and Markdown still use the default yellow", async ({ page }) => {
  await newPage(page);
  await page.keyboard.type("Remember");
  await body(page).locator("p").first().click({ clickCount: 3 });
  await page.keyboard.press("Meta+Shift+h");
  await expect(body(page).locator("mark")).toHaveText("Remember");
  await expect(body(page).locator("mark")).not.toHaveAttribute("data-color");
  await page.keyboard.press("Meta+Shift+h");
  await expect(body(page).locator("mark")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("==Keep this== ");
  await expect(body(page).locator("mark")).toHaveText("Keep this");
});

// Seam: overlapping controls can pass locator clicks while real pointers open the wrong menu or cannot drag.
test("Table block and row handles have separate pointer targets, and the table drags", async ({ page }, testInfo) => {
  await newPage(page);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Name");
  const firstCell = body(page).locator("th").first();
  await firstCell.hover();
  const center = async (name: string) => {
    const control = page.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    const rect = (await control.boundingBox())!;
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), point)).toBe(name);
    return point;
  };
  const drag = await center("Drag to move");
  await center("Add block");
  await center("Row 1");
  await page.mouse.click(drag.x, drag.y);
  await expect(page.getByRole("menu", { name: "Block", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await firstCell.hover();
  const row = await center("Row 1");
  await page.mouse.click(row.x, row.y);
  await expect(page.getByRole("menu", { name: "Row 1", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await firstCell.hover();
  const add = await center("Add block");
  await page.mouse.click(add.x, add.y);
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("After");
  const after = body(page).locator(":scope > p").filter({ hasText: /^After$/ });
  await expect(after).toHaveText("After");
  await firstCell.hover();
  const start = await center("Drag to move");
  const end = (await after.boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(start.x + (end.x + 100 - start.x) * i / 12, start.y + (end.y + end.height - 2 - start.y) * i / 12);
  await page.mouse.up();
  await expect(body(page).locator(":scope > :first-child")).toHaveText("After");
  await expect(body(page).locator(":scope > :nth-child(2)")).toHaveClass(/tableWrapper/);
  await expect(body(page).locator("tr")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("table-dragged.png") });
});

// Seam: the table keymap must leave Enter to nested blocks while Cmd-Enter can still add a row.
test("Table lists and code keep Enter, with Cmd-Enter available for a new row", async ({ page }, testInfo) => {
  await newPage(page);
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await body(page).locator("tr").last().locator("td").first().click();
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect(body(page).locator("tr")).toHaveCount(3);
  await expect(body(page).locator("li")).toHaveText(["one", "two"]);
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.type("New row");
  await expect(body(page).locator("tr")).toHaveCount(4);
  await expect(body(page).locator("tr").last().locator("td").first()).toHaveText("New row");
  await body(page).locator("tr").last().locator("td").nth(1).click();
  await page.keyboard.type("/code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await expect(body(page).locator("tr")).toHaveCount(4);
  await expect(body(page).locator("pre")).toHaveText("first\nsecond");
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.type("After code");
  await expect(body(page).locator("tr")).toHaveCount(5);
  await expect(body(page).locator("tr").last().locator("td").nth(1)).toHaveText("After code");
  await body(page).locator("tr").last().locator("td").nth(2).click();
  await page.keyboard.type("## Section");
  await expect(body(page).locator("h2")).toHaveText("Section");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After heading");
  await expect(body(page).locator("tr")).toHaveCount(6);
  await expect(body(page).locator("tr").last().locator("td").nth(2)).toHaveText("After heading");
  await page.screenshot({ path: testInfo.outputPath("rich-table-cells.png") });
});
