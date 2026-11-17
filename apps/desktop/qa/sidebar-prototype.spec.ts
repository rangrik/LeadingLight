import { test, expect } from "@playwright/test";

// Seams: sidebar mode versus pane selection, and editor state across navigation.
test.beforeEach(async ({ page }) => { await page.goto("/sidebar-prototype.html"); });

test("sidebar modes preserve writing while notes and browser share a split", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await test.step("Start with curated notes and switch modes by shortcut", async () => {
    await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Trip to Kyoto");
    await expect(page.getByText("Recent", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Alt+Meta+b");
    await expect(page.getByRole("radio", { name: "Browser", exact: true })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Trip to Kyoto");
  });
  await test.step("Shift-click a browser tab beside the note and write", async () => {
    await page.getByLabel("Browser tabs", { exact: true }).getByRole("button", { name: "Kyoto city guide", exact: true }).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("pane-right").getByRole("heading", { name: "A quieter side of Kyoto" })).toBeVisible();
    const body = page.getByRole("textbox", { name: "Page body" });
    await body.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("Save time for a walk by the river.");
    await page.getByLabel("Browser tabs", { exact: true }).getByRole("button", { name: "Tokyo to Kyoto by train", exact: true }).click();
    await expect(page.getByTestId("pane-right").getByRole("heading", { name: "Tokyo → Kyoto" })).toBeVisible();
    await expect(body).toContainText("Save time for a walk by the river.");
  });
  await test.step("Switch notes without losing the research pane, then restore the edited note", async () => {
    await page.getByRole("radio", { name: "Notes", exact: true }).check();
    await page.getByLabel("Notes", { exact: true }).getByRole("button", { name: "Reading list", exact: true }).click();
    await expect(page.getByTestId("pane-right").getByRole("heading", { name: "Tokyo → Kyoto" })).toBeVisible();
    await page.getByLabel("Notes", { exact: true }).getByRole("button", { name: "Trip to Kyoto", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Save time for a walk by the river.");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Save time for a walk by the river.");
    await expect(page.getByTestId("pane-right").getByRole("heading", { name: "Tokyo → Kyoto" })).toBeVisible();
    await page.screenshot({ path: "qa/report/sidebar-prototype-split.png" });
    expect(errors).toEqual([]);
  });
});

test("sidebar gestures ignore vertical scroll and pinch and latch one swipe", async ({ page }) => {
  const region = page.getByTestId("sidebar-gesture");
  await region.hover();
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(20, 40);
  await region.dispatchEvent("wheel", { deltaX: 150, deltaY: 0, ctrlKey: true });
  await expect(page.getByRole("radio", { name: "Notes", exact: true })).toBeChecked();
  // Dispatch a continuous burst together so test instrumentation cannot create a pause.
  await region.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaX: 90, bubbles: true, cancelable: true }));
    el.dispatchEvent(new WheelEvent("wheel", { deltaX: -120, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("radio", { name: "Browser", exact: true })).toBeChecked();
  // A new gesture begins after wheel events have stopped, as on a trackpad.
  await page.waitForTimeout(300);
  await page.mouse.wheel(-90, 0);
  await expect(page.getByRole("radio", { name: "Notes", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Trip to Kyoto");
});

test("open beside menu, pointer and keyboard resize, and either pane can close", async ({ page }) => {
  await page.getByRole("radio", { name: "Browser", exact: true }).check();
  const row = page.getByLabel("Browser tabs", { exact: true }).getByRole("listitem").filter({ hasText: "Kyoto city guide" });
  await row.hover();
  await row.getByRole("button", { name: "Actions for Kyoto city guide" }).click();
  await page.getByRole("menuitem", { name: "Open beside", exact: true }).click();
  const divider = page.getByRole("separator", { name: "Resize panes" });
  await divider.focus(); await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "52");
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 70, box.y + 100); await page.mouse.up();
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(55);
  await page.getByRole("button", { name: "Close left pane" }).click();
  await expect(page.getByTestId("pane-left")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A quieter side of Kyoto" })).toBeVisible();
  await page.getByRole("button", { name: "Open split view" }).click();
  await page.getByRole("button", { name: "Close right pane" }).click();
  await expect(page.getByRole("heading", { name: "A quieter side of Kyoto" })).toBeVisible();
});

test("create and pin a note, filter the library, and reset isolated data", async ({ page }) => {
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Page title" }).fill("Coffee in Kyoto");
  await page.getByRole("textbox", { name: "Page body" }).fill("Try the little place by the river.");
  await page.getByRole("button", { name: "Pin page", exact: true }).click();
  await page.getByRole("textbox", { name: "Search notes" }).fill("Coffee");
  await expect(page.getByLabel("Notes", { exact: true }).getByRole("button", { name: "Coffee in Kyoto", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search notes" }).fill("nothing-matches");
  await expect(page.getByText("Nothing matches this search.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search notes" }).clear();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Books", exact: true }).click();
  await page.getByRole("button", { name: "The Dispossessed", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("The Dispossessed");
  await page.getByRole("button", { name: "Settings & account" }).click();
  await page.getByRole("menuitem", { name: "Reset sample workspace" }).click();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Trip to Kyoto");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => !key.startsWith("ll.sidebar-prototype."))).toEqual([]);
});

test("sample browser history, unknown address, and last tab recovery", async ({ page }) => {
  const contacted: string[] = [];
  page.on("request", (request) => { if (/\.example\b/.test(request.url())) contacted.push(request.url()); });
  await page.getByRole("button", { name: "Open split view" }).click();
  await page.getByRole("button", { name: "Plan the train journey" }).click();
  await expect(page.getByRole("heading", { name: "Tokyo → Kyoto" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A quieter side of Kyoto" })).toBeVisible();
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await page.getByRole("textbox", { name: "Website address" }).fill("https://unavailable.example");
  await page.getByRole("textbox", { name: "Website address" }).press("Enter");
  await expect(page.getByText("The address you entered has not been contacted.", { exact: false })).toBeVisible();
  await page.getByRole("radio", { name: "Browser", exact: true }).check();
  while (await page.getByLabel("Browser tabs", { exact: true }).getByRole("listitem").count()) {
    const row = page.getByLabel("Browser tabs", { exact: true }).getByRole("listitem").first();
    await row.hover(); await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Close tab", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "A fresh tab" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a sample site" }).click();
  await page.getByRole("button", { name: /The reading room/ }).click();
  await expect(page.getByRole("heading", { name: "Make room for a good book" })).toBeVisible();
  expect(contacted).toEqual([]);
});
