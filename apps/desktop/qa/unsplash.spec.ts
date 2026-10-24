import { expect, test } from "@playwright/test";

const cors = { "access-control-allow-origin": "*" };
const photo = {
  urls: { raw: "https://images.unsplash.com/photo-1?ixid=a", thumb: "https://images.unsplash.com/photo-1?w=200" },
  user: { name: "Ann Lee", links: { html: "https://unsplash.com/@ann" } },
  links: { download_location: "https://api.unsplash.com/photos/1/download?ixid=a" },
};

// Seam: Unsplash's terms. Catches a picked photo not reported as used, or losing its credit,
// which no one would see but could get the key cut off.
test("An Unsplash cover is reported as used and keeps its credit", async ({ page }) => {
  const used: string[] = [];
  await page.route("https://api.unsplash.com/**", (r) => {
    if (r.request().url().includes("/download")) used.push(r.request().headers().authorization ?? "");
    return r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ results: [photo] }) });
  });
  await page.route("https://images.unsplash.com/**", (r) => r.fulfill({ status: 404 }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).hover();
  await page.getByRole("button", { name: "Add cover" }).click();
  await page.getByRole("tab", { name: "Unsplash" }).click();
  await page.getByRole("textbox", { name: "Access key" }).fill("test-key");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByRole("searchbox", { name: "Search Unsplash" }).fill("mountain");
  await page.getByRole("button", { name: "Photo by Ann Lee" }).click();
  await expect.poll(() => used).toEqual(["Client-ID test-key"]);
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole("group", { name: "Cover" }).hover();
  await expect(page.getByRole("link", { name: "Ann Lee" })).toHaveAttribute("href", "https://unsplash.com/@ann?utm_source=leadinglight&utm_medium=referral");
});
