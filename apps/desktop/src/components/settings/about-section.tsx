import { ExternalLink } from "lucide-react";
import { SettingsGroup, SettingsPage, SettingsRow, Value } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { openLink } from "~/lib/links";

// Our About: which build this is, and what it is built on. Shipyard's own About
// (vendor/shipyard/app/src/views/settings/about-section.tsx) is about boxes and berthd.
const built = new Date(__LL_BUILT__).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AboutSection() {
  return (
    <SettingsPage title="About" description={`LeadingLight ${__LL_VERSION__}`}>
      <SettingsGroup title="This build">
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
