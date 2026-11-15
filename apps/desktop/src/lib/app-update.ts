import { newer } from "~/lib/clis";
import { localPrefs } from "~/lib/local-prefs";
import { isDesktop, platformReady } from "~/lib/platform";
import { createStore } from "~/lib/state";

// The app's own updates. The Mac app installs GitHub's latest release with Tauri's updater. An
// iPhone or iPad app can't replace itself, so there the button opens the release's install link
// and iOS asks to install it. In a browser build a stand-in plays it: ?update=0.9.0 offers that
// version, =fail breaks its install, =offline the check; with ?ipad or ?iphone it is the link.

export type AppUpdate = { state: "idle" | "checking" | "current" | "ready" | "installing" | "failed" | "unreachable"; version?: string; error?: string };
export const appUpdate = createStore<AppUpdate>({ state: "idle" });
// later: the version whose toast was answered, so it doesn't come back for that version.
export const updatePrefs = localPrefs("ll.update", { later: "" });
export const RELEASES = "https://github.com/rangrik/LeadingLight/releases/latest";
// iOS reads this release's manifest and offers to install its Ad Hoc build in place.
export const installLink = (version: string) =>
  `itms-services://?action=download-manifest&url=${encodeURIComponent(`https://github.com/rangrik/LeadingLight/releases/download/v${version}/LeadingLight_ios.plist`)}`;

const fake = import.meta.env.DEV ? new URLSearchParams(location.search).get("update") : null;
const ios = platformReady.then((os) => os === "ios");
// `tauri dev` is not an installed app, so it has nothing to replace.
const real = isDesktop.then((mac) => mac && !import.meta.env.DEV);
const realIos = ios.then((yes) => yes && !import.meta.env.DEV);
// How this app gets a new version, or null where it can't: the web app, a browser build.
export const updateWay: Promise<"app" | "link" | null> = Promise.all([real, ios]).then(([mac, onIos]) =>
  onIos ? (fake || !import.meta.env.DEV ? "link" : null) : mac || fake ? "app" : null,
);

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
let install: (() => Promise<void>) | null = null;

async function find(): Promise<{ version: string; install?: () => Promise<void> } | null> {
  if (await real) {
    const update = await (await import("@tauri-apps/plugin-updater")).check();
    if (!update) return null;
    return {
      version: update.version,
      install: async () => {
        await update.downloadAndInstall();
        await (await import("@tauri-apps/plugin-process")).relaunch();
      },
    };
  }
  if (await realIos) {
    const res = await fetch("https://api.github.com/repos/rangrik/LeadingLight/releases/latest");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const version = ((await res.json()) as { tag_name: string }).tag_name.replace(/^v/, "");
    return newer(version, __LL_VERSION__) ? { version } : null;
  }
  if (fake === "offline") throw new Error("offline");
  if (!fake || fake === "current") return null;
  const version = fake === "fail" ? "0.9.0" : fake;
  return {
    version,
    install: async () => {
      await pause(1500);
      if (fake === "fail") throw new Error("The download was interrupted.");
    },
  };
}

// asked: the person clicked Check for updates, so a failed check is said rather than kept quiet.
export async function checkForUpdate(asked = false): Promise<void> {
  const before = appUpdate.get();
  if (before.state === "checking" || before.state === "installing") return;
  if (asked) appUpdate.set({ state: "checking" });
  try {
    const found = await find();
    // An install that began while this check was out keeps its state and its update.
    if (appUpdate.get().state === "installing") return;
    install = found?.install ?? null;
    appUpdate.set(found ? { state: "ready", version: found.version } : { state: "current" });
  } catch {
    if (asked && appUpdate.get().state === "checking") appUpdate.set({ state: "unreachable" });
  }
}

// Resolves only in the stand-in: the real app restarts as the new version before this returns.
export async function installUpdate(): Promise<boolean> {
  const { version } = appUpdate.get();
  if (!install) return false;
  appUpdate.set({ state: "installing", version });
  try {
    await install();
    install = null;
    appUpdate.set({ state: "current" });
    return true;
  } catch (e) {
    appUpdate.set({ state: "failed", version, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
