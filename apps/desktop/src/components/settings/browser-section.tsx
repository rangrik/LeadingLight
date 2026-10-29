import { useEffect, useState } from "react";
import { closeSettings } from "@/views/settings/open";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Input } from "@leadinglight/ui/components/input";
import { Switch } from "@leadinglight/ui/components/switch";
import { BrowserDeveloperSetting } from "~/components/browser-developer";
import { BrowserClearData, type BrowserClearSelection } from "~/components/browser-clear-data";
import { clearBrowserHistory } from "~/lib/browser-data";
import { useSavedBrowserComments } from "~/lib/browser-annotations";
import { detachBrowser } from "~/lib/browser-context";
import { requestBrowserOpen } from "~/lib/browser-opening";
import { updateBrowserDownloadPreferences, useBrowserDownloadPreferences, useNativeBrowserDownloads } from "~/lib/browser-preferences";
import { openPage } from "~/lib/panes";
import { isDesktop } from "~/lib/platform";
import { browserBase, useBrowserData } from "~/lib/project-runtime/browser";
import { ask } from "~/lib/project-runtime/transport";
import { browserView } from "~/lib/space";

export function BrowserSection() {
  const { prefs, error: readError } = useBrowserDownloadPreferences();
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [base, setBase] = useState("");
  const { error: activationError } = useNativeBrowserDownloads();
  useEffect(() => {
    let live = true;
    void isDesktop.then((next) => { if (live) setNative(next); });
    void ask<{ location: string; worktree: string }>("POST", "/v1/browser/workspace").then((w) => { if (live) setBase(browserBase(w.location, w.worktree)); }, (e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  const change = async (run: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const choose = () => change(async () => {
    const path = await (await import("@tauri-apps/plugin-dialog")).open({ title: "Choose download folder", directory: true, multiple: false, defaultPath: prefs?.directory });
    if (typeof path === "string") await updateBrowserDownloadPreferences({ directory: path });
  });
  return <SettingsPage title="Browser" description="A separate browser profile for your pages and agents.">
    {(error || readError || activationError) && <p className="text-sm text-destructive-foreground" role="alert">{error || readError || activationError}</p>}
    <SettingsGroup title="Downloads">
      <SettingsRow className="flex-col items-stretch gap-3" label="Download location" description={native ? "Completed personal-browser downloads are copied here. Existing files keep their names." : "Choose a download folder in the Mac app. This browser uses its own save dialog."}>
        <div className="min-w-0 flex-1 space-y-3">
        <p className="break-all text-sm text-muted-foreground">{prefs?.directory || "Loading…"}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={!native || busy || !prefs} onClick={() => void choose()} size="sm" variant="outline">Choose folder…</Button><Button disabled={!native || busy || !prefs || prefs.directory === prefs.defaultDirectory} onClick={() => void change(() => updateBrowserDownloadPreferences({ directory: "" }))} size="sm" variant="ghost">Reset to Downloads</Button></div>
        </div>
      </SettingsRow>
      <SettingsRow label="Ask where to save downloads" description={native ? "Choose a destination when each personal download finishes. Cancelled saves remain in the browser’s Downloads list." : "Change this in the Mac app. This browser uses its own download settings."}><Switch aria-label="Ask where to save downloads" checked={prefs?.ask ?? false} disabled={!native || busy || !prefs} onCheckedChange={(checked) => void change(() => updateBrowserDownloadPreferences({ ask: checked }))} /></SettingsRow>
    </SettingsGroup>
    <BrowserDeveloperSetting />
    <BrowserCommentSettings />
    {base && <BrowserHistorySettings base={base} />}
  </SettingsPage>;
}

function BrowserCommentSettings() {
  const { count, clearAll } = useSavedBrowserComments();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return <SettingsGroup title="Saved feedback"><SettingsRow label={`${count} saved ${count === 1 ? "comment" : "comments"}`} description="Comments from all workspaces, including pages you no longer visit.">
    <Button disabled={!count} onClick={() => { setError(""); setOpen(true); }} size="sm" variant="outline">Remove saved comments…</Button>
    <Dialog onOpenChange={setOpen} open={open}><DialogPopup className="sm:max-w-md"><DialogHeader><DialogTitle>Remove saved browser comments?</DialogTitle><DialogDescription>This removes saved comments from all workspaces. Comments and images already attached to a chat stay in that chat.</DialogDescription></DialogHeader>
      {error && <DialogPanel><p className="text-sm text-destructive-foreground" role="alert">{error}</p></DialogPanel>}
      <DialogFooter><Button onClick={() => setOpen(false)} variant="outline">Cancel</Button><Button onClick={() => { try { clearAll(); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} variant="destructive">Remove saved comments</Button></DialogFooter>
    </DialogPopup></Dialog>
  </SettingsRow></SettingsGroup>;
}

function BrowserHistorySettings({ base }: { base: string }) {
  const [data, update] = useBrowserData(base);
  const [filter, setFilter] = useState("");
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clear = async ({ history, website, range }: BrowserClearSelection) => {
    setBusy(true); setError("");
    try {
      if (website) { await ask("DELETE", `${base}/profile`, { confirm: true }); detachBrowser(""); }
      update((d) => ({ ...(history ? clearBrowserHistory(d, range) : d), ...(website ? { tabs: [], closed: [], selected: "" } : {}) }));
      setClearing(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const entries = data.history.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(filter.toLowerCase()));
  return <SettingsGroup title="Personal browser history">
    <SettingsRow className="flex-col items-stretch gap-3" label="Visited pages" description="Project browsers have their own history in the browser menu.">
      <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap gap-2"><Input aria-label="Search browser history" className="min-w-0 flex-1" onChange={(e) => setFilter(e.target.value)} placeholder="Search history" size="sm" value={filter} /><Button onClick={() => { setError(""); setClearing(true); }} size="sm" variant="outline">Clear browsing data…</Button></div>
      <div className="max-h-96 overflow-auto">{entries.map((entry) => <div className="flex min-w-0 items-center gap-2" key={entry.url}><Button className="h-auto min-w-0 flex-1 justify-start py-2 text-left sm:h-auto" onClick={() => { requestBrowserOpen(base, entry.url); closeSettings(); openPage(browserView("")); }} variant="ghost"><span className="min-w-0"><span className="block truncate">{entry.title}</span><span className="block truncate text-xs font-normal text-muted-foreground">{entry.url}</span></span></Button><Button aria-label={`Remove history ${entry.title}`} onClick={() => update((d) => ({ ...d, history: d.history.filter((x) => x.url !== entry.url) }))} size="xs" variant="ghost">Remove</Button></div>)}{!entries.length && <p className="py-3 text-sm text-muted-foreground">{filter ? "No matching pages." : "No browsing history."}</p>}</div>
      <BrowserClearData busy={busy} error={error} onClear={clear} onClose={() => setClearing(false)} open={clearing} />
      </div>
    </SettingsRow>
  </SettingsGroup>;
}
