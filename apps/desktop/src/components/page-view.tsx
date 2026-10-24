import { BlockEditor, type BlockEditorHandle, type EditorDoc, type NotesStore, type QuoteTarget } from "@leadinglight/editor/editor";
import { splitTitle } from "@leadinglight/editor/markdown";
import { AlignLeft, Hash, ImageIcon, LayoutTemplate, Smile } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { Backlinks, Linked } from "~/components/backlinks";
import { CreatedThisDay, DailyBar } from "~/components/daily-bar";
import { linkHost } from "~/components/link-views";
import { CoverBand, CoverPicker } from "~/components/page-cover";
import { IconPicker, PageIconView } from "~/components/page-icon";
import { FolderRow, LinkFolderButton } from "~/components/project-folder";
import { PropertyPanel } from "~/components/property-panel";
import { ReportByline, Reports, ReportSources } from "~/components/reports";
import { WorkPanel } from "~/components/work-panel";
import { PagePicker } from "~/components/property-value";
import { TagPanel } from "~/components/tag-panel";
import { setPageStats } from "~/components/page-stats";
import { openAsk, registerPage, unregisterPage } from "~/lib/ask";
import { assets } from "~/lib/assets";
import { makeRoom, openHref, quoteInto, reportQuotes, useQuotes } from "~/lib/essay";
import { useKeysFor } from "~/lib/keymap";
import { pageLabel, pageStyle } from "~/lib/labels";
import { childOf, parentOf, roleOf } from "~/lib/linked";
import { registerLive, touchLive } from "~/lib/live";
import type { LLObject, ObjectPatch } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { focusedPage, panes } from "~/lib/panes";
import { type PageCover, type PageIcon, readCover, readIcon } from "~/lib/page-meta";
import { trackFlush } from "~/lib/saving";
import { pageOf, patchSummary, savePage, space, typeOf } from "~/lib/space";
import { draftOf, drafts, pick, recipientFor, sentNotes } from "~/lib/feedback";
import { useThoughts } from "~/lib/thoughts";
import { reportOf } from "~/lib/work";
import { editorWriting, toolsOn, useWritingPrefs } from "~/lib/writing";

// The body is read only when a save runs, not on every keystroke.
type Pending = { title?: string; content?: () => EditorDoc; properties?: Record<string, unknown>; typeId?: string };

const SAVE_DELAY_MS = 500;

// Narrow panes show the header controls as icons only.
const Label = ({ children }: { children: string }) => <span className="hidden @md:inline">{children}</span>;

// A textarea that grows with its text instead of scrolling.
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
};

export function PageView({ page }: { page: LLObject }) {
  const [title, setTitle] = useState(page.title);
  const [typeId, setTypeId] = useState(page.typeId);
  const keysFor = useKeysFor();
  const [props, setProps] = useState(page.properties);
  const latest = useRef(page.properties);
  const [adding, setAdding] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const writing = useWritingPrefs();
  const [inBody, setInBody] = useState(false);
  // The writing tools follow the page's type (Settings › Writing › Use on).
  const tools = toolsOn(writing, typeId);
  const counting = tools && writing.count;
  useEffect(() => {
    if (!counting) setPageStats(page.id, null);
  }, [counting, page.id]);

  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    const { content, ...rest } = pending.current;
    pending.current = {};
    if (!content && Object.keys(rest).length === 0) return;
    const patch: ObjectPatch = { ...rest };
    if (content) patch.content = content();
    await savePage(page.id, patch);
  };

  const queue = (patch: Pending) => {
    Object.assign(pending.current, patch);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
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
    setTypeId(next);
    patchSummary(page.id, { typeId: next });
    queue({ typeId: next });
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
  const notes = useThoughts(current, (thoughts) => {
    if (thoughts) setProp("thoughts", thoughts.id);
    makeRoom();
  });
  const essay = childOf(current, "essay");
  // An agent's report reads as it was published (features/reports.feature), taking only sidenotes.
  const report = !!reportOf(current);
  // Notes on a task's pages can go to its agent as feedback (features/feedback.feature): only when
  // this page's task or sent notes change does the page draw again.
  const pickKey = useSyncExternalStore(space.subscribe, () => {
    const to = recipientFor(page.id);
    return to ? `${to.task} ${to.agent} ${[...sentNotes()].join(",")}` : "";
  });
  const chosen = drafts.use();
  const shared = useMemo<NotesStore | undefined>(() => {
    if (!notes || !pickKey) return notes;
    const [task, agent, sentList] = pickKey.split(" ");
    const sent = new Set(sentList ? sentList.split(",") : []);
    const to = pageLabel(pageOf(agent)?.title ?? "").split(": ")[0];
    return { ...notes, pick: { to, on: (id) => draftOf(task).picks.some((x) => x.note === id), set: (id, on) => pick(task, page.id, id, on), sent: (id) => sent.has(id) } };
  }, [notes, pickKey, chosen]);
  const quotes = useQuotes(page.id, essay);
  const quoteTo: QuoteTarget | undefined = essay ? { essay, add: (text, id) => void quoteInto(page.id, { text, id }) } : undefined;
  const onCites = role === "essay" && parent ? (ids: string[]) => reportQuotes(parent, ids) : undefined;

  // A brand new page starts in the title. Pending edits are saved when leaving the page, and
  // whenever the app is about to go away (see App).
  useEffect(() => {
    if (!page.title && !page.content) titleRef.current?.focus();
    const untrack = trackFlush(flush);
    const unlive = registerLive(page.id, {
      editor: () => editorRef.current,
      content: () => editorRef.current?.getJSON() ?? page.content ?? { type: "doc", content: [] },
      setContent: (doc) => editorRef.current?.setContent(doc),
      properties: () => latest.current,
      setProperties: replaceProps,
      setTitle: rename,
      insertQuote: (quote) => editorRef.current?.insertQuote(quote),
      reveal: (anchor) => editorRef.current?.reveal(anchor),
      focus: () => editorRef.current?.focus("end"),
    });
    return () => {
      untrack();
      unlive();
      setPageStats(page.id, null);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The agent panel asks about this page while it is in front (lib/ask.ts); with panes side
  // by side, that is the page last worked in.
  const askPage = { id: page.id, title: () => titleRef.current?.value ?? "", text: () => docMarkdown(editorRef.current?.getJSON(), (id) => pageOf(id)?.title ?? "") };
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
  // They wrap again when the pane changes width.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fit(el);
      fit(descriptionRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toBody = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== "ArrowDown") return;
    e.preventDefault();
    editorRef.current?.focus("start");
  };

  // A whole page pasted into the title: a heading on its first line names the page, and the
  // rest (all of it, with no heading) goes into the body.
  const pasteTitle = (e: React.ClipboardEvent) => {
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
    if (!editor || !title || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || editor.hasFocus()) return;
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

  return (
    // Focus mode fades the rest of the page too while the body is written in (styles.css).
    <div
      className={cn("ll-page-root min-h-full", tools && writing.focus && writing.focusOn !== "typewriter" && inBody && "ll-page-dim")}
      onFocusCapture={() => registerPage(askPage, editorRef.current)}
      onMouseDown={onBlankMouseDown}
    >
      {cover && <CoverBand cover={cover} onChange={setCover} />}
      {/* The left padding is the block handle's gutter; the right one gives way in narrow panes.
          Sidenotes and "On this page" make room for themselves (ll-page, styles.css). */}
      <div className="ll-page pb-8">
        <div className={cn("group/head", !(cover && icon) && "pt-10")}>
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
            {/* Shown on hover, sitting in the space above the title so nothing moves. */}
            <div
              className="absolute bottom-full -ms-2 mb-1 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/head:opacity-100 has-data-popup-open:opacity-100 data-[report]:hidden"
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
              <LinkFolderButton label={<span className="hidden @3xl:inline">Link folder</span>} pageId={page.id} />
            </div>
            <textarea
              aria-label="Title"
              className="block w-full resize-none overflow-hidden bg-transparent font-bold font-heading text-[36px] leading-[1.2] tracking-tight outline-none placeholder:text-muted-foreground/60"
              onFocus={() => editorRef.current?.clearBlocks()}
              onChange={(e) => rename(e.currentTarget.value.replace(/\n/g, ""))}
              onKeyDown={toBody}
              onPaste={pasteTitle}
              placeholder={role === "essay" ? "Essay title" : "Untitled"}
              readOnly={report}
              ref={titleRef}
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
              ref={descriptionRef}
              rows={1}
              value={description}
            />
          )}
        </div>
        {report ? <div className="mt-2"><ReportByline about report={current} /></div> : <FolderRow pageId={page.id} />}
        <WorkPanel pageId={page.id} />
        {templateOf && (
          <p className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
            <LayoutTemplate className="size-4" />
            Template for {typeOf(templateOf).plural}: new ones start as a copy of this page.
          </p>
        )}
        {!report && <PropertyPanel
          onDescription={description === undefined ? addDescription : undefined}
          page={{ ...page, ...pageOf(page.id), title, typeId, properties: props }}
          setProp={setProp}
          setType={setType}
          typeId={typeId}
          values={props}
        />}
        {day && <DailyBar day={day} />}
        {typeId === "tag" && <TagPanel id={page.id} />}
        <div className="ll-page-body pt-3" ref={bodyRef}>
          <BlockEditor
            assets={assets}
            content={page.content}
            onAsk={openAsk}
            askKeys={keysFor("ask")}
            onChange={(read) => {
              queue({ content: read });
              touchLive(page.id);
            }}
            links={linkHost}
            notes={role === "thoughts" || role === "essay" ? undefined : shared}
            onCites={onCites}
            onExitTop={() => titleRef.current?.focus()}
            onFocusChange={setInBody}
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
        {report && <ReportSources report={current} />}
        <Reports pageId={page.id} />
        <Linked id={page.id} />
        {day && <CreatedThisDay content={page.content} day={day} id={page.id} />}
        <Backlinks id={page.id} title={title} />
      </div>
    </div>
  );
}
