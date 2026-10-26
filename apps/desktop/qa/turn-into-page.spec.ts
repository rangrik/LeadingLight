import { expect, type Page, test } from "@playwright/test";

const source = (page: Page) => page.getByRole("region", { name: "Source", exact: true }).getByRole("textbox", { name: "Page body" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Turn into", exact: true });
const records = (page: Page) => page.evaluate(async () => {
  const { objects } = await import(String("/src/lib/objects.ts"));
  return Promise.all((await objects.list()).map((p: any) => objects.get(p.id)));
});
async function start(page: Page, text: string) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Source");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type(text);
}
async function selectEnd(page: Page, text: string) {
  for (let i = 0; i < text.length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Turn into", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function project(page: Page) {
  await dialog(page).getByRole("button", { name: "Project", exact: true }).click();
  await page.getByPlaceholder("Find or create a project").fill("House");
  await page.getByRole("button", { name: "Create project “House”", exact: true }).click();
}

// Seam: the source replacement, new record, and relation survive independently across undo and reload.
test("Selected words become an idea linked to a project, with undo and reload", async ({ page }) => {
  await start(page, "Before Build a quiet reading corner after.");
  for (let i = 0; i < " after.".length; i++) await page.keyboard.press("ArrowLeft");
  await selectEnd(page, "Build a quiet reading corner");
  await expect(dialog(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Build a quiet");
  await project(page);
  await dialog(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(source(page).locator(".node-mention")).toContainText("Build a quiet");
  await expect(source(page)).toContainText("Before ");
  await expect(source(page)).toContainText(" after.");
  const saved = await records(page);
  const idea = saved.find((p: any) => p.typeId === "idea");
  const house = saved.find((p: any) => p.title === "House");
  expect(idea.properties["idea-project"]).toEqual([house.id]);
  expect(idea.content.content).toMatchObject([{ type: "paragraph", content: [{ text: "Build a quiet reading corner" }] }]);
  await page.keyboard.press("Meta+z");
  await expect(source(page)).toHaveText("Before Build a quiet reading corner after.");
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(1);
  await page.keyboard.press("Meta+Shift+z");
  await expect(source(page).locator(".node-mention")).toContainText("Build a quiet");
  await page.keyboard.press("Meta+s");
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Source", exact: true }).click();
  await expect(source(page).locator(".node-mention")).toContainText("Build a quiet");
  const reloaded = (await records(page)).find((p: any) => p.id === idea.id);
  expect(reloaded.properties["idea-project"]).toEqual([house.id]);
  expect(reloaded.content).toEqual(idea.content);
});

// Seam: a multi-block slice must keep its rich schema, rather than flattening to the suggested title.
test("A task keeps selected paragraphs, bold text, and a list", async ({ page }) => {
  await start(page, "First ");
  await page.keyboard.press("Meta+b");
  await page.keyboard.type("bold words");
  await page.keyboard.press("Meta+b");
  await page.keyboard.type("\nSecond paragraph\n- List item");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await page.getByRole("button", { name: "Turn into", exact: true }).click();
  await dialog(page).getByRole("combobox", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "Task", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Title", exact: true }).fill("Plan the corner");
  await project(page);
  await dialog(page).getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  const saved = await records(page);
  const task = saved.find((p: any) => p.typeId === "task");
  expect(task.title).toBe("Plan the corner");
  expect(task.properties["task-project"]).toEqual([saved.find((p: any) => p.title === "House").id]);
  expect(task.content.content).toMatchObject([
    { type: "paragraph", content: [{ text: "First " }, { text: "bold words", marks: [{ type: "bold" }] }] },
    { type: "paragraph", content: [{ text: "Second paragraph" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ text: "List item" }] }] }] },
    { type: "paragraph" },
  ]);
});

// Seam: cancelling never writes; a custom type uses the same body path and empty-title fallback.
test("Cancel and Escape preserve the source, and custom types use a short fallback title", async ({ page }) => {
  await start(page, "  Quiet   corner");
  await page.evaluate(async () => {
    const { putType } = await import(String("/src/lib/space.ts"));
    await putType({ id: "concept", name: "Concept", plural: "Concepts", props: [], card: [], linkView: "line", createdAt: Date.now() });
  });
  for (const cancel of ["button", "escape"]) {
    await source(page).click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.press("Meta+Shift+ArrowUp");
    await page.getByRole("button", { name: "Turn into", exact: true }).click();
    if (cancel === "button") await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(await records(page)).toHaveLength(1);
    await expect(source(page)).toContainText("Quiet   corner");
  }
  await source(page).click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await page.getByRole("button", { name: "Turn into", exact: true }).click();
  await dialog(page).getByRole("combobox", { name: "Type", exact: true }).click();
  for (const excluded of ["Agent", "Report", "Feedback", "Daily note"]) await expect(page.getByRole("option", { name: excluded, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Concept", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Title", exact: true }).fill("");
  await dialog(page).getByRole("button", { name: "Create concept", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  const concept = (await records(page)).find((p: any) => p.typeId === "concept");
  expect(concept.title).toBe("Quiet corner");
  expect(JSON.stringify(concept.content)).toContain("Quiet   corner");
});

// Seam: storage failure and concurrent clicks must not replace text or create duplicate records.
test("A failed save keeps choices, and a double-clicked retry creates one page", async ({ page }) => {
  await start(page, "Keep these selected words");
  await selectEnd(page, "Keep these selected words");
  await dialog(page).getByRole("textbox", { name: "Title", exact: true }).fill("Retry title");
  await project(page);
  await page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const create = objects.create;
    let fail = true;
    objects.create = async (init: any) => {
      if (fail) { fail = false; throw new Error("Test disk full"); }
      await new Promise((resolve) => setTimeout(resolve, 250));
      return create(init);
    };
  });
  await dialog(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(dialog(page)).toContainText("Test disk full");
  await expect(dialog(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Retry title");
  await expect(dialog(page).getByRole("button", { name: "Project", exact: true })).toContainText("House");
  expect(await page.locator(".tiptap").textContent()).toBe("Keep these selected words");
  await dialog(page).getByRole("button", { name: "Create idea", exact: true }).dblclick();
  await expect(dialog(page)).toBeHidden();
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(1);
});

// Seam: a frozen selection must never replace unrelated words changed by another action.
test("Source changes before or during saving do not replace unrelated text", async ({ page }) => {
  await start(page, "Original selected words");
  await selectEnd(page, "Original selected words");
  await page.evaluate(() => (window as any).__editor.commands.setContent("<p>Changed source</p>"));
  await dialog(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(dialog(page)).toContainText(/select.*again/i);
  expect(await records(page)).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await source(page).click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await page.getByRole("button", { name: "Turn into", exact: true }).click();
  await page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const create = objects.create;
    objects.create = async (init: any) => {
      const saved = await create(init);
      (window as any).__editor.commands.setContent("<p>Changed during save</p>");
      return saved;
    };
  });
  await dialog(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Source", exact: true }).click();
  await expect(source(page)).toHaveText("Changed during save");
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(1);
  await expect(source(page).locator(".node-mention")).toHaveCount(0);
});

// Seam: report annotations allow selecting words, but must not expose a content-changing action.
test("A report selection does not offer Turn into", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { showOnly } = await import(String("/src/lib/panes.ts"));
    const p = await createPage({ title: "Report", typeId: "report", properties: { report: { by: "missing", session: "qa", to: "missing", at: Date.now(), command: "qa" } }, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Read these words" }] }] } });
    showOnly(p.id);
  });
  await page.getByRole("textbox", { name: "Page body" }).locator("p").first().click({ clickCount: 3 });
  await expect(page.getByRole("toolbar", { name: "Text formatting", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn into", exact: true })).toHaveCount(0);
});
