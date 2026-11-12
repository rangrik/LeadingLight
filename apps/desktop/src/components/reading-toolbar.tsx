import { BookOpen, Camera, Check, Ellipsis, Eraser, Mic, NotebookPen, PenLine, Redo2, Square, Undo2 } from "lucide-react";
import type { InkAction, InkState } from "@leadinglight/editor/editor";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { ToolbarPrimitive } from "@leadinglight/ui/components/toolbar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { toastManager } from "@leadinglight/ui/components/toast";
import { setReadingMode, useReadingMode } from "~/lib/reading-mode";
import { ReadingLibrary } from "./reading-library";
import { PageHistory } from "./page-history";
import { WritingMenu } from "./writing-menu";
import { liveEditor } from "~/lib/live";
import { openPaper } from "~/lib/paper";
import { newNotebook, notebookFor, notebookSource, openLinkedNotebook } from "~/lib/notebooks";
import { openPage } from "~/lib/panes";
import { pageOf, space } from "~/lib/space";
import { useMobile } from "~/lib/platform";
import { useKeysFor } from "~/lib/keymap";
import { toolsOn, useWritingPrefs } from "~/lib/writing";
import { useInlinePencil } from "~/lib/document-ink";

const idleInk: InkState = { enabled: false, tool: "pen", finger: false, canUndo: false, canRedo: false };

export function ReadingToolbar({ pageId, paper = false, documentCapture = false, unavailable = false, children, options }: { pageId: string; paper?: boolean; documentCapture?: boolean; unavailable?: boolean; children?: ReactNode; options?: ReactNode }) {
  const mobile = useMobile();
  const reading = useReadingMode();
  const writing = useWritingPrefs();
  space.use();
  const [library, setLibrary] = useState(false);
  const keys = useKeysFor();
  const marker = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [phase, setPhase] = useState("idle");
  const [seconds, setSeconds] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [creating, setCreating] = useState(false);
  const documentInk = !paper || documentCapture;
  const [ink, setInk] = useState<InkState>(idleInk);
  const draw = (action: InkAction) => {
    if (action !== "finish" && Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01) {
      toastManager.add({ type: "info", title: "Return to normal zoom to write on this page" });
      return;
    }
    liveEditor(pageId)?.inkAction(action);
  };
  useInlinePencil(marker, ink.enabled && documentInk, pageId);
  useEffect(() => {
    setInk(idleInk);
    const pane = marker.current?.closest("[data-pane-page]");
    const changed = (event: Event) => {
      const next = (event as CustomEvent<InkState>).detail;
      setInk((old) => Object.keys(idleInk).every((key) => old[key as keyof InkState] === next[key as keyof InkState]) ? old : next);
    };
    pane?.addEventListener("ll:ink-state", changed);
    return () => pane?.removeEventListener("ll:ink-state", changed);
  }, [pageId]);
  useLayoutEffect(() => { setTarget(marker.current?.closest("[data-pane-page]")?.querySelector("[data-page-actions]") ?? null); }, [pageId]);
  useEffect(() => {
    if (phase !== "recording") return;
    const start = Date.now(); setSeconds(0);
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const card = marker.current?.closest("[data-pane-page]");
    const changed = (event: Event) => setPhase((event as CustomEvent<string>).detail);
    card?.addEventListener("ll:recording-state", changed);
    return () => card?.removeEventListener("ll:recording-state", changed);
  }, [pageId]);
  const capture = async () => {
    if (paper && !documentCapture) { openPaper(pageId, "photo"); return; }
    if (capturing) return;
    setCapturing(true);
    try { await liveEditor(pageId)?.captureImage("photo"); }
    catch (error) { toastManager.add({ type: "error", title: "Couldn't capture", description: String(error) }); }
    finally { setCapturing(false); }
  };
  const create = async (linked: boolean) => {
    if (creating) return;
    setCreating(true);
    try { if (linked) await openLinkedNotebook(pageId); else openPage((await newNotebook()).id); }
    catch (error) { toastManager.add({ type: "error", title: "Couldn't create notebook", description: error instanceof Error ? error.message : String(error) }); }
    finally { setCreating(false); }
  };
  const recording = phase === "recording";
  const source = notebookSource(pageId);
  const busy = unavailable || capturing || phase !== "idle";
  return <><span ref={marker} hidden />{target && createPortal(<ToolbarPrimitive.Root aria-label={paper ? "Paper tools" : "Reading capture"} className="ll-reading-toolbar">
    {children}
    {documentInk && !ink.enabled && <Tooltip><TooltipTrigger render={<Button aria-label="Write on this page" size="icon-xs" variant="ghost" disabled={unavailable || busy} onClick={() => draw("toggle")} />}><PenLine className="size-4" /></TooltipTrigger><TooltipPopup>Write on this page</TooltipPopup></Tooltip>}
    {documentInk && ink.enabled && <>
      <Menu><MenuTrigger render={<Button aria-label="Writing tools" size="icon-xs" variant="ghost" />}>
        {ink.tool === "eraser" ? <Eraser className="size-4" /> : <PenLine className="size-4" />}
      </MenuTrigger><MenuPopup align="end">
        <MenuRadioGroup value={ink.tool} onValueChange={(tool) => draw(tool as "pen" | "eraser")}>
          <MenuRadioItem value="pen" closeOnClick>Pen</MenuRadioItem>
          <MenuRadioItem value="eraser" closeOnClick>Eraser</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem closeOnClick checked={ink.finger} onCheckedChange={() => draw("finger")}>Draw with finger</MenuCheckboxItem>
        <MenuItem onClick={() => draw("space")}><NotebookPen className="size-4" />Write below selected block</MenuItem>
        <MenuItem disabled={!ink.canRedo} onClick={() => draw("redo")}><Redo2 className="size-4" />Redo</MenuItem>
      </MenuPopup></Menu>
      <Tooltip><TooltipTrigger render={<Button aria-label="Undo" size="icon-xs" variant="ghost" disabled={!ink.canUndo} onClick={() => draw("undo")} />}><Undo2 className="size-4" /></TooltipTrigger><TooltipPopup>Undo</TooltipPopup></Tooltip>
      <Tooltip><TooltipTrigger render={<Button aria-label="Finish writing" size="icon-xs" variant="ghost" onClick={() => draw("finish")} />}><Check className="size-4" /></TooltipTrigger><TooltipPopup>Finish writing</TooltipPopup></Tooltip>
    </>}
    {!ink.enabled && <>
    <Tooltip><TooltipTrigger render={<Button aria-label={recording ? "Stop recording" : "Quick record"} className={`ll-quick-record ${recording ? "flex-col gap-0 text-destructive-foreground" : ""}`} loading={["starting", "saving", "transcribing"].includes(phase)} size="icon-xs" variant="ghost" disabled={unavailable || capturing || ["starting", "saving", "transcribing"].includes(phase)} onClick={() => paper && !documentCapture ? openPaper(pageId, "record") : liveEditor(pageId)?.record()} />}>
      {recording ? <><Square className="size-3 fill-current" /><span className="text-[9px] leading-[10px] tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></> : <Mic className="size-4" />}
    </TooltipTrigger><TooltipPopup>{phase === "recording" ? `Stop recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : phase === "starting" ? "Starting recording…" : phase === "saving" ? "Saving recording…" : phase === "transcribing" ? "Transcribing recording…" : `Quick record · ${keys("quick-record")}`}</TooltipPopup></Tooltip>
    {mobile && <Tooltip><TooltipTrigger render={<Button aria-label="Take photo" size="icon-xs" variant="ghost" disabled={busy} onClick={() => void capture()} />}><Camera className="size-4" /></TooltipTrigger><TooltipPopup>Photograph a passage</TooltipPopup></Tooltip>}
    </>}
    <Menu><MenuTrigger render={<Button aria-label={paper ? "Notebook options" : "Page actions"} size="icon-xs" variant="ghost" />}><Ellipsis className="size-4" /></MenuTrigger><MenuPopup align="end" className="max-w-[calc(100vw-1rem)]" portalProps={{ keepMounted: true }}>
      {paper && mobile && <MenuItem disabled={busy} onClick={() => openPaper(pageId)}><PenLine className="size-4" />Open handwriting</MenuItem>}
      {options}
      {source && <MenuItem onClick={() => openPage(source.id)}><BookOpen className="size-4" /><span className="min-w-0 truncate">Back to {source.title || "source page"}</span></MenuItem>}
      {!paper && <MenuItem disabled={creating || busy} onClick={() => void create(true)}><NotebookPen className="size-4" />{notebookFor(pageId) ? "Open linked notebook" : "New linked notebook"}</MenuItem>}
      <MenuSeparator />
      <PageHistory page={pageId} submenu />
      {!paper && toolsOn(writing, pageOf(pageId)?.typeId ?? "page") && <WritingMenu pageId={pageId} submenu />}
      <MenuCheckboxItem checked={reading.enabled} onCheckedChange={setReadingMode}>E-ink appearance</MenuCheckboxItem>
      <MenuSeparator />
      <MenuItem disabled={creating || busy} onClick={() => void create(false)}><NotebookPen className="size-4" />New notebook</MenuItem>
      <MenuItem onClick={() => setLibrary(true)}><BookOpen className="size-4" />Import a book</MenuItem>
    </MenuPopup></Menu>
  </ToolbarPrimitive.Root>, target)}<ReadingLibrary open={library} onOpenChange={setLibrary} /></>;
}
