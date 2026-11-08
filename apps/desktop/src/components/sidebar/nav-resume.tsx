import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { useFeed } from "~/components/feed";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import type { FeedItem } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import type { ObjectSummary } from "~/lib/objects";
import { focusedPage, openFrom, panes } from "~/lib/panes";
import { iconFor, listed, pageOf, propOf, space, typeOf } from "~/lib/space";
import { AGENT, reportsOn, taskOfAgent } from "~/lib/work";

// Resume (features/sidebar-resume.feature): where you were, what needs you, and the other thread,
// made from the records each time as the Feed is (DECISIONS.md, 23).

const WAITS: Partial<Record<FeedItem["kind"], string>> = { question: "Asks a question", approval: "Asks for approval", review: "Report ready" };

// A Project page is its own project; any other page is in those its project relations name.
const projectsOf = (p: ObjectSummary) =>
  p.typeId === "project" ? [p.id] : Object.entries(p.properties).flatMap(([k, v]) => (propOf(k)?.kind === "relation" && propOf(k)?.options.type === "project" && Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));

function pick(pages: ObjectSummary[], feed: FeedItem[]) {
  const ask = feed.filter((i) => WAITS[i.kind] && pageOf(i.task ?? "")).sort((a, b) => b.at - a.at)[0];
  // A task given to an agent is the agent's to edit; it comes back here when it needs you.
  const given = new Set(pages.flatMap((p) => (p.typeId === AGENT ? [taskOfAgent(p)] : [])));
  const own = pages.filter((p) => listed(p) && !typeOf(p.typeId).made && !given.has(p.id) && p.id !== ask?.task).sort((a, b) => b.updatedAt - a.updatedAt);
  const here = own[0];
  const near = here ? projectsOf(here) : [];
  const other = here && own.find((p) => (near.length || projectsOf(p).length) && !projectsOf(p).some((id) => near.includes(id)));
  return [here && { page: here }, ask && { page: pageOf(ask.task!)!, ask }, other && { page: other }].filter((r) => !!r);
}

// The project, then what changed since you left: what the agent waits on, a newer report, or when.
function since(p: ObjectSummary, ask?: FeedItem) {
  const project = projectsOf(p).find((id) => id !== p.id && pageOf(id));
  const report = reportsOn(p.id).at(-1);
  const change = ask ? WAITS[ask.kind] : report && report.createdAt > p.updatedAt ? "Report arrived" : formatAgo(p.updatedAt);
  return [project && pageLabel(pageOf(project)!.title), change].filter(Boolean).join(" · ");
}

export function NavResume({ select }: { select: (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => void }) {
  const { pages } = space.use();
  panes.use();
  const current = focusedPage();
  const rows = pick(pages, useFeed(true));
  if (!rows.length) return null;
  return (
    <nav aria-label="Resume">
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Resume</SidebarGroupLabel>
        <SidebarMenu>
          {rows.map(({ page, ask }) => (
            <SidebarMenuItem key={page.id}>
              <SidebarMenuButton
                aria-current={page.id === current ? "page" : undefined}
                isActive={page.id === current}
                onClick={select((e) => openFrom(page.id, e))}
                onPointerDown={(e) => armDrag(e, { page: page.id, label: pageLabel(page.title) })}
                size="lg"
              >
                <RowIcon icon={iconFor(page)} />
                <span className="grid flex-1">
                  <span className="truncate">{pageLabel(page.title)}</span>
                  <span className="truncate font-normal text-muted-foreground text-xs">{since(page, ask)}</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  );
}
