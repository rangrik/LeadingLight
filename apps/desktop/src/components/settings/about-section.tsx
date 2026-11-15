import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsPage, SettingsRow, Value } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { updateAndRestart } from "~/components/app-update";
import { appUpdate, checkForUpdate, updatable } from "~/lib/app-update";
import { openLink } from "~/lib/links";

// Our About: which build this is, and what it is built on. Shipyard's own About
// (vendor/shipyard/app/src/views/settings/about-section.tsx) is about boxes and berthd.
const built = new Date(__LL_BUILT__).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Only where the app can replace itself: the Mac app, not the web or a phone.
function VersionRow() {
  const update = appUpdate.use();
  const offered = update.state === "ready" || update.state === "failed";
  const installing = update.state === "installing";
  const busy = update.state === "checking" || installing;
  const says = {
    idle: "Checked every four hours.",
    checking: "Checking…",
    current: "Up to date",
    ready: `${update.version} is ready`,
    installing: `Updating to ${update.version}…`,
    failed: `Couldn't update to ${update.version}`,
    unreachable: "Couldn't check for updates",
  }[update.state];
  return (
    <SettingsRow label="Version" description={says}>
      <Value>{__LL_VERSION__}</Value>
      <Button disabled={busy} onClick={() => void (offered ? updateAndRestart() : checkForUpdate(true))} size="sm" variant={offered || installing ? "default" : "outline"}>
        {offered || installing ? "Update and restart" : "Check for updates"}
      </Button>
    </SettingsRow>
  );
}

export function AboutSection() {
  const [canUpdate, setCanUpdate] = useState(false);
  useEffect(() => void updatable.then(setCanUpdate), []);
  return (
    <SettingsPage title="About" description={`LeadingLight ${__LL_VERSION__}`}>
      <SettingsGroup title="This build">
        {canUpdate && <VersionRow />}
        <SettingsRow label="Build" description="The commit it was built from. “+dirty” means uncommitted changes went in.">
          <Value>{__LL_COMMIT__}</Value>
        </SettingsRow>
        <SettingsRow label="Built">
          <Value>{built}</Value>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Built on">
        <SettingsRow label="Shipyard" description="The themes' engine, Settings and the agent code come from cosscom/shipyard, MIT.">
          <Value>
            {__BERTH_VERSION__} · {__BERTH_COMMIT__}
          </Value>
          <Button onClick={() => openLink("https://github.com/cosscom/shipyard")} size="sm" variant="ghost">
            Source
            <ExternalLink />
          </Button>
        </SettingsRow>
        <SettingsRow label="Themes" description="Dracula, Catppuccin, Nord and the other ports keep their authors' MIT notices.">
          <Button onClick={() => openLink("https://github.com/cosscom/shipyard/blob/main/THIRD_PARTY_THEMES.md")} size="sm" variant="ghost">
            Notices
            <ExternalLink />
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
