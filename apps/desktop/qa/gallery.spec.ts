import { expect, type Page, test } from "@playwright/test";

// Screenshots of the main states for design review. Run: pnpm qa:gallery
const shot = (page: Page, name: string) => page.screenshot({ path: `qa/report/${name}.png` });

const body = (page: Page) => page.getByRole("textbox", { name: "Page body" });

async function typeLines(page: Page, lines: string[]) {
  for (const line of lines) {
    if (line) await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
}

async function writeSample(page: Page) {
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Trip to Kyoto");
  await page.keyboard.press("Enter");
  await expect(body(page)).toBeFocused();
  // Enter inside a list continues the list, so only the first item carries the shortcut.
  await typeLines(page, [
    "# Before we go",
    "Pack light, bring the good **camera**, and leave room for ceramics.",
    "- Book the Hakone ryokan",
    "Reserve seats on the Nozomi",
    "",
    "[] Renew the rail pass",
    "Call the ryokan about dinner",
    "",
    "a. Tokyo",
    "Kyoto",
    "",
    "> Kyoto is best in the early morning, before the temples fill up.",
    "",
    "#### Packing",
    "```",
    "const stops = ['Fushimi Inari', 'Arashiyama']",
    "",
    "",
  ]);
  await page.keyboard.type("---");
  await page.keyboard.type("/toggle");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Day plans");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Morning at Fushimi Inari, lunch in Gion.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Day");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Plan");
  await page.waitForTimeout(600);
}

test("gallery @gallery", async ({ page }) => {
  await page.goto("/");
  await shot(page, "01-empty");

  await writeSample(page);
  await page.mouse.move(10, 10);
  await shot(page, "02-document");

  // Clicking right of the text puts the caret at the end of the line.
  await body(page).getByText("Pack light").click({ position: { x: 620, y: 10 } });
  await page.waitForTimeout(50);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await shot(page, "03-slash-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  await body(page).getByText("camera").dblclick();
  await expect(page.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();
  await shot(page, "04-selection-toolbar");

  await body(page).getByText("Reserve seats").hover();
  await expect(page.getByRole("button", { name: "Drag to move" })).toBeVisible();
  await shot(page, "05-block-handle");

  await page.getByRole("button", { name: "Drag to move" }).click();
  await page.getByRole("menuitem", { name: "Turn into" }).hover();
  await expect(page.getByRole("menuitem", { name: "Heading 1" })).toBeVisible();
  await shot(page, "06a-block-menu");
  // One Escape for the submenu, one for the menu.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Shift+ArrowDown");
  await shot(page, "06-block-selection");
  await page.keyboard.press("Escape");

  await body(page).getByText("Day", { exact: true }).click();
  await page.waitForTimeout(50);
  await expect(page.getByRole("toolbar", { name: "Table" })).toBeVisible();
  await shot(page, "07-table-toolbar");

  await body(page).getByText("Fushimi Inari', 'Arashiyama'").click();
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, "07a-code-controls");

  const firstRow = page.getByRole("navigation", { name: "Pages" }).getByRole("listitem").first();
  await firstRow.hover();
  await firstRow.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page, "08a-page-actions");
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, "08-delete-dialog");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.waitForTimeout(300);
  await shot(page, "09-sidebar-collapsed");
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.waitForTimeout(300);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(100);
  await page.mouse.move(10, 10);
  await shot(page, "10-dark");
  await body(page).getByText("Kyoto is best").click({ position: { x: 600, y: 10 } });
  await page.waitForTimeout(50);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await shot(page, "11-dark-slash-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");

  await body(page).getByText("Kyoto is best").hover();
  await page.getByRole("button", { name: "Drag to move" }).click();
  await expect(page.getByRole("menu", { name: "Block" })).toBeVisible();
  await shot(page, "12-dark-block-menu");
});
