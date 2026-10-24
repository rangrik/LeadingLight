import { isNative } from "./platform";

// A page's link, for pasting into another page, where it becomes an @mention; as text, "@Title".
export function copyPageLink(id: string, title: string): Promise<void> {
  const span = document.createElement("span");
  span.dataset.mention = id;
  span.textContent = `@${title}`;
  const blob = (text: string, type: string) => new Blob([text], { type });
  return navigator.clipboard.write([new ClipboardItem({ "text/html": blob(span.outerHTML, "text/html"), "text/plain": blob(span.textContent, "text/plain") })]);
}

// Links open outside the app: the system browser in the app, a new tab in a browser.
export function openLink(href: string): void {
  void isNative.then(async (native) => {
    if (!native) return void window.open(href, "_blank", "noopener");
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  });
}
