import { expect, test } from "@playwright/test";

// Seam: the Work view and the runtime's worktree list (work-view.feature). Catches a row reading
// the wrong field, an agent matched to the wrong folder, and Remove reaching a worktree in use.
test("worktrees are listed as the runtime has them, and one in use is not removed", async ({ page }) => {
  const deleted: string[] = [];
  await page.addInitScript(() => localStorage.setItem("ll.projects", JSON.stringify({ enabled: true })));
  await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
  await page.route("**/__runtime/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/__runtime", "");
    if (route.request().method() === "DELETE") deleted.push(path + url.search);
    if (path === "/v1/worktrees")
      return route.fulfill({
        json: [
          { name: "My Project", path: "/tmp/My Project", branch: "main", main: true, changed: 0, untracked: 0, ahead: 0 },
          { name: "pricing-page", path: "/rt/My Project-pricing-page", branch: "ll/pricing-page", changed: 2, untracked: 1, ahead: 0 },
          { name: "spike", path: "/rt/My Project-spike", changed: 0, untracked: 0, ahead: 2 },
        ],
      });
    if (path === "/v1/sessions")
      return route.fulfill({
        json: [
          { name: "s1", dir: "/rt/My Project-pricing-page", agent: "codex", agent_state: "running", exited: false },
          { name: "s2", dir: "/rt/My Project-spike", agent: "claude", agent_state: "finished", exited: true },
        ],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/?mac");
  await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { folders } = await import(String("/src/lib/project-runtime/folders.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const project = await createPage({ title: "Research", typeId: "project" });
    folders.set(new Map([[project.id, { folder: { pageId: project.id, path: "/tmp/My Project", folderId: "f", location: "p-fixture", createdAt: 0, updatedAt: 0 }, missing: false, repo: true }]]));
    openPage(`work:${project.id}`);
  });
  const row = (name: string) => page.locator(`[data-worktree="${name}"]`);
  const alert = page.getByRole("alertdialog");
  await expect(row("pricing-page")).toContainText("ll/pricing-page");
  await expect(row("pricing-page")).toContainText("Codex · Working");
  await expect(row("pricing-page")).toContainText("3 files changed");
  await expect(row("spike")).toContainText("detached");
  await expect(row("spike")).toContainText("No agent");
  await expect(row("spike")).toContainText("No changes · 2 commits");
  await expect(row("My Project").getByRole("button", { name: "Remove" })).toHaveCount(0);
  await row("pricing-page").getByRole("button", { name: "Remove" }).click();
  await expect(alert).toContainText("Codex is at work in it.");
  await alert.getByRole("button", { name: "OK" }).click();
  await row("spike").getByRole("button", { name: "Remove" }).click();
  await alert.getByRole("button", { name: "Remove" }).click();
  await expect(alert).toBeHidden();
  expect(deleted).toEqual(["/v1/locations/p-fixture/worktrees/spike"]);
});
