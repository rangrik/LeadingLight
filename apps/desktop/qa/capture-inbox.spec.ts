import { expect, type Page, test } from "@playwright/test";

const inbox = (page: Page) => page.getByRole("region", { name: "Capture inbox", exact: true });
const row = (page: Page, title: string) => inbox(page).getByRole("row").filter({ has: page.getByRole("button", { name: title, exact: true }) });
async function openInbox(page: Page) {
  await page.getByRole("button", { name: "Capture inbox", exact: true }).click();
  await expect(inbox(page).getByRole("heading", { name: "Capture inbox" })).toBeVisible();
}
async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).waitFor();
  const id = await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep these words." }] }] };
    const tag = await createPage({ typeId: "tag", title: "in-the-middle" });
    const idea = await createPage({ typeId: "idea", title: "Garden lights", content, properties: { tags: [tag.id], custom: "kept" } });
    await createPage({ title: "Saved article", properties: { sourceUrl: "https://example.com", capturedAt: new Date().toISOString() }, content });
    await createPage({ title: "Voice note", content: { type: "doc", content: [{ type: "voiceRecording", attrs: { src: "data:audio/wav;base64,UklGRg==", name: "voice.wav" } }] } });
    await createPage({ typeId: "idea", title: "Ordinary idea", content });
    await createPage({ title: "Ordinary page", content });
    await createPage({ typeId: "project", title: "Garden" });
    return idea.id;
  });
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Garden lights", exact: true })).toBeVisible();
  return id;
}

// Seam: old/new capture sources must not copy pages or pull every idea into the queue.
test("Inbox includes captured material and keeps review state across undo and reload", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: /^New idea/ }).click();
  const capture = page.getByRole("dialog", { name: "New idea" });
  await capture.getByRole("textbox", { name: "Idea", exact: true }).fill("Quick thought");
  await capture.getByRole("textbox", { name: "Idea", exact: true }).press("Meta+Enter");
  await expect(capture).toBeHidden();
  await openInbox(page);
  for (const title of ["Garden lights", "Saved article", "Voice note", "Quick thought"]) await expect(row(page, title)).toBeVisible();
  for (const title of ["Ordinary idea", "Ordinary page"]) await expect(row(page, title)).toHaveCount(0);
  await row(page, "Garden lights").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(row(page, "Garden lights")).toHaveCount(0);
  await inbox(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row(page, "Garden lights")).toBeVisible();
  await row(page, "Garden lights").getByRole("button", { name: "Mark reviewed" }).click();
  await page.reload();
  await openInbox(page);
  await expect(row(page, "Garden lights")).toHaveCount(0);
  await inbox(page).getByRole("tab", { name: "Reviewed", exact: true }).click();
  await expect(row(page, "Garden lights")).toBeVisible();
  await row(page, "Garden lights").getByRole("button", { name: "Return to inbox" }).click();
  await inbox(page).getByRole("tab", { name: "To review" }).click();
  await expect(row(page, "Garden lights")).toBeVisible();
});

// Seam: metadata edits keep the original page's other properties and body across a reload.
test("Inbox assigns project and tags, including projects on saved webpages", async ({ page }) => {
  const id = await seed(page);
  await openInbox(page);
  const idea = row(page, "Garden lights");
  await idea.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Garden", exact: true }).click();
  await expect(idea.getByRole("button", { name: "Project", exact: true })).toContainText("Garden");
  await idea.getByRole("button", { name: "Add tag", exact: true }).click();
  await page.getByPlaceholder("Find or create a tag").fill("Outside");
  await page.getByRole("button", { name: "Create tag “Outside”" }).click();
  await expect(idea.getByRole("button", { name: "Outside", exact: true })).toBeVisible();
  await idea.locator('[data-slot="badge"]').filter({ has: page.getByRole("button", { name: "in-the-middle", exact: true }) }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(idea).toBeVisible();
  await row(page, "Saved article").getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Garden", exact: true }).click();
  await expect(row(page, "Saved article").getByRole("button", { name: "Project", exact: true })).toContainText("Garden");
  await page.reload();
  await openInbox(page);
  await expect(row(page, "Garden lights").getByRole("button", { name: "Project", exact: true })).toContainText("Garden");
  await expect(row(page, "Saved article").getByRole("button", { name: "Project", exact: true })).toContainText("Garden");
  const saved = await page.evaluate(async (id) => (await import(String("/src/lib/objects.ts"))).objects.get(id), id);
  expect(saved.properties.custom).toBe("kept");
  expect(saved.content.content[0].content[0].text).toBe("Keep these words.");
  await page.setViewportSize({ width: 520, height: 800 });
  await page.screenshot({ path: "qa/report/capture-inbox-narrow.png" });
  expect(await inbox(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

// Seam: a rejected write cannot remove a capture from its queue or discard its retry.
test("A failed review stays visible and can be retried", async ({ page }) => {
  await seed(page);
  await openInbox(page);
  await expect(row(page, "Voice note")).toBeVisible();
  await page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const update = objects.update;
    objects.update = async () => { objects.update = update; throw new Error("Storage unavailable. Try again."); };
  });
  await row(page, "Garden lights").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(row(page, "Garden lights").getByRole("alert")).toHaveText("Storage unavailable. Try again.");
  await row(page, "Garden lights").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(row(page, "Garden lights")).toHaveCount(0);
});

// Seam: inbox edits and an open editor's autosave must preserve each other.
test("Reviewing beside an open page keeps its words and empty states stay calm", async ({ page }) => {
  await page.goto("/");
  await openInbox(page);
  await expect(inbox(page).getByText("Nothing waiting here")).toBeVisible();
  await inbox(page).getByRole("tab", { name: "Reviewed", exact: true }).click();
  await expect(inbox(page).getByText("No reviewed captures yet")).toBeVisible();
  await seed(page);
  await openInbox(page);
  await row(page, "Garden lights").getByRole("button", { name: "Garden lights", exact: true }).click({ modifiers: ["Shift"] });
  const body = page.getByRole("region", { name: "Garden lights", exact: true }).getByRole("textbox", { name: "Page body" });
  await body.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" More words.");
  await row(page, "Garden lights").locator('[data-slot="badge"]').filter({ has: page.getByRole("button", { name: "in-the-middle", exact: true }) }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row(page, "Garden lights")).toBeVisible();
  await page.keyboard.press("Meta+s");
  await expect.poll(() => page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const found = (await objects.list()).find((item: any) => item.title === "Garden lights");
    const saved = await objects.get(found.id);
    return { captured: saved.properties.captureInbox?.kind, tags: saved.properties.tags };
  })).toEqual({ captured: "idea", tags: [] });
  await row(page, "Garden lights").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(body).toContainText("More words.");
  await expect(row(page, "Garden lights")).toHaveCount(0);
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Garden lights", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("More words.");
  await openInbox(page);
  await inbox(page).getByRole("tab", { name: "Reviewed", exact: true }).click();
  await expect(row(page, "Garden lights")).toBeVisible();
});
