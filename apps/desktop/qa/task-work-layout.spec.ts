import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1100, height: 720 } });

// Seam: a task's status must fit beside native-sized chat controls in a narrow split pane.
for (const size of [13, 14]) {
  test(`task status and actions fit a narrow split at text size ${size}`, async ({ page }, info) => {
    await page.addInitScript((uiFontSize) => {
      localStorage.setItem("ll.sidebar.width", "400");
      localStorage.setItem("berth.prefs", JSON.stringify({ version: 4, uiFontSize }));
      localStorage.setItem("berth.ui", JSON.stringify({ themeId: "berth-dark" }));
    }, size);
    await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
    await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
    await page.goto("/?mac");
    await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { createPage } = await import(String("/src/lib/space.ts"));
      const { openPage } = await import(String("/src/lib/panes.ts"));
      const task = await createPage({ title: "Review layout fixture", typeId: "task" });
      const agent = await createPage({ title: "Claude: Review layout fixture", typeId: "agent", properties: {
        "agent-task": [task.id], run: { conversation: "fixture", session: "fixture", location: "fixture", agent: "claude" },
      } });
      await createPage({ title: "Layout report", typeId: "report", properties: {
        parent: task.id, report: { by: agent.id, session: "fixture", to: task.id, at: Date.now(), command: "fixture", ready: true },
      } });
      await createPage({ title: "Other fixture" });
      openPage(task.id);
    });
    await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Other fixture", exact: true }).click({ modifiers: ["Shift"] });
    const pane = page.getByRole("region", { name: "Review layout fixture", exact: true });
    await expect(pane.getByRole("combobox", { name: "Type", exact: true })).toHaveText("Task");
    const card = pane.getByTestId("work-row");
    const status = card.locator('[data-state="review"]');
    await expect(status).toHaveText("Ready for review");
    for (const width of [1080, 1100, 1180, 1600]) {
      await page.setViewportSize({ width, height: 720 });
      if (width === 1080) {
        await pane.screenshot({ path: info.outputPath("narrow-task-card.png") });
        await info.attach("narrow-task-geometry", { contentType: "application/json", body: JSON.stringify({
          pane: await pane.boundingBox(),
          agent: await card.getByRole("button", { name: "Claude: Review layout fixture", exact: true }).boundingBox(),
          status: await status.boundingBox(),
          chat: await card.getByRole("button", { name: "Chat", exact: true }).boundingBox(),
        }) });
      }
      await expect.poll(async () => {
        const a = (await status.boundingBox())!;
        const b = (await card.getByRole("button", { name: "Chat", exact: true }).boundingBox())!;
        return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
          && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
      }).toBe(false);
      expect((await card.getByRole("button", { name: "Claude: Review layout fixture", exact: true }).boundingBox())!.width).toBeGreaterThan(20);
      expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      await card.getByRole("button", { name: "Chat", exact: true }).click({ trial: true });
      await card.getByRole("button", { name: "Accept", exact: true }).click({ trial: true });
    }
    await card.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(card.locator('[data-state="done"]')).toHaveText("Done");
  });
}
