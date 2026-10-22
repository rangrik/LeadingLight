import { isNative } from "./platform";

// Links open outside the app: the system browser in the app, a new tab in a browser.
export function openLink(href: string): void {
  void isNative.then(async (native) => {
    if (!native) return void window.open(href, "_blank", "noopener");
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  });
}
