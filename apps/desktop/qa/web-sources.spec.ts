import { expect, test } from "@playwright/test";

const url = "https://source.example/article";
const article = `<html><head><title>A source worth keeping</title></head><body><article><h1>A source worth keeping</h1><p>${"A useful paragraph with enough words to read. ".repeat(15)}</p><h2>Details</h2><p>A <strong>bold point</strong> and <a href="/related">related reading</a>.</p><img src="/picture.png" alt="A small picture"><p>Last paragraph stays here.</p><script>window.sourceScriptRan=true</script><iframe src="https://unsafe.example"></iframe></article></body></html>`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zS8AAAAASUVORK5CYII=", "base64");

type Page = import("@playwright/test").Page;
// A lone address in the capture box is a webpage (quick-capture.feature); ⇧⌘↩ saves it and opens it beside.
const box = (page: Page) => page.getByRole("dialog", { name: "New idea" });
async function paste(page: Page, address = url) {
  await page.getByRole("button", { name: "Quick capture" }).click();
  await page.keyboard.insertText(address);
  await expect(box(page).locator("header")).toContainText("Webpage");
}
async function dialog(page: Page) {
  await page.goto("/");
  await paste(page);
}
const save = (page: Page) => page.keyboard.press("Shift+Meta+Enter");

// Seam: untrusted website content becomes persistent editor nodes and local media.
test("source snapshots retain text and local images across reload without executing website HTML", async ({ page }) => {
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: article }));
  await page.route("https://source.example/picture.png", (route) => route.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png }));
  await dialog(page);
  await save(page);
  await expect(page.getByRole("textbox", { name: "Title" }).last()).toHaveValue("A source worth keeping");
  const body = page.getByRole("textbox", { name: "Page body" }).last();
  await expect(body).toContainText("Last paragraph stays here.");
  await expect(body.locator("img")).toHaveAttribute("src", /^data:image\/png/);
  await expect(body.locator("img")).toHaveAttribute("alt", "A small picture");
  await expect(body.locator("script,iframe,form")).toHaveCount(0);
  await expect(body.getByRole("link", { name: "Embedded media (link)" })).toHaveAttribute("href", "https://unsafe.example/");
  await expect(body.getByRole("link", { name: "related reading" })).toHaveAttribute("href", "https://source.example/related");
  await page.route("https://source.example/**", (route) => route.abort());
  await page.reload();
  await expect(body).toContainText("Last paragraph stays here.");
  await expect(body.locator("img")).toHaveAttribute("src", /^data:image\/png/);
  await page.screenshot({ path: "qa/report/web-source.png" });
});

// Seam: capture errors never create empty documents; link-only never needs website access.
test("failed capture can save a link without retrying the website, and unsafe URLs are refused", async ({ page }) => {
  let requests = 0;
  await page.route("https://source.example/**", (route) => { requests++; return route.fulfill({ status: 403, headers: { "access-control-allow-origin": "*" } }); });
  await dialog(page);
  await save(page);
  await expect(box(page).getByRole("alert")).toContainText("403");
  await page.getByRole("button", { name: "Save link instead" }).click();
  await expect(page.getByRole("textbox", { name: "Title" }).last()).toHaveValue("source.example");
  expect(requests).toBe(1);
  await paste(page, "https://user:secret@example.com");
  await box(page).getByRole("radio", { name: "Link only", exact: true }).click();
  await save(page);
  await expect(box(page).getByRole("alert")).toContainText("without a username or password");
});

test("text only avoids media downloads; failed media is labelled and linked", async ({ page }) => {
  let mediaRequests = 0;
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: article.replace("</article>", '<img src="data:image/png;base64,invalid" alt="Unsupported picture"></article>') }));
  await page.route("https://source.example/picture.png", (route) => { mediaRequests++; return route.abort(); });
  await dialog(page);
  await box(page).getByRole("radio", { name: "Text only", exact: true }).click();
  await save(page);
  const body = page.getByRole("textbox", { name: "Page body" }).last();
  await expect(body).toContainText("Last paragraph stays here.");
  await expect(body.locator("img")).toHaveCount(0);
  expect(mediaRequests).toBe(0);
  await paste(page);
  await save(page);
  // The second copy opens beside the first, under the same title.
  const copy = page.getByRole("textbox", { name: "Page body" }).filter({ hasText: "Media not saved:" });
  await expect(copy).toContainText("Media not saved: Unsupported picture (unsupported address)");
  await expect(copy.locator("img")).toHaveCount(0);
});

// Seam: cancelling asynchronous capture must not create a page later or queue more downloads.
test("slow article and media captures can be cancelled before saving another source", async ({ page }) => {
  for (const stage of ["article", "media"]) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let mediaRequests = 0;
    let articleRequested = false;
    await page.route("https://source.example/**", async (route) => {
      const isArticle = route.request().url() === url;
      if (isArticle) articleRequested = true;
      else mediaRequests++;
      if ((stage === "article" && isArticle) || !isArticle) await held;
      const body = article.replace("</article>", '<img src="/two.png"><img src="/three.png"><img src="/four.png"></article>');
      await route.fulfill({ contentType: isArticle ? "text/html" : "image/png", headers: { "access-control-allow-origin": "*" }, body: isArticle ? body : png }).catch(() => {});
    });
    await dialog(page);
    await save(page);
    await expect.poll(() => stage === "article" ? articleRequested : mediaRequests === 3).toBe(true);
    await page.keyboard.press("Escape");
    await expect(box(page)).toBeHidden();
    release();
    await page.waitForTimeout(200);
    expect(mediaRequests).toBe(stage === "article" ? 0 : 3);
    await expect(page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "A source worth keeping", exact: true })).toHaveCount(0);
    await page.unroute("https://source.example/**");
  }
  await paste(page, "https://another.example");
  await box(page).getByRole("radio", { name: "Link only", exact: true }).click();
  await save(page);
  await expect(page.getByRole("textbox", { name: "Title" }).last()).toHaveValue("another.example");
});
