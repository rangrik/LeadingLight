import { useEffect, useState } from "react";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Switch } from "@leadinglight/ui/components/switch";
import { isNative } from "~/lib/platform";

// Settings › Capture (features/capture.feature). Open at login is the Mac app's: a browser has
// nothing to start.
export function CaptureSection() {
  const [native, setNative] = useState(false);
  const [atLogin, setAtLogin] = useState(false);
  useEffect(() => {
    void isNative.then(async (n) => {
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
        <SettingsRow label="New idea shortcut" description="Opens the capture box over any app. In a browser, while this window has the keyboard.">
          <Kbd className="h-6 px-1.5 text-sm">⌃⌥I</Kbd>
        </SettingsRow>
        <SettingsRow label="Open at login" description={native ? "So the shortcut works after a restart." : "In the Mac app only."}>
          <Switch checked={atLogin} disabled={!native} onCheckedChange={(on) => void setLogin(on).catch(console.error)} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
