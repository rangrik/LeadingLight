import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["microphone"] });
const transcript = "Paint the porch. Ask Sam about colors.";
const review = (page: Page) => page.getByRole("dialog", { name: "Review transcript", exact: true });
const create = (page: Page) => page.getByRole("dialog", { name: "Create from recording", exact: true });
const records = (page: Page) => page.evaluate(async () => {
  const { objects } = await import(String("/src/lib/objects.ts"));
  return Promise.all((await objects.list()).map((p: any) => objects.get(p.id)));
});

// Seam: the link hint must match reports' existing plain-click navigation.
test("report source links still open with a plain click", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick capture", exact: true }).waitFor();
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const source = await createPage({ title: "Source note" });
    const report = await createPage({ title: "Recording report", typeId: "report", properties: { report: { by: "qa", session: "qa", to: source.id, at: Date.now(), command: "Review" } }, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Source recording", marks: [{ type: "link", attrs: { href: `ll:${source.id}` } }] }] }] } });
    openPage(report.id);
  });
  const link = page.getByRole("link", { name: "Source recording", exact: true });
  await link.hover();
  await expect(page.locator('[data-slot="tooltip-popup"]')).toHaveText("Click to open");
  await link.click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Source note");
});

async function record(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Voice source");
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
  await page.keyboard.type("/voice");
  await page.getByRole("option", { name: "Voice recording", exact: true }).click();
  await page.evaluate((text) => {
    (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "voiceRecording").options.assets.transcribe = async () => text;
  }, transcript);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(page.getByRole("button", { name: "Review transcript", exact: true })).toBeVisible();
}
async function selectAll(page: Page) {
  await page.getByRole("button", { name: "Review transcript", exact: true }).click();
  await review(page).getByRole("button", { name: "Use whole transcript" }).click();
  await review(page).getByRole("button", { name: "Create from selection" }).click();
}

// Seam: a copied passage must retain its recording, source link, and independent undo history.
test("a selected voice passage becomes a project task without consuming the transcript", async ({ page }) => {
  await record(page);
  const audio = await page.locator('[data-media="voice"] audio').getAttribute("src");
  const original = await page.evaluate(() => (window as any).__editor.getJSON());
  await page.getByRole("button", { name: "Review transcript", exact: true }).click();
  await expect(review(page).getByRole("button", { name: "Create from selection" })).toBeDisabled();
  const text = review(page).getByRole("textbox", { name: "Original transcript" });
  const points = await text.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = style.font;
    const x = box.left + parseFloat(style.paddingLeft);
    return { from: x + measure.measureText("Paint the porch. ").width, to: x + measure.measureText("Paint the porch. Ask Sam about colors").width, y: box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
  });
  await page.mouse.move(points.from, points.y);
  await page.mouse.down();
  await page.mouse.move(points.to, points.y, { steps: 10 });
  await page.mouse.up();
  await review(page).getByRole("button", { name: "Create from selection" }).click();
  await expect(create(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Ask Sam about");
  await create(page).getByRole("combobox", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "Task", exact: true }).click();
  await create(page).getByRole("textbox", { name: "Title", exact: true }).fill("Ask Sam");
  await create(page).getByRole("button", { name: "Project", exact: true }).click();
  await page.getByPlaceholder("Find or create a project").fill("House");
  await page.getByRole("button", { name: "Create project “House”", exact: true }).click();
  await create(page).getByRole("button", { name: "Create task", exact: true }).click();
  await expect(create(page)).toBeHidden();
  await expect(page.locator(".ll-page-link")).toContainText("Ask Sam");
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText(transcript);
  await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", audio!);
  const saved = await records(page);
  const task = saved.find((p: any) => p.typeId === "task");
  const source = saved.find((p: any) => p.title === "Voice source");
  expect(source.properties.captureInbox.kind).toBe("voice");
  expect(task.content.content[0].content[0].text).toBe("Ask Sam about colors");
  expect(task.properties["task-project"]).toEqual([saved.find((p: any) => p.title === "House").id]);
  expect(task.content.content[1].content[0].marks[0].attrs.href).toBe(`ll:${source.id}#voice-${original.content[0].attrs.recordingId}`);
  await page.keyboard.press("Meta+z");
  expect(await page.evaluate(() => (window as any).__editor.getJSON())).toEqual(original);
  expect((await records(page)).filter((p: any) => p.typeId === "task")).toHaveLength(1);
  await page.keyboard.press("Meta+Shift+z");
  await expect(page.locator(".ll-page-link")).toContainText("Ask Sam");
  await page.keyboard.press("Meta+s");
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Voice source", exact: true }).click();
  await page.locator(".ll-page-link").getByRole("button", { name: "Ask Sam", exact: true }).click();
  const sourceLink = page.getByRole("link", { name: "Source recording", exact: true });
  await sourceLink.hover();
  await expect(page.locator('[data-slot="tooltip-popup"]')).toHaveText(/(?:⌘|Ctrl)-click to open/);
  await sourceLink.click({ modifiers: ["Meta"] });
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Voice source");
  await expect(page.locator('[data-media="voice"]')).toBeInViewport();
  await page.getByRole("button", { name: "Review transcript", exact: true }).click();
  await expect(review(page).getByRole("textbox", { name: "Original transcript" })).toHaveValue(transcript);
  await page.screenshot({ path: "qa/report/voice-review.png" });
});

// Seam: capture's autosave must carry the original snapshot and recording id into the opened page.
test("Quick capture autostarts once and keeps the original transcript for page review", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick capture", exact: true }).click();
  const box = page.getByRole("dialog", { name: "New idea", exact: true });
  await box.getByRole("textbox", { name: "Idea", exact: true }).fill("Captured voice");
  await page.evaluate((text) => {
    (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "voiceRecording").options.assets.transcribe = async () => text;
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__microphoneStarts = 0;
    navigator.mediaDevices.getUserMedia = (...args) => { (window as any).__microphoneStarts++; return getMedia(...args); };
  }, transcript);
  await box.getByRole("button", { name: "Record a voice note", exact: true }).click();
  await expect(box.getByText(/Recording ·/)).toBeVisible();
  await page.waitForTimeout(1100);
  await box.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(box.getByRole("textbox", { name: "Notes" })).toContainText(transcript);
  expect(await page.evaluate(() => (window as any).__microphoneStarts)).toBe(1);
  await box.getByRole("textbox", { name: "Idea", exact: true }).press("Escape");
  await expect(box).toBeHidden();
  await expect.poll(async () => {
    const saved = (await records(page)).find((p: any) => p.title === "Captured voice");
    return saved?.content?.content?.find((n: any) => n.type === "voiceRecording")?.attrs.transcript;
  }).toBe(transcript);
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Captured voice", exact: true }).click();
  const audio = await page.locator('[data-media="voice"] audio').getAttribute("src");
  await page.getByRole("textbox", { name: "Page body" }).locator("p").filter({ hasText: transcript }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited later.");
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Edited later.");
  await page.getByRole("button", { name: "Review transcript", exact: true }).click();
  await expect(review(page).getByRole("textbox", { name: "Original transcript" })).toHaveValue(transcript);
  await review(page).getByRole("button", { name: "Use whole transcript" }).click();
  await review(page).getByRole("button", { name: "Create from selection" }).click();
  await create(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(create(page)).toBeHidden();
  await expect(page.locator('[data-media="voice"] audio')).toHaveAttribute("src", audio!);
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Edited later.");
  const ideas = (await records(page)).filter((p: any) => p.typeId === "idea");
  expect(ideas).toHaveLength(2);
  expect(ideas.find((p: any) => p.title === "Paint the porch.").content.content[0].content[0].text).toBe(transcript);
});

// Seam: cancellation and create retries must not lose the immutable source or duplicate a page.
test("whole transcript, cancellation, save failure, and duplicate clicks keep the source", async ({ page }) => {
  await record(page);
  await selectAll(page);
  await create(page).getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(0);
  await selectAll(page);
  await create(page).getByRole("textbox", { name: "Title", exact: true }).fill("");
  await page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const original = objects.create.bind(objects);
    let tries = 0;
    objects.create = async (init: any) => {
      if (init.typeId === "idea" && ++tries === 1) throw new Error("QA disk full");
      return original(init);
    };
  });
  await create(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(create(page).getByRole("alert")).toContainText("QA disk full");
  await create(page).getByRole("button", { name: "Create idea", exact: true }).dblclick();
  await expect(create(page)).toBeHidden();
  const ideas = (await records(page)).filter((p: any) => p.typeId === "idea");
  expect(ideas).toHaveLength(1);
  expect(ideas[0].title).toBe("Paint the porch.");
  expect(ideas[0].content.content[0].content[0].text).toBe(transcript);
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText(transcript);
});

// Seam: async dialogs must never write through a stale recording position.
test("source edits before and during creation cannot overwrite recording content", async ({ page }) => {
  await record(page);
  await selectAll(page);
  await page.evaluate(() => (window as any).__editor.commands.insertContentAt((window as any).__editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "New words" }] }));
  await create(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(create(page).getByRole("alert")).toContainText("source text changed");
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(0);
  await create(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await selectAll(page);
  await page.evaluate(async () => {
    const { objects } = await import(String("/src/lib/objects.ts"));
    const original = objects.create.bind(objects);
    objects.create = async (init: any) => {
      if (init.typeId === "idea") (window as any).__editor.commands.insertContentAt((window as any).__editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "During save" }] });
      return original(init);
    };
  });
  await create(page).getByRole("button", { name: "Create idea", exact: true }).click();
  await expect(create(page)).toBeHidden();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Voice source", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("During save");
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText(transcript);
  expect((await records(page)).filter((p: any) => p.typeId === "idea")).toHaveLength(1);
});
