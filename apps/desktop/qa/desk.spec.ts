import { expect, test } from "@playwright/test";

// Seam: the Desk's Today card is a second editor for today's note, and a page is open in one place
// at most (components/desk.tsx). Catches words typed on the Desk lost when the note opens beside.
test("Words written on the Desk are there when Today opens beside, and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Kickoff");
  await page.keyboard.press("Meta+1");
  const card = page.getByRole("region", { name: "Today", exact: true });
  await card.getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.type("from the desk");
  await page.getByRole("button", { name: "Today", exact: true }).click({ modifiers: ["Shift"] });
  await expect(card.getByText("Today's note is already open.")).toBeVisible();
  const note = page.locator("section[data-pane]").filter({ has: page.getByRole("textbox", { name: "Title" }) });
  await expect(note.getByRole("textbox", { name: "Page body" })).toHaveText("from the desk");
  await note.getByRole("textbox", { name: "Page body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(", then the note");
  await note.getByRole("button", { name: "Close page" }).click();
  await expect(card.getByRole("textbox", { name: "Page body" })).toHaveText("from the desk, then the note");
});
