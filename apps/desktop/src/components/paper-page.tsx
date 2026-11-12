import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { eInk } from "@/themes/builtin";
import { GripVertical, Info, Plus, Trash2, Type } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup, ContextMenuItem } from "@leadinglight/ui/components/context-menu";
import { Menu, MenuItem, MenuPopup, MenuTrigger, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubTrigger, MenuSubPopup } from "@leadinglight/ui/components/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { ReadingToolbar } from "./reading-toolbar";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import { Player } from "@leadinglight/editor/player";
import { isNative, platformReady, phone } from "~/lib/platform";
import { assets } from "~/lib/assets";
import { editPage } from "~/lib/live";
import { editPaper, readPaper, type Paper, type PaperAction, type PaperItem } from "~/lib/paper";

export function PaperPage({ id, title, paper, request, onChange, onDetails, mixed = false, readOnly = false }: { readOnly?: boolean; onDetails: () => void; mixed?: boolean; id: string; title: string; paper: Paper; request: { action: PaperAction; count: number } | null; onChange: (value: Paper, immediate?: boolean) => Promise<void> }) {
  const current = useRef(paper); current.current = paper;
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number | "fit" | "auto">("fit");
  const scale = zoom === "fit" ? fitScale : zoom === "auto" ? Math.max(0.75, fitScale) : zoom;
  const [typing, setTyping] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [nativePaper, setNativePaper] = useState(false);
  const [recordError, setRecordError] = useState("");
  useEffect(() => { void Promise.all([isNative, platformReady]).then(([native, os]) => setNativePaper(native && os === "ios")); }, []);
  const [textHeights, setTextHeights] = useState<Record<string, number>>({});
  const measureEdits = useRef(new Set<string>());
  const [recording, setRecording] = useState<string>();
  const recorder = useRef<BlockEditorHandle>(null);
  const recordingPhase = useRef("idle");
  const recordingSaved = useRef(false);
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [previewMissing, setPreviewMissing] = useState(false);
  useEffect(() => setPreviewMissing(false), [paper.preview?.url]);
  const report = (error: unknown) => toastManager.add({ type: "error", title: "Couldn't save paper", description: error instanceof Error ? error.message : String(error) });
  const change = (next: Paper) => { current.current = next; void onChange(next).catch(report); };
  const update = (itemId: string, patch: Partial<PaperItem>) => {
    if (patch.text !== undefined || patch.width !== undefined) measureEdits.current.add(itemId);
    const value = current.current;
    const items = value.items.map((item) => item.id === itemId ? { ...item, ...patch } : item);
    change({ ...value, updatedAt: Date.now(), height: Math.min(14000, Math.max(value.height, ...items.map((item) => item.y + item.height + 100))), items });
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setFitScale(Math.max(0.1, Math.min(1, entry.contentRect.width / 900))));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const root = container.current?.closest(".ll-paper-page");
    const phase = (event: Event) => {
      recordingPhase.current = (event as CustomEvent<string>).detail;
      if (recordingPhase.current === "idle") window.setTimeout(() => {
        if (recordingPhase.current === "idle" && recordingSaved.current) setRecording(undefined);
      });
    };
    const error = (event: Event) => {
      const description = (event as CustomEvent<string>).detail;
      setRecordError(description); toastManager.add({ type: "error", title: recordingSaved.current ? "Recording saved" : "Couldn't record", description });
    };
    root?.addEventListener("ll:recording-state", phase);
    root?.addEventListener("ll:recording-error", error);
    return () => { root?.removeEventListener("ll:recording-state", phase); root?.removeEventListener("ll:recording-error", error); };
  }, []);
  const open = async (action: PaperAction) => {
    if (opening.current) return;
    opening.current = true; setBusy(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      if (!await editPaper(id, title, current.current, action, (value) => onChange(value, true))) {
        if (action === "record") {
          if (recording && (recordingPhase.current !== "idle" || !recordingSaved.current)) recorder.current?.record();
          else { setRecordError(""); recordingSaved.current = false; setRecording(crypto.randomUUID()); }
        } else if (action === "photo") throw new Error("Use the iPad or iPhone app to take a photo.");
        else { setTyping(true); container.current?.scrollTo({ top: 0 }); }
      }
    } catch (error) { toastManager.add({ type: "error", title: "Couldn't open paper tool", description: error instanceof Error ? error.message : String(error) }); }
    finally { opening.current = false; setBusy(false); }
  };
  const lastRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (request && lastRequest.current !== request.count) { lastRequest.current = request.count; void open(request.action); }
  }, [request]);
  const addText = (x: number, y: number) => {
    const left = x < 160 ? 112 : Math.min(x, 900 - 200);
    const item: PaperItem = { id: crypto.randomUUID(), kind: "text", x: left, y: Math.max(8, Math.min(Math.round((y - 24) / 36) * 36 + 8, current.current.height - 144)), width: Math.min(560, 900 - left - 24, Math.max(240, ((container.current?.clientWidth ?? 900) - 40) / 0.75)), height: 70, text: "", fontSize: 24 };
    change({ ...current.current, updatedAt: Date.now(), items: [...current.current.items, item] });
    setSelected(item.id); setEditing(item.id); setTyping(false);
    if (fitScale < 0.75) setZoom(0.75);
    requestAnimationFrame(() => surface.current?.querySelector<HTMLTextAreaElement>(`[data-paper-item="${item.id}"] textarea`)?.focus());
  };
  const gesture = (event: React.PointerEvent, item: PaperItem, resize = false) => {
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, item: { ...item } };
    const move = (next: PointerEvent) => {
      const x = (next.clientX - start.x) / scale, y = (next.clientY - start.y) / scale;
      if (resize) {
        const width = Math.max(180, Math.min(900 - item.x, start.item.width + x));
        update(item.id, { width, ...(item.kind === "image" ? { height: start.item.height * width / start.item.width } : {}) });
      }
      else update(item.id, { x: Math.max(0, Math.min(900 - item.width, start.item.x + x)), y: Math.max(44, Math.min(current.current.height - item.height - 44, start.item.y + y)) });
    };
    const end = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", end); target.removeEventListener("pointercancel", end); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", end); target.addEventListener("pointercancel", end);
  };
  const capture = (read: () => EditorDoc) => {
    const nodes = read().content ?? [];
    const voice = nodes.find((node: EditorDoc) => node.type === "voiceRecording" && node.attrs?.src);
    if (!voice?.attrs?.src || !recording) return;
    recordingSaved.current = true;
    const attrs = voice.attrs;
    const value = current.current;
    const existing = value.items.find((item) => item.id === recording);
    const item: PaperItem = existing ? { ...existing } : { id: recording, kind: "audio", x: 112, y: Math.min(13600, Math.max(60, (value.inkBottom ?? (value.preview ? value.previewHeight ?? value.height : 0)) + 32, ...value.items.map((item) => item.y + item.height + 30))), width: 320, height: 44 };
    item.asset = { url: String(attrs.src), name: String(attrs.name), mime: String(attrs.mime), size: Number(attrs.size) };
    let items = [...value.items.filter((item) => item.id !== recording), item];
    if (attrs.transcript) {
      const textId = `${recording}-text`;
      const text = items.find((item) => item.id === textId);
      if (!text) { measureEdits.current.add(textId); items = [...items, { id: textId, kind: "text", x: 112, y: item.y, width: 560, height: 160, text: String(attrs.transcript), fontSize: 24 }]; }
    }
    change({ ...value, updatedAt: Date.now(), height: Math.min(14000, Math.max(value.height, ...items.map((item) => item.y + item.height + 100))), items });
  };
  const recognize = async (item: PaperItem) => {
    if (!item.asset || recognizing) return;
    setRecognizing(true);
    try {
      const text = item.kind === "audio" ? await assets.transcribe?.(item.asset, navigator.language) : await assets.recognizeText?.(item.asset);
      const value = current.current;
      if (!value.items.some((current) => current.id === item.id && current.asset?.url === item.asset?.url)) return;
      if (!text?.trim()) throw new Error("No text was found. Your original is still on the paper.");
      const result: PaperItem = { id: `${item.id}-text`, kind: "text", x: Math.max(112, item.x), y: item.y, width: Math.min(560, 900 - Math.max(112, item.x)), height: 100, fontSize: 24, text };
      if (!value.items.some((current) => current.id === result.id)) { measureEdits.current.add(result.id); change({ ...value, updatedAt: Date.now(), height: Math.max(value.height, result.y + 200), items: [...value.items, result] }); }
    } catch (error) { toastManager.add({ type: "error", title: "Couldn't extract text", description: error instanceof Error ? error.message : String(error) }); }
    finally { setRecognizing(false); }
  };
  const removeItem = (itemId: string) => {
    change({ ...current.current, updatedAt: Date.now(), items: current.current.items.filter((value) => value.id !== itemId) });
    setSelected(undefined); setEditing(undefined);
  };
  const finishText = () => {
    const item = current.current.items.find((value) => value.id === editing);
    if (item && !item.text?.trim()) removeItem(item.id);
    setEditing(undefined); setSelected(undefined);
  };
  const sourceText = (item: PaperItem) => item.kind !== "text" ? paper.items.find((text) => text.id === `${item.id}-text`) : undefined;
  const display = (item: PaperItem) => {
    const text = sourceText(item);
    return text ? { ...item, x: Math.max(8, text.x - 96), y: text.y, width: 72, height: item.kind === "audio" ? 68 : 64 } : { ...item, height: item.kind === "audio" ? 44 : item.height };
  };
  const selectedItem = paper.items.find((item) => item.id === selected);
  const selectedBox = selectedItem && display(selectedItem);
  const selectedHeight = selectedBox ? Math.max(selectedBox.height, textHeights[selectedBox.id] ?? 0) * scale + 12 : 0;
  const paneWidth = container.current?.clientWidth ?? 900, paneHeight = container.current?.clientHeight ?? 600;
  const selectedLeft = selectedBox ? Math.max(0, (paneWidth - paper.width * scale) / 2) + selectedBox.x * scale - scrollPosition.x - 6 : 0;
  const selectedTop = selectedBox ? (selectedBox.y + 112) * scale - scrollPosition.y - 6 : 0;
  const menuLeft = Math.max(4, Math.min(selectedLeft - 48, paneWidth - 48));
  const obstacles = selectedItem ? paper.items.map((item) => {
    const box = display(item), paired = !!sourceText(item);
    const width = Math.max(box.width * scale, paired ? 44 : 0);
    const left = Math.max(0, (paneWidth - paper.width * scale) / 2) + box.x * scale - scrollPosition.x - (width - box.width * scale) / 2;
    const top = (box.y + 112) * scale - scrollPosition.y;
    return { left, right: left + width, top, bottom: top + Math.max(Math.max(box.height, textHeights[item.id] ?? 0) * scale, paired ? 44 + 14 * scale : 0) };
  }).filter((box) => box.left < menuLeft + 44 && box.right > menuLeft) : [];
  const menuTop = [selectedTop, selectedTop - 48, selectedTop + selectedHeight + 8, 4, ...obstacles.flatMap((box) => [box.top - 48, box.bottom + 4])]
    .filter((y) => y >= 4 && y <= paneHeight - 48).sort((a, b) => Math.abs(a - selectedTop) - Math.abs(b - selectedTop))
    .find((y) => obstacles.every((box) => y + 44 <= box.top || y >= box.bottom)) ?? 4;
  return <section inert={readOnly || undefined} aria-label={readOnly ? "Notebook version preview" : "Handwritten page"} style={{ "--paper-scale": scale, "--background": eInk.colors.background, "--foreground": eInk.colors.foreground, "--muted": eInk.colors.muted, "--muted-foreground": eInk.colors.mutedForeground, "--border": eInk.colors.border, "--ring": eInk.colors.ring, "--accent": eInk.colors.accent, "--accent-foreground": eInk.colors.accentForeground } as CSSProperties} className="ll-paper-page" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === "Escape") { finishText(); setTyping(false); }
    if (editing || !selectedItem || (event.target as HTMLElement).closest('[role="menu"]')) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeItem(selectedItem.id); }
    if (event.key === "Enter" && selectedItem.kind === "text") { event.preventDefault(); if (fitScale < 0.75) setZoom(0.75); setEditing(selectedItem.id); requestAnimationFrame(() => surface.current?.querySelector<HTMLTextAreaElement>(`[data-paper-item="${selectedItem.id}"] textarea`)?.focus()); }
  }} onMouseDown={(event) => event.stopPropagation()}>
    {!readOnly && <ReadingToolbar pageId={id} paper documentCapture={mixed} options={<>
      {phone && <MenuItem onClick={onDetails}><Info className="size-4" />Notebook details</MenuItem>}
      {!nativePaper && phone && <MenuItem onClick={() => { finishText(); setTyping(true); }}><Type className="size-4" />Place text box</MenuItem>}

      <MenuSub><MenuSubTrigger>Zoom</MenuSubTrigger><MenuSubPopup><MenuRadioGroup value={String(zoom)} onValueChange={(value) => setZoom(value === "fit" ? "fit" : Number(value))}>
        <MenuRadioItem value="fit">Fit width</MenuRadioItem>
        {[0.75, 1, 1.5, 2].map((value) => <MenuRadioItem key={value} value={String(value)}>{value * 100}%</MenuRadioItem>)}
      </MenuRadioGroup></MenuSubPopup></MenuSub><MenuSub><MenuSubTrigger>Paper style</MenuSubTrigger><MenuSubPopup>
      <MenuRadioGroup value={paper.style ?? "ruled"} onValueChange={(style) => change({ ...current.current, style: style as Paper["style"], updatedAt: Date.now() })}>
        <MenuRadioItem value="plain">Plain paper</MenuRadioItem><MenuRadioItem value="ruled">Ruled paper</MenuRadioItem><MenuRadioItem value="dotted">Dotted paper</MenuRadioItem>
      </MenuRadioGroup></MenuSubPopup></MenuSub><MenuSeparator />
      <MenuItem disabled={paper.height >= 14000} onClick={() => change({ ...current.current, height: Math.min(14000, current.current.height + 1400), updatedAt: Date.now() })}><Plus className="size-4" />More paper</MenuItem>
    </>}>
      {!phone && <Tooltip><TooltipTrigger render={<Button size="icon-xs" variant="ghost" aria-label="Notebook details" onClick={onDetails} />}><Info className="size-4" /></TooltipTrigger><TooltipPopup>Title and page details</TooltipPopup></Tooltip>}
      {!nativePaper && !phone && <Tooltip><TooltipTrigger render={<Button size="icon-xs" variant="ghost" aria-label="Text box" aria-pressed={typing || !!editing} disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => { const active = typing || !!editing; finishText(); setTyping(!active); }} />}><Type className="size-4" /></TooltipTrigger><TooltipPopup>Place a text box</TooltipPopup></Tooltip>}
    </ReadingToolbar>}
    {previewMissing && <div role="status" className="m-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Ink preview unavailable. Your saved ink is unchanged.<Button size="sm" variant="outline" onClick={() => setPreviewMissing(false)}>Retry ink preview</Button></div>}
    {recording && <div hidden={!recordError} className="ll-paper-recorder" aria-label="Paper recording">
      <BlockEditor key={recording} ref={recorder} assets={assets} content={{ type: "doc", content: [{ type: "voiceRecording", attrs: { autostart: true } }, { type: "paragraph" }] }} onChange={capture} onVoiceDetached={async (_, asset) => {
        await editPage(id, { properties: (props) => {
          const value = readPaper(props.paper) ?? current.current;
          if (value.items.some((item) => item.id === recording)) return props;
          const y = Math.min(13800, Math.max(60, (value.inkBottom ?? (value.preview ? value.previewHeight ?? value.height : 0)) + 32, ...value.items.map((item) => item.y + item.height + 30)));
          return { ...props, paper: { ...value, updatedAt: Date.now(), height: Math.max(value.height, y + 180), items: [...value.items, { id: recording, kind: "audio", x: 112, y, width: 320, height: 44, asset }] } };
        } });
      }} />
    </div>}
    <div className="ll-paper-viewport" ref={container} onScroll={(event) => setScrollPosition({ x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop })}>
    <div style={{ height: (paper.height + 112) * scale, width: paper.width * scale }} className="ll-paper-sheet relative shrink-0">
      <div className="ll-paper-heading" style={{ width: paper.width, height: 112, transform: `scale(${scale})` }}><h1>{mixed ? "Handwritten notes" : title || "Untitled notebook"}</h1><p>{mixed ? "Kept with this document" : "Notebook"}</p></div>
      <div ref={surface} data-paper-surface data-paper-style={paper.style ?? "ruled"} className="ll-paper-surface absolute origin-top-left" style={{ width: paper.width, height: paper.height, top: 112 * scale, transform: `scale(${scale})`, cursor: typing ? "text" : undefined }} onClick={() => { if (nativePaper) void open("write"); }} onDoubleClick={(event) => {
        if (nativePaper || (event.target as HTMLElement).closest("[data-paper-item]")) return;
        const rect = event.currentTarget.getBoundingClientRect(); addText((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
      }} onPointerDown={(event) => {
        if (nativePaper) { if (event.pointerType === "pen") void open("write"); return; }
        if ((event.target as HTMLElement).closest("[data-paper-item]")) return;
        if (typing) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); addText((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale); }
        else { finishText(); if (document.activeElement instanceof HTMLElement && surface.current?.contains(document.activeElement)) document.activeElement.blur(); }
      }}>
        {paper.preview && !previewMissing && <img src={paper.preview.url} alt="Handwritten ink" onError={() => setPreviewMissing(true)} draggable={false} className="pointer-events-none absolute left-0 top-0 w-full" style={{ height: paper.previewHeight ?? paper.height, zIndex: 1 }} />}
        {paper.items.map((item) => { const box = display(item), paired = !!sourceText(item); return <div key={item.id} data-paper-item={item.id} className="ll-paper-item absolute" data-selected={selected === item.id || undefined} style={{ left: box.x, top: box.y, width: box.width, height: Math.max(box.height, textHeights[item.id] ?? 0), pointerEvents: nativePaper ? "none" : undefined }} onPointerDown={(event) => {
            if (nativePaper) return;
            if ((event.target as HTMLElement).closest("button, [role=slider]")) return;
            if (editing !== item.id) { event.preventDefault(); event.currentTarget.closest<HTMLElement>(".ll-paper-page")?.focus(); }
            if (selected === item.id && editing !== item.id && !paired) gesture(event, item);
            else { if (editing) finishText(); setSelected(item.id); }
          }} onDoubleClick={() => { if (!nativePaper && item.kind === "text") { if (fitScale < 0.75) setZoom(0.75); setEditing(item.id); requestAnimationFrame(() => surface.current?.querySelector<HTMLTextAreaElement>(`[data-paper-item="${item.id}"] textarea`)?.focus()); } }}>
          {item.kind === "text" && <PaperText fitContent={measureEdits.current.has(item.id)} readOnly={editing !== item.id} item={item} onHeight={(height) => {
            setTextHeights((before) => before[item.id] === height ? before : { ...before, [item.id]: height });
            if (measureEdits.current.delete(item.id) && height !== item.height) update(item.id, { height });
          }} onChange={(patch) => update(item.id, patch)} onFinish={finishText} />}
          {item.kind === "image" && item.asset && (paired ? <ContextMenu>
            <ContextMenuTrigger render={<Button variant="ghost" className="ll-paper-source-photo" aria-label="Open original photo" onClick={() => assets.open(item.asset!)} />}><img src={item.asset.url} alt="" draggable={false} /></ContextMenuTrigger>
            <ContextMenuPopup><ContextMenuItem onClick={() => assets.open(item.asset!)}>Open original photo</ContextMenuItem><ContextMenuItem variant="destructive" onClick={() => removeItem(item.id)}><Trash2 className="size-4" />Delete photo</ContextMenuItem></ContextMenuPopup>
          </ContextMenu> : <img src={item.asset.url} alt={item.asset.name} draggable={false} className="h-full w-full object-contain" />)}
          {item.kind === "audio" && item.asset && <ContextMenu><ContextMenuTrigger render={<div className="h-full" />}><Player kind="audio" compact={paired} src={item.asset.url} onError={() => toastManager.add({ type: "error", title: "Recording unavailable", description: "Let the attachment finish syncing, then try again." })} /></ContextMenuTrigger><ContextMenuPopup>{!paired && <ContextMenuItem disabled={recognizing} onClick={() => void recognize(item)}>Transcribe recording</ContextMenuItem>}<ContextMenuItem variant="destructive" onClick={() => removeItem(item.id)}><Trash2 className="size-4" />Delete recording</ContextMenuItem></ContextMenuPopup></ContextMenu>}
        </div>; })}
      </div>
      {!nativePaper && selectedItem && selectedBox && <div className="ll-paper-selection" style={{ left: selectedBox.x * scale - 6, top: (selectedBox.y + 112) * scale - 6, width: selectedBox.width * scale + 12, height: Math.max(selectedBox.height, textHeights[selectedItem.id] ?? 0) * scale + 12 }}>
        {!editing && <div className="ll-paper-item-tools absolute flex" style={{ left: menuLeft - selectedLeft, top: menuTop - selectedTop }}>
          <Menu><MenuTrigger render={<Button size="icon" variant="ghost" aria-label="Text or attachment options" />}><GripVertical className="size-4" /></MenuTrigger><MenuPopup align="start">
            {selectedItem.kind === "image" && selectedItem.asset && <MenuItem onClick={() => assets.open(selectedItem.asset!)}>Open original photo</MenuItem>}
            {selectedItem.asset && !paper.items.some((value) => value.id === `${selectedItem.id}-text`) && <MenuItem disabled={recognizing} onClick={() => void recognize(selectedItem)}>{recognizing ? "Recognizing…" : selectedItem.kind === "audio" ? "Transcribe recording" : "Extract text"}</MenuItem>}
            <MenuItem variant="destructive" onClick={() => removeItem(selectedItem.id)}><Trash2 className="size-4" />Delete {selectedItem.kind === "text" ? "text box" : "attachment"}</MenuItem>
          </MenuPopup></Menu>
        </div>}
        {selectedItem.kind !== "audio" && !sourceText(selectedItem) && <Button size="icon" variant="ghost" className="ll-paper-knob" aria-label="Resize text or attachment" style={{ top: selectedItem.kind === "text" ? "50%" : "100%", right: Math.max(-22, selectedLeft + selectedBox.width * scale + 12 - paneWidth + 4), touchAction: "none" }} onPointerDown={(event) => gesture(event, selectedItem, true)}><span /></Button>}
      </div>}
    </div>
    </div>
  </section>;
}

function PaperText({ item, readOnly, fitContent, onChange, onFinish, onHeight }: { readOnly: boolean; fitContent: boolean; item: PaperItem; onChange: (patch: Partial<PaperItem>) => void; onFinish: () => void; onHeight: (height: number) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!readOnly) requestAnimationFrame(() => { ref.current?.focus(); ref.current?.scrollIntoView({ block: "nearest", inline: "center" }); }); }, [readOnly]);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "0px";
    const height = Math.max(70, field.scrollHeight);
    const fitted = Math.min(readOnly && !fitContent ? Math.max(height, item.height) : height, 14000 - item.y);
    field.style.height = `${fitted}px`;
    onHeight(fitted);
  }, [item.text, item.width, item.height, item.fontSize, item.y, readOnly, fitContent]);
  return <Textarea ref={ref} readOnly={readOnly} onBlur={() => { if (!readOnly) onFinish(); }} unstyled aria-label="Paper text" value={item.text ?? ""} className="ll-paper-text w-full" style={{ fontSize: item.fontSize ?? 24 }} onChange={(event) => onChange({ text: event.currentTarget.value, height: Math.min(Math.max(70, event.currentTarget.scrollHeight), 14000 - item.y) })} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.blur(); onFinish(); } if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); onFinish(); } }} />;
}
