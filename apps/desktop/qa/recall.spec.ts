import { expect, test } from "@playwright/test";

// Seam: Recall writes through the sidenote store and the body (features/recall.feature). Catches a
// saved line the editor prunes as a note without a thought, or a round not kept on the Thoughts page.
test("a recalled line is a sidenote, and the round is kept", async ({ page }) => {
  await page.goto("/?mac&demo");
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  await page.evaluate(async () => {
    const { space } = await import(String("/src/lib/space.ts"));
    const { openPage } = await import(String("/src/lib/panes.ts"));
    openPage(space.get().pages.find((p: { title: string }) => p.title === "Notes on Thinking in Systems").id);
  });
  await expect(page.getByText("You noted 3 things here")).toBeVisible();
  await page.getByRole("button", { name: "Recall", exact: true }).click();

  const card = page.getByTestId("recall");
  await expect(card.getByText("1 of 3")).toBeVisible();
  await card.getByRole("textbox", { name: "In your own words" }).fill("Links over parts");
  await page.keyboard.press("Enter");
  await expect(card.getByText("2 of 3")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.locator(".ll-note", { hasText: "Links over parts" })).toBeVisible();

  // Stored: the thought beside the others, its mark in the body, and the round on the Thoughts page.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { objects } = await import(String("/src/lib/objects.ts"));
        const { space } = await import(String("/src/lib/space.ts"));
        const notes = space.get().pages.find((p: { title: string }) => p.title === "Notes on Thinking in Systems");
        const thoughts = await objects.get(notes.properties.thoughts);
        const body = JSON.stringify((await objects.get(notes.id))?.content);
        const added = thoughts?.content?.content?.find((t: object) => JSON.stringify(t).includes("Links over parts"));
        return { quote: added?.attrs?.quote, anchored: body.includes(`"id":"${added?.attrs?.id}"`), recalled: thoughts?.properties.recalled?.length };
      }),
    )
    .toEqual({ quote: "interconnections", anchored: true, recalled: 1 });
});
