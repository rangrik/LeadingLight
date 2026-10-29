import { expect, test } from "@playwright/test";

// Native storage and desktop capabilities must not be confused when a new platform is added.
test("iPad uses native storage without Mac capabilities", async ({ page }) => {
  await page.route("**/src/main.tsx*", (route) => route.fulfill({ contentType: "text/javascript", body: "export {};" }));
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: { filename?: string }) => {
      if (command === "plugin:app|identifier") return "com.leadinglight.app";
      if (command === "native_platform") return "ios";
      if (command === "plugin:leadinglight-preview|asset_preview") {
        Object.assign(window, { previewFilename: args.filename });
        return null;
      }
      throw new Error(`Unexpected native call: ${command}`);
    } } });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/lib/platform.ts";
    const p = await import(/* @vite-ignore */ path);
    return { native: await p.isNative, desktop: await p.isDesktop, mobile: await p.isMobile };
  });
  expect(result).toEqual({ native: true, desktop: false, mobile: true });
  await page.evaluate(async () => {
    const path = "/src/lib/assets.ts";
    const { assets } = await import(/* @vite-ignore */ path);
    assets.open({ url: "asset://localhost/app/assets/note.pdf", name: "Note.pdf", size: 4, mime: "application/pdf" });
  });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "previewFilename"))).toBe("note.pdf");
});

// iOS updates can relocate app data; old media paths must resolve before the editor reads them.
test("saved attachments follow the current iOS data directory", async ({ page }) => {
  await page.route("**/src/main.tsx*", (route) => route.fulfill({ contentType: "text/javascript", body: "export {};" }));
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI_INTERNALS__: {
      convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
      invoke: async (command: string, args: { paths?: string[] }) => {
        if (command === "plugin:app|identifier") return "com.leadinglight.dev.ipad";
        if (command === "native_platform") return "ios";
        if (command === "plugin:path|resolve_directory") return "/private/var/mobile/Containers/Data/Application/NEW/Library/Application Support/LeadingLight";
        if (command === "plugin:path|join") return args.paths!.join("/");
        throw new Error(`Unexpected native call: ${command}`);
      },
    } });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storePath = "/src/lib/store-sqlite.ts", objectsPath = "/src/lib/objects.ts";
    const { sqliteStore } = await import(/* @vite-ignore */ storePath);
    const { objects } = await import(/* @vite-ignore */ objectsPath);
    const old = `asset://localhost/${encodeURIComponent("/private/var/mobile/Containers/Data/Application/OLD/Library/Application Support/LeadingLight/assets/photo one.png")}`;
    const untouched = ["https://example.org/assets/photo.png", "data:image/png;base64,eA==", "blob:photo", "asset://localhost/old/assets/%xx", "asset://localhost/old/assets/..%2Fsecret", "asset://other/old/assets/photo.png"];
    const fixture = {
      content: { type: "doc", content: [
        ...["image", "video", "audio", "voiceRecording"].map((type) => ({ type, attrs: { src: old } })),
        { type: "text", text: old },
      ] },
      properties: { cover: { kind: "image", url: old }, icon: { kind: "image", url: old }, links: untouched.map((url) => ({ url })) },
      createdAt: 40, updatedAt: 42,
    };
    const saved = JSON.stringify(fixture);
    sqliteStore.get = async () => fixture;
    const resolved = await objects.get("fixture");
    const current = old.replace("OLD", "NEW");
    return {
      media: resolved.content.content.slice(0, 4).every((node: { attrs: { src: string } }) => node.attrs.src === current),
      cover: resolved.properties.cover.url === current, icon: resolved.properties.icon.url === current,
      text: resolved.content.content[4].text === old,
      links: resolved.properties.links.map(({ url }: { url: string }) => url),
      unchanged: JSON.stringify(fixture) === saved && resolved.createdAt === 40 && resolved.updatedAt === 42,
      untouched,
    };
  });
  expect(result).toEqual({ media: true, cover: true, icon: true, text: true, links: result.untouched, unchanged: true, untouched: result.untouched });
});

test.use({ viewport: { width: 600, height: 900 }, hasTouch: true });

// Sheet navigation must hand focus back to a writable page, including after offline saves.
test("touch navigation, offline edits, settings and capture", async ({ page, context, browserName }) => {
  await page.goto("/?ipad");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Train notes");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Page body" });
  await context.setOffline(true);
  await body.fill("Ideas on the train");
  await title.click();
  await page.waitForTimeout(700);
  await context.setOffline(false);
  await page.reload();
  await expect(body).toHaveText("Ideas on the train");
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Train notes" }).click();
  await expect(page.locator('[data-slot="sidebar"][data-mobile]')).toBeHidden();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("button", { name: "Browser", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await page.locator(".ll-settings").getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByTestId("settings-nav-writing").click();
  await expect(page.getByTestId("settings-writing")).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"][data-mobile]')).toBeHidden();
  await page.locator(".ll-settings").getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Quick capture" }).click();
  const capture = page.getByRole("dialog", { name: "New idea" });
  await capture.getByRole("textbox", { name: "Idea", exact: true }).fill("Remember this");
  const box = await capture.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await capture.getByRole("button", { name: "Project", exact: true }).getByText("No project").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/ipad-${browserName}-capture.png` });
  await capture.getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture).toBeHidden();
  await page.getByRole("button", { name: "Quick capture" }).click();
  await capture.getByRole("button", { name: "Close", exact: true }).click();
  await expect(capture).toBeHidden();
  await page.getByRole("button", { name: "Quick capture" }).click();
  await capture.getByRole("textbox", { name: "Idea", exact: true }).fill("Second idea");
  await capture.getByRole("button", { name: "Open beside", exact: true }).click();
  await expect(capture).toBeHidden();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Train notes" }).click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(body).toBeVisible();
  await page.screenshot({ path: `qa/report/ipad-${browserName}.png` });
});

// A keyboard resizes only the visual viewport; the caret must follow without an edit or refocus.
test("viewport changes reveal the caret and keep focus", async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 900, width: 600, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport });
  });
  await page.goto("/?ipad");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Rotate while writing");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Page body" });
  const text = Array.from({ length: 5 }, (_, i) => `Paragraph ${i + 1}. Writing on the train today.`).join("\n\n");
  await body.fill(text);
  const selection = () => page.evaluate(() => {
    const s = getSelection()!;
    return { text: s.focusNode?.textContent, offset: s.focusOffset };
  });
  const before = await selection();
  const beforeText = await body.textContent();
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 260 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    // WebKit can restore the old scroll after our first reveal has already succeeded.
    window.setTimeout(() => { document.querySelector<HTMLElement>("[data-page-scroller]")!.scrollTop = 0; }, 180);
  });
  const caretVisible = () => page.evaluate(() => {
    const selection = getSelection()!;
    const caret = selection.getRangeAt(0).getBoundingClientRect();
    const box = document.querySelector('[data-page-scroller]')!.getBoundingClientRect();
    return caret.height > 0 && caret.top >= box.top && caret.bottom <= box.bottom;
  });
  await expect.poll(caretVisible).toBe(true);
  await page.waitForTimeout(350);
  expect(await caretVisible()).toBe(true);
  await expect(body).toBeFocused();
  expect(await body.textContent()).toBe(beforeText);
  expect(await selection()).toEqual(before);
  await page.evaluate(() => window.visualViewport!.dispatchEvent(new Event("resize")));
  await page.mouse.move(300, 200);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(350);
  expect(await page.locator("[data-page-scroller]").evaluate((el) => el.scrollTop)).toBe(0);
  await title.click();
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 700 });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--ll-viewport-height"))).toBe("700px");
  await expect(title).toBeFocused();
});
