// COSS p-dialog-1 and p-radio-group-1; fields and actions save a webpage into the space.
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { Input } from "@leadinglight/ui/components/input";
import { Label } from "@leadinglight/ui/components/label";
import { Radio, RadioGroup } from "@leadinglight/ui/components/radio-group";
import { toastManager } from "@leadinglight/ui/components/toast";
import { openPage } from "~/lib/panes";
import { saveWebSource, type SourceMode } from "~/lib/web-source";

export function SaveWebpage({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<SourceMode>("media");
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const saving = useRef(false);
  const commitStarted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const save = async (choice: SourceMode) => {
    if (saving.current) return;
    saving.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const { page, missing } = await saveWebSource(url, choice, { signal: controller.signal, onCommit: () => {
        commitStarted.current = true;
        setCommitting(true);
      } });
      openPage(page.id);
      onOpenChange(false);
      setUrl("");
      if (missing) toastManager.add({ title: "Source saved", description: `${missing} media file${missing === 1 ? "" : "s"} could not be downloaded. The saved page marks each one.`, type: "info" });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      commitStarted.current = false;
      if (!controller.signal.aborted) { setBusy(false); setCommitting(false); }
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (commitStarted.current) return;
      if (!next) request.current?.abort();
      setError("");
      onOpenChange(next);
    }}>
      <DialogPopup showCloseButton={!committing}>
        <DialogHeader>
          <DialogTitle>Save webpage</DialogTitle>
          <DialogDescription>Keep a source link or a readable copy in your notes.</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={(event) => { event.preventDefault(); void save(mode); }}>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Web address</FieldLabel>
              <Input autoFocus disabled={busy} required type="url" placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} />
            </Field>
            <RadioGroup aria-label="What to save" disabled={busy} value={mode} onValueChange={(value) => setMode(value as SourceMode)}>
              <Label><Radio value="link" />Link only</Label>
              <Label><Radio value="text" />Text only</Label>
              <Label><Radio value="media" />Text and media</Label>
            </RadioGroup>
            <p className="text-muted-foreground text-sm">Copies downloaded text and up to 30 media files (20 MB each). Content behind sign-in, loaded by scripts, or streamed may need Link only.</p>
            {error && <div role="alert" className="space-y-2 text-sm"><p>{error === "Failed to fetch" ? "The browser could not fetch this website. Try in the Mac app, or save the link instead." : error}</p>{mode !== "link" && <Button disabled={busy} variant="outline" size="sm" onClick={() => void save("link")}>Save link instead</Button>}</div>}
            {busy && <p role="status" className="text-muted-foreground text-sm">Saving source…</p>}
          </DialogPanel>
          <DialogFooter>
            <DialogClose disabled={committing} render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={busy} type="submit">{busy ? "Saving…" : "Save source"}</Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
