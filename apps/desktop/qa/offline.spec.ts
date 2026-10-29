import { expect, test } from '@playwright/test';

// Seam: the shipped service worker must serve the editor and save notes after a network loss.
test('production workspace reads and writes offline', async ({ page, context }) => {
  test.skip(!process.env.OFFLINE_QA, 'Build and serve the production app at OFFLINE_QA first.');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.OFFLINE_QA!);
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Offline note');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await page.keyboard.type('These words stay with me.');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.waitForTimeout(11_000);
  await expect(page.getByText('Codex update available', { exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await page.reload();
  const body = page.getByRole('textbox', { name: 'Page body' });
  await expect(body).toContainText('These words stay with me.');
  await body.fill('Written offline.');
  await page.reload();
  await expect(body).toContainText('Written offline.');
  await page.getByRole('button', { name: 'History and authorship' }).click();
  await page.getByRole('menuitem', { name: 'Inspect authorship' }).click();
  await expect(page.getByRole('dialog')).toContainText('Written offline.');
  await expect(page.locator('[data-slot="sheet-popup"]')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `qa/report/offline-${test.info().project.name}.png` });
});
