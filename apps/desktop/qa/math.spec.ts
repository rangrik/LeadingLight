import { expect, test } from "@playwright/test";

// Seam: saved agent replies into our renderer; the upstream parser alone cannot catch missing KaTeX.
test("Replies render math while preserving currency, code and invalid formulas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Math reply");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.press("Meta+s");
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the source module in this fixture.
    const { focusedPage } = await import("/src/lib/panes.ts");
    localStorage.setItem(`ll.threads.${focusedPage()}`, JSON.stringify([{
      id: "math", title: "Show math", updated: Date.now(), seen: {}, allowed: [], items: [
        { kind: "user", text: "Show math" },
        { kind: "text", text: "Work: \\(y^2\\)", phase: "commentary" },
        { kind: "text", text: "Inline \\(x^2\\).\n\n$$\n\\frac{1}{2}\n$$\n\nInvalid \\(\\frac{\\).\n\n$5 and $10\n\n`\\(code\\)`", phase: "final_answer" },
        { kind: "end", how: "done", ms: 1000 },
      ],
    }]));
  });
  await page.reload();
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Math reply", exact: true }).click();
  await page.keyboard.press("Meta+j");
  const panel = page.getByRole("region", { name: "Agent" });
  await expect(panel.locator(".katex:visible")).toHaveCount(2);
  await expect(panel.locator(".katex-display")).toBeVisible();
  await expect(panel.locator(".katex-error")).toHaveText("\\frac{");
  await expect(panel.locator(".katex-error")).not.toHaveAttribute("title");
  await expect(panel).toContainText("$5 and $10");
  await expect(panel.locator("code")).toHaveText("\\(code\\)");
  await panel.getByRole("button", { name: "Worked for 1s" }).click();
  await expect(panel.locator(".katex:visible")).toHaveCount(3);
});
