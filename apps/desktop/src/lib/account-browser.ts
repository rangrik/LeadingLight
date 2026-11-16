import { platformReady } from './platform';

// Keep account sign-ins and their Google cookies together on the Mac.
export async function openAccountBrowser(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url, await platformReady === 'macos' ? 'Safari' : undefined);
}
