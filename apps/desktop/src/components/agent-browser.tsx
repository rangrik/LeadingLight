import { Globe } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { useEffect, useState } from "react";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { cn } from "@leadinglight/ui/lib/utils";
import { useFolder } from "~/components/project-folder";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask, stream } from "~/lib/project-runtime/transport";

// An agent's browser, live (features/agent-browser.feature): the frames the runtime casts of a
// workspace's tab, its address, its tabs and its console. The agent drives it; this only watches.

type Tab = { name: string; url?: string; title?: string };
const ALLOWED = "ll.browser.allowed";
type Loc = { name: string; worktrees?: { name: string; main?: boolean; port?: number }[] };

// The workspace a chat works in: its own branch's worktree, else the folder's main one.
export function useWorkspace(pageId: string, worktree?: string) {
  const state = useFolder(pageId);
  const location = state?.folder.location;
  const [found, setFound] = useState<{ name: string; port?: number } | null>(null);
  useEffect(() => {
    if (!location) return;
    void ask<Loc[]>("GET", "/v1/locations").then((all) => {
      const wts = all.find((l) => l.name === location)?.worktrees ?? [];
      const w = wts.find((x) => (worktree ? x.name === worktree : x.main));
      setFound({ name: w?.name ?? worktree ?? location, port: w?.port });
    }, () => {});
  }, [location, worktree]);
  // port: the first of the block the runtime gave this workspace.
  return location ? { location, worktree: found?.name ?? worktree ?? null, port: found?.port } : null;
}

// A workspace's open tabs, as the runtime says when its browser opens or closes them; none, none open.
export function useBrowserTabs(location?: string, worktree?: string | null) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  useEffect(() => {
    if (!location || !worktree) return;
    // The unnamed main tab is no agent's: each has its own, named after its session.
    const read = () => void ask<{ tabs: Tab[] | null }>("GET", `/v1/worktrees/${location}/${worktree}/browser/tabs`).then((r) => setTabs((r.tabs ?? []).filter((t) => t.name)), () => setTabs([]));
    read();
    return onRuntimeEvent((e) => e.type.startsWith("browser.") && read());
  }, [location, worktree]);
  return tabs;
}

const path = (url?: string) => {
  try {
    const u = new URL(url ?? "");
    return u.pathname + u.search;
  } catch {
    return url ?? "";
  }
};

export function BrowserPane({ pageId, worktree, session }: { pageId: string; worktree?: string; session?: string }) {
  const ws = useWorkspace(pageId, worktree);
  const tabs = useBrowserTabs(ws?.location, ws?.worktree);
  // Each agent has a tab of its own, named after its session: the chat's is shown first.
  const [tab, setTab] = useState("");
  const [refused, setRefused] = useState<string[]>([]);
  // Allowed sites, remembered here: the runtime's list of refusals still names them for a while.
  const [allowed, setAllowed] = useState<string[]>(() => JSON.parse(localStorage.getItem(ALLOWED) ?? "[]"));
  // The page fitted to the view, or at its own size to read.
  const [fit, setFit] = useState(true);
  // Open, then gone: said plainly, not left as a frozen picture.
  const [closed, setClosed] = useState(false);
  const [view, setView] = useState<"page" | "console">("page");
  const [frame, setFrame] = useState<{ data: string; url?: string } | null>(null);
  const [console, setConsole] = useState("");
  // The chat's own agent's tab, unless another is picked; never another's without asking.
  const shown = (tab && tabs.some((t) => t.name === tab) ? tab : "") || (session ? (tabs.find((t) => t.name === session)?.name ?? "") : (tabs[0]?.name ?? ""));
  const label = (t: Tab) => (t.name === session ? "This chat's agent" : t.name);
  useEffect(() => void (tabs.length ? setClosed(false) : frame && setClosed(true)), [tabs.length]);
  const base = ws?.worktree ? `/v1/worktrees/${ws.location}/${ws.worktree}/browser` : null;
  useEffect(() => {
    setFrame(null);
    if (!base || !shown) return;
    return stream("GET", `${base}/screencast?tab=${encodeURIComponent(shown)}`, undefined, 60, (line) => {
      try {
        const f = JSON.parse(line) as { data?: string; url?: string };
        if (f.data) setFrame({ data: f.data, url: f.url });
      } catch {
        // Not a frame.
      }
    }, () => {});
  }, [base, shown]);
  // Public sites the browser was kept from, which the person may allow for agents' browsers.
  useEffect(() => {
    if (!base || !tabs.length) return;
    const read = () => void ask<{ status?: { refused_hosts?: string[] } }>("GET", `${base}/status`).then((s) => setRefused((s.status?.refused_hosts ?? []).filter((h) => !/(^|\.)localhost$|^127\.|^\[?::1/.test(h))), () => {});
    read();
    const every = window.setInterval(read, 3000);
    return () => window.clearInterval(every);
  }, [base, tabs.length]);
  const allow = (host: string) =>
    void ask("POST", "/v1/browser/allow", { origin: host }).then(() => {
      const next = [...allowed, host];
      localStorage.setItem(ALLOWED, JSON.stringify(next));
      setAllowed(next);
    }, () => {});
  // The console as the tab has it, read without using up what its agent hasn't read yet.
  useEffect(() => {
    if (view !== "console" || !base) return;
    const read = () => void ask<{ text: string }>("GET", `${base}/console?peek=1${shown ? `&tab=${encodeURIComponent(shown)}` : ""}`).then((r) => setConsole(r.text), () => setConsole(""));
    read();
    const every = window.setInterval(read, 2000);
    return () => window.clearInterval(every);
  }, [view, base, shown]);

  if (!shown)
    return (
      <div className="m-auto flex flex-col items-center gap-2 p-6 text-center text-muted-foreground text-sm">
        <Globe className="size-6" />
        {closed || frame ? "The browser closed. It opens again when the agent next opens a page." : "This chat's agent has no page open. Its browser opens when it opens one."}
      </div>
    );
  return (
    <div className="flex h-full flex-col text-sm" data-testid="agent-browser">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <SegmentedControl aria-label="Show" render={<RadioGroupPrimitive onValueChange={(v) => setView(v as "page" | "console")} value={view} />} size="sm">
          <SegmentedControlItem render={<RadioPrimitive.Root value="page" />}>Page</SegmentedControlItem>
          <SegmentedControlItem render={<RadioPrimitive.Root value="console" />}>Console</SegmentedControlItem>
        </SegmentedControl>
        {/* The page's path, and the workspace's own port that serves it (the runtime routes its address there). */}
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">{path(frame?.url ?? tabs.find((t) => t.name === shown)?.url)}</span>
        {ws?.port && <span className="shrink-0 text-muted-foreground text-xs">Port {ws.port}</span>}
        {tabs.length > 1 && (
          <Select items={tabs.map((t) => ({ value: t.name, label: label(t) }))} onValueChange={(v) => setTab(v as string)} value={shown}>
            <SelectTrigger aria-label="Tab" className="w-36" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {tabs.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {label(t)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </div>
      {[...new Set(refused)].filter((h) => !allowed.includes(h)).map((host) => (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs" key={host}>
          <span className="min-w-0 flex-1 truncate">
            The agent's browser was kept from <span className="font-medium">{host}</span>, a site outside the folder.
          </span>
          <Button onClick={() => allow(host)} size="xs" variant="outline">
            Allow
          </Button>
        </div>
      ))}
      {view === "page" ? (
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/40 p-3">
          {frame ? (
            <button aria-label={fit ? "Show the page at its own size" : "Fit the page to the view"} className={cn("shrink-0", fit ? "max-w-full cursor-zoom-in" : "cursor-zoom-out")} onClick={() => setFit((f) => !f)} type="button">
              <img alt={`The agent's tab at ${frame.url ?? ""}`} className={cn("rounded-md border shadow-xs/5", fit ? "max-w-full" : "max-w-none")} src={`data:image/jpeg;base64,${frame.data}`} />
            </button>
          ) : (
            <p className="m-auto text-muted-foreground">Waiting for the tab…</p>
          )}
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs">{console || "Nothing in the console yet."}</pre>
      )}
    </div>
  );
}
