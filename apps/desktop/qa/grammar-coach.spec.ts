import { expect, test, type Page } from "@playwright/test";
const body = (page: Page) => page.getByRole("textbox", { name: "Page body", exact: true, includeHidden: true });
const review = (page: Page) => page.getByRole("dialog", { name: "Review writing", exact: true });
async function newPage(page: Page, text: string) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Writing practice");
  await body(page).fill(text);
}
async function openReview(page: Page) {
  await page.getByRole("button", { name: "Writing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review writing", exact: true }).click();
  await expect(review(page)).toBeVisible();
}

// Seam: quiet preferences and PM undo preserve the writer's actual document.
test("Quiet review applies only the chosen correction and Undo keeps formatting", async ({ page }) => {
  await newPage(page, "I recieved it.");
  await page.evaluate(() => (window as any).__editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "I " }, { type: "text", text: "recieved", marks: [{ type: "bold" }] }, { type: "text", text: " it." },
  ] }] }));
  await expect(body(page)).toHaveAttribute("spellcheck", "false");
  await openReview(page);
  await expect(review(page).getByText("Your words", { exact: true }).locator("..")).toContainText("recieved", { timeout: 15000 });
  await expect(body(page).locator(".ll-spelling, .ll-grammar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Counts", exact: true, includeHidden: true })).not.toContainText("misspelling");
  await review(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(body(page).locator("strong")).toHaveText("received");
  await review(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(body(page).locator("strong")).toHaveText("recieved");
  await review(page).getByRole("button", { name: "Keep this wording", exact: true }).click();
  await expect(review(page)).toContainText("No suggestions from this check");
  await review(page).getByRole("button", { name: "Done for now" }).click();
  await expect(body(page)).toBeFocused();
  await expect(body(page)).toHaveText("I recieved it.");
});

// Seam: learning persists generic rule IDs and practice never mutates the user's words.
test("A short lesson can be practiced, saved, reloaded, and removed", async ({ page }) => {
  await newPage(page, "I ate a apple.");
  await openReview(page);
  await expect(review(page).getByRole("button", { name: "Why?", exact: true })).toBeVisible({ timeout: 15000 });
  await review(page).getByRole("button", { name: "Why?", exact: true }).click();
  await expect(review(page)).toContainText("Use “an” before a vowel sound");
  await review(page).getByRole("button", { name: "Try one", exact: true }).click();
  await review(page).getByRole("button", { name: "a", exact: true }).click();
  await expect(review(page)).toContainText("“Hour” starts with a vowel sound");
  await expect(body(page)).toHaveText("I ate a apple.");
  await review(page).getByRole("button", { name: "Save tip", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("ll.grammar.tips"))).toBe('["AnA"]');
  await review(page).getByRole("button", { name: "Done for now" }).click();
  await page.reload();
  await openReview(page);
  await review(page).getByRole("tab", { name: "Saved tips", exact: true }).click();
  await expect(review(page).getByRole("heading", { name: "A or an", exact: true })).toBeVisible();
  await review(page).getByRole("button", { name: "Remove saved tip", exact: true }).click();
  await expect(review(page)).toContainText("Save a tip from");
});

// Seam: inline click and persistent dictionary use one checker and clear old marks.
test("Inline help remembers specialist words and can check them again", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ll.writing", JSON.stringify({ grammarMode: "inline" })));
  await newPage(page, "I use zorbulation.");
  const underline = body(page).locator(".ll-spelling");
  await expect(underline).toHaveText("zorbulation", { timeout: 15000 });
  await underline.click();
  await expect(review(page)).toBeVisible();
  await review(page).getByRole("button", { name: "Remember word", exact: true }).click();
  await expect(review(page)).toContainText("Remembered “zorbulation”");
  await expect(underline).toHaveCount(0);
  await review(page).getByRole("button", { name: "Done for now" }).click();
  await page.reload();
  await openReview(page);
  await expect(review(page)).toContainText("No suggestions from this check", { timeout: 15000 });
  await review(page).getByRole("tab", { name: "My words", exact: true }).click();
  await review(page).getByRole("button", { name: "Remove zorbulation", exact: true }).click();
  await expect(review(page)).toContainText("will be checked again");
  await review(page).getByRole("tab", { name: "Review", exact: true }).click();
  await expect(review(page).getByText("Your words", { exact: true }).locator("..")).toContainText("zorbulation", { timeout: 15000 });
});

// Seam: speech is opt-in and selects local voices, never a remote default.
test("Listen uses a local voice and stops when review closes", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__speech = { utterances: [], stops: 0 };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [{ name: "Remote", lang: "en-US", localService: false }, { name: "Local", lang: "en-US", localService: true }],
      addEventListener() {}, removeEventListener() {},
      speak: (utterance: any) => (window as any).__speech.utterances.push({ text: utterance.text, voice: utterance.voice.name }),
      cancel: () => (window as any).__speech.stops++,
    } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { text: string; constructor(text: string) { this.text = text; } } });
  });
  await newPage(page, "I ate a apple.");
  await openReview(page);
  await expect(review(page).getByRole("button", { name: "Listen", exact: true })).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__speech.utterances)).toHaveLength(0);
  await review(page).getByRole("button", { name: "Listen", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__speech.utterances[0].voice)).toBe("Local");
  const before = await page.evaluate(() => (window as any).__speech.stops);
  await review(page).getByRole("button", { name: "Done for now" }).click();
  expect(await page.evaluate(() => (window as any).__speech.stops)).toBeGreaterThan(before);
});
