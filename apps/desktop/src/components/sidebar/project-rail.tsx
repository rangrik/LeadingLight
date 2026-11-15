// The project rail (features/project-rail.feature): All, then each project not done. Choosing one
// narrows the sidebar and the page area to it. Its buttons are the sidebar's own menu buttons.
import { Layers } from "lucide-react";
import { useEffect } from "react";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@leadinglight/ui/components/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { useFeed } from "~/components/feed";
import { PageIconView } from "~/components/page-icon";
import { StateDot } from "~/components/state-dot";
import { agentOfTask, isTask } from "~/lib/assign";
import type { FeedItem } from "~/lib/feed";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { COLORS, readIcon } from "~/lib/page-meta";
import type { Session } from "~/lib/project-runtime/chat";
import { ALL, choose, inProject, railProjects, scope } from "~/lib/scope";
import { space, typeOf } from "~/lib/space";
import { sessions, stateOf, type TaskState } from "~/lib/work-watch";

// What waits on the person in a project (its Feed items), else whether its agents are at work.
function status(project: string, items: FeedItem[], live: Map<string, Session>): { line: string; dot?: TaskState } {
  const tasks = space.get().pages.filter((p) => isTask(p) && inProject(p, project));
  const ids = new Set(tasks.map((t) => t.id));
  const mine = items.filter((i) => i.project === project || (i.task !== undefined && ids.has(i.task)));
  if (mine.length) return { line: `${mine.length} need${mine.length === 1 ? "s" : ""} you`, dot: mine.some((i) => i.kind === "question" || i.kind === "approval") ? "input" : "review" };
  const working = tasks.some((t) => {
    const agent = agentOfTask(t);
    return agent && ["working", "starting"].includes(stateOf(t, agent, live));
  });
  return { line: working ? "working" : "quiet" };
}

// The project's own icon; without one, its first letter on its type's colour.
function Mark({ project }: { project: ObjectSummary }) {
  const icon = readIcon(project.properties.icon);
  if (icon) return <PageIconView icon={icon} />;
  const band = COLORS[typeOf(project.typeId).color ?? "gray"].band;
  return <span className={cn("flex size-5 items-center justify-center rounded-[5px] font-semibold text-[11px]", band)}>{[...pageLabel(project.title)][0]?.toUpperCase()}</span>;
}

function RailButton({ name, n, active, line, dot, onSelect, children }: { name: string; n: number; active: boolean; line?: string; dot?: TaskState; onSelect: () => void; children: React.ReactNode }) {
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={<SidebarMenuButton aria-current={active || undefined} aria-label={name} className="size-8 justify-center p-0" isActive={active} onClick={onSelect} />}
        >
          {children}
        </TooltipTrigger>
        <TooltipPopup side="right">
          {name} {n <= 9 && <Kbd>⌘{n}</Kbd>}
          {line && <span className="block text-muted-foreground">{line}</span>}
        </TooltipPopup>
      </Tooltip>
      {dot && <StateDot className="pointer-events-none top-0.5 right-0.5 translate-y-0" state={dot} />}
    </SidebarMenuItem>
  );
}

export function ProjectRail() {
  const { pages } = space.use();
  const { id } = scope.use();
  // Gone with the sidebar, and while it is a sheet in a narrow window.
  const { open, isMobile } = useSidebar();
  const shown = open && !isMobile;
  const items = useFeed(true);
  const live = sessions.use();
  const projects = railProjects(pages);
  const gone = id !== ALL && pages.length > 0 && !projects.some((p) => p.id === id);
  // A project deleted or done leaves the rail; its pages are All's again.
  useEffect(() => void (gone && choose(ALL)), [gone]);
  return (
    // The hairline is a half-pixel shadow, as the bar's. It folds away over the sidebar.
    <nav
      aria-label="Projects"
      className={cn("relative z-20 w-(--rail-width) shrink-0 overflow-hidden bg-sidebar shadow-[inset_-0.5px_0_0_var(--color-border)] transition-[width] duration-200 ease-linear", !shown && "w-0")}
      data-tauri-drag-region
      inert={!shown || undefined}
    >
      {/* Level with the sidebar header's logo tile, below the traffic lights. */}
      <SidebarMenu className="w-(--rail-width) items-center gap-1 pt-[calc(var(--traffic-top)_+_1.5rem)]">
        <RailButton active={id === ALL} n={1} name="All" onSelect={() => choose(ALL)}>
          <Layers />
        </RailButton>
        {projects.map((p, i) => (
          <RailButton active={id === p.id} key={p.id} n={i + 2} name={pageLabel(p.title)} onSelect={() => choose(p.id)} {...status(p.id, items, live)}>
            <Mark project={p} />
          </RailButton>
        ))}
      </SidebarMenu>
    </nav>
  );
}
