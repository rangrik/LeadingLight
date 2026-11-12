import { expect, type Page } from "@playwright/test";

// Seam: iOS navigation and touch focus must preserve the shared editor's source and live preview.
export async function mermaidTouch(page: Page, device: "ipad" | "iphone") {
  await page.goto(`/?${device}`);
  if (device === "iphone") await page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "Notes", exact: true }).tap();
  await page.getByRole("button", { name: "New page", exact: true }).tap();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Mermaid by touch");
  await title.press("Enter");
  await page.keyboard.type("/mermaid");
  await page.getByRole("option", { name: "Mermaid diagram" }).tap();
  await page.keyboard.type("flowchart LR");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A[Plan] --> B[Done]");
  const diagram = page.getByRole("img", { name: "Mermaid diagram", exact: true });
  await expect(diagram).toContainText("Done");
  const codeSource = page.locator(".ll-code code");
  await page.getByRole("button", { name: "Hide source" }).tap();
  await expect(codeSource).toBeHidden();
  await expect(diagram).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).tap();
  await expect(codeSource).toContainText("A[Plan] --> B[Done]");
  const language = page.getByRole("combobox", { name: "Language" });
  await language.tap();
  await page.getByRole("option", { name: "Plain text", exact: true }).tap();
  await expect(diagram).toHaveCount(0);
  await language.tap();
  await page.getByRole("option", { name: "Mermaid", exact: true }).tap();
  await expect(diagram).toContainText("Plan");

  await page.context().setOffline(true);
  await codeSource.tap();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("flowchart LR; A[Offline] --> B[Saved]");
  await expect(diagram).toContainText("Offline");
  await title.tap();
  await page.waitForTimeout(700);
  const toolbar = await language.boundingBox();
  const code = await page.locator(".ll-code pre").boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(code!.y);
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/mermaid-${device}-${page.context().browser()!.browserType().name()}.png` });
  await page.context().setOffline(false);
  await page.reload();
  if (device === "iphone") await page.getByRole("button", { name: "Continue writing" }).tap();
  await expect(codeSource).toHaveText("flowchart LR; A[Offline] --> B[Saved]");
  await expect(diagram).toContainText("Offline");
}
