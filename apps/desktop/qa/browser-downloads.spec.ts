import { expect, test } from "@playwright/test";

// Seam: completed downloads to native dialogs and chunked writes; catches duplicate prompts and false saves.
test("Native download prompts are serialized, scoped and remembered after cancel or failure", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const js = (body: string) => route.fulfill({ contentType: "text/javascript", body });
    if (path === "/") return route.fulfill({ contentType: "text/html", body: "<main>Mock native download boundary</main>" });
    if (path.endsWith("/lib/platform.ts")) return js("export const isNative = Promise.resolve(true)");
    if (path.endsWith("/project-runtime/transport.ts")) return js("export const ask = (...args) => window.downloadHarness.ask(...args)");
    if (path.includes("plugin-dialog")) return js("export const save = (...args) => window.downloadHarness.save(...args)");
    if (path.includes("plugin-fs")) return js("export const open = (...args) => window.downloadHarness.open(...args)");
    return route.continue();
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const state = {
      prefs: { enabled: true, ask: true, directory: "/chosen/folder", defaultDirectory: "/Downloads" },
      downloads: new Map([
        ["/workspace-a", [{ id: "a", tab: "user-a", state: "completed", exportState: "" }, { id: "agent", tab: "agent-a", state: "completed", exportState: "" }]],
        ["/workspace-b", [{ id: "b", tab: "user-b", state: "completed", exportState: "" }]],
      ]),
      calls: [] as { method: string; path: string; body?: Record<string, unknown> }[],
      dialogs: [] as { defaultPath: string }[], writes: [] as number[], closed: 0, active: 0, maximum: 0,
      release: (() => {}) as (path: string | null) => void,
      releaseData: (() => {}) as () => void,
      holdData: false, waitingData: false, live: true,
      failed: false, done: false, result: "",
    };
    const ask = async (method: string, path: string, body?: Record<string, unknown>) => {
      state.calls.push({ method, path, body });
      if (path === "/v1/browser/download-settings") return state.prefs;
      const base = path.split("/downloads")[0];
      const rows = state.downloads.get(base)!;
      if (path.endsWith("/downloads")) return { downloads: rows };
      const id = path.split("/downloads/")[1].split("/")[0];
      const row = rows.find((entry) => entry.id === id)!;
      if (path.endsWith("/prompt")) {
        if (method === "POST") {
          if (row.exportState) return { claimed: false };
          row.exportState = "prompted";
          return { claimed: true, tab: row.tab, id };
        }
        row.exportState = body?.savedPath ? "saved" : body?.error ? "error" : "dismissed";
        return {};
      }
      const offset = Number(new URL(path, "http://fixture").searchParams.get("offset"));
      if (state.holdData && offset === 0) { state.waitingData = true; await new Promise<void>((resolve) => { state.releaseData = resolve; }); }
      const totalBytes = 1024 * 1024 + 5;
      const size = Math.min(1024 * 1024, totalBytes - offset);
      return { name: `../../${id}.bin`, mime: "application/octet-stream", data: btoa("x".repeat(size)), offset, totalBytes, done: offset + size === totalBytes };
    };
    const save = async (options: { defaultPath: string }) => {
      state.dialogs.push(options); state.active++; state.maximum = Math.max(state.maximum, state.active);
      try {
        if (state.dialogs.length === 1) return await new Promise<string | null>((resolve) => { state.release = resolve; });
        return state.dialogs.length === 2 ? null : "/chosen/fail.bin";
      } finally { state.active--; }
    };
    const open = async () => ({ write: async (bytes: Uint8Array) => { if (state.failed) throw new Error("Disk full"); const count = Math.min(bytes.length, 700000); state.writes.push(count); return count; }, close: async () => { state.closed++; } });
    Object.assign(window, { downloadHarness: { state, ask, save, open } });
    const modulePath = "/src/lib/browser-preferences.ts";
    const module = await import(modulePath);
    Object.assign(window, { downloadModule: module });
    void Promise.all([module.promptBrowserDownloads("/workspace-a"), module.promptBrowserDownloads("/workspace-a"), module.promptBrowserDownloads("/workspace-b")]).then(() => { state.done = true; });
  });
  const read = () => page.evaluate(() => (window as any).downloadHarness.state);
  await expect.poll(async () => (await read()).dialogs.length).toBe(1);
  await page.evaluate(() => (window as any).downloadHarness.state.release("/chosen/a.bin"));
  await expect.poll(async () => (await read()).done).toBe(true);
  const state = await read();
  expect(state.maximum).toBe(1);
  expect(state.dialogs.map((value: { defaultPath: string }) => value.defaultPath)).toEqual(["/chosen/folder/a.bin", "/chosen/folder/b.bin"]);
  expect(state.writes.reduce((sum: number, value: number) => sum + value, 0)).toBe(1024 * 1024 + 5);
  expect(Math.max(...state.writes)).toBeLessThanOrEqual(1024 * 1024);
  expect(state.closed).toBe(1);
  expect(state.calls.filter((value: { method: string; path: string }) => value.method === "POST" && value.path.includes("/prompt"))).toHaveLength(2);
  expect(state.calls.some((value: { path: string }) => value.path.includes("/agent/"))).toBe(false);
  await page.evaluate(async () => {
    const { state } = (window as any).downloadHarness;
    const modulePath = "/src/lib/browser-preferences.ts?reload-prompt-test";
    const fresh = await import(modulePath);
    await fresh.promptBrowserDownloads("/workspace-a"); await fresh.promptBrowserDownloads("/workspace-b");
    state.failed = true;
    state.downloads.get("/workspace-a").push({ id: "failure", tab: "user-a", state: "completed", exportState: "" });
    try { await fresh.promptBrowserDownloads("/workspace-a"); } catch (error) { state.result = String(error); }
    await fresh.promptBrowserDownloads("/workspace-a");
  });
  const final = await read();
  expect(final.dialogs).toHaveLength(3);
  expect(final.closed).toBe(2);
  expect(final.result).toContain("Disk full");
  expect(final.calls.find((value: { method: string; path: string }) => value.method === "PUT" && value.path.includes("/failure/"))?.body?.error).toBe("Disk full");
  await page.evaluate(() => {
    const { state } = (window as any).downloadHarness;
    state.holdData = true; state.done = false;
    state.downloads.get("/workspace-a").push({ id: "closed-pane", tab: "user-a", state: "completed", exportState: "" });
    void (window as any).downloadModule.promptBrowserDownloads("/workspace-a", () => state.live).then(() => { state.done = true; });
  });
  await expect.poll(async () => (await read()).waitingData).toBe(true);
  await page.evaluate(() => { const { state } = (window as any).downloadHarness; state.live = false; state.releaseData(); });
  await expect.poll(async () => (await read()).done).toBe(true);
  const closed = await read();
  expect(closed.dialogs).toHaveLength(3);
  expect(closed.calls.find((value: { method: string; path: string }) => value.method === "PUT" && value.path.includes("/closed-pane/"))?.body?.cancelled).toBe(true);
});
