import { createStore } from "./state";

// True only inside the LeadingLight app itself. Other Tauri hosts (Shipyard's preview pane)
// expose Tauri's internals too, so check the app's identifier, not just for Tauri.
export const isNative: Promise<boolean> = (async () => {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  try {
    const { getIdentifier } = await import("@tauri-apps/api/app");
    // The real app or a worktree's dev app (scripts/install-dev-app.sh).
    return (await getIdentifier()).startsWith("com.leadinglight.");
  } catch {
    return false;
  }
})();

// Device capabilities are separate from storage: an iPad is native, but has no Mac processes.
const params = new URLSearchParams(location.search);
export const phone = /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent) || (import.meta.env.DEV && params.has("iphone"));
const preview = import.meta.env.DEV && (params.has("ipad") || params.has("iphone"));
export const platform = createStore(preview ? "ios" : "browser");
export const platformReady = isNative.then(async (native) => {
  const os = native ? await (await import("@tauri-apps/api/core")).invoke<string>("native_platform").catch(() => "unknown") : preview ? "ios" : "browser";
  platform.set(os);
  document.documentElement.toggleAttribute("data-ipad", os === "ios" || phone);
  document.documentElement.toggleAttribute("data-phone", phone);
  return os;
});
export const isDesktop = platformReady.then((os) => os === "macos");
export const isMobile = platformReady.then((os) => phone || (os !== "macos" && os !== "browser"));
export const useMobile = () => !["browser", "macos"].includes(platform.use()) || phone;
