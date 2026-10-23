import { useStore } from "@/lib/store";

// Project settings are one repository on one box: setup, environment,
// ports, services, agents, automations and skills. They are a full page
// (views/project); anything that opens them (the sidebar, the Run menu)
// calls openProjectSettings.
export function openProjectSettings(box: string, location: string) {
  useStore.getState().setView({ kind: "project", box, location });
}
