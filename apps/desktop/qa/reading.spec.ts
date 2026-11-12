import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["microphone"] });

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
async function create(page: Page, query = "") {
  await page.goto(`/${query}`);
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Reading test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
}

// Seam: ending a thought must leave the parent's anchor intact and put subsequent keys in its page.
test("finish a sidenote by keyboard and touch, preserving the thought on reload", async ({ page }) => {
  await create(page);
  const body = page.getByRole("textbox", { name: "Page body" });
  await page.keyboard.type("A passage from a book.");
  await page.keyboard.press("Meta+Shift+m");
  const note = page.getByRole("textbox", { name: "Sidenote 1", exact: true });
  await expect(note).toBeFocused();
  await note.fill("A thought worth keeping.");
  await note.press("Meta+Enter");
  await expect(body).toBeFocused();
  await page.keyboard.type(" More reading.");
  await expect(body.locator("[data-note]")).toHaveText("A passage from a book.");
  await expect(note).toHaveText("A thought worth keeping.");
  await note.click();
  await page.getByRole("button", { name: "Finish sidenote" }).click();
  await expect(body).toBeFocused();
  await page.keyboard.press("Meta+s");
  await page.reload();
  await expect(note).toHaveText("A thought worth keeping.");
  await page.screenshot({ path: "qa/report/reading-sidenote.png" });
});

// Seam: one action starts one take, and finishing it saves audio before inserting undoable text.
test.describe("quick recording", () => {

  test("one click starts, the shortcut stops, and transcript undo keeps audio", async ({ page }) => {
    await create(page);
    await page.evaluate(() => {
      (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "voiceRecording").options.assets.transcribe = async () => "My spoken reading note.";
    });
    await page.getByRole("button", { name: "Quick record", exact: true }).click();
    await expect(page.getByText(/Recording ·/)).toBeVisible();
    await page.waitForTimeout(1100);
    await page.keyboard.press("Meta+Shift+r");
    await expect(page.locator('[data-media="voice"] audio')).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("My spoken reading note.");
    await page.evaluate(() => (window as any).__editor.commands.undo());
    await expect(page.locator('[data-media="voice"] audio')).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Page body" })).not.toContainText("My spoken reading note.");
  });
});

// Seam: a toolbar retry must reuse an unsaved take rather than hide it behind another recorder.
test("quick record retries a failed paper save before starting another take", async ({ page }) => {
  await create(page);
  await page.evaluate(() => {
    const assets = (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "voiceRecording").options.assets;
    const put = assets.put.bind(assets);
    let attempts = 0;
    assets.put = async (file: File) => { if (attempts++ === 0) throw new Error("Disk unavailable"); return put(file); };
    assets.transcribe = async () => "Keep this take.";
  });
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "New linked notebook" }).click();
  await page.getByRole("button", { name: "Quick record", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save recording" })).toBeVisible();
  await page.getByRole("button", { name: "Quick record", exact: true }).click();
  await expect(page.locator("[data-paper-item] audio")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Paper text", exact: true })).toHaveValue("Keep this take.");
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-paper-item] audio")).toHaveCount(1);
});

test.describe("touch paper", () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });
  // Seam: a touch's compatibility mouse event must not blur and discard the note it just placed.
  test("placing text near the margin keeps keyboard focus", async ({ page }) => {
    await create(page, "?ipad");
    await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "New linked notebook", exact: true }).click();
  await page.getByRole("button", { name: "Text box" }).click();
    await expect(page.getByRole("button", { name: "Text box" })).toHaveAttribute("aria-pressed", "true");
    const sheet = (await page.locator("[data-paper-surface]").boundingBox())!;
    await page.touchscreen.tap(sheet.x + 100 * sheet.width / 900, sheet.y + 300 * sheet.width / 900);
    const text = page.getByRole("textbox", { name: "Paper text", exact: true });
    await expect(text).toBeFocused();
    await page.keyboard.type("A note placed by touch.");
    await expect(text).toHaveValue("A note placed by touch.");
  });
});

// Seam: a pane's toolbar must not retain the previous page's recording state.
test("switching pages resets the recording controls", async ({ page }) => {
  await create(page);
  await page.getByRole("button", { name: "Quick record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Another page");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(page.getByRole("button", { name: "Quick record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Quick record", exact: true }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

// Seam: legacy ink assets stay editable; stale OCR must not change a replacement.
test("legacy handwriting keeps editable strokes and OCR ignores a replaced image", async ({ page }) => {
  await create(page, "?ipad");
  await page.evaluate((src) => {
    const assets = (window as any).__editor.extensionManager.extensions.find((e: any) => e.name === "image").options.assets;
    assets.capture = async () => ({ image: { url: src, name: "Ink.png", mime: "image/png", size: 20 }, drawing: { url: "data:application/octet-stream;base64,AQID", name: "Ink.drawing", mime: "application/octet-stream", size: 3 } });
    assets.recognizeText = () => new Promise((resolve) => { (window as any).__resolveOCR = resolve; });
  }, png);
  await page.evaluate(async () => {
    const editor = (window as any).__editor;
    const assets = editor.extensionManager.extensions.find((e: any) => e.name === "image").options.assets;
    const result = await assets.capture("drawing");
    editor.commands.insertContent({ type: "image", attrs: { src: result.image.url, name: result.image.name, mime: result.image.mime, size: result.image.size, drawing: result.drawing } });
  });
  await expect(page.locator('[data-media="image"] img')).toBeVisible();
  await page.locator('[data-media="image"] img').click();
  await expect(page.getByRole("button", { name: "Edit handwriting" })).toBeVisible();
  await page.getByRole("button", { name: "Extract text" }).click();
  await page.evaluate(() => {
    const editor = (window as any).__editor;
    editor.state.doc.descendants((node: any, pos: number) => { if (node.type.name === "image") editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: node.attrs.src + "#replaced" })); });
    (window as any).__resolveOCR("This belongs to the old image");
  });
  await expect(page.getByRole("textbox", { name: "Page body" })).not.toContainText("This belongs to the old image");
  await page.keyboard.press("Meta+s");
  await page.reload();
  await expect(page.locator('[data-media="image"] img')).toBeVisible();
  const ink = await page.evaluate(() => (window as any).__editor.getJSON().content.find((node: any) => node.type === "image").attrs.drawing);
  expect(ink.url).toBe("data:application/octet-stream;base64,AQID");
});

// Seam: theme selection and the reading toolbar must share one state, including after reload.
test("e-ink survives reload and EPUB chapters use ordinary sidenotes", async ({ page }) => {
  await create(page);
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitemcheckbox", { name: "E-ink appearance", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-eink", "");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-eink", "");
  await page.keyboard.press("Meta+,");
  await page.getByTestId("settings-nav-appearance").click();
  await page.locator('[data-testid="theme-option"][data-theme-id="berth-dark"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-eink");
  await expect(page.getByRole("switch", { name: "E-ink appearance" })).not.toBeChecked();
  await page.locator('[data-testid="theme-option"][data-theme-id="e-ink"]').click();
  await expect(page.getByRole("switch", { name: "E-ink appearance" })).toBeChecked();
  await page.getByRole("switch", { name: "E-ink appearance" }).click();
  await expect(page.locator('[data-testid="theme-option"][data-theme-id="berth-dark"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("switch", { name: "E-ink appearance" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Import a book", exact: true }).click();
  const files = {
    "mimetype": strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    "book.opf": strToU8('<package><manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'),
    "chapter.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>A small book</h1><p>Words to think about.</p><script>window.bookScriptRan=true</script><img src="https://example.invalid/tracker.png"/></body></html>'),
  };
  await page.getByLabel("Book file").setInputFiles({ name: "Sample.epub", mimeType: "application/epub+zip", buffer: Buffer.from(zipSync(files)) });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Sample");
  await page.locator('.ll-page-link').getByText('A small book', { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Words to think about.");
  await page.getByRole("textbox", { name: "Page body" }).locator("p").last().click();
  await page.keyboard.press("Meta+Shift+m");
  await page.getByRole("textbox", { name: "Sidenote 1", exact: true }).fill("My annotation.");
  await page.getByRole("textbox", { name: "Sidenote 1", exact: true }).press("Meta+Enter");
  expect(await page.evaluate(() => (window as any).bookScriptRan)).toBeUndefined();
  await page.screenshot({ path: "qa/report/reading-eink.png" });
});

// Seam: real PDF bytes must become annotatable text while a scan remains recoverable as an image.
test("PDF import keeps text, page numbers and a scanned page", async ({ page }) => {
  await create(page);
  const commands = "BT /F1 18 Tf 72 720 Td (A printed passage for annotation.) Tj ET";
  const blank = "0.8 g 72 72 200 200 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R >>",
    `<< /Length ${blank.length} >>\nstream\n${blank}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Import a book", exact: true }).click();
  await page.getByLabel("Book file").setInputFiles({ name: "Printed book.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Printed book");
  await page.locator(".ll-page-link").getByText("Pages 1–2", { exact: true }).click();
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body).toContainText("A printed passage for annotation.");
  await expect(body.locator("h2")).toHaveText(["Page 1", "Page 2"]);
  await expect(body.locator('[data-media="image"] img')).toBeVisible();
  await page.screenshot({ path: "qa/report/reading-pdf.png" });
});

// Seam: paper layout and editable text survive reload without becoming an image block.
test("whole-page paper keeps placed text and preserves earlier notes", async ({ page }) => {
  await create(page, "?ipad");
  await page.getByRole("textbox", { name: "Page body" }).fill("Earlier document words.");
  await page.keyboard.press("Meta+s");
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "New linked notebook", exact: true }).click();
  await page.getByRole("button", { name: "Text box" }).click();
  const surface = page.locator("[data-paper-surface]");
  await expect(surface).toBeVisible();
  await surface.click({ position: { x: 100, y: 160 } });
  const text = page.getByRole("textbox", { name: "Paper text", exact: true });
  await text.fill("A typed thought between handwritten passages.");
  await text.press("Meta+Enter");
  await expect(page.locator('[data-media="image"]')).toHaveCount(0);
  await page.reload();
  await expect(text).toHaveValue("A typed thought between handwritten passages.");
  await text.click();
  const item = page.locator("[data-paper-item]").first();
  const before = await item.boundingBox();
  const handle = await item.boundingBox();
  await page.mouse.move(handle!.x + 20, handle!.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 70, handle!.y + 80, { steps: 5 });
  await page.mouse.up();
  const after = await item.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 40);
  expect(after!.y).toBeGreaterThan(before!.y + 50);
  await page.keyboard.press("Meta+s");
  await page.reload();
  await expect(text).toHaveValue("A typed thought between handwritten passages.");
  expect((await item.boundingBox())!.x).toBeCloseTo(after!.x, 0);
  await page.screenshot({ path: "qa/report/reading-paper.png" });
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page.getByRole("menuitem", { name: "Back to Reading test", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page body" })).toContainText("Earlier document words.");
});
