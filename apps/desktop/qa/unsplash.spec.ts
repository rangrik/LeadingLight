import { expect, test } from "@playwright/test";

const service = "**/api/photos**";
const cors = { "access-control-allow-origin": "*" };
const photo = {
  url: "https://images.unsplash.com/photo-1?ixid=a&w=2400&q=80",
  thumb: "https://images.unsplash.com/photo-1?w=200",
  name: "Ann Lee", profile: "https://unsplash.com/@ann", used: "signed-selection",
};

// Seam: selection reaches the shared service without credentials and keeps attribution after save.
test("Unsplash works without setup and reports a cover with its credit", async ({ page }) => {
  const used: string[] = [];
  await page.route(service, (r) => {
    expect(r.request().headers().authorization).toBeUndefined();
    if (r.request().method() === "POST") {
      used.push(r.request().postData() ?? "");
      return r.fulfill({ status: 204, headers: cors });
    }
    expect(new URL(r.request().url()).searchParams.get("query")).toBe("mountain");
    return r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify([photo]) });
  });
  await page.route("https://images.unsplash.com/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="gray"/></svg>' }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).hover();
  await page.getByRole("button", { name: "Add cover" }).click();
  await page.getByRole("tab", { name: "Unsplash" }).click();
  await expect(page.getByRole("searchbox", { name: "Search Unsplash" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Access key" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search Unsplash" }).fill("mountain");
  await expect(page.getByRole("link", { name: "Ann Lee" })).toHaveAttribute("href", "https://unsplash.com/@ann?utm_source=leadinglight&utm_medium=referral");
  const thumbnail = page.getByRole("button", { name: "Photo by Ann Lee" });
  // COSS's responsive button height must not crop the image to a strip.
  await expect.poll(() => thumbnail.evaluate((el) => el.clientWidth / el.clientHeight)).toBeCloseTo(1.5, 1);
  await thumbnail.click();
  await expect.poll(() => used).toEqual(["signed-selection"]);
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole("group", { name: "Cover" }).hover();
  await expect(page.getByRole("link", { name: "Ann Lee" })).toHaveAttribute("href", "https://unsplash.com/@ann?utm_source=leadinglight&utm_medium=referral");
});

test("Unsplash handles unavailable service, limits, empty results and offline search", async ({ page }) => {
  let status = 503;
  await page.route(service, (r) => status === 0 ? r.abort() : r.fulfill({ status, headers: cors, contentType: "application/json", body: "[]" }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).hover();
  await page.getByRole("button", { name: "Add cover" }).click();
  await page.getByRole("tab", { name: "Unsplash" }).click();
  const search = page.getByRole("searchbox", { name: "Search Unsplash" });
  for (const [code, message] of [[503, "Photo search is temporarily unavailable. Try again later."], [429, "Unsplash's hourly limit is used up. Try again later."], [200, "No photos found"], [0, "Couldn't reach Unsplash"]] as const) {
    status = code;
    await search.fill(`search ${code}`);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
  await page.unroute(service);
  await page.route(service, (r) => r.fulfill({ headers: cors, contentType: "application/json", body: "{}" }));
  await search.fill("malformed result");
  await expect(page.getByRole("alert")).toHaveText("Photo search is temporarily unavailable. Try again later.");
  await expect(search).toBeVisible();
});
