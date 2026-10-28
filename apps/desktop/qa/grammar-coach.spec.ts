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

async function speechVoices(page: Page, local = true) {
  await page.addInitScript((local) => {
    (window as any).__speech = { utterances: [], stops: 0 };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [{ name: "Remote", lang: "en-US", localService: false }, ...(local ? [{ name: "Local", lang: "en-US", localService: true }] : [])],
      addEventListener() {}, removeEventListener() {},
      speak: (utterance: any) => (window as any).__speech.utterances.push({ text: utterance.text, voice: utterance.voice.name }),
      cancel: () => (window as any).__speech.stops++,
    } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { text: string; constructor(text: string) { this.text = text; } } });
  }, local);
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
  await speechVoices(page);
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
  const listen = await review(page).getByRole("button", { name: "Listen", exact: true }).boundingBox();
  const practice = await review(page).getByRole("button", { name: "Try one", exact: true }).boundingBox();
  expect(Math.abs(listen!.x - practice!.x)).toBeLessThan(1);
  expect(listen!.width).toBeLessThan(130);
  await page.screenshot({ path: "qa/report/grammar-saved-tips.png" });
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
  await speechVoices(page);
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

// Seam: a storage failure must not silence a word or leave the dictionary action locked.
test("Remember word reports storage failure and retries without losing the suggestion", async ({ page }) => {
  await newPage(page, "I use zorbulation.");
  await openReview(page);
  const remember = review(page).getByRole("button", { name: "Remember word", exact: true });
  await expect(remember).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "ll.grammar.words") throw new DOMException("Storage full", "QuotaExceededError");
      return set.call(this, key, value);
    };
    (window as any).__restoreStorage = () => { Storage.prototype.setItem = set; };
  });
  await remember.click();
  await expect(review(page).getByRole("alert")).toHaveText("The word list could not be saved. Please try again.");
  await expect(remember).toBeEnabled();
  await expect(body(page)).toHaveText("I use zorbulation.");
  expect(await page.evaluate(() => localStorage.getItem("ll.grammar.words"))).toBeNull();
  await page.evaluate(() => (window as any).__restoreStorage());
  await remember.click();
  await expect(review(page)).toContainText("Remembered “zorbulation”");
  await expect(review(page).getByRole("alert")).toHaveCount(0);
  await expect(review(page)).toContainText("No suggestions from this check", { timeout: 15000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ll.grammar.words")!))).toEqual(["zorbulation"]);
});

// Seam: a remote-only voice list must never become an implicit network speech fallback.
test("Listen explains when no local English voice is available", async ({ page }) => {
  await speechVoices(page, false);
  await newPage(page, "I ate a apple.");
  await openReview(page);
  await expect(review(page)).toContainText("Listen needs a local English system voice.", { timeout: 15000 });
  await expect(review(page).getByRole("button", { name: "Listen", exact: true })).toHaveCount(0);
  await expect(review(page).getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__speech.utterances)).toHaveLength(0);
});

// Seam: unavailable local WASM is a visible failure, and Retry starts a fresh check.
test("A failed local checker can retry without reloading or changing words", async ({ page }) => {
  test.setTimeout(45000);
  await page.route(/harper_wasm.*\.wasm/, (route) => route.abort());
  await newPage(page, "I recieved it.");
  await openReview(page);
  await expect(review(page)).toContainText("Checking on this device");
  await expect(review(page).getByRole("alert")).toHaveText("The local checker could not finish. Your words are unchanged.", { timeout: 26000 });
  await expect(review(page)).not.toContainText("No suggestions from this check");
  await expect(body(page)).toHaveText("I recieved it.");
  await page.unroute(/harper_wasm.*\.wasm/);
  await review(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(review(page).getByText("Your words", { exact: true }).locator("..")).toContainText("recieved", { timeout: 15000 });
  await expect(review(page).getByRole("alert")).toHaveCount(0);
  await expect(body(page)).toHaveText("I recieved it.");
});

// Seam: the Writing menu must target the active tab's editor while Tail stays in its panel.
test("Review follows the active tab and leaves quiet drafting quiet with Suggestions open", async ({ page }) => {
  await newPage(page, "I recieved it.");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("First draft");
  await page.getByRole("textbox", { name: "Title", exact: true }).press("Enter");
  const recent = page.getByRole("navigation", { name: "Recent" });
  await expect(recent.getByRole("button", { name: "First draft", exact: true })).toBeVisible();
  await recent.getByRole("button", { name: "New page" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Second draft");
  await body(page).fill("I ate a apple.");
  await recent.getByRole("button", { name: "First draft", exact: true }).click({ modifiers: ["Meta"] });
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("First draft");
  await page.getByRole("button", { name: "Suggestions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(review(page)).toHaveCount(0);
  await expect(body(page).locator(".ll-spelling, .ll-grammar")).toHaveCount(0);
  await openReview(page);
  await expect(review(page).getByText("Your words", { exact: true }).locator("..")).toContainText("recieved", { timeout: 15000 });
  await review(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("region", { name: "First draft", exact: true, includeHidden: true }).getByRole("textbox", { name: "Page body", exact: true, includeHidden: true })).toHaveText("I received it.");
  await review(page).getByRole("button", { name: "Done for now" }).click();
  await page.getByRole("tab", { name: "Second draft Close tab", exact: true }).click();
  await expect(page.getByRole("region", { name: "Second draft", exact: true, includeHidden: true }).getByRole("textbox", { name: "Page body", exact: true, includeHidden: true })).toHaveText("I ate a apple.");
  await expect(body(page).locator(".ll-spelling, .ll-grammar")).toHaveCount(0);
  await openReview(page);
  await expect(review(page).getByText("Your words", { exact: true }).locator("..")).toHaveText("Your wordsa", { timeout: 15000 });
  await expect(review(page).getByText("Suggested", { exact: true }).locator("..")).toContainText("an");
});
