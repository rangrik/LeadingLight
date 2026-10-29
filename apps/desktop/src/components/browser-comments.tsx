import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@leadinglight/ui/components/accordion";
import { Button } from "@leadinglight/ui/components/button";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { ScrollArea } from "@leadinglight/ui/components/scroll-area";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import type { BrowserAreaCapture } from "~/lib/browser-annotations";
import { annotationImageName, type BrowserAnnotation } from "~/lib/browser-context";
import { ask } from "~/lib/project-runtime/transport";

function Screenshot({ base, tab, name }: { base: string; tab: string; name: string }) {
  const [src, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSource(""); setError("");
    if (!annotationImageName(name)) { setError("This comment has no saved screenshot."); return; }
    void ask<{ name: string; mime: string; data: string }>("GET", `${base}/shots/${name}/data?tab=${encodeURIComponent(tab)}`).then((file) => {
      if (file.name !== name || file.mime !== "image/png" || file.data.length > 28 * 1024 * 1024 || !file.data.startsWith("iVBORw0KGgo")) throw new Error("The saved screenshot is invalid.");
      if (alive) setSource(`data:image/png;base64,${file.data}`);
    }).catch(() => { if (alive) setError("This screenshot is no longer available. Remove the comment and select the area again."); });
    return () => { alive = false; };
  }, [base, tab, name]);
  return src ? <img alt="Frozen screenshot of the commented region" className="max-h-32 max-w-full rounded-md border object-contain" src={src} /> : <p className="text-xs text-muted-foreground" role={error ? "alert" : undefined}>{error || "Loading screenshot…"}</p>;
}

type CommentsProps = { base: string; tab: string; comments: BrowserAnnotation[]; onRemove: (id: string) => void; onAsk: () => void | Promise<void> };
export function BrowserComments({ base, tab, comments, onRemove, onAsk }: CommentsProps) {
  const [error, setError] = useState("");
  if (!comments.length) return null;
  return <section aria-label="Saved browser comments" className="flex max-h-[35%] min-h-0 shrink-0 flex-col border-t text-sm" data-testid="browser-comments">
    <div className="flex items-center gap-2 border-b px-3 py-1.5"><h3 className="min-w-0 flex-1 font-medium">{comments.length} {comments.length === 1 ? "comment" : "comments"}</h3><Button onClick={() => { setError(""); void Promise.resolve().then(onAsk).catch((reason) => setError(String(reason.message ?? reason))); }} size="xs" variant="outline">Ask about comments</Button></div>
    <ScrollArea className="min-h-0 flex-1 px-3" overscrollContain>
      <Accordion className="w-full">
        {comments.map((note, index) => <AccordionItem key={note.id} value={note.id ?? String(index)}>
          <AccordionTrigger className="py-2"><span className="min-w-0 flex-1 truncate">{index + 1}. {note.comment || "Style preview"}</span></AccordionTrigger>
          <AccordionPanel className="space-y-2 pb-2">
            <p className="whitespace-pre-wrap break-words text-foreground">{note.comment || "Style preview"}</p>
            <p className="break-words text-xs">{note.element?.selector || note.element?.tag || `Area ${Math.round(note.area?.bounds.width ?? 0)} × ${Math.round(note.area?.bounds.height ?? 0)}`}</p>
            {note.element?.frame && <p className="truncate text-xs">Frame: {note.element.frame.url}</p>}
            {note.screenshot && <Screenshot base={base} name={note.screenshot.name} tab={tab} />}
            <Button aria-label={`Remove comment ${index + 1}`} onClick={() => { try { onRemove(note.id!); setError(""); } catch (reason) { setError(String(reason)); } }} size="xs" variant="ghost"><Trash2 className="size-4" />Remove</Button>
          </AccordionPanel>
        </AccordionItem>)}
      </Accordion>
    </ScrollArea>
    {error && <p className="px-3 py-2 text-xs text-destructive-foreground" role="alert">{error}</p>}
  </section>;
}

type AreaProps = { base: string; tab: string; area: BrowserAreaCapture; onClose: () => void; onSave: (annotation: BrowserAnnotation) => void | Promise<void>; onAsk: (annotation: BrowserAnnotation) => void | Promise<void> };
export function BrowserAreaFeedback(props: AreaProps) {
  return <AreaFeedback key={props.area.screenshot.name} {...props} />;
}
function AreaFeedback({ base, tab, area, onClose, onSave, onAsk }: AreaProps) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = (save: boolean) => {
    if (busy || !comment.trim()) return;
    const annotation: BrowserAnnotation = { comment: comment.trim(), area: { url: area.url, bounds: { ...area.bounds }, viewport: { ...area.viewport } }, screenshot: { ...area.screenshot, capturedAt: area.capturedAt } };
    setBusy(true); setError("");
    void Promise.resolve().then(() => (save ? onSave : onAsk)(annotation)).then(() => { if (save) onClose(); }).catch((reason) => setError(String(reason.message ?? reason))).finally(() => setBusy(false));
  };
  return <section aria-label="Area feedback" className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t text-sm" data-testid="browser-area-feedback">
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"><h3 className="min-w-0 flex-1 font-medium">Area feedback</h3><Tooltip><TooltipTrigger render={<Button aria-label="Close area feedback" disabled={busy} onClick={onClose} size="icon-sm" variant="ghost" />}><X className="size-4" /></TooltipTrigger><TooltipPopup>Close area feedback</TooltipPopup></Tooltip></div>
    <ScrollArea className="min-h-0 flex-1 px-3 py-2" overscrollContain>
      <div className="space-y-2">
        <Screenshot base={base} name={area.screenshot.name} tab={tab} />
        <p className="text-xs text-muted-foreground">{Math.round(area.bounds.width)} × {Math.round(area.bounds.height)} · captured in a {area.viewport.width} × {area.viewport.height} page</p>
        <p className="truncate text-xs text-muted-foreground">{area.url}</p>
        <Field className="gap-1"><FieldLabel className="text-xs">Your feedback</FieldLabel><Textarea aria-label="Area feedback comment" className="[&_textarea]:max-h-24 [&_textarea]:resize-y" maxLength={2000} onChange={(event) => setComment(event.currentTarget.value)} placeholder="Describe what should change in this area…" size="sm" value={comment} /></Field>
        {error && <p className="break-words text-xs text-destructive-foreground" role="alert">{error}</p>}
      </div>
    </ScrollArea>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-t px-3 py-2"><Button disabled={busy || !comment.trim()} onClick={() => submit(true)} size="xs" variant="outline">Save comment</Button><Button disabled={busy || !comment.trim()} onClick={() => submit(false)} size="xs">Ask with feedback</Button></div>
  </section>;
}
