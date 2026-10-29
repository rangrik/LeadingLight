import { useEffect, useState } from "react";
import { isNative } from "~/lib/platform";
import { ask } from "~/lib/project-runtime/transport";
import { personalTab } from "~/lib/browser-data";
import { saveBrowserDownload } from "~/lib/browser-files";

export type BrowserDownloadPreferences = { enabled: boolean; ask: boolean; directory: string; defaultDirectory: string };
const route = "/v1/browser/download-settings";
export const readBrowserDownloadPreferences = () => ask<BrowserDownloadPreferences>("GET", route);
export async function updateBrowserDownloadPreferences(change: Partial<Pick<BrowserDownloadPreferences, "enabled" | "ask" | "directory">>) {
  const next = await ask<BrowserDownloadPreferences>("PUT", route, change);
  window.dispatchEvent(new Event("ll:browser-download-preferences"));
  return next;
}

export function useBrowserDownloadPreferences() {
  const [prefs, setPrefs] = useState<BrowserDownloadPreferences | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const read = () => void readBrowserDownloadPreferences().then((next) => { if (live) { setPrefs(next); setError(""); } }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    read(); window.addEventListener("ll:browser-download-preferences", read);
    return () => { live = false; window.removeEventListener("ll:browser-download-preferences", read); };
  }, []);
  return { prefs, error };
}

let prompts = Promise.resolve();
const queued = new Set<string>();

// Persist the claim before showing a dialog, including when the app later closes or the user cancels.
export async function promptBrowserDownloads(base: string, live = () => true) {
  const prefs = await readBrowserDownloadPreferences();
  if (!prefs.enabled || !prefs.ask || !live()) return;
  const { downloads } = await ask<{ downloads: { id: string; tab: string; state: string; exportState?: string }[] }>("GET", `${base}/downloads`);
  const waiting: Promise<void>[] = [];
  for (const download of downloads) {
    const key = `${base}/${download.id}`;
    if (download.state !== "completed" || download.exportState || !personalTab(download.tab) || queued.has(key)) continue;
    queued.add(key);
    const next = prompts.catch(() => {}).then(async () => {
      if (!live()) return;
      const current = await readBrowserDownloadPreferences();
      if (!current.enabled || !current.ask || !live()) return;
      const route = `${base}/downloads/${encodeURIComponent(download.id)}/prompt`;
      const claim = await ask<{ claimed: boolean; tab: string; id: string }>("POST", route);
      if (!claim.claimed) return;
      let savedPath = "";
      let error = "";
      try {
        if (live()) await saveBrowserDownload(base, claim.tab, claim.id, { directory: current.directory, canPrompt: live, onSaved: (path) => { savedPath = path; } });
      } catch (e) { error = e instanceof Error ? e.message : String(e); }
      await ask("PUT", route, savedPath ? { savedPath } : error ? { error } : { cancelled: true });
      if (error) throw new Error(`Could not save the download. ${error} Use Save in Downloads to try again.`);
    }).finally(() => { queued.delete(key); });
    prompts = next;
    waiting.push(next);
  }
  const results = await Promise.allSettled(waiting);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

export function useNativeBrowserDownloads(base?: string) {
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let timer = 0;
    setError("");
    void isNative.then(async (native) => {
      if (!native || !live) return;
      const current = await readBrowserDownloadPreferences();
      if (!current.enabled && live) await updateBrowserDownloadPreferences({ enabled: true });
      const read = async () => {
        if (!base || !live) return;
        try { await promptBrowserDownloads(base, () => live); }
        catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
        if (live) timer = window.setTimeout(read, 1500);
      };
      await read();
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; window.clearTimeout(timer); };
  }, [base]);
  return { error };
}
