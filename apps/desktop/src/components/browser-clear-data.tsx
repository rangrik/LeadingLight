import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldItem, FieldLabel } from "@leadinglight/ui/components/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { BROWSER_HISTORY_RANGES, type BrowserHistoryRange } from "~/lib/browser-data";

export type BrowserClearSelection = { history: boolean; website: boolean; range: BrowserHistoryRange };
type Props = { open: boolean; busy: boolean; error?: string; onClose(): void; onClear(selection: BrowserClearSelection): Promise<void> };

export function BrowserClearData({ open, busy, error, onClose, onClear }: Props) {
  const [history, setHistory] = useState(true);
  const [website, setWebsite] = useState(true);
  const [range, setRange] = useState<BrowserHistoryRange>("all");
  useEffect(() => { if (open) { setHistory(true); setWebsite(true); setRange("all"); } }, [open]);
  return <Dialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open={open}><DialogPopup className="sm:max-w-md">
    <DialogHeader><DialogTitle>Clear browsing data?</DialogTitle><DialogDescription>Choose what to remove from this workspace. Bookmarks and downloaded files stay.</DialogDescription></DialogHeader>
    <DialogPanel className="space-y-4">
      <Field><FieldItem><Checkbox checked={history} disabled={busy} onCheckedChange={setHistory} /><FieldLabel>Browsing history</FieldLabel></FieldItem></Field>
      <Field className="gap-1"><FieldLabel>History time range</FieldLabel><Select disabled={!history || busy} items={BROWSER_HISTORY_RANGES} onValueChange={(next) => { if (next) setRange(next as BrowserHistoryRange); }} value={range}><SelectTrigger aria-label="History time range"><SelectValue /></SelectTrigger><SelectPopup>{BROWSER_HISTORY_RANGES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectPopup></Select></Field>
      <Field><FieldItem><Checkbox checked={website} disabled={busy} onCheckedChange={setWebsite} /><FieldLabel>Cookies, website data and cache</FieldLabel></FieldItem></Field>
      {website && <p className="text-sm text-muted-foreground">Website data is removed for all time. This signs out this workspace and closes its personal tabs. Close any agent tabs here first.</p>}
      {error && <p className="text-sm text-destructive-foreground" role="alert">{error}</p>}
    </DialogPanel>
    <DialogFooter><Button disabled={busy} onClick={onClose} variant="outline">Cancel</Button><Button disabled={busy || (!history && !website)} onClick={() => void onClear({ history, website, range })} variant="destructive">Clear browsing data</Button></DialogFooter>
  </DialogPopup></Dialog>;
}
