import { expect, test } from "@playwright/test";

// Seam: the Projects group reads each project's Feed items and task states, and the Library folds
// once a project exists. Catches a count or dot that never shows, and a Library that starts hidden.
test("a project's row says what needs you and unfolds to its work", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
  await page.route("**/__runtime/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/?mac");
  const library = page.getByRole("navigation", { name: "Library" }).getByRole("button", { name: "Library" });
  await expect(library).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { folders } = await import(String("/src/lib/project-runtime/folders.ts"));
    const project = (await createPage({ title: "Research", typeId: "project" })).id;
    folders.set(new Map([[project, { folder: { pageId: project, path: "/tmp/r", folderId: "f", location: "p-fixture", createdAt: 0, updatedAt: 0 }, missing: false, repo: false }]]));
    const task = (await createPage({ title: "Survey the field", typeId: "task", properties: { "task-project": [project] } })).id;
    const run = { conversation: "c", session: "s", location: "p-fixture", agent: "claude" };
    const agent = (await createPage({ title: "Claude: Survey the field", typeId: "agent", properties: { "agent-task": [task], run } })).id;
    await createPage({ title: "Survey", typeId: "report", properties: { parent: task, report: { by: agent, session: "s", to: task, at: Date.now(), command: "x", ready: true } } });
  });
  const row = page.getByRole("navigation", { name: "Projects" }).getByRole("listitem").first();
  await expect(row.getByRole("button", { name: "Research 1 need you" })).toBeVisible();
  await expect(row.locator("[data-state-dot=review]")).toBeVisible();
  await page.getByRole("button", { name: "Expand Research" }).click();
  await expect(row.getByRole("button", { name: "Survey the field" })).toBeVisible();
  // It never folds under the pointer; it starts folded on the next launch.
  await expect(library).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Collapse Research" })).toBeVisible();
  await expect(library).toHaveAttribute("aria-expanded", "false");
});
