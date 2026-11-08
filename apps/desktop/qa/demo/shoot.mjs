// Screenshots of a running option build: node shoot.mjs <port> <name> [today]
// Loads ?mac&demo (seeds an empty space, then reloads), waits, and saves built/<name>.png at 2x.
import { chromium } from "@playwright/test";
const [port, name, ...rest] = process.argv.slice(2);
const out = new URL("./built/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/?mac&demo`, { waitUntil: "load" });
// First visit seeds and reloads; wait for the sidebar's Types or Recent to show pages.
await page.waitForTimeout(6000);
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
await page.mouse.move(5, 5);
await page.screenshot({ path: `${out}${name}.png`, animations: "disabled" });
const clickText = rest.find((r) => r !== "today");
if (clickText) {
  await page.getByText(clickText, { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${out}${name}.png`, animations: "disabled" });
}
if (rest.includes("today")) {
  await page.getByRole("button", { name: "Today", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${out}${name}-today.png`, animations: "disabled" });
}
console.log("saved", name);
await browser.close();
