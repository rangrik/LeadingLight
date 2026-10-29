import { reportOf } from "~/lib/work";
import { Clock3, Flag, ScanText, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { BlockEditor } from "@leadinglight/editor/editor";
import { origins } from "@leadinglight/editor/authorship";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Label } from "@leadinglight/ui/components/label";
import { Badge } from "@leadinglight/ui/components/badge";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "@leadinglight/ui/components/sheet";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@leadinglight/ui/components/tabs";
import { cn } from "@leadinglight/ui/lib/utils";
import { assets } from "~/lib/assets";
import { milestone, restoreVersion, undoAction } from "~/lib/history";
import { action, type HistoryEntry } from "~/lib/history-types";
import { liveContent, liveSnapshot } from "~/lib/live";
import { docText, objects, onHistory } from "~/lib/objects";
import { openPage } from "~/lib/panes";
import { flushAll } from "~/lib/saving";
import { createPage } from "~/lib/space";

const date = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function PageHistory({ page, className }: { page: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"history" | "authorship">("history");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [picked, setPicked] = useState<string>();
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(document.documentElement.dataset.authorship === "true");
  useEffect(() => {
    const update = () => setHighlight(document.documentElement.dataset.authorship === "true");
    window.addEventListener("leadinglight:authorship", update);
    return () => window.removeEventListener("leadinglight:authorship", update);
  }, []);
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof objects.get>>>(null);
  const reload = async () => {
    const [all, now] = await Promise.all([objects.history(), objects.get(page)]);
    setEntries(all.sort((a, b) => b.at - a.at));
    setCurrent(now && { ...now, content: liveContent(page) ?? now.content });
  };
  useEffect(() => {
    if (!open) return;
    void reload().catch((e) => setError(String(e)));
    return onHistory(() => { void reload().catch((e) => setError(String(e))); });
  }, [open, page]);
  const show = async (next: typeof mode, makeMilestone = false) => {
    setMode(next); setNaming(makeMilestone); setOpen(true); setError("");
    try { await flushAll(); await reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); await reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const groups = new Map<string, HistoryEntry>();
  for (const e of entries.filter((e) => e.changes.some((c) => (c.after ?? c.before)?.id === page))) {
    const key = e.milestone ? e.id : e.action;
    if (!groups.has(key)) groups.set(key, e);
  }
  const rows = [...groups.values()];
  const first = [...entries].reverse().find((e) => e.changes.some((c) => (c.after ?? c.before)?.id === page));
  const baseline = first?.changes.find((c) => c.before?.id === page)?.before;
  if (first && baseline) rows.push({ ...first, id: `baseline:${first.id}`, action: `baseline:${first.id}`, label: "Before history began", milestone: undefined, author: { kind: "unknown", name: "Origin unknown" }, changes: [{ before: null, after: baseline }] });
  const selected = rows.find((e) => e.id === picked) ?? rows[0];
  const lastChange = selected?.changes.find((c) => (c.after ?? c.before)?.id === page);
  const firstChange = [...entries].reverse().find((e) => e.action === selected?.action && e.changes.some((c) => (c.after ?? c.before)?.id === page))?.changes.find((c) => (c.after ?? c.before)?.id === page);
  const change = lastChange && !selected?.milestone && firstChange ? { ...lastChange, before: firstChange.before } : lastChange;
  const snapshot = change?.after ?? change?.before;
  const originRows = origins(current?.content ?? null);
  return <>
    <Menu>
      <MenuTrigger render={<Button aria-label="History and authorship" className={cn("size-7", className)} size="icon" variant="ghost" />}><Clock3 className="size-4" /></MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => void show("history")}><Clock3 className="size-4" />Page history</MenuItem>
        <MenuItem onClick={() => void show("history", true)}><Flag className="size-4" />Save milestone…</MenuItem>
        <MenuSeparator />
        <MenuCheckboxItem checked={highlight} onCheckedChange={(on) => { setHighlight(on); document.documentElement.dataset.authorship = String(on); localStorage.setItem("leadinglight.authorship", String(on)); window.dispatchEvent(new Event("leadinglight:authorship")); }}>Show authorship</MenuCheckboxItem>
        <MenuItem onClick={() => void show("authorship")}><ScanText className="size-4" />Inspect authorship</MenuItem>
      </MenuPopup>
    </Menu>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetPopup className="w-full max-w-3xl sm:w-[min(92vw,56rem)]">
        <SheetHeader>
          <SheetTitle>{mode === "history" ? "Page history" : "Authorship"}</SheetTitle>
          <SheetDescription>{mode === "history" ? "Saved automatically. Restore a moment without losing what came after." : "Who added these words in LeadingLight. This does not detect text composed in other apps."}</SheetDescription>
        </SheetHeader>
        {error && <div className="mx-4 space-y-2 rounded-lg bg-destructive/10 p-3 text-sm"><p className="text-destructive" role="alert">{error}</p><Button size="sm" variant="outline" onClick={() => void run(async () => { const source = await objects.get(page); if (!source) return; const { id: _id, revision: _revision, ...copy } = { ...source, ...liveSnapshot(page) }; const saved = await createPage({ ...copy, title: `${copy.title || "Untitled"} (unsaved copy)` }, { ...action("Kept unsaved edits"), preserveOrigin: true }); openPage(saved.id); setOpen(false); })}>Keep my unsaved edits as a new page</Button></div>}
        {mode === "authorship" ? <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <p className="text-muted-foreground text-sm">Agent text is tinted when Show authorship is on. Words you add are recorded separately; older untracked words remain unknown.</p>
          {originRows.length === 0 && <p className="text-muted-foreground text-sm">There are no words on this page yet.</p>}
          {originRows.map((row, i) => <div className="space-y-2" key={i}>
            <Badge variant="secondary">{row.author.kind === "agent" ? <Sparkles className="size-3" /> : <UserRound className="size-3" />}{row.author.name}{row.author.model ? ` · ${row.author.model}` : ""}</Badge>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{row.text.trim()}</p>
          </div>)}
        </div> : <>
          <div className="border-b px-4 pb-3">
            {naming ? <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await milestone(page, name); setName(""); setNaming(false); }); }}>
              <Label htmlFor={`milestone-${page}`}>Milestone name</Label>
              <div className="flex gap-2"><Input autoFocus id={`milestone-${page}`} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Before review" value={name} /><Button disabled={busy || !name.trim()} type="submit">Save milestone</Button></div>
            </form> : <Button onClick={() => setNaming(true)} size="sm" variant="outline"><Flag className="size-4" />Save milestone</Button>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <div aria-label="Versions" className="max-h-48 shrink-0 space-y-1 overflow-auto border-b p-2 sm:max-h-none sm:w-56 sm:border-r sm:border-b-0">
              {rows.length === 0 && <p className="p-3 text-muted-foreground text-sm">History begins with your next edit. Save a milestone to keep this moment.</p>}
              {rows.map((entry) => <Button aria-pressed={selected?.id === entry.id} className="h-auto w-full justify-start whitespace-normal px-3 py-2.5 text-left" key={entry.id} onClick={() => setPicked(entry.id)} variant={selected?.id === entry.id ? "secondary" : "ghost"}>
                <span className="min-w-0 space-y-1"><span className="block font-medium">{entry.milestone || entry.label}</span><span className="block text-muted-foreground text-xs">{entry.author.name} · {date(entry.at)}</span></span>
              </Button>)}
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
              {snapshot && selected && <>
                <div className="mb-4 space-y-2"><h2 className="break-words font-semibold text-lg">{snapshot.title || "Untitled"}</h2><p className="text-muted-foreground text-xs">{selected.author.name}{selected.author.model ? ` · ${selected.author.model}` : ""} · {date(selected.at)}</p></div>
                <Tabs defaultValue="preview">
                  <TabsList><TabsTab value="preview">Preview</TabsTab><TabsTab value="changes">Changes</TabsTab></TabsList>
                  <TabsPanel value="preview"><BlockEditor assets={assets} content={snapshot.content} key={selected.id} label="Version preview" readOnly /></TabsPanel>
                  <TabsPanel value="changes" className="space-y-4 pt-3">
                    <VersionText label="Before" text={docText(change?.before?.content ?? null)} />
                    <VersionText label="After" text={docText(change?.after?.content ?? null)} />
                    {change?.before?.title !== change?.after?.title && <p className="text-sm">Title: {change?.before?.title || "Untitled"} → {change?.after?.title || "Deleted"}</p>}
                    {JSON.stringify(change?.before?.properties) !== JSON.stringify(change?.after?.properties) && <p className="text-muted-foreground text-sm">This version also changed page properties. Restoring includes those values.</p>}
                  </TabsPanel>
                </Tabs>
                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  <Button disabled={busy || Boolean(reportOf(snapshot))} onClick={() => void run(() => restoreVersion(snapshot))} size="sm">Restore this version</Button>
                  <Button disabled={busy} onClick={() => void run(async () => { const { id: _id, revision: _revision, ...copy } = snapshot; const made = await createPage({ ...copy, title: `${copy.title || "Untitled"} (copy)`, ...(reportOf(snapshot) ? { typeId: "page", properties: {} } : {}), createdAt: Date.now() }, { ...action("Kept version as copy"), preserveOrigin: true }); openPage(made.id); })} size="sm" variant="outline">Keep a copy</Button>
                  {selected.author.kind === "agent" && !entries.some((e) => e.undoOf === selected.action) && <Button disabled={busy} onClick={() => void run(() => undoAction(selected.action))} size="sm" variant="outline">Undo entire action</Button>}
                </div>
              </>}
            </div>
          </div>
        </>}
      </SheetPopup>
    </Sheet>
  </>;
}

function VersionText({ label, text }: { label: string; text: string }) {
  return <div><p className="mb-1 font-medium text-sm">{label}</p><p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{text || "Empty page"}</p></div>;
}
