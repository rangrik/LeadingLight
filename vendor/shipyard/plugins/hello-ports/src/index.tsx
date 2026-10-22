import type { BerthPluginContext, HomeWidgetProps, ScreenProps, Service, WorktreeSectionProps } from "@berth/plugin";
import { useBoxes, useWidgetData } from "@berth/plugin";
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Icon, Spinner, WidgetEmpty, WidgetRow, WidgetSkeleton } from "@berth/plugin/ui";
import { useEffect, useState } from "react";

// Hello ports: the smallest useful plugin, kept as an example of the SDK: a
// screen listing dev servers across boxes, a worktree section with the
// ports of the worktree in front, and an event handler.
// The built-in Dev servers plugin (plugins/dev-servers) does this properly.

interface Row extends Service {
  box: string;
}

// useServices polls every online box's services.
function useServices(berth: BerthPluginContext): Row[] | undefined {
  const boxes = useBoxes();
  const online = boxes.filter((b) => b.state === "online").map((b) => b.name);
  const key = online.join(",");
  const [rows, setRows] = useState<Row[]>();
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const all = await Promise.all(
        online.map((box) =>
          berth.api.services(box).then(
            (s) => s.map((x) => ({ ...x, box })),
            () => [] as Row[],
          ),
        ),
      );
      if (!cancelled) setRows(all.flat());
    };
    void load();
    const timer = setInterval(() => !document.hidden && void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // online is derived from key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, berth]);
  return rows;
}

function PortsScreen({ berth }: ScreenProps) {
  const rows = useServices(berth);
  return (
    <div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty className="mt-10">
          <EmptyHeader>
            <EmptyTitle>Nothing is listening</EmptyTitle>
            <EmptyDescription>Start a dev server in a worktree and it shows up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={`${r.box}:${r.port}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-14 font-mono">{r.port}</span>
              <span className="font-medium">{r.worktree}</span>
              <span className="text-muted-foreground">
                {r.location} · {r.box}
              </span>
              {r.main && <Badge variant="outline">main</Badge>}
              <span className="text-muted-foreground text-xs">{r.process}</span>
              <Button className="ml-auto" size="xs" variant="outline" onClick={() => berth.openUrl(berth.api.serviceUrl(r.box, r.port))}>
                <Icon name="ExternalLink" />
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// PortsHere is the worktree section: under the composer where work starts
// in a worktree, the ports listening in that worktree, one click from a
// browser tab beside the agent.
function PortsHere({ berth, box, path }: WorktreeSectionProps) {
  const rows = useServices(berth)?.filter((r) => r.box === box && r.path === path);
  if (!rows?.length) return <p className="px-2 text-muted-foreground text-xs">No ports open here yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5 px-2">
      {rows.map((r) => (
        <Button key={r.port} size="xs" variant="outline" onClick={() => berth.openBrowser(berth.api.serviceUrl(r.box, r.port))}>
          <Icon name="Radio" />
          {r.port}
          {r.process && <span className="text-muted-foreground">{r.process}</span>}
        </Button>
      ))}
    </div>
  );
}

// PortsWidget is a Home widget: the ports listening on every box. Home
// draws its card and menu; useWidgetData keeps the last read, shows it at
// once, and reads again every 30s, only while the widget is on screen.
function PortsWidget({ berth, size }: HomeWidgetProps) {
  const online = useBoxes()
    .filter((b) => b.state === "online")
    .map((b) => b.name);
  const { data } = useWidgetData<Row[]>(
    `ports:${online.join(",")}`,
    async () => (await Promise.all(online.map((box) => berth.api.services(box).then((s) => s.map((x) => ({ ...x, box })), () => [] as Row[])))).flat(),
    { every: 30_000 },
  );
  if (!data) return <WidgetSkeleton rows={3} />;
  if (!data.length) return <WidgetEmpty scene="dock" title="Nothing is listening" compact />;
  return (
    <div>
      {data.slice(0, size === "t" ? 8 : 3).map((r) => (
        <WidgetRow key={`${r.box}:${r.port}`} onClick={() => berth.openUrl(berth.api.serviceUrl(r.box, r.port))}>
          <span className="w-12 shrink-0 font-mono text-xs">:{r.port}</span>
          <span className="min-w-0 flex-1 truncate">{r.worktree}</span>
          <span className="text-muted-foreground text-xs">{r.box}</span>
        </WidgetRow>
      ))}
    </div>
  );
}

export default function activate(berth: BerthPluginContext) {
  berth.addHomeWidget({ id: "ports", title: "Hello ports", description: "Every port listening on every box. From the hello-ports example plugin.", icon: "Radio", sizes: ["s", "m", "t"], category: "Fleet", source: "Each online box's services, every 30s while on screen", Component: PortsWidget });
  berth.addScreen({ id: "ports", title: "Hello ports", description: "Everything listening in a worktree, on every box. From the hello-ports plugin.", Component: PortsScreen });
  berth.addSidebarItem({ id: "ports", title: "Hello ports", icon: "Radio", screen: "ports" });
  berth.addWorktreeSection({ id: "ports", title: "Hello ports", Component: PortsHere });
  berth.addCommand({ id: "ports", title: "Show dev servers", group: "Hello ports", run: () => berth.openScreen("ports") });
  berth.on("worktree.created", (e) => berth.notify("New worktree", `${String(e.data?.name ?? "")} on ${e.box ?? "a box"}`));
}
