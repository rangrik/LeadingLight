import { expect, test } from "@playwright/test";
import type { HistoryEntry } from "../src/lib/history-types";

// Seam: autosave, history and restore share one durable write; typing keeps its origin.
test("milestones restore without erasing history or attribution", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Launch notes");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("First draft");
  await page.getByRole("button", { name: "History and authorship" }).click();
  await page.getByRole("menuitem", { name: "Save milestone" }).click();
  await page.getByLabel("Milestone name").fill("Before review");
  await page.getByRole("button", { name: "Save milestone", exact: true }).click();
  await expect(page.getByRole("button", { name: /Before review/ })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Page body" });
  await body.fill("Reviewed draft");
  await page.waitForTimeout(750);
  await page.reload();
  await expect(body).toContainText("Reviewed draft");
  await page.getByRole("button", { name: "History and authorship" }).click();
  await page.getByRole("menuitem", { name: "Page history" }).click();
  await page.getByRole("button", { name: /Before review/ }).click();
  await expect(page.getByRole("textbox", { name: "Version preview" })).toContainText("First draft");
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByRole("button", { name: /Restored version/ })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(body).toContainText("First draft");
  await page.getByRole("button", { name: "History and authorship" }).click();
  await page.getByRole("menuitem", { name: "Inspect authorship" }).click();
  await expect(page.getByRole("dialog")).toContainText("You");
  await expect(page.getByRole("dialog")).toContainText("First draft");
  await page.screenshot({ path: "qa/report/authorship.png" });
});

// Seam: agent tools must flush the user first and never inherit the user's attribution.
test("an agent's words remain distinct after a human inserts text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Mixed authors");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("My opening.");
  await page.evaluate(async () => {
    const { focusedPage } = await import("/src/lib/" + "panes.ts");
    const { runTool } = await import("/src/lib/" + "note-tools.ts");
    const { action } = await import("/src/lib/" + "history-types.ts");
    await runTool(focusedPage(), "insert_text", { markdown: "Agent conclusion." }, action("Claude added conclusion", { kind: "agent", name: "Claude" }));
  });
  const body = page.getByRole("textbox", { name: "Page body" });
  await expect(body.locator('[data-origin="agent"]')).toContainText(["Agent conclusion."]);
  await body.press("ControlOrMeta+End");
  await page.keyboard.type(" My addition.");
  await expect(body.locator('[data-origin="agent"]')).toContainText(["Agent conclusion."]);
  await expect(body.locator('[data-origin="human"]')).toContainText(["My opening.", " My addition."]);
  await page.getByRole("button", { name: "History and authorship" }).click();
  await page.getByRole("menuitem", { name: "Page history" }).click();
  await expect(page.getByRole("button", { name: /Claude added conclusion/ })).toBeVisible();
});

// Seam: replacing a selected agent word must attribute every replacement character to the user.
test("replacing selected agent text credits all typed characters to me", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.evaluate(async () => {
    const { focusedPage } = await import("/src/lib/" + "panes.ts");
    const { runTool } = await import("/src/lib/" + "note-tools.ts");
    const { action } = await import("/src/lib/" + "history-types.ts");
    await runTool(focusedPage(), "insert_text", { markdown: "A useful first draft" }, action("Claude draft", { kind: "agent", name: "Claude" }));
  });
  const body = page.getByRole("textbox", { name: "Page body" });
  await body.press("ControlOrMeta+End");
  for (let i = 0; i < " first draft".length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.down("Shift");
  for (let i = 0; i < "useful".length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("useful");
  await page.keyboard.type("clear");
  await expect(body).toContainText("A clear first draft");
  await expect(body.locator('[data-origin="human"]')).toHaveText(["clear"]);
  await expect(body.locator('[data-origin="agent"]')).toHaveText(["A ", " first draft"]);
});

// Seam: deletion must flush pending edits before recording its reversible snapshot.
test("immediate deletion keeps the last typed words", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Last words before deletion");
  const restored = await page.evaluate(async () => {
    const { focusedPage } = await import("/src/lib/" + "panes.ts");
    const { removePage } = await import("/src/lib/" + "space.ts");
    const { objects, docText } = await import("/src/lib/" + "objects.ts");
    const { undoAction } = await import("/src/lib/" + "history.ts");
    const id = focusedPage(); await removePage(id);
    const deletion = (await objects.history()).find((entry: HistoryEntry) => entry.changes.some((c) => c.before?.id === id && !c.after));
    if (!deletion) throw new Error("Missing deletion history");
    await undoAction(deletion.action);
    return docText((await objects.get(id))?.content ?? null);
  });
  expect(restored).toBe("Last words before deletion");
});

// Seam: undoing a multi-page action is atomic and refuses any overlapping later edit.
test("complete action undo refuses newer work without changing another page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Recent" })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { objects } = await import("/src/lib/" + "objects.ts");
    const { commitAction, undoAction } = await import("/src/lib/" + "history.ts");
    const { action } = await import("/src/lib/" + "history-types.ts");
    const { newObject } = await import("/src/lib/" + "store.ts");
    const context = action("Made task and note", { kind: "agent", name: "Tail" });
    const a = newObject({ title: "Task" }), b = newObject({ title: "Note" });
    await commitAction([{ before: null, after: a }, { before: null, after: b }], context);
    await objects.update(a.id, { title: "My newer task" });
    let error = "";
    try { await undoAction(context.action); } catch (e) { error = String(e); }
    const preserved = [await objects.get(a.id), await objects.get(b.id)].map((p) => p?.title);
    const next = action("Made two pages", { kind: "agent", name: "Claude" });
    const c = newObject({ title: "One" }), d = newObject({ title: "Two" });
    await commitAction([{ before: null, after: c }, { before: null, after: d }], next);
    await undoAction(next.action);
    return { error, preserved, removed: [await objects.get(c.id), await objects.get(d.id)] };
  });
  expect(result.error).toContain("newer changes");
  expect(result.preserved).toEqual(["My newer task", "Note"]);
  expect(result.removed).toEqual([null, null]);
});

// Seam: undoing an agent turn must not erase human work between two tool calls.
test("an intervening human edit prevents whole-turn undo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Recent" })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { objects } = await import("/src/lib/" + "objects.ts");
    const { undoAction, milestone } = await import("/src/lib/" + "history.ts");
    const { action } = await import("/src/lib/" + "history-types.ts");
    const p = await objects.create({ title: "Start" });
    const turn = action("Agent turn", { kind: "agent", name: "Claude" });
    await objects.update(p.id, { title: "Agent first" }, turn);
    await objects.update(p.id, { title: "Human contribution" });
    await objects.update(p.id, { properties: { description: "Agent second" } }, turn);
    let error = "";
    try { await undoAction(turn.action); } catch (e) { error = String(e); }
    const kept = await objects.get(p.id);
    const next = action("Agent changed title", { kind: "agent", name: "Claude" });
    await objects.update(p.id, { title: "Later" }, next);
    await milestone(p.id, "Remember this");
    await undoAction(next.action);
    return { error, kept: kept?.title, afterMilestone: (await objects.get(p.id))?.title };
  });
  expect(result.error).toContain("newer changes between steps");
  expect(result.kept).toBe("Human contribution");
  expect(result.afterMilestone).toBe("Human contribution");
});
