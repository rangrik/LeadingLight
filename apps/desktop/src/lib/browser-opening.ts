import { createStore } from "./state.ts";
import { safeBrowserURL } from "./browser-data.ts";

// Settings can request navigation before its browser pane has mounted again.
export const browserOpening = createStore<{ base: string; url: string; id: string } | null>(null);
export function requestBrowserOpen(base: string, url: string) {
  if (safeBrowserURL(url)) browserOpening.set({ base, url, id: crypto.randomUUID() });
}
