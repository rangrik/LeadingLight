import { expect, type Page, test } from "@playwright/test";

async function archivedChat(page: Page, agent: string, exited = false, missing = false) {
  const writes: string[] = [];
  let reads = 0;
  await page.addInitScript(() => localStorage.setItem("ll.ai", JSON.stringify({ tail: { mode: "off" } })));
  await page.route("**/api/**", (route) => route.fulfill({ json: { ready: false, providers: [] } }));
  await page.route("**/__runtime/**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/__runtime", "");
    if (req.method() !== "GET") {
      writes.push(`${req.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: "History fixture is read-only" } });
    }
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/v1/locations") return json([{ name: "history", path: "/tmp/history-fixture", folder_id: "fixture-folder" }]);
    if (path === "/v1/conversations") return json([{ id: "archived", agent, location: "history", dir: "/tmp/history-fixture", session: "removed-session", live: false, title: "Saved conversation", created: "2026-11-01T00:00:00Z" }]);
    if (path === "/v1/sessions") return json(exited ? [{ name: "removed-session", agent, exited: true, agent_state: "finished" }] : []);
    if (path === "/v1/sessions/removed-session/transcript") return json({ source: "none", items: [], next: 0 });
    if (path === "/v1/conversations/archived/transcript") {
      reads++;
      if (missing) return route.fulfill({ status: 404, json: { error: "The saved conversation record is missing." } });
      return json({ source: agent, next: 2, gen: "archive-1", items: url.searchParams.get("since") === "2" ? [] : [
        { kind: "user", id: "u1", text: "What did the fixture check?" },
        { kind: "text", id: "a1", text: "The saved local answer remains readable." },
      ] });
    }
    if (/\/(turns|requests|notify|outputs)$/.test(path)) return json([]);
    if (path === "/v1/events") return route.fulfill({ status: 200, body: "" });
    return route.fulfill({ status: 404, json: { error: "Unused fixture route" } });
  });
  await page.goto("/?mac");
  await expect(page.getByRole("navigation", { name: "Library" }).getByRole("button", { name: "Projects", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { createPage, chatView } = await import(String("/src/lib/space.ts"));
    const { objects } = await import(String("/src/lib/objects.ts"));
    const { projectPrefs } = await import(String("/src/lib/project-runtime/prefs.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    const project = await createPage({ id: "history-project", title: "History fixture", typeId: "project" });
    await objects.putFolder({ pageId: project.id, path: "/tmp/history-fixture", folderId: "fixture-folder", location: "history", createdAt: 1, updatedAt: 1 });
    localStorage.setItem(`ll.chat.${project.id}`, "archived");
    projectPrefs.set({ enabled: true });
    openPage(chatView(project.id));
  });
  return { writes, reads: () => reads, chat: page.getByTestId("project-chat") };
}

// Seam: a saved conversation outlives its runtime session and must remain readable without a model request.
for (const agent of ["claude", "codex"]) {
  for (const state of ["missing", "exited"]) {
    test(`${agent} ${state} session history survives app reload without starting an agent`, async ({ page }, info) => {
      const fixture = await archivedChat(page, agent, state === "exited");
      const answer = fixture.chat.getByText("The saved local answer remains readable.", { exact: true });
      await expect(answer).toBeVisible();
      await expect(fixture.chat.getByText("What did the fixture check?", { exact: true })).toBeVisible();
      const before = fixture.reads();
      await page.reload();
      await expect(answer).toHaveCount(1);
      await expect(answer).toBeVisible();
      expect(fixture.reads()).toBeGreaterThan(before);
      expect(fixture.writes).toEqual([]);
      await expect(fixture.chat.getByText(/Send a message to pick this chat up again/)).toHaveCount(0);
      await fixture.chat.screenshot({ path: info.outputPath("saved-chat-after-reload.png") });
    });
  }
}

test("an unavailable saved record reports a read error without asking for a model prompt", async ({ page }) => {
  const fixture = await archivedChat(page, "claude", false, true);
  await expect(fixture.chat.getByText("The saved conversation record is missing.", { exact: true })).toBeVisible();
  await expect(fixture.chat.getByText(/Send a message to pick this chat up again/)).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});
