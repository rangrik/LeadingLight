import { localPrefs } from "~/lib/local-prefs";
import { platform, useMobile } from "~/lib/platform";

// Keep the saved preference, but never start Mac project processes on an iPad.
const saved = localPrefs("ll.projects", { enabled: false });
export const projectPrefs = {
  ...saved,
  get: () => ({ ...saved.get(), enabled: saved.get().enabled && ["macos", "browser"].includes(platform.get()) }),
  use: () => {
    const prefs = saved.use();
    const mobile = useMobile();
    return { ...prefs, enabled: prefs.enabled && !mobile };
  },
};
