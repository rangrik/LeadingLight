import { useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { toastManager } from "@leadinglight/ui/components/toast";
import { appUpdate, checkForUpdate, installLink, installUpdate, RELEASES, updatePrefs, updateWay } from "~/lib/app-update";
import { openLink } from "~/lib/links";

// Says when a newer LeadingLight is ready, 30 s after the app opens (once the tools' toast has had
// its 15 s) and every four hours, and installs it from the toast or from Settings › About. On
// iPhone and iPad the button opens the install link, and iOS asks before installing.

let byLink = false;
void updateWay.then((way) => (byLink = way === "link"));

let showing: string | null = null;
let showingVersion = "";
let checking = false, lastCheck = 0;
// The failure toast stays until answered, so a retry or a newer offer takes it away.
let failed: string | null = null;
const close = (id: string | null) => id && toastManager.close(id);

export async function updateAndRestart() {
  const { state, version } = appUpdate.get();
  if (state !== "ready" && state !== "failed") return;
  close(showing);
  if (byLink) return openLink(installLink(version!));
  close(failed);
  const id = toastManager.add({ type: "loading", title: `Updating to LeadingLight ${version}…`, timeout: 0 });
  if (await installUpdate()) return toastManager.close(id);
  failed = id;
  toastManager.update(id, {
    type: "error",
    title: "Couldn't update LeadingLight",
    timeout: 0,
    description: (
      <span className="flex flex-col items-start gap-2">
        <span className="whitespace-pre-wrap break-words">{appUpdate.get().error}</span>
        <span className="flex gap-1.5">
          <Button
            onClick={() => {
              openLink(RELEASES);
              toastManager.close(id);
            }}
            size="xs"
            variant="outline"
          >
            Download
          </Button>
          <Button onClick={() => toastManager.close(id)} size="xs" variant="ghost">
            Dismiss
          </Button>
        </span>
      </span>
    ),
  });
}

async function check() {
  if (checking || !navigator.onLine) return;
  checking = true; lastCheck = Date.now();
  try { await checkForUpdate(); } finally { checking = false; }
  const { state, version } = appUpdate.get();
  if (state !== "ready" || !version || (showing && version === showingVersion) || version === updatePrefs.get().later) return;
  close(showing);
  close(failed);
  const id = toastManager.add({
    type: "info",
    timeout: 0,
    title: `LeadingLight ${version} is ready`,
    description: (
      <span className="flex gap-1.5">
        <Button onClick={() => void updateAndRestart()} size="xs">
          {byLink ? "Update" : "Update and restart"}
        </Button>
        <Button
          onClick={() => {
            updatePrefs.set({ later: version });
            toastManager.close(id);
          }}
          size="xs"
          variant="ghost"
        >
          Later
        </Button>
      </span>
    ),
    onClose: () => {
      if (showing === id) showing = null;
    },
  });
  showing = id;
  showingVersion = version;
}

export function AppUpdates() {
  useEffect(() => {
    let resumed: number | undefined;
    const resume = () => {
      window.clearTimeout(resumed);
      resumed = window.setTimeout(check, Math.max(0, 5 * 60_000 - (Date.now() - lastCheck)));
    };
    const foreground = () => { if (document.visibilityState === "visible") resume(); };
    const first = window.setTimeout(check, 30_000);
    const again = window.setInterval(check, 4 * 3_600_000);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", resume);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
      window.clearTimeout(resumed);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", resume);
    };
  }, []);
  return null;
}
