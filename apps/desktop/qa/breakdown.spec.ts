import { expect, type Page, test } from "@playwright/test";

type Seeded = { project: string; ids: Record<string, string> };

// A project linked to a folder, and pages made in the store, by title.
async function seed(page: Page, pages: { title: string; typeId: string; properties?: Record<string, unknown> }[]): Promise<Seeded> {
  await page.addInitScript(() => localStorage.setItem("ll.projects", JSON.stringify({ enabled: true })));
  await page.goto("/?mac");
  await expect(page.getByRole("navigation", { name: "Types" }).getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
  return page.evaluate(async (list) => {
    const { createPage } = await import(String("/src/lib/space.ts"));
    const { folders } = await import(String("/src/lib/project-runtime/folders.ts"));
    const project = (await createPage({ title: "Research", typeId: "project" })).id;
    folders.set(new Map([[project, { folder: { pageId: project, path: "/tmp/My Project", folderId: "f", location: "p-fixture", createdAt: 0, updatedAt: 0 }, missing: false, repo: false }]]));
    const ids: Record<string, string> = {};
    // "$Title" in a value is that page's id; "$project" the project's.
    const fill = (v: unknown): unknown => (Array.isArray(v) ? v.map((x) => (typeof x === "string" && x.startsWith("$") ? (x === "$project" ? project : ids[x.slice(1)]) : x)) : v);
    for (const p of list) ids[p.title] = (await createPage({ ...p, properties: Object.fromEntries(Object.entries(p.properties ?? {}).map(([k, v]) => [k, fill(v)])) })).id;
    return { project, ids };
  }, pages);
}

const open = (page: Page, id: string) => page.evaluate(async (id) => (await import(String("/src/lib/panes.ts"))).openPage(id), id);
const props = (page: Page, title: string) =>
  page.evaluate(async (title) => {
    const { space } = await import(String("/src/lib/space.ts"));
    return (space.get().pages as { title: string; properties: Record<string, unknown> }[]).find((p) => p.title === title)?.properties;
  }, title);

async function taskLine(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.type("/task");
  await page.keyboard.press("Enter");
  await page.keyboard.type(title);
  await expect(page.getByRole("option", { name: new RegExp(`New task “${title}”`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => props(page, title)).toBeTruthy();
}

// Seam: the page a task line makes (linkHost.create). Catches a subtask made without its parent or
// its Project, and a Project guessed for a page that has none.
test("a task line inside a task is its subtask, in its project; elsewhere it is neither", async ({ page }) => {
  const { project, ids } = await seed(page, [
    { title: "Pricing page", typeId: "task", properties: { "task-project": ["$project"] } },
    { title: "Notes", typeId: "page" },
  ]);
  await open(page, ids["Pricing page"]);
  await taskLine(page, "Copy");
  expect(await props(page, "Copy")).toMatchObject({ "subtask-of": [ids["Pricing page"]], "task-project": [project] });
  await expect(page.getByTestId("work-row").locator("[data-task]")).toHaveText([/Copy.*Not started/]);
  await open(page, ids.Notes);
  await taskLine(page, "Loose");
  const loose = await props(page, "Loose");
  expect(loose?.["subtask-of"]).toBeUndefined();
  expect(loose?.["task-project"]).toBeUndefined();
});

// Seam: startReady and the After rule. Catches a subtask started before what it waits on is done,
// one started twice, and a freed subtask that never becomes startable.
test("Start the ready ones starts what waits on nothing; done ones free the rest", async ({ page }) => {
  const sessions: { name: string; title: string; location: string }[] = [];
  await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
  await page.route("**/__runtime/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/__runtime", "");
    if (req.method() === "POST" && path === "/v1/sessions") sessions.push(req.postDataJSON());
    if (path === "/v1/conversations") return route.fulfill({ json: sessions.map((s, i) => ({ id: `c${i}`, session: s.name, location: s.location, live: true })) });
    return route.fulfill({ json: [] });
  });
  const { ids } = await seed(page, [
    { title: "Pricing page", typeId: "task", properties: { "task-project": ["$project"] } },
    { title: "Copy", typeId: "task", properties: { "subtask-of": ["$Pricing page"], "task-project": ["$project"] } },
    { title: "Layout", typeId: "task", properties: { "subtask-of": ["$Pricing page"], "task-project": ["$project"] } },
    { title: "Launch post", typeId: "task", properties: { "subtask-of": ["$Pricing page"], "task-project": ["$project"], after: ["$Copy", "$Layout"] } },
  ]);
  await open(page, ids["Pricing page"]);
  const card = page.getByTestId("work-row");
  const launch = card.locator(`[data-task="${ids["Launch post"]}"]`);
  await expect(launch).toContainText("after Copy, Layout");
  await card.getByRole("button", { name: "Start the ready ones" }).click();
  await expect.poll(() => sessions.map((s) => s.title).sort()).toEqual(["Copy", "Layout"]);
  await expect(card.getByRole("button", { name: "Start the ready ones" })).toBeHidden();
  await expect(launch).toContainText("Not started");
  await expect(launch.getByRole("button", { name: "Start" })).toHaveCount(0);
  await page.evaluate(async (done) => {
    const { editPage } = await import(String("/src/lib/live.ts"));
    for (const id of done) await editPage(id, { properties: (p: Record<string, unknown>) => ({ ...p, done: true }) });
  }, [ids.Copy, ids.Layout]);
  await expect(launch.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Start the ready ones" })).toBeVisible();
  expect(sessions).toHaveLength(2);
});
