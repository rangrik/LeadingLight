import type { BerthEvent, Location, Worktree } from "@/lib/api";
import { hostSuffix, portUrl, worktreeHost } from "@/lib/browser-url";
import { leaves } from "@/lib/layout";
import { route } from "@/lib/notifications";
import { useStore } from "@/lib/store";
import { activateTab, focusPane, openTab, refOf, selectWorktree, setPaneContent, splitPane, useWorkspaces, wsKey } from "@/lib/workspaces";

// An agent on a box runs `berthd preview` to show the person a page: the
// event names the worktree, the port and the path. The page opens beside the
// person's terminal when they are looking at that worktree, and otherwise
// waits behind a
// notification, so an agent never pulls them away from what they do.

export function previewUrl(box: string, loc: Location, wt: Worktree, port: number, urlPath = "/"): string {
  const store = useStore.getState();
  const urlPort = store.status?.proxy.url_port;
  const ref = refOf(box, loc, wt);
  const host = worktreeHost(ref);
  // A worktree's own first port is what its name reaches.
  const base =
    host && port === wt.port
      ? `http://${host}${hostSuffix(urlPort)}/`
      : (portUrl(port, {
          ref,
          services: store.boxes[box]?.services,
          urlPort,
        }) ?? `http://${port}.${box}.localhost${hostSuffix(urlPort)}/`);
  return base.replace(/\/$/, "") + (urlPath.startsWith("/") ? urlPath : `/${urlPath}`);
}

function find(box: string, data: Record<string, unknown>): { loc: Location; wt: Worktree } | undefined {
  const locations = useStore.getState().boxes[box]?.locations ?? [];
  const path = data.path as string | undefined;
  for (const loc of locations) {
    const wt = loc.worktrees?.find((w) => w.path === path) ?? (loc.name === data.location ? loc.worktrees?.find((w) => w.name === data.name) : undefined);
    if (wt) return { loc, wt };
  }
  return undefined;
}

// showPreview opens url in the worktree's workspace: in a browser pane that
// already shows the same server, or beside the focused pane.
function showPreview(box: string, loc: Location, wt: Worktree, url: string) {
  const key = wsKey(box, wt.path);
  if (useWorkspaces.getState().current !== key || useStore.getState().view.kind !== "workspace") selectWorktree(refOf(box, loc, wt));
  const ws = useWorkspaces.getState().spaces[key];
  const origin = new URL(url).origin;
  for (const tab of ws?.tabs ?? []) {
    const pane = leaves(tab.root).find((l) => l.content.kind === "browser" && safeOrigin(l.content.url) === origin);
    if (pane) {
      setPaneContent(key, tab.id, pane.id, { kind: "browser", url });
      activateTab(key, tab.id);
      focusPane(key, tab.id, pane.id);
      return;
    }
  }
  // Its own worktree's page, beside the focused pane even when that pane is
  // a guest from another worktree.
  const active = ws?.tabs.find((t) => t.id === ws.active);
  if (active) splitPane(key, active.id, active.focus, "row", { kind: "browser", url });
  else openTab({ kind: "browser", url }, key);
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function handlePreview(e: BerthEvent) {
  if (!e.box || !e.data) return;
  const box = e.box;
  const hit = find(box, e.data);
  const port = Number(e.data.port);
  if (!hit || !port) {
    // The worktree may be newer than what the app has loaded.
    void useStore
      .getState()
      .refreshBox(box, ["locations", "services"])
      .then(() => {
        const again = find(box, e.data ?? {});
        if (again && port) offer(box, again.loc, again.wt, port, e.data?.url_path as string | undefined);
      });
    return;
  }
  offer(box, hit.loc, hit.wt, port, e.data.url_path as string | undefined);
}

function offer(box: string, loc: Location, wt: Worktree, port: number, urlPath?: string) {
  const url = previewUrl(box, loc, wt, port, urlPath);
  const here = useWorkspaces.getState().current === wsKey(box, wt.path) && useStore.getState().view.kind === "workspace";
  if (here) {
    showPreview(box, loc, wt, url);
    return;
  }
  route({
    category: "opened",
    title: "Preview ready",
    detail: `${new URL(url).host}${urlPath && urlPath !== "/" ? urlPath : ""}`,
    box,
    path: wt.path,
    action: { kind: "worktree", box, path: wt.path },
    label: "Open preview",
    run: () => showPreview(box, loc, wt, url),
    key: `preview|${box}|${url}`,
  });
}
