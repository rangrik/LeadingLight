import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@leadinglight/ui/components/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { saveBrowserDownload } from "~/lib/browser-files";
import { ask } from "~/lib/project-runtime/transport";

export type BrowserToolsView = "console" | "network" | "text" | "downloads" | "permissions";
type Log = { seq: number; level: string; text: string; count?: number };
type Failure = { seq: number; text: string };
type Download = { id: string; name: string; url: string; state: "inProgress" | "completed" | "canceled"; receivedBytes: number; totalBytes: number; tab: string; createdAt: string };
type Contents = { console?: Log[]; failures?: Failure[]; text?: string; downloads?: Download[]; hosts?: string[] };
type Props = { base: string; tab: string; view: BrowserToolsView; onClose: () => void; onError: (message: string) => void; onNavigate?: (url: string) => void };
const NAMES: Record<BrowserToolsView, string> = { console: "Console", network: "Failed requests", text: "Page text", downloads: "Downloads", permissions: "Site permissions" };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

export function BrowserTools({ base, tab, view, onClose, onError }: Props) {
  const key = `${base}\n${tab}\n${view}`;
  const current = useRef(key);
  current.current = key;
  const [result, setResult] = useState<{ key: string; data: Contents; error?: string }>({ key: "", data: {} });
  const [filter, setFilter] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [cleared, setCleared] = useState(0);
  const [saved, setSaved] = useState("");
  const query = `?tab=${encodeURIComponent(tab)}`;
  const data = result.key === key ? result.data : {};
  const error = result.key === key ? result.error : undefined;
  const loading = result.key !== key;

  useEffect(() => {
    current.current = key;
    setFilter("");
    setCleared(0);
    setBusy("");
    setSaved("");
    return () => { if (current.current === key) current.current = ""; };
  }, [key]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const route = view === "permissions" ? "/v1/browser/permissions" : `${base}/${view === "console" || view === "network" ? "devtools" : view === "text" ? "snapshot" : "downloads"}${query}`;
        const next = await ask<Contents>(view === "text" ? "POST" : "GET", route, view === "text" ? { full: true } : undefined);
        if (live) setResult({ key, data: next });
      } catch (error) {
        if (live) setResult((previous) => ({ key, data: previous.key === key ? previous.data : {}, error: message(error) }));
      }
      if (live && view !== "text" && view !== "permissions") timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [base, key, query, refresh, view]);

  const action = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    setSaved("");
    try {
      await run();
      if (current.current === key) setRefresh((r) => r + 1);
    } catch (error) {
      if (current.current === key) onError(message(error));
    } finally {
      if (current.current === key) setBusy("");
    }
  };
  const save = (download: Download) => action(download.id, async () => {
    if (current.current !== key) return;
    if (await saveBrowserDownload(base, tab, download.id) && current.current === key) setSaved(`Saved ${download.name}`);
  });
  const logs = (data.console ?? []).filter((entry) => entry.seq > cleared && `${entry.level} ${entry.text}`.toLowerCase().includes(filter.toLowerCase()));
  const failures = (data.failures ?? []).filter((entry) => entry.seq > cleared && entry.text.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section aria-label={NAMES[view]} className="flex min-h-0 min-w-0 flex-1 flex-col text-sm" data-testid={`browser-tools-${view}`}>
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b px-2">
        <h3 className="min-w-0 flex-1 px-1 font-medium">{NAMES[view]}</h3>
        {(view === "console" || view === "network") && <Button onClick={() => setCleared(Math.max(0, ...(view === "console" ? data.console ?? [] : data.failures ?? []).map((entry) => entry.seq)))} size="xs" variant="ghost">Clear view</Button>}
        <Tooltip><TooltipTrigger render={<Button aria-label={`Refresh ${NAMES[view].toLowerCase()}`} onClick={() => setRefresh((r) => r + 1)} size="icon-sm" variant="ghost" />}><RefreshCw className="size-4" /></TooltipTrigger><TooltipPopup>Refresh</TooltipPopup></Tooltip>
        <Tooltip><TooltipTrigger render={<Button aria-label={`Close ${NAMES[view].toLowerCase()}`} onClick={onClose} size="icon-sm" variant="ghost" />}><X className="size-4" /></TooltipTrigger><TooltipPopup>Return to page</TooltipPopup></Tooltip>
      </div>
      {(view === "console" || view === "network") && <div className="shrink-0 border-b p-2"><Input aria-label={`Filter ${NAMES[view].toLowerCase()}`} onChange={(event) => setFilter(event.target.value)} placeholder="Filter…" size="sm" value={filter} /></div>}
      {error && <p className="shrink-0 break-words border-b px-3 py-2 text-destructive-foreground" role="alert">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? <p className="p-3 text-muted-foreground" role="status">Loading…</p> : view === "text" ? <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">{data.text || "No page text available."}</pre> : view === "console" ? (
          logs.length ? <Table className="table-fixed text-xs"><TableHeader><TableRow><TableHead className="w-20">Level</TableHead><TableHead>Message</TableHead></TableRow></TableHeader><TableBody>{logs.map((entry) => <TableRow key={entry.seq}><TableCell className="align-top">{entry.level}</TableCell><TableCell className="whitespace-pre-wrap break-words font-mono leading-relaxed">{entry.text}{(entry.count ?? 0) > 1 && <span className="ml-2 text-muted-foreground">×{entry.count}</span>}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-3 text-muted-foreground">{filter ? "No matching messages." : "No console messages."}</p>
        ) : view === "network" ? (
          <><p className="p-3 text-xs text-muted-foreground">Failed requests only. Reading or clearing this view leaves the agent's output available.</p>{failures.length ? <Table className="table-fixed text-xs"><TableBody>{failures.map((entry) => <TableRow key={entry.seq}><TableCell className="whitespace-pre-wrap break-words font-mono leading-relaxed">{entry.text}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-3 text-muted-foreground">{filter ? "No matching failed requests." : "No failed requests."}</p>}</>
        ) : view === "permissions" ? (
          <><p className="p-3 text-xs text-muted-foreground">Public sites allowed for browsers in this app. Revoking blocks new network requests. Pages already shown or saved in the browser cache may still appear.</p>{data.hosts?.length ? <Table className="table-fixed"><TableBody>{data.hosts.map((host) => <TableRow key={host}><TableCell className="whitespace-normal break-all leading-relaxed">{host}</TableCell><TableCell className="w-24 text-right"><Button aria-label={`Revoke ${host}`} disabled={!!busy} onClick={() => void action(host, () => ask("DELETE", "/v1/browser/permissions", { origin: host }))} size="xs" variant="outline">Revoke</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="p-3 text-muted-foreground">No public sites allowed.</p>}</>
        ) : (
          <><p className="p-3 text-xs text-muted-foreground">Downloads stay on this Mac. Save a copy to choose where to keep it.</p>{data.downloads?.length ? <Table className="table-fixed"><TableBody>{data.downloads.map((download) => <TableRow key={download.id}><TableCell className="whitespace-normal leading-relaxed"><p className="break-all font-medium">{download.name || "Download"}</p><p className="text-xs text-muted-foreground">{download.state === "completed" ? "Completed" : download.state === "canceled" ? "Cancelled or interrupted" : "Downloading"} · {bytes(download.receivedBytes)}{download.totalBytes > 0 && download.state === "inProgress" ? ` of ${bytes(download.totalBytes)}` : ""}</p></TableCell><TableCell className="w-24 text-right">{download.state === "completed" ? <Button aria-label={`Save ${download.name}`} disabled={!!busy} onClick={() => void save(download)} size="xs" variant="outline">Save…</Button> : download.state === "inProgress" ? <Button aria-label={`Cancel ${download.name}`} disabled={!!busy} onClick={() => void action(download.id, () => ask("POST", `${base}/downloads/cancel${query}`, { id: download.id }))} size="xs" variant="outline">Cancel</Button> : null}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-3 text-muted-foreground">No downloads in this workspace.</p>}{saved && <p className="p-3 text-xs text-muted-foreground" role="status">{saved}</p>}</>
        )}
      </div>
    </section>
  );
}
