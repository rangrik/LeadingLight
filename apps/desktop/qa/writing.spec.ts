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

// Seam: Harper's wasm and worker load through the bundler and report back to the editor and header,
// and the reason reaches COSS's tooltip. Catches grammar that never arrives, or the slow native tip.
test("Grammar check underlines, explains and counts a misspelling", async ({ page }) => {
  await open(page, {});
  await page.keyboard.type("I recieved it.");
  const word = page.getByRole("textbox", { name: "Page body" }).locator(".ll-spelling");
  await expect(word).toHaveText("recieved", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "Counts" })).toContainText("1 misspelling");
  await word.hover();
  await expect(page.locator("[data-slot=tooltip-popup]")).toContainText("recieved", { timeout: 1000 });
});

// Seam: the counts share a card header with the page's title. Catches the title cut to "L…"
// while counts still show, or a count cut in half, in narrow cards side by side.
test("Narrow cards keep the title whole and show only whole counts", async ({ page }) => {
  await open(page, {});
  await page.keyboard.type("One two three. I recieved teh note basically.");
  await page.getByRole("textbox", { name: "Title" }).fill("Left");
  const nav = page.getByRole("navigation", { name: "Pages" });
  for (const title of ["Middle", "Right"]) {
    const rows = await nav.getByRole("listitem").count();
    await nav.getByRole("button", { name: "New page" }).click();
    await expect(nav.getByRole("listitem")).toHaveCount(rows + 1);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Some words to count here.");
  }
  await nav.getByRole("button", { name: "Left", exact: true }).click();
  await nav.getByRole("button", { name: "Middle", exact: true }).click({ modifiers: ["Shift"] });
  await nav.getByRole("button", { name: "Right", exact: true }).click({ modifiers: ["Shift"] });
  const headers = page.locator("[data-pane-area] section header");
  await expect(headers).toHaveCount(3);
  for (const header of await headers.all()) {
    const title = header.locator("li").last().locator("span").last();
    expect(await title.evaluate((t) => t.scrollWidth <= t.clientWidth)).toBe(true);
    const edge = await header.locator("[aria-label=Counts]").evaluate((b) => b.parentElement!.getBoundingClientRect().right + 0.5);
    for (const count of await header.locator("[data-count]").all())
      if (await count.isVisible()) expect((await count.boundingBox())!.x + (await count.boundingBox())!.width).toBeLessThanOrEqual(edge);
  }
});

// Seam: a page's type against Settings › Writing › Use on. Catches the tools on records (a person)
// by default, or a ticked type that never reaches its open pages.
test("The writing tools follow the page's type", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "People" }).first().click();
  await page.getByRole("button", { name: "New person" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Ada");
  const card = page.getByRole("region", { name: "Ada", exact: true });
  await expect(card.getByRole("button", { name: "Counts" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Writing" })).toHaveCount(0);
  await page.keyboard.press("Meta+Comma");
  await page.getByTestId("settings-nav-writing").click();
  await page.getByRole("checkbox", { name: "People" }).click();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: "Writing" })).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Counts" })).toHaveCount(1);
});
