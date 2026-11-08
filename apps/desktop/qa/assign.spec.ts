import { expect, test } from "@playwright/test";

// Seam: Assign on a page that isn't a task (assign.feature). Catches a second page made for it, its
// Project left under Ideas, a missing "From idea" tag, and the session started outside its worktree.
test("an idea assigned becomes the task, in a worktree of its own", async ({ page }) => {
  const posts: Record<string, { name: string; location?: string; prompt?: string; branch?: string }> = {};
  await page.addInitScript(() => localStorage.setItem("ll.projects", JSON.stringify({ enabled: true })));
  await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
  await page.route("**/__runtime/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/__runtime", "");
    if (req.method() === "POST") posts[path] = req.postDataJSON();
    const s = posts["/v1/sessions"];
    if (path === "/v1/locations") return route.fulfill({ json: [{ name: "p-fixture", path: "/tmp/My Project", repo: true, worktrees: [{ name: "My Project", main: true }, { name: "pricing-page" }] }] });
    if (path.endsWith("/worktrees")) return route.fulfill({ json: { name: posts[path].name } });
    if (path === "/v1/conversations" && s) return route.fulfill({ json: [{ id: "c1", session: s.name, location: s.location, live: true }] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/?mac");
  const { idea, project } = await page.evaluate(async () => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { folders } = await import(String("/src/lib/project-runtime/folders.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const project = await createPage({ title: "Research", typeId: "project" });
    folders.set(new Map([[project.id, { folder: { pageId: project.id, path: "/tmp/My Project", folderId: "f", location: "p-fixture", createdAt: 0, updatedAt: 0 }, missing: false, repo: true }]]));
    const idea = await createPage({ title: "Pricing page", typeId: "idea", properties: { "idea-project": [project.id] } });
    openPage(idea.id);
    return { idea: idea.id, project: project.id };
  });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This idea becomes a task and is given to the agent. Its words, links and history stay.");
  await expect(dialog.getByRole("combobox", { name: "Becomes" })).toHaveCount(0);
  await dialog.getByRole("switch", { name: "In its own worktree" }).click();
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("work-row")).toContainText("in pricing-page-2");
  const after = await page.evaluate(async (id) => {
    const { space } = await import(String("/src/lib/space.ts"));
    const pages = space.get().pages as { id: string; title: string; typeId: string; properties: Record<string, unknown> }[];
    const me = pages.find((p) => p.id === id)!;
    return { me, tasks: pages.filter((p) => p.typeId === "task").length, tags: (me.properties.tags as string[]).map((t) => pages.find((p) => p.id === t)?.title) };
  }, idea);
  expect(after.me.typeId).toBe("task");
  expect(after.me.properties["task-project"]).toEqual([project]);
  expect(after.me.properties["idea-project"]).toBeUndefined();
  expect(after.tags).toEqual(["From idea"]);
  expect(after.tasks).toBe(1);
  expect(posts["/v1/locations/p-fixture/worktrees"]).toEqual({ name: "pricing-page-2", branch: "ll/pricing-page-2" });
  expect(posts["/v1/sessions"].location).toBe("p-fixture/pricing-page-2");
  expect(posts["/v1/sessions"].prompt).toContain("never switch branches");
});
