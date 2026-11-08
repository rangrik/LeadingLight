// The Projects group (features/sidebar-work-first.feature): a row per project not done, those that
// need the person first, each unfolding to its tasks at work and its latest pages. Rows are COSS's
// sidebar rows; the chevron is a SidebarMenuAction moved to the row's left.
import { ChevronRight, Ellipsis } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { Dot } from "~/components/state-dot";
import { inProject, tasksAtWork } from "~/components/work-table";
import { isTask } from "~/lib/assign";
import { linkedIds } from "~/lib/doc-links";
import { pageLabel } from "~/lib/labels";
import { localPrefs } from "~/lib/local-prefs";
import { objects, type ObjectSummary } from "~/lib/objects";
import { focusedPage, openFrom, panes } from "~/lib/panes";
import { iconFor, listed, space, typeOf, typeView } from "~/lib/space";
import { taskState, type TaskState } from "~/lib/work-watch";
import { type Child, Children } from "./nav-projects";

const unfolded = localPrefs("ll.sidebar.projects", { open: [] as string[] });
const NEEDS = ["question", "approval", "review"];
const URGENT: TaskState[] = ["input", "review", "working"];
export const isProject = (p: ObjectSummary) => p.typeId === "project" && listed(p);
const going = (p: ObjectSummary) => !(p.properties["project-status"] as string[] | undefined)?.includes("done");
const notDone = (p: ObjectSummary) => p.properties.done !== true;

type Select = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => void;

// The pages its own page links to, read from the store once it is unfolded.
function useLinked(project: ObjectSummary, open: boolean) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let gone = false;
    void objects.get(project.id).then((o) => !gone && setIds(linkedIds(o?.content ?? null)));
    return () => void (gone = true);
  }, [project.id, project.updatedAt, open]);
  return ids;
}

function ProjectRow({ project, count, current, select }: { project: ObjectSummary; count: number; current?: string; select: Select }) {
  const { pages } = space.use();
  const open = unfolded.use().open.includes(project.id);
  const linked = useLinked(project, open);
  const name = pageLabel(project.title);
  const rank = (t: ObjectSummary) => (URGENT.indexOf(taskState(t.id)!) + 4) % 4;
  const tasks = tasksAtWork(project.id, pages)
    .filter(notDone)
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const state = URGENT.find((s) => tasks.some((t) => taskState(t.id) === s));
  const recent = pages
    .filter((p) => p.id !== project.id && listed(p) && !isTask(p) && !typeOf(p.typeId).made && (inProject(p, project.id) || linked.includes(p.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  const child = (p: ObjectSummary, id?: string): Child => ({
    id,
    name: pageLabel(p.title),
    isActive: p.id === current,
    onSelect: select((e) => openFrom(p.id, e)),
    onDrag: (e) => armDrag(e, { page: p.id, label: pageLabel(p.title) }),
  });
  const items = [...tasks.map((t) => child(t, t.id)), ...recent.map((p) => child(p))];
  const toggle = () => unfolded.set({ open: open ? unfolded.get().open.filter((id) => id !== project.id) : [...unfolded.get().open, project.id] });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-current={project.id === current ? "page" : undefined}
        className="ps-7 group-has-data-[sidebar=menu-action]/menu-item:pe-6"
        isActive={project.id === current}
        onClick={select((e) => openFrom(project.id, e))}
        onPointerDown={(e) => armDrag(e, { page: project.id, label: name })}
      >
        <RowIcon icon={iconFor(project)} />
        <span className="min-w-0 flex-1 basis-0 truncate">{name}</span>
        {count > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
            <span className="sr-only"> need you</span>
          </span>
        )}
      </SidebarMenuButton>
      <SidebarMenuAction aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${name}`} className="right-auto left-1.5" onClick={toggle}>
        <ChevronRight className={cn("transition-transform duration-150 ease-out", open && "rotate-90")} />
      </SidebarMenuAction>
      {/* Centred where the rows' More buttons and Recent's New page are. */}
      <Dot className="top-4 right-[11px]" state={state} />
      <AnimatePresence initial={false}>
        {open && <Children items={items.length ? items : [{ name: "Nothing here yet", isActive: false, disabled: true, onSelect: () => {} }]} />}
      </AnimatePresence>
    </SidebarMenuItem>
  );
}

export function NavWork({ select }: { select: Select }) {
  const { pages } = space.use();
  panes.use();
  const current = focusedPage();
  const feed = useFeed(true);
  const count = (id: string) => feed.filter((i) => i.project === id && NEEDS.includes(i.kind)).length;
  const latest = (p: ObjectSummary) => Math.max(p.updatedAt, ...pages.filter((x) => inProject(x, p.id)).map((x) => x.updatedAt));
  const projects = pages
    .filter((p) => isProject(p) && going(p))
    .map((p) => ({ p, n: count(p.id), at: latest(p) }))
    .sort((a, b) => Number(b.n > 0) - Number(a.n > 0) || b.at - a.at);
  if (!projects.length) return null;
  const all = typeView("project");
  return (
    <nav aria-label="Projects">
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarMenu>
          {projects.map(({ p, n }) => (
            <ProjectRow count={n} current={current} key={p.id} project={p} select={select} />
          ))}
          {/* sidebar-08's trailing "More" row, as All projects. */}
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-current={current === all ? "page" : undefined}
              className="ps-7 text-sidebar-foreground/70"
              isActive={current === all}
              onClick={select((e) => openFrom(all, e))}
              onPointerDown={(e) => armDrag(e, { page: all, label: typeOf("project").plural })}
            >
              <Ellipsis className="text-sidebar-foreground/70" />
              <span>All projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  );
}
