import { useStore } from "@/lib/store";

// Settings on a section, scrolled to one group; Settings loads on first use, so wait up to 3 s for it.
export function openSettingsAt(section: string, group: string) {
  useStore.getState().setView({ kind: "settings", section });
  const until = Date.now() + 3000;
  const find = () => {
    const h = [...document.querySelectorAll(`[data-testid="settings-${section}"] h2`)].find((e) => e.textContent === group);
    if (h) h.scrollIntoView({ block: "start" });
    else if (Date.now() < until) setTimeout(find, 50);
  };
  find();
}
