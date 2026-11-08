import { expect, type Page, test } from "@playwright/test";

// features/search.feature. Seams: a save reaching the index without a reread, the open
// page lighting the matched block once its editor is live, and typing on a big space.
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...lines: string[]) => ({ type: "doc", content: lines.map(para) });

async function make(page: Page, pages: { title: string; content?: unknown }[]) {
  await page.evaluate(async (list) => {
    const { createPage } = await import("/src/lib/" + "space.ts");
    for (const p of list) await createPage(p);
  }, pages);
}

const panel = (page: Page) => page.getByRole("dialog", { name: "Search" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No pages yet")).toBeVisible();
});

test("finds a sentence by its words and opens at it", async ({ page }) => {
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about stocks and flows.`);
  await make(page, [
    { title: "Feedback loops", content: doc(...filler, "Delays in a loop make it oscillate. The signal arrives late.") },
    { title: "Oscillation", content: doc("A swing around a goal.") },
  ]);
  await page.keyboard.press("ControlOrMeta+k");
  await panel(page).getByRole("combobox").fill("delays make loops oscil");
  const rows = panel(page).getByRole("option");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Delays in a loop make it oscillate.");
  await expect(rows.first().locator("b")).toHaveText(["Delays", "loop", "make", "oscillate"]);

  // A title match comes before a body match.
  await panel(page).getByRole("combobox").fill("oscil");
  await expect(rows).toHaveText([/^Oscillation/, /^Feedback loops/]);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeHidden();
  const line = page.getByRole("textbox", { name: "Page body" }).getByText("Delays in a loop make it oscillate.");
  await expect(line).toBeInViewport();
  expect(await page.evaluate(() => CSS.highlights.has("ll-target"))).toBe(true);
});

test("an edit is found without reading any page again", async ({ page }) => {
  await make(page, [{ title: "Weekly review", content: doc("What moved this week.") }]);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(panel(page).getByRole("option", { name: /Weekly review/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "Weekly review" }).click();
  await page.getByRole("textbox", { name: "Page body" }).getByText("What moved this week.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" A quiet harbour at dawn.");
  await page.waitForTimeout(800);

  await page.evaluate(async () => {
    const { objects } = await import("/src/lib/" + "objects.ts");
    const get = objects.get;
    (window as unknown as { __reads: number }).__reads = 0;
    objects.get = (id: string) => ((window as unknown as { __reads: number }).__reads++, get(id));
  });
  await page.keyboard.press("ControlOrMeta+k");
  await panel(page).getByRole("combobox").fill("quiet harbour");
  await expect(panel(page).getByRole("option")).toContainText(["A quiet harbour at dawn."]);
  expect(await page.evaluate(() => (window as unknown as { __reads: number }).__reads)).toBe(0);
});

test("typing stays under a frame on 300 pages", async ({ page }) => {
  test.setTimeout(240_000);
  const words = "system stock flow delay loop goal signal habit budget trust money water team project".split(" ");
  const sentence = (i: number, j: number) => Array.from({ length: 14 }, (_, k) => words[(i * 7 + j * 3 + k) % words.length]).join(" ") + ".";
  await make(page, Array.from({ length: 300 }, (_, i) => ({ title: `Generated ${i}`, content: doc(...Array.from({ length: 12 }, (_, j) => sentence(i, j))) })));
  // The first open's read of every body, timed on its own.
  const index = await page.evaluate(async () => {
    const { readIndex } = await import("/src/lib/" + "search.ts");
    const t = performance.now();
    await readIndex();
    return performance.now() - t;
  });
  await page.keyboard.press("ControlOrMeta+k");
  await page.evaluate(() => {
    const w = window as unknown as { __keys: number[]; __gap: number };
    [w.__keys, w.__gap] = [[], 0];
    // A key's work: from keydown to its input event handled and laid out, without the wait for a frame.
    let t = 0;
    window.addEventListener("keydown", () => void (t = performance.now()), true);
    window.addEventListener("input", () => {
      document.body.getBoundingClientRect();
      w.__keys.push(performance.now() - t);
    });
    // The longest time between two frames, which the search after a pause shows in.
    let last = performance.now();
    const frame = (now: number) => {
      w.__gap = Math.max(w.__gap, now - last);
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await panel(page).getByRole("combobox").pressSequentially("delay loop signal habit", { delay: 30 });
  await expect(panel(page).getByRole("option").first()).toContainText("Generated");
  const { keys, gap } = await page.evaluate(() => {
    const w = window as unknown as { __keys: number[]; __gap: number };
    return { keys: w.__keys, gap: w.__gap };
  });
  const run = await page.evaluate(async () => {
    const { parse, search } = await import("/src/lib/" + "search.ts");
    const t = performance.now();
    search(parse("delay loop signal habit"));
    return performance.now() - t;
  });
  console.log(`index ${index.toFixed(0)} ms; slowest key ${Math.max(...keys).toFixed(1)} ms; one search ${run.toFixed(1)} ms; longest frame ${gap.toFixed(1)} ms`);
  expect(Math.max(...keys)).toBeLessThan(16);
  expect(run).toBeLessThan(16);
});
