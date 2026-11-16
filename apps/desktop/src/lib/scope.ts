import { useEffect } from "react";
import { linksIn } from "./doc-links";
import { localPrefs } from "./local-prefs";
import { objects, type ObjectSummary } from "./objects";
import { switchPanes } from "./panes";
import { BROWSER_VIEW, isPageView, pageOf, propOf, space } from "./space";
import { createStore } from "./state";

// What the sidebar and the page area are about (features/project-rail.feature): all, or one project.
export const ALL = "all";
export const scope = localPrefs("ll.scope", { id: ALL });

// The rail's projects: not done, oldest first, so their keys stay put.
export const railProjects = (pages: ObjectSummary[]) =>
  pages
    .filter((p) => p.typeId === "project" && !p.properties.templateOf && !(p.properties["project-status"] as unknown[] | undefined)?.includes("done"))
    .sort((a, b) => a.createdAt - b.createdAt);

// A page is a project's through a Project property, or because the project's body links it.
export const inProject = (p: ObjectSummary, project: string, linked: string[] = []) =>
  linked.includes(p.id) ||
  Object.entries(p.properties).some(([k, v]) => propOf(k)?.kind === "relation" && propOf(k)?.options.type === "project" && Array.isArray(v) && v.includes(project));

// What each project's body links to, read from its stored page again after saves settle.
const links = createStore<Record<string, string[]>>({});
export function useLinks(project: string) {
  const { saved } = space.use();
  useEffect(() => {
    if (project === ALL) return;
    let live = true;
    const t = window.setTimeout(() => void objects.get(project).then((o) => live && links.set({ ...links.get(), [project]: linksIn(o?.content ?? null) })), links.get()[project] ? 300 : 0);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [project, saved]);
  return links.use()[project];
}

// A kept tab whose page has gone is dropped, as on launch.
const exists = (view: string) => {
  const page = view.startsWith(BROWSER_VIEW) ? view.slice(BROWSER_VIEW.length).split("/")[0] : isPageView(view) ? view : "";
  return !page || !!pageOf(page);
};

// Switches the scope; the page area shows its own panes, or a project's page the first time.
export function choose(id: string) {
  if (id === scope.get().id) return;
  scope.set({ id });
  switchPanes(id === ALL ? "" : id, exists, id === ALL ? null : id);
}

// ⌘1 is All, ⌘2 on the rail's projects in order.
export function pick(n: number) {
  const id = [ALL, ...railProjects(space.get().pages).map((p) => p.id)][n - 1];
  if (id) choose(id);
}
