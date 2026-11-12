import { useStore } from "@/lib/store";
import { localPrefs } from "./local-prefs";

const prefs = localPrefs("ll.reading-mode", { previousTheme: "system" });
export const useReadingMode = () => ({ enabled: useStore((state) => state.themeId === "e-ink") });
const apply = (theme: string) => document.documentElement.toggleAttribute("data-eink", theme === "e-ink");
apply(useStore.getState().themeId);
useStore.subscribe((state, previous) => {
  if (state.themeId === previous.themeId) return;
  if (state.themeId === "e-ink") prefs.set({ previousTheme: previous.themeId });
  apply(state.themeId);
});
export function setReadingMode(enabled: boolean) {
  const state = useStore.getState();
  if (enabled === (state.themeId === "e-ink")) return;
  state.setTheme(enabled ? "e-ink" : prefs.get().previousTheme);
}
