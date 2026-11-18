import type { Page } from '@playwright/test';

// Use the same search controls as a person, rather than opening panes through stores.
export async function findPage(page: Page, name: string | RegExp) {
  const dialog = page.getByRole('dialog', { name: 'Search library', exact: true });
  if (!await dialog.getByRole('combobox').isVisible()) await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await dialog.getByRole('combobox').fill(typeof name === 'string' ? name : name.source.replace(/^\^|\$$/g, ''));
  return dialog.getByRole('option', { name, exact: true });
}

export async function findPinnedPage(page: Page, name: string) {
  const row = page.getByRole('navigation', { name: 'Pinned', exact: true }).getByRole('button', { name, exact: true });
  if (!await row.isVisible()) {
    const result = await findPage(page, name);
    if (await result.count()) await page.getByRole('dialog', { name: 'Search library', exact: true }).getByRole('button', { name: 'Pin', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  return row;
}
