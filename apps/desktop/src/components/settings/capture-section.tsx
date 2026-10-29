import { useEffect, useState } from "react";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Switch } from "@leadinglight/ui/components/switch";
import { ShortcutRow } from "~/components/settings/shortcuts-section";
import { isDesktop, useMobile } from "~/lib/platform";

// Settings › Capture (features/capture.feature). Open at login is the Mac app's: a browser has
// nothing to start.
export function CaptureSection() {
  const mobile = useMobile();
  const [native, setNative] = useState(false);
  const [atLogin, setAtLogin] = useState(false);
  useEffect(() => {
    void isDesktop.then(async (n) => {
      setNative(n);
      if (n) setAtLogin(await (await import("@tauri-apps/plugin-autostart")).isEnabled());
    });
  }, []);
  const setLogin = async (on: boolean) => {
    const auto = await import("@tauri-apps/plugin-autostart");
    await (on ? auto.enable() : auto.disable());
    setAtLogin(await auto.isEnabled());
  };
  return (
    <SettingsPage title="Capture" description="Ideas out of your head and into Today, from wherever you are.">
      <SettingsGroup>
        <ShortcutRow description={mobile ? "Opens quick capture while using LeadingLight with a keyboard." : "Opens the capture box over any app. In a browser, only in this window."} id="new-idea" label="New idea shortcut" />
        {!mobile && <SettingsRow label="Open at login" description={native ? "So the shortcut works after a restart." : "In the Mac app only."}>
          <Switch checked={atLogin} disabled={!native} onCheckedChange={(on) => void setLogin(on).catch(console.error)} />
        </SettingsRow>}
      </SettingsGroup>
    </SettingsPage>
  );
}
