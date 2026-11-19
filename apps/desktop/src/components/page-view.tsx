import { checkNotebookType, NOTEBOOK_TYPE } from "~/lib/page-format";
import { saveEmergency, clearEmergency } from "~/lib/store-local";
import { carry } from "~/lib/catalog";
import { BlockEditor, type BlockEditorHandle, type EditorDoc, type QuoteTarget, type PageSelection, type VoiceReview } from "@leadinglight/editor/editor";
import { splitTitle } from "@leadinglight/editor/markdown";
import { AlignLeft, ChevronDown, Hash, ImageIcon, LayoutTemplate, Smile } from "lucide-react";
import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";
import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription, SheetPanel } from "@leadinglight/ui/components/sheet";
import { Button } from "@leadinglight/ui/components/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { toastManager } from "@leadinglight/ui/components/toast";
import { markCapture } from "~/lib/capture-inbox";
import { saveVoice } from "~/lib/capture";
import { cn } from "@leadinglight/ui/lib/utils";
import { BookNavigation } from "~/components/reading-library";
import { Backlinks, Linked } from "~/components/backlinks";
import { DailyBar, ThisDay } from "~/components/daily-bar";
import { linkHost } from "~/components/link-views";
import { CoverBand, CoverPicker } from "~/components/page-cover";
import { IconPicker, PageIconView } from "~/components/page-icon";
import { FolderRow, LinkFolderButton } from "~/components/project-folder";
import { PropertyPanel } from "~/components/property-panel";
import { ReportByline, Reports, ReportSources } from "~/components/reports";
import { ProjectConnection } from "~/components/device-connections";
import { WorkPanel } from "~/components/work-panel";
import { ProjectWork } from "~/components/work-table";
import { PagePicker } from "~/components/property-value";
import { TagPanel } from "~/components/tag-panel";
import { setPageStats } from "~/components/page-stats";
import { phone, useMobile } from "~/lib/platform";
import { openAsk, registerPage, unregisterPage } from "~/lib/ask";
import { assets } from "~/lib/assets";
import { openHref, quoteInto, reportQuotes, useQuotes } from "~/lib/essay";
import { useKeysFor } from "~/lib/keymap";
import { pageStyle } from "~/lib/labels";
import { childOf, parentOf, roleOf } from "~/lib/linked";
import { registerLive, touchLive } from "~/lib/live";
import type { LLObject, ObjectPatch } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { focusedPage, panes } from "~/lib/panes";
import { type PageCover, type PageIcon, readCover, readIcon } from "~/lib/page-meta";
import { trackFlush } from "~/lib/saving";
import { pageOf, patchSummary, savePage, space, typeOf } from "~/lib/space";
import { useNotesFor } from "~/lib/notes-for";
import { reportOf } from "~/lib/work";
import { editorWriting, toolsOn, useWritingPrefs } from "~/lib/writing";
import { contentWidth, usePageLayout } from "~/lib/page-layout";
import { TurnIntoPage } from "~/components/turn-into-page";
import { VoiceReviewDialog } from "~/components/voice-review";
import { TailPage, TailToday } from "~/components/tail";
import { today } from "~/lib/daily";
import { currentEdit } from "@leadinglight/editor/authorship";
import type { ChangeContext } from "~/lib/history-types";
import { ReadingToolbar } from "~/components/reading-toolbar";
import { PaperPage } from "~/components/paper-page";
import { readPaper, registerPaper, type PaperAction } from "~/lib/paper";

// The body is read only when a save runs, not on every keystroke.
type Pending = { title?: string; content?: () => EditorDoc; properties?: Record<string, unknown>; typeId?: string; context?: ChangeContext };

const SAVE_DELAY_MS = 500;

// Narrow panes show the header controls as icons only.
const Label = ({ children }: { children: string }) => <span className="hidden @lg/page-title:inline">{children}</span>;

// A textarea that grows with its text instead of scrolling.
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
};
const watchFit = (ref: RefObject<HTMLTextAreaElement | null>, el: HTMLTextAreaElement | null) => {
  ref.current = el;
  if (!el) return;
  fit(el);
  let width = el.offsetWidth;
  const observer = new ResizeObserver(() => {
    if (!el.offsetWidth || el.offsetWidth === width) return;
    width = el.offsetWidth;
    fit(el);
  });
  observer.observe(el);
  return () => { observer.disconnect(); ref.current = null; };
};

export function PageView({ page }: { page: LLObject }) {
  const mobile = useMobile();
  const [title, setTitle] = useState(page.title);
  const latestTitle = useRef(title); latestTitle.current = title;
  const [typeId, setTypeId] = useState(page.typeId);
  const keysFor = useKeysFor();
  const [props, setProps] = useState(page.properties);
  const latest = useRef(page.properties);
  const [paperDetails, setPaperDetails] = useState(false);
  const [paperRequest, setPaperRequest] = useState<{ action: PaperAction; count: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const titleField = useCallback((el: HTMLTextAreaElement | null) => watchFit(titleRef, el), []);
  const descriptionField = useCallback((el: HTMLTextAreaElement | null) => watchFit(descriptionRef, el), []);
  const editorRef = useRef<BlockEditorHandle>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const writing = useWritingPrefs();
  const layout = usePageLayout();
  const [margins, setMargins] = useState({ notes: false, toc: false });
  // A report under the page with notes needs the margin too.
  const [streamNotes, setStreamNotes] = useState(false);
  const [inBody, setInBody] = useState(false);
  const [turnInto, setTurnInto] = useState<PageSelection | null>(null);
  const [voiceReview, setVoiceReview] = useState<VoiceReview | null>(null);
  const [tailRow, setTailRow] = useState(false);
  // The writing tools follow the page's type (Settings › Writing › Use on).
  const tools = toolsOn(writing, typeId);
  const counting = tools && writing.count;
  useEffect(() => {
    if (!counting) setPageStats(page.id, null);
  }, [counting, page.id]);

  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const restoring = useRef(false);

  const flush = (finishInk = true): Promise<void> => {
    if (finishInk) editorRef.current?.finishPendingInk();
    clearTimeout(timer.current);
    const batch = pending.current;
    const { content, context, ...rest } = batch;
    pending.current = {};
    if (!content && Object.keys(rest).length === 0) return saving.current;
    const patch: ObjectPatch = { ...rest };
    if (content) patch.content = content();
    const recovery = saveEmergency(page, patch, context);
    const write = saving.current.catch(() => {}).then(() => savePage(page.id, patch, context)).then(() => clearEmergency(page.id, recovery));
    saving.current = write.catch((error) => {
      pending.current = { ...batch, ...pending.current };
      throw error;
    });
    return saving.current;
  };

  const queue = (patch: Pending) => {
    if (restoring.current) return;
    Object.assign(pending.current, patch, { context: currentEdit() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(false).catch(() => {}), SAVE_DELAY_MS);
  };

  // Every other stored property, including ones this version doesn't know, is kept as it was.
  const replaceProps = (next: Record<string, unknown>) => {
    latest.current = next;
    setProps(next);
    patchSummary(page.id, { properties: next });
    queue({ properties: next });
  };
  const setProp = (key: string, value: unknown) => {
    const next = { ...latest.current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    replaceProps(next);
  };
  const setType = (next: string) => {
    checkNotebookType(pageOf(page.id)?.typeId ?? page.typeId, next);
    setTypeId(next);
    patchSummary(page.id, { typeId: next });
    queue({ typeId: next });
    const carried = carry(latest.current, typeOf(next), space.get().props);
    if (carried !== latest.current) replaceProps(carried);
  };
  const rename = (value: string) => {
    if (reportOf(pageOf(page.id))) return;
    setTitle(value);
    patchSummary(page.id, { title: value });
    queue({ title: value });
  };
  const setIcon = (icon?: PageIcon) => setProp("icon", icon);
  const setCover = (cover?: PageCover) => setProp("cover", cover);
  const addDescription = () => {
    setAdding(true);
    setProp("description", "");
  };

  const icon = readIcon(props.icon);
  const cover = readCover(props.cover);
  const description = typeof props.description === "string" ? props.description : undefined;
  const templateOf = typeof props.templateOf === "string" ? props.templateOf : undefined;
  const day = typeId === "daily" && typeof props.day === "string" ? props.day : undefined;
  const tags = Array.isArray(props.tags) ? (props.tags as string[]) : [];
  // Types with a Tags property show it as a row already.
  const canTag = !typeOf(typeId).props.includes("tags") && tags.length === 0;

  // Sidenotes keep their text in the page's Thoughts page; a Thoughts page or an essay takes none
  // of its own. A page with an essay quotes into it and follows its quotes (DECISIONS.md, 11).
  const role = roleOf(page);
  const parent = parentOf(page);
  const current = { ...page, properties: props };
  const { notes, onNoteSteps } = useNotesFor(current, editorRef);
  const essay = childOf(current, "essay");
  // An agent's report reads as it was published (features/reports.feature), taking only sidenotes.
  const report = !!reportOf(current);
  const paper = readPaper(props.paper);
  const unavailablePaper = typeId === NOTEBOOK_TYPE && !paper;
  const [documentNotes, setDocumentNotes] = useState(!!page.content?.content?.some((node) => node.type !== "paragraph" || node.content?.length));
  const showDetails = !paper || documentNotes;
  useEffect(() => registerPaper(page.id, (action) => {
    if (report || !readPaper(latest.current.paper)) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setPaperRequest((value) => ({ action, count: (value?.count ?? 0) + 1 }));
  }), [page.id, report]);
  const quotes = useQuotes(page.id, essay);
  const quoteTo: QuoteTarget | undefined = essay ? { essay, add: (text, id) => void quoteInto(page.id, { text, id }) } : undefined;
  const onCites = role === "essay" && parent ? (ids: string[]) => reportQuotes(parent, ids) : undefined;

  // A brand new page starts in the title. Pending edits are saved when leaving the page, and
  // whenever the app is about to go away (see App).
  useEffect(() => {
    if (!page.title && !page.content && !paper && !unavailablePaper) titleRef.current?.focus();
    const leavingEditor = editorRef.current;
    const untrack = trackFlush(flush);
    const unlive = registerLive(page.id, {
      flush,
      dirty: () => Object.keys(pending.current).length > 0 || !!editorRef.current?.hasPendingInk(),
      discard: () => { clearTimeout(timer.current); pending.current = {}; },
      snapshot: () => ({ typeId: pageOf(page.id)?.typeId ?? page.typeId, title: latestTitle.current, content: editorRef.current?.getJSON() ?? page.content, properties: latest.current }),
      restore: (next) => {
        restoring.current = true;
        clearTimeout(timer.current);
        pending.current = {};
        setTitle(next.title);
        setTypeId(next.typeId);
        latest.current = next.properties;
        setProps(next.properties);
        editorRef.current?.setContent(next.content ?? { type: "doc", content: [] });
        setDocumentNotes(!!next.content?.content?.some((node) => node.type !== "paragraph" || node.content?.length));
        restoring.current = false;
      },
      editor: () => editorRef.current,
      content: () => editorRef.current?.getJSON() ?? page.content ?? { type: "doc", content: [] },
      setContent: (doc) => editorRef.current?.setContent(doc),
      properties: () => latest.current,
      setProperties: replaceProps,
      setTitle: rename,
      // Retyped from elsewhere (Assign): its properties come with it, so nothing is carried.
      setType: (next) => {
        checkNotebookType(pageOf(page.id)?.typeId ?? page.typeId, next);
        setTypeId(next);
        patchSummary(page.id, { typeId: next });
        queue({ typeId: next });
      },
      insertQuote: (quote) => editorRef.current?.insertQuote(quote),
      reveal: (anchor) => editorRef.current?.reveal(anchor),
      focus: (where) => { if (where === "title" && titleRef.current?.offsetParent) titleRef.current.focus(); else if (bodyRef.current?.offsetParent) editorRef.current?.focus("end"); },
    });
    return () => {
      leavingEditor?.finishPendingInk();
      untrack();
      unlive();
      setPageStats(page.id, null);
      void flush().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The agent panel asks about this page while it is in front (lib/ask.ts); with panes side
  // by side, that is the page last worked in.
  const askPage = { id: page.id, title: () => latestTitle.current, text: () => docMarkdown(editorRef.current?.getJSON(), (id) => pageOf(id)?.title ?? "") };
  useEffect(() => {
    registerPage(askPage, editorRef.current);
    // Its pane can come to the front with no focus in it: its sidebar row, or the pane beside closed.
    const off = panes.subscribe(() => void (focusedPage() === page.id && registerPage(askPage, editorRef.current)));
    return () => {
      off();
      unregisterPage(page.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  useLayoutEffect(() => fit(titleRef.current), [title]);
  useLayoutEffect(() => fit(descriptionRef.current), [description]);

  const toBody = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (paper || unavailablePaper) { (e.currentTarget as HTMLElement).blur(); setPaperDetails(false); return; }
    editorRef.current?.focus("start");
  };

  // A whole page pasted into the title: a heading on its first line names the page, and the
  // rest (all of it, with no heading) goes into the body.
  const pasteTitle = (e: React.ClipboardEvent) => {
    if (typeId === NOTEBOOK_TYPE) {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
      return;
    }
    const html = e.clipboardData.getData("text/html");
    const { title, body } = splitTitle(e.clipboardData.getData("text/plain").trim(), html);
    if (title === undefined && !body.includes("\n")) return;
    e.preventDefault();
    // As typing does, so the title's own undo takes it back.
    if (title !== undefined) document.execCommand("insertText", false, title);
    if (body) editorRef.current?.paste(body, title === undefined ? html : "");
  };

  // Blank page space belongs to the page: with no block active (and no popup open), a click at
  // the title's height goes to the title, from the body down into the body (see placeAt). The
  // properties between them and the sections after the body keep their clicks.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    const editor = editorRef.current;
    const title = titleRef.current;
    if (paper || !editor || !title || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || editor.hasFocus()) return;
    if (document.activeElement?.closest("[role=dialog], [role=menu], [role=listbox]")) return;
    const target = e.target as HTMLElement;
    if (target.closest(".ProseMirror, .ll-handle, .ll-note, .ll-toc, textarea, input, button, a, [role]")) return;
    // Level with the sections after the body (backlinks, what was made that day) is theirs too.
    const besideSection = [...e.currentTarget.querySelectorAll("section")].some((s) => {
      const r = s.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (besideSection) return;
    if (e.clientY <= title.getBoundingClientRect().bottom) {
      e.preventDefault();
      title.focus();
      title.setSelectionRange(title.value.length, title.value.length);
    } else if (e.clientY >= (bodyRef.current?.getBoundingClientRect().top ?? 0) && editor.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };

  const pageDetails = <>
        <div className={cn("group/head @container/page-title", !(cover && icon) && "pt-10")} data-tail={tailRow || undefined}>
          {icon && (
            <IconPicker icon={icon} onChange={setIcon}>
              <button
                aria-label="Change icon"
                className={cn("relative mb-9 flex rounded-lg transition-colors duration-150 hover:bg-accent", cover && "-mt-8")}
                type="button"
              >
                <PageIconView icon={icon} large />
              </button>
            </IconPicker>
          )}
          <div className="relative">
            {/* Shown on hover, sitting in the space above the title so nothing moves. A tail row
                takes that space while it shows. */}
            <div
              className="absolute bottom-full -ms-2 mb-1 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/head:opacity-100 has-data-popup-open:opacity-100 group-data-[tail]/head:hidden data-[report]:hidden"
              data-report={report || undefined}
            >
              {!icon && (
                <IconPicker onChange={setIcon}>
                  <Button aria-label="Add icon" className="text-muted-foreground" size="sm" variant="ghost">
                    <Smile />
                    <Label>Add icon</Label>
                  </Button>
                </IconPicker>
              )}
              {!cover && (
                <CoverPicker onChange={setCover}>
                  <Button aria-label="Add cover" className="text-muted-foreground" size="sm" variant="ghost">
                    <ImageIcon />
                    <Label>Add cover</Label>
                  </Button>
                </CoverPicker>
              )}
              {canTag && (
                <PagePicker
                  exclude={tags}
                  label="Add tag"
                  onPick={(id) => setProp("tags", [...tags, id])}
                  trigger={
                    <Button aria-label="Add tag" className="text-muted-foreground" size="sm" variant="ghost">
                      <Hash />
                      <Label>Add tag</Label>
                    </Button>
                  }
                  typeId="tag"
                />
              )}
              {description === undefined && (
                <Button aria-label="Add description" className="text-muted-foreground" onClick={addDescription} size="sm" variant="ghost">
                  <AlignLeft />
                  <Label>Add description</Label>
                </Button>
              )}
              {/* Its words only where there is room for them beside the others. */}
              <LinkFolderButton label={<span className="hidden @3xl/page-title:inline">Link folder</span>} pageId={page.id} />
            </div>
            {!report && <TailPage onRow={setTailRow} pageId={page.id} />}
            <textarea
              aria-label="Title"
              className="block w-full resize-none overflow-hidden bg-transparent font-bold font-heading text-[2.25rem] leading-[1.2] tracking-tight outline-none placeholder:text-muted-foreground/60"
              onFocus={() => editorRef.current?.clearBlocks()}
              onChange={(e) => rename(e.currentTarget.value.replace(/\n/g, ""))}
              onKeyDown={toBody}
              onPaste={pasteTitle}
              placeholder={role === "essay" ? "Essay title" : "Untitled"}
              readOnly={report}
              ref={titleField}
              rows={1}
              value={title}
            />
          </div>
          {description !== undefined && (
            <textarea
              aria-label="Description"
              autoFocus={adding}
              className="mt-1 block w-full resize-none overflow-hidden bg-transparent text-base text-muted-foreground leading-normal outline-none placeholder:text-muted-foreground/60"
              onBlur={() => {
                setAdding(false);
                if (!description.trim()) setProp("description", undefined);
              }}
              onChange={(e) => setProp("description", e.currentTarget.value.replace(/\n/g, ""))}
              onKeyDown={toBody}
              placeholder="Add a description"
              ref={descriptionField}
              rows={1}
              value={description}
            />
          )}
        </div>
        {report ? <div className="mt-2"><ReportByline about report={current} /></div> : <FolderRow pageId={page.id} />}
        {typeId === "project" && <ProjectConnection project={page.id} />}
        <WorkPanel pageId={page.id} />
        {templateOf && (
          <p className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
            <LayoutTemplate className="size-4" />
            Template for {typeOf(templateOf).plural}: new ones start as a copy of this page.
          </p>
        )}
        {!report && (phone && !paper ? <Collapsible className="mt-3">
          <CollapsibleTrigger render={<Button className="text-muted-foreground" variant="ghost" />}><ChevronDown />Page details</CollapsibleTrigger>
          <CollapsiblePanel><PropertyPanel
            onDescription={description === undefined ? addDescription : undefined}
            page={{ ...page, ...pageOf(page.id), title, typeId, properties: props }}
            setProp={setProp} setType={setType} typeId={typeId} values={props}
          /></CollapsiblePanel>
        </Collapsible> : <PropertyPanel
          onDescription={description === undefined ? addDescription : undefined}
          page={{ ...page, ...pageOf(page.id), title, typeId, properties: props }}
          setProp={setProp}
          setType={setType}
          typeId={typeId}
          values={props}
        />)}
        <BookNavigation page={current} />
        {!report && <ProjectWork pageId={page.id} />}
        {day && <DailyBar day={day} />}
        {!phone && day === today() && <TailToday />}
        {typeId === "tag" && <TagPanel id={page.id} />}
  </>;

  return (
    // Focus mode fades the rest of the page too while the body is written in (styles.css).
    <div
      className={cn("ll-page-root min-h-full", paper && "ll-notebook-root", paper && showDetails && "ll-notebook-with-details", tools && writing.focus && writing.focusOn !== "typewriter" && inBody && "ll-page-dim")}
      onFocusCapture={() => registerPage(askPage, editorRef.current)}
      onMouseDown={onBlankMouseDown}
    >
      {!paper && !report && <ReadingToolbar pageId={page.id} paper={unavailablePaper} unavailable={unavailablePaper} />}
      {showDetails && cover && <CoverBand cover={cover} onChange={setCover} />}
      {/* The left padding is the block handle's gutter; the right one gives way in narrow panes.
          Sidenotes and "On this page" make room for themselves (ll-page, styles.css). */}
      <div className={cn("ll-page pb-8", paper && "ll-notebook-page")} data-page-notes={margins.notes || streamNotes || undefined} data-page-toc={margins.toc || undefined} style={{ "--content-width": `${paper ? 900 : contentWidth(layout.width)}px`, ...(layout.fullWidth && { maxWidth: "none" }) } as CSSProperties}>
        {showDetails && <div className={paper ? "ll-notebook-details" : "contents"}>{pageDetails}</div>}
        {unavailablePaper && <Alert className="my-4"><AlertTitle>Notebook unavailable</AlertTitle><AlertDescription>This version cannot read the notebook’s paper. Open it with the app version that saved it, or restore a version from history. Your saved content is unchanged.</AlertDescription></Alert>}
        <div className={cn("ll-page-body pt-3", (paper || unavailablePaper) && !documentNotes && "hidden")} ref={bodyRef}>
          <BlockEditor
            readOnly={unavailablePaper}
            assets={assets}
            content={page.content}
            onAsk={mobile ? undefined : openAsk}
            onTurnInto={report ? undefined : setTurnInto}
            onVoiceReview={report ? undefined : setVoiceReview}
            onVoiceSaved={report ? undefined : () => { void markCapture(page.id, "voice").catch(() => toastManager.add({ type: "error", title: "Recording saved", description: "It could not be added to the inbox. Your audio is still in this page." })); }}
            onVoiceDetached={report ? undefined : async (recordingId, asset) => {
              await flush();
              await saveVoice(page.id, recordingId, asset);
            }}
            askKeys={keysFor("ask")}
            onChange={(read) => {
              queue({ content: read });
              if (paper) setDocumentNotes(!!read().content?.some((node) => node.type !== "paragraph" || node.content?.length));
              touchLive(page.id);
            }}
            links={linkHost}
            notes={role === "thoughts" || role === "essay" ? undefined : notes}
            onNoteSteps={onNoteSteps}
            onCites={onCites}
            onExitTop={() => titleRef.current?.focus()}
            onFocusChange={setInBody}
            onLayoutChange={setMargins}
            onStats={counting ? (stats) => setPageStats(page.id, stats) : undefined}
            openLink={openHref}
            quoteTo={quoteTo}
            quotes={quotes}
            annotate={report}
            ref={editorRef}
            style={pageStyle(props)}
            writing={editorWriting(writing, typeId)}
          />
        </div>
        {paper && <PaperPage onDetails={() => { if (documentNotes) titleRef.current?.scrollIntoView({ block: "start" }); else setPaperDetails(true); }} mixed={documentNotes} id={page.id} title={title} paper={paper} request={paperRequest} onChange={async (value, immediate) => {
          setProp("paper", value); touchLive(page.id);
          if (immediate) await flush();
          else saveEmergency(page, { properties: latest.current }, currentEdit());
        }} />}
        {report && <ReportSources report={current} />}
        <Reports onNotes={setStreamNotes} pageId={page.id} />
        <Linked id={page.id} />
        {day && <ThisDay content={page.content} day={day} id={page.id} />}
        <Backlinks id={page.id} title={title} />
      </div>
      {paper && !documentNotes && <Sheet open={paperDetails} onOpenChange={setPaperDetails}>
        <SheetPopup side={phone ? "bottom" : "right"} className="w-full max-w-lg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" closeProps={{ style: { top: "calc(env(safe-area-inset-top) + 0.5rem)" } }} initialFocus={false}>
          <SheetHeader><SheetTitle>Notebook details</SheetTitle><SheetDescription>Title, properties and links for this notebook.</SheetDescription></SheetHeader>
          <SheetPanel>{cover && <CoverBand cover={cover} onChange={setCover} />}{pageDetails}<Linked id={page.id} /><Backlinks id={page.id} title={title} /></SheetPanel>
        </SheetPopup>
      </Sheet>}
      {voiceReview && <VoiceReviewDialog review={voiceReview} sourceId={page.id} onClose={() => setVoiceReview(null)} />}
      {turnInto && <TurnIntoPage selection={turnInto} onClose={() => setTurnInto(null)} />}
    </div>
  );
}
