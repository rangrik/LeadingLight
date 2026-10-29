import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import type { BrowserBounds, BrowserViewport } from "~/components/browser-surface";
import { BROWSER_STYLE_PROPERTIES } from "~/lib/browser-context";
import { ask } from "~/lib/project-runtime/transport";

export type BrowserInspection = { handle: string; tag: string; text: string; selector?: string; url: string; bounds: BrowserBounds; styles: Record<string, string> };
type Props = { base: string; tab: string; inspection: BrowserInspection; viewport?: BrowserViewport; onChange: (inspection: BrowserInspection) => void; onClose: () => void; onAsk: (note: string, styles: Record<string, string>) => void };

export function BrowserFeedback(props: Props) {
  return <Feedback key={`${props.base}/${props.tab}/${props.inspection.handle}`} {...props} />;
}

function Feedback({ base, tab, inspection, viewport, onChange, onClose, onAsk }: Props) {
  const [comment, setComment] = useState("");
  const [property, setProperty] = useState("color");
  const [value, setValue] = useState(inspection.styles.color ?? "");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  const dirty = useRef(false);
  const working = useRef(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const revealSequence = useRef(0);
  const revealed = useRef("");
  const callbacks = useRef({ onChange, onClose, onAsk });
  callbacks.current = { onChange, onClose, onAsk };
  const route = `${base}/style`;
  const query = `?tab=${encodeURIComponent(tab)}`;
  const handle = inspection.handle;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Wait for a preview already in flight before undoing an abandoned selection.
      void pending.current.then(async () => {
        if (dirty.current) await ask("POST", `${route}/reset${query}`, { handle }).catch(() => {});
      });
    };
  }, [route, query, handle]);

  const run = (task: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError("");
    pending.current = (async () => {
      try { await task(); }
      catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
      finally { working.current = false; if (live.current) setBusy(false); }
    })();
  };
  const reset = async () => {
    const next = await ask<BrowserInspection>("POST", `${route}/reset${query}`, { handle });
    dirty.current = false;
    if (live.current) { setChanges({}); setValue(next.styles[property] ?? ""); callbacks.current.onChange(next); }
  };
  const preview = () => run(async () => {
    const chosen = value.trim();
    if (!chosen) return;
    dirty.current = true;
    const next = await ask<BrowserInspection>("POST", `${route}${query}`, { handle, property, value: chosen });
    if (live.current) { setChanges((all) => ({ ...all, [property]: chosen })); callbacks.current.onChange(next); }
  });
  const close = () => run(async () => {
    if (dirty.current) {
      try { await reset(); }
      catch (error) {
        if (!(error instanceof Error) || !/The (element|page) changed\. Inspect it again\.|This tab closed\./.test(error.message)) throw error;
        dirty.current = false;
      }
    }
    if (live.current) callbacks.current.onClose();
  });

  useEffect(() => {
    if (!viewport) return;
    const size = `${viewport.width}x${viewport.height}`;
    if (revealed.current === size) return;
    const sequence = ++revealSequence.current;
    void pending.current.then(() => {
      if (!live.current || sequence !== revealSequence.current) return;
      run(async () => {
        try {
          const next = await ask<BrowserInspection>("POST", `${base}/inspect/reveal${query}`, { handle });
          if (live.current && sequence === revealSequence.current) { revealed.current = size; callbacks.current.onChange(next); }
        } catch (error) { if (live.current && sequence === revealSequence.current) throw error; }
      });
    });
    return () => { revealSequence.current++; };
  }, [base, query, handle, viewport?.width, viewport?.height]);

  return <section aria-label="Element feedback" className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t text-sm" data-testid="browser-feedback">
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"><h3 className="min-w-0 flex-1 font-medium">Element feedback</h3><Tooltip><TooltipTrigger render={<Button aria-label="Close element feedback" disabled={busy} onClick={close} size="icon-sm" variant="ghost" />}><X className="size-4" /></TooltipTrigger><TooltipPopup>Close and reset previews</TooltipPopup></Tooltip></div>
    <div className="min-h-0 space-y-2 overflow-y-auto px-3 py-2">
      <div className="min-w-0"><p className="break-words font-mono text-xs">{inspection.selector || inspection.tag}</p>{inspection.text && <p className="line-clamp-2 break-words text-xs text-muted-foreground">{inspection.text}</p>}</div>
      <Field className="gap-1"><FieldLabel className="text-xs">Your feedback</FieldLabel><Textarea aria-label="Element feedback comment" className="[&_textarea]:max-h-24 [&_textarea]:resize-y" maxLength={2000} onChange={(event) => setComment(event.currentTarget.value)} placeholder="Describe what should change…" size="sm" value={comment} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field className="min-w-0 gap-1"><FieldLabel className="text-xs">Style</FieldLabel><Select disabled={busy} items={BROWSER_STYLE_PROPERTIES} onValueChange={(next) => { if (next) { setProperty(next); setValue(changes[next] ?? inspection.styles[next] ?? ""); } }} value={property}><SelectTrigger aria-label="Style property" className="min-w-0" size="sm"><SelectValue /></SelectTrigger><SelectPopup>{BROWSER_STYLE_PROPERTIES.map(({ label, value }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectPopup></Select></Field>
        <Field className="min-w-0 gap-1"><FieldLabel className="text-xs">Value</FieldLabel><Input aria-label="Style value" disabled={busy} maxLength={256} onChange={(event) => setValue(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); preview(); } }} size="sm" value={value} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">{Object.keys(changes).length ? `${Object.keys(changes).length} style ${Object.keys(changes).length === 1 ? "change" : "changes"} previewed.` : "Preview styles temporarily on this page."}</p>
      {error && <p className="break-words text-xs text-destructive-foreground" role="alert">{error}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-1 border-t px-3 py-2"><Button disabled={busy || !value.trim()} onClick={preview} size="xs" variant="outline">Preview</Button><Button disabled={busy || !dirty.current} onClick={() => run(reset)} size="xs" variant="ghost">Reset</Button><Button className="ml-auto" disabled={busy || (!comment.trim() && !Object.keys(changes).length)} onClick={() => callbacks.current.onAsk(comment.trim(), { ...changes })} size="xs">Ask with feedback</Button></div>
  </section>;
}
