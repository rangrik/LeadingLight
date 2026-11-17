import type { Page } from '@playwright/test';

// Use the same search and Library controls as a person, rather than opening panes through stores.
export async function findPage(page: Page, name: string | RegExp) {
  await page.getByRole('textbox', { name: 'Search notes', exact: true }).fill(typeof name === "string" ? name : name.source);
  return page.getByRole('navigation', { name: 'Search results' }).getByRole('button', { name, exact: true });
}
