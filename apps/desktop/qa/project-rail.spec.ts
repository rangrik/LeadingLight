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

// Seam: a sidenote asks for room (lib/essay.ts), the shell folds the sidebar (App.tsx) and the rail
// stays (project-rail.tsx). Catches a note that folds with room to spare, or takes the rail with it.
test("A sidenote folds the sidebar only without room, and never the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.locator("[data-slot=sidebar]");
  const notes = page.locator("[data-pane-area] .ll-note");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("One.\nTwo.");
  await page.keyboard.press("Meta+Shift+m");
  await expect(notes).toHaveCount(1);
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  // The Inbox takes the card under the 832 px a page with notes needs.
  await page.keyboard.press("Meta+Alt+i");
  await page.getByRole("textbox", { name: "Page body" }).getByText("One.").click();
  await page.keyboard.press("Meta+Shift+m");
  await expect(notes).toHaveCount(2);
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "All" })).toBeVisible();
});
