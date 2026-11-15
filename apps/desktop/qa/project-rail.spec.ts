import { expect, test } from "@playwright/test";

// Seam: the panes kept per scope (lib/panes.ts, lib/scope.ts). Catches a project losing its panes
// when you go to All and back, or a reload opening another scope's panes.
test("Each project on the rail keeps its own panes", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "Projects" });
  const pane = (name: string) => page.locator("[data-pane-area]").getByRole("region", { name, exact: true });
  await expect(rail.getByRole("button", { name: "All" })).toHaveAttribute("aria-current", "true");
  await page.evaluate(async () => {
    const { createPage } = await import(/* @vite-ignore */ String("/src/lib/space.ts"));
    await createPage({ title: "Garden", typeId: "project" });
    await createPage({ title: "Seeds" });
  });
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Seeds" }).click();
  await expect(pane("Seeds")).toBeVisible();
  // A project chosen the first time opens its own page.
  await rail.getByRole("button", { name: "Garden" }).click();
  await expect(pane("Garden")).toBeVisible();
  await expect(pane("Seeds")).toHaveCount(0);
  await rail.getByRole("button", { name: "All" }).click();
  await expect(pane("Seeds")).toBeVisible();
  await page.keyboard.press("Meta+2");
  await expect(pane("Garden")).toBeVisible();
  await page.reload();
  await expect(rail.getByRole("button", { name: "Garden" })).toHaveAttribute("aria-current", "true");
  await expect(pane("Garden")).toBeVisible();
});
