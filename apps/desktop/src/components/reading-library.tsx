import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { importBook, readingSource } from "~/lib/book-import";
import { createPage, pageOf } from "~/lib/space";
import { openPage, openBeside } from "~/lib/panes";
import { browserView } from "~/lib/space";
import { assets } from "~/lib/assets";
import { openLink } from "~/lib/links";
import { isDesktop } from "~/lib/platform";
import { ask } from "~/lib/project-runtime/transport";
import { browserBase } from "~/lib/project-runtime/browser";
import { requestBrowserOpen } from "~/lib/browser-opening";
import type { LLObject } from "~/lib/objects";

const readerAddress = (value: string) => {
  try {
    const address = new URL(value);
    if (address.protocol === "https:" && !address.username && !address.password) return address.href;
  } catch { /* The field explains how to repair the address. */ }
  throw new Error("Use a complete HTTPS link to the book's reader.");
};
const services = { Kindle: "https://read.amazon.com/", Libby: "https://libbyapp.com/" };
export function ReadingLibrary({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => { if (!open) setPassword(""); }, [open]);
  const [service, setService] = useState<keyof typeof services | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const importFile = async (file: File) => {
    setBusy(true); setError(""); setProgress("Opening book…");
    try { const id = await importBook(file, password, setProgress); setPassword(""); onOpenChange(false); openPage(id); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setProgress(""); }
  };
  const companion = async () => {
    if (!service || !title.trim()) return;
    setBusy(true); setError("");
    try {
      const address = readerAddress(url || services[service]);
      const page = await createPage({ typeId: "book", title: title.trim(), properties: { "book-status": ["reading"], reading: { source: service, url: address } }, content: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: `Reading notes for ${title.trim()}. The protected book stays in ${service}; your notes stay here.` }] },
        ...notes.split(/\n+/).filter((line) => line.trim()).map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
      ] } });
      onOpenChange(false); openPage(page.id);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogPopup showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Reading library</DialogTitle><DialogDescription>Bring a book into your notes, or keep notes beside Kindle and Libby.</DialogDescription></DialogHeader>
      <DialogPanel className="grid gap-4">
        <input ref={input} aria-label="Book file" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importFile(file); }} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => input.current?.click()}>Import PDF or EPUB</Button>
          {Object.keys(services).map((name) => <Button key={name} variant="outline" disabled={busy} onClick={() => { setService(name as keyof typeof services); setUrl(services[name as keyof typeof services]); setError(""); }}>{name} notes</Button>)}
        </div>
        <p className="text-sm text-muted-foreground">Files up to 32 MiB. PDFs keep their original file and page numbers; EPUBs keep chapter order. Select words in an imported section to highlight or add a sidenote.</p>
        <Field><FieldLabel>PDF password, if needed</FieldLabel><Input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></Field>
        {service && <>
          <p className="text-sm text-muted-foreground">{service === "Kindle" ? "Amazon offers EPUB/PDF downloads for eligible purchases in Manage Your Content and Devices. Protected purchases stay in Kindle." : "Use your SF Public Library card in Libby. Loans stay in Libby; exported highlights and your own notes can live here after a loan ends."}</p>
          <Field><FieldLabel>Book title</FieldLabel><Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></Field>
          <Field><FieldLabel>Reader link</FieldLabel><Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} /><FieldDescription>Paste a link to this book, or keep the library address.</FieldDescription></Field>
          <Field><FieldLabel>Highlights or notes</FieldLabel><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={busy} /><FieldDescription>{service === "Libby" ? "In Libby: Manage Loan → Reading Journey → Actions → Export Reading Data. Paste the highlights here." : "Paste highlights from your Kindle notebook. You can add more in the page later."}</FieldDescription></Field>
        </>}
        {progress && <p role="status" className="text-sm">{progress}</p>}
        {error && <p role="alert" className="text-sm text-destructive-foreground">{error}</p>}
      </DialogPanel>
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>{service && <Button disabled={busy || !title.trim()} onClick={() => void companion()}>Create reading notes</Button>}</DialogFooter>
    </DialogPopup>
  </Dialog>;
}

export function BookNavigation({ page }: { page: LLObject }) {
  const source = readingSource(page.properties.reading);
  const [error, setError] = useState("");
  if (!source) return null;
  const root = source.book ? readingSource(pageOf(source.book)?.properties.reading) : source;
  const read = async () => {
    setError("");
    if (!root?.url) return;
    try {
      const address = readerAddress(root.url);
      if (!(await isDesktop)) { openLink(address); return; }
      const workspace = await ask<{ location: string; worktree: string }>("POST", "/v1/browser/workspace");
      requestBrowserOpen(browserBase(workspace.location, workspace.worktree), address);
      openBeside(browserView(""));
    } catch { setError("The in-app reader could not open. Use Open in browser to continue."); }
  };
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Book navigation">
    {source.book && <Button size="sm" variant="ghost" onClick={() => openPage(source.book!)}>Contents</Button>}
    {source.previous && <Button size="sm" variant="ghost" onClick={() => openPage(source.previous!)}>Previous section</Button>}
    {source.next && <Button size="sm" variant="ghost" onClick={() => openPage(source.next!)}>Next section</Button>}
    {root?.asset && <Button size="sm" variant="ghost" onClick={() => assets.open(root.asset!)}>Open original</Button>}
    {root?.url && <Button size="sm" variant="outline" onClick={() => void read()}>Read in {root.source}</Button>}
    {error && <><span role="alert">{error}</span><Button size="sm" variant="ghost" onClick={() => { try { openLink(readerAddress(root!.url!)); } catch { setError("Use a complete HTTPS link to the book’s reader."); } }}>Open in browser</Button></>}
  </div>;
}
