import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Mermaid QA");
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
});

// Seam: Mermaid's asynchronous DOM rendering must not edit ProseMirror's source or history.
test("Mermaid insertion, editing, invalid source, undo and language changes", async ({ page }) => {
  await page.keyboard.type("/mermaid");
  await page.getByRole("option", { name: "Mermaid diagram" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Write a Mermaid" })).toBeVisible();
  await page.keyboard.insertText("flowchart LR; A[Draft] --> B[Published]");
  const diagram = page.getByRole("img", { name: "Mermaid diagram", exact: true });
  await expect(diagram).toContainText("Published");
  const code = page.locator(".ll-code code");
  await code.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("not a diagram");
  await expect(page.getByRole("status").filter({ hasText: "Couldn't render" })).toBeVisible();
  await expect(diagram).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(diagram).toContainText("Published");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(code).toHaveText("not a diagram");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("flowchart LR; A[Draft] --> B[Reviewed]");
  await expect(diagram).toContainText("Reviewed");
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Plain text", exact: true }).click();
  await expect(diagram).toHaveCount(0);
  await expect(code).toContainText("Reviewed");
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Mermaid", exact: true }).click();
  await expect(diagram).toContainText("Reviewed");
});

// Seam: folding source must keep the editable document and the rendered SVG intact.
test("Tall diagrams scroll and keep their preview when source is folded", async ({ page }) => {
  const source = "flowchart TD; " + Array.from({ length: 22 }, (_, i) => `N${i}[Step ${i}]`).join(" --> ");
  await page.keyboard.type("/mermaid");
  await page.getByRole("option", { name: "Mermaid diagram" }).click();
  await page.keyboard.insertText(source);
  const block = page.locator(".ll-code");
  const preview = block.locator(".ll-mermaid");
  const svg = preview.locator("svg");
  await expect(svg).toContainText("Step 21");
  const id = await svg.getAttribute("id");
  expect(await preview.evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight < innerHeight)).toBe(true);
  await preview.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const hide = block.getByRole("button", { name: "Hide source" });
  await expect(hide).toBeVisible();
  await hide.click();
  const code = block.locator("code");
  await expect(code).toBeHidden();
  await expect(svg).toHaveAttribute("id", id!);
  await block.getByRole("button", { name: "Show source" }).press("Enter");
  await expect(code).toBeVisible();
  await expect(code).toHaveText(source);
  await expect(svg).toHaveAttribute("id", id!);
});

// Seam: clipboard fences and saved JSON must keep their language and source, never preview markup.
test("Pasted Mermaid renders, copies, downloads and survives reopening", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi";
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", `\`\`\`mermaid\n${text}\n\`\`\``);
    document.querySelector('[role="textbox"][aria-label="Page body"]')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, source);
  await expect(page.getByRole("img", { name: "Mermaid diagram", exact: true })).toContainText("Hello");
  await page.locator(".ll-code").hover();
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download code", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("snippet.mmd");
  await page.getByRole("textbox", { name: "Title", exact: true }).click();
  await page.reload();
  await expect(page.locator(".ll-code code")).toHaveText(source);
  await expect(page.getByRole("img", { name: "Mermaid diagram", exact: true })).toContainText("Hello");
});

// Seam: agents parse Markdown separately from paste; all object types must use the same node view.
test("Agent-created Markdown renders across document types and round-trips", async ({ page }) => {
  const created = await page.evaluate(async () => {
    const { runTool } = await import("/src/lib/" + "note-tools.ts");
    const { space } = await import("/src/lib/" + "space.ts");
    await runTool("", "create_page", { title: "Generated diagram", markdown: "```mermaid\nflowchart LR; A[Automatic] --> B[Diagram]\n```" });
    return space.get().pages.find((p: any) => p.title === "Generated diagram")!.id;
  });
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: /Generated diagram/ }).click();
  await expect(page.getByRole("img", { name: "Mermaid diagram", exact: true })).toContainText("Automatic");
  const types = await page.evaluate(async () => {
    const { space, putType } = await import("/src/lib/" + "space.ts");
    const { NOTEBOOK_TYPE } = await import("/src/lib/" + "page-format.ts");
    await putType({ id: "custom-diagram-type", name: "Diagram note", plural: "Diagram notes", props: [], card: [], linkView: "line", createdAt: Date.now() });
    return space.get().types.map((t: any) => t.id).filter((id: string) => id !== NOTEBOOK_TYPE);
  });
  for (const typeId of types) {
    await page.evaluate(async ({ id, typeId }) => {
      const { editPage } = await import("/src/lib/" + "live.ts");
      await editPage(id, { typeId });
    }, { id: created, typeId });
    await expect(page.getByRole("img", { name: "Mermaid diagram", exact: true })).toContainText("Automatic");
  }
  const read = await page.evaluate(async (id) => {
    const { runTool } = await import("/src/lib/" + "note-tools.ts");
    return runTool(id, "read_page", {});
  }, created);
  expect(read.content[0].text).toContain("```mermaid\nflowchart LR; A[Automatic] --> B[Diagram]");
  expect(read.content[0].text).not.toContain("<svg");
});
