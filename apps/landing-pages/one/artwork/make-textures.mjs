import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1700 }, deviceScaleFactor: 1 });
for (const side of ['left', 'right']) {
  const svg = readFileSync(new URL(`${side}-page.svg`, import.meta.url), 'utf8');
  await page.goto('data:image/svg+xml,' + encodeURIComponent(svg));
  await page.screenshot({ path: fileURLToPath(new URL(`${side}-page.png`, import.meta.url)) });
}
await browser.close();
