import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const nav = (page: Page) => page.getByRole("navigation", { name: "Phone navigation" });
const capture = (page: Page) => page.getByRole("dialog", { name: "New idea" });
async function newNote(page: Page, title: string, text: string) {
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Page body" }).fill(text);
}

// Navigation must preserve the live editor and search must find locally saved body text.
test("phone home, offline writing, return and search", async ({ page, context, browserName }) => {
  await page.goto("/?iphone");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture a thought" })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "Bar", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await newNote(page, "Train", "Remember the headphones and charger");
  // Back at a page's first entry returns to the tab it came from.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search notes" })).toBeVisible();
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("Remember the headphones and charger");
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search notes" }).fill("headphones");
  await page.getByRole("button", { name: "Train Page" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("Remember the headphones and charger");
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search notes" }).fill("not in any note");
  await expect(page.getByText("No notes found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("button", { name: "Train Page" })).toBeVisible();
  await page.screenshot({ path: `qa/report/iphone-${browserName}-notes.png` });
  await page.getByRole("searchbox", { name: "Search notes" }).fill("headphones");
  await page.getByRole("button", { name: "Train Page" }).click();
  await page.getByRole("textbox", { name: "Page body" }).fill("Only the charger now");
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("No notes found", { exact: true })).toBeVisible();
});

// Hiding a zero-height editor resets WebKit's scroll position despite retaining its content.
test("Today and Continue keep the reading position in a long note", async ({ page }) => {
  await page.goto("/?iphone");
  await newNote(page, "Keep my place", "A long note");
  await page.evaluate(() => {
    const editor = Reflect.get(window, "__editor");
    editor.commands.setContent({ type: "doc", content: Array.from({ length: 300 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `Paragraph ${i}. Words to keep while moving between Today and this note.` }] })) });
    editor.commands.setTextSelection({ from: 12, to: 18 });
    editor.commands.blur();
  });
  const scroller = page.locator("[data-page-scroller]:visible");
  // Begin midway through the fixture; mobile WebKit has no wheel input.
  await scroller.evaluate((el) => { el.scrollTop = 2000; });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  await page.waitForTimeout(300);
  const before = await scroller.evaluate((el) => el.scrollTop);
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(before);
  expect(await page.evaluate(() => { const { from, to } = Reflect.get(window, "__editor").state.selection; return { from, to }; })).toEqual({ from: 12, to: 18 });
});

// Closing a capture must await its write; errors keep the same draft available for retry.
test("capture saves offline, survives dismissal, and retries a failed save", async ({ page, context, browserName }) => {
  await page.goto("/?iphone");
  await page.getByRole("button", { name: "Quick capture" }).click();
  await expect(capture(page).getByRole("button", { name: "Project", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("Bring my headphones");
  await capture(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture(page)).toBeHidden();
  await expect(page.getByRole("region", { name: "Recent captures" }).getByText("Bring my headphones", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quick capture" }).click();
  await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("An interrupted thought");
  await capture(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(capture(page)).toBeHidden();
  await context.setOffline(false);
  await page.evaluate(async () => {
    const path = "/src/lib/objects.ts";
    const { objects } = await import(/* @vite-ignore */ path);
    const original = objects.create;
    Object.assign(window, { restoreCreate: () => { objects.create = original; } });
    objects.create = async () => { throw new Error("Test: storage unavailable"); };
  });
  await page.getByRole("button", { name: "Quick capture" }).click();
  await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("Keep this draft");
  await capture(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture(page).getByRole("alert")).toContainText("Your words are still here");
  await capture(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(capture(page)).toBeVisible();
  await expect(capture(page).getByRole("textbox", { name: "Idea", exact: true })).toHaveValue("Keep this draft");
  await page.screenshot({ path: `qa/report/iphone-${browserName}-save-error.png` });
  await page.evaluate(() => Reflect.get(window, "restoreCreate")());
  await capture(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("region", { name: "Recent captures" }).getByText("Keep this draft", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: `qa/report/iphone-${browserName}-today.png` });
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Captures", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Captures", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "An interrupted thought", exact: true })).toBeVisible();
});

// A failed update must show its error and retry controls above the landscape keyboard.
test("failed capture update leaves Save reachable and retries the same idea", async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport });
  });
  await page.goto("/?iphone");
  await page.getByRole("button", { name: "Quick capture" }).click();
  await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("One idea, two edits");
  await expect(capture(page).getByText("Saved", { exact: true })).toHaveCSS("opacity", "1");
  await page.evaluate(async () => {
    const path = "/src/lib/objects.ts", { objects } = await import(/* @vite-ignore */ path);
    const original = objects.update;
    Object.assign(window, { restoreUpdate: () => { objects.update = original; } });
    objects.update = async () => { throw new Error("Test: update failed"); };
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 110, width: 844 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await capture(page).getByRole("textbox", { name: "Notes", exact: true }).fill("Keep the second edit too");
  await capture(page).getByRole("button", { name: "Save", exact: true }).tap();
  await expect(capture(page).getByRole("alert")).toBeVisible();
  await expect.poll(() => capture(page).evaluate((dialog) => {
    const error = dialog.querySelector("[role=alert]")!.getBoundingClientRect();
    const scroller = dialog.querySelector("[data-capture-scroller]")!.getBoundingClientRect();
    return error.top >= scroller.top && error.bottom <= Math.min(scroller.bottom, 110);
  })).toBe(true);
  for (const name of ["Save", "Close"]) {
    const bounds = (await capture(page).getByRole("button", { name, exact: true }).boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(110);
  }
  await page.evaluate(() => Reflect.get(window, "restoreUpdate")());
  await capture(page).getByRole("button", { name: "Save", exact: true }).tap();
  await expect(capture(page)).toBeHidden();
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 390 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("region", { name: "Recent captures" }).getByRole("button", { name: "One idea, two edits Idea" }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("Keep the second edit too");
  expect(await page.evaluate(async () => {
    const path = "/src/lib/objects.ts", { objects } = await import(/* @vite-ignore */ path);
    return (await objects.list()).filter((p: { title: string }) => p.title === "One idea, two edits").length;
  })).toBe(1);
});

// Visual viewport resizing is separate from orientation and must not hide capture actions.
test("small phone, keyboard, landscape, navigation and settings", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 667, width: 375, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport });
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/?iphone");
  await page.getByRole("button", { name: "Capture a thought" }).click();
  await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("A thought on a small phone");
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 320 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const save = capture(page).getByRole("button", { name: "Save", exact: true });
  await expect.poll(async () => { const box = await save.boundingBox(); return box!.y + box!.height; }).toBeLessThanOrEqual(320);
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `qa/report/iphone-${browserName}-keyboard.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 150, width: 844 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  for (const name of ["Save", "Close"]) {
    const box = await capture(page).getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(150);
  }
  await capture(page).getByRole("textbox", { name: "Notes", exact: true }).fill("Keep the words in landscape too");
  await capture(page).getByRole("button", { name: "Open note", exact: true }).click();
  await expect(capture(page)).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Page body" })).toHaveText("Keep the words in landscape too");
  await expect(page.locator("[data-pane]:visible")).toHaveCount(1);
  await expect(nav(page)).toBeHidden(); // the keyboard covers the tab bar
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 390, width: 844 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(nav(page)).toBeVisible();
  await expect(page.locator("[data-tab-row]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/iphone-${browserName}-landscape.png` });
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
});

// Device detection must work in production, without a development query flag.
test("iPhone user agent selects the phone shell and keeps links offline", async ({ browser, browserName }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(nav(page)).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const theme = page.getByRole("combobox", { name: "Theme in dark mode" });
    await expect(theme).toBeVisible();
    const bounds = await theme.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: `qa/report/iphone-${browserName}-settings.png` });
    await page.locator(".ll-settings").getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "Back to app" }).click();
    await page.getByRole("button", { name: "Quick capture" }).click();
    await context.setOffline(true);
    await capture(page).getByRole("textbox", { name: "Idea", exact: true }).fill("https://example.com/remember");
    await expect(capture(page).getByRole("radio", { name: "Link only", exact: true })).toBeChecked();
    await capture(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(capture(page)).toBeHidden();
    await expect(page.getByRole("region", { name: "Recent captures" })).toContainText("example.com");
  } finally { await context.close(); }
});

// A notched phone's last row must clear the floating tab bar, and the top bar must clear the notch.
test("the tab bar floats clear of the home indicator", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 520 });
  await page.goto("/?iphone");
  await page.evaluate(() => { const s = document.documentElement.style; s.setProperty("--ll-env-top", "47px"); s.setProperty("--ll-env-bottom", "34px"); });
  await nav(page).getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("main", { name: "Notes" }).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const sync = (await page.getByRole("button", { name: "Account and sync" }).boundingBox())!;
  const tab = (await nav(page).getByRole("button", { name: "Notes", exact: true }).boundingBox())!;
  expect(sync.y + sync.height).toBeLessThanOrEqual(tab.y);
  expect(tab.y + tab.height).toBeLessThanOrEqual(520 - 16);
  expect((await page.getByRole("button", { name: "Settings", exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(47);
});

// Pages opened from Today or Notes start a fresh history, so Back returns to the list, not an older note.
test("Back from a second page opened in Notes returns to Notes", async ({ page }) => {
  await page.goto("/?iphone");
  await newNote(page, "First", "One");
  await newNote(page, "Second", "Two");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search notes" })).toBeVisible();
});
