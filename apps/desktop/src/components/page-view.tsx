import { BlockEditor, type BlockEditorHandle, type EditorDoc, type QuoteTarget } from "@leadinglight/editor/editor";
import { AlignLeft, Hash, ImageIcon, LayoutTemplate, Smile } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { Backlinks } from "~/components/backlinks";
import { CreatedThisDay, DailyBar } from "~/components/daily-bar";
import { linkHost } from "~/components/link-views";
import { CoverBand, CoverPicker } from "~/components/page-cover";
import { IconPicker, PageIconView } from "~/components/page-icon";
import { PropertyPanel } from "~/components/property-panel";
import { PagePicker } from "~/components/property-value";
import { TagPanel } from "~/components/tag-panel";
import { setPageStats } from "~/components/page-stats";
import { openAsk, registerPage, unregisterPage } from "~/lib/ask";
import { assets } from "~/lib/assets";
import { makeRoom, openHref, quoteInto, reportQuotes, useQuotes } from "~/lib/essay";
import { pageStyle } from "~/lib/labels";
import { childOf, parentOf, roleOf } from "~/lib/linked";
import { registerLive, touchLive } from "~/lib/live";
import type { LLObject, ObjectPatch } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { type PageCover, type PageIcon, readCover, readIcon } from "~/lib/page-meta";
import { trackFlush } from "~/lib/saving";
import { pageOf, patchSummary, savePage, typeOf } from "~/lib/space";
import { useThoughts } from "~/lib/thoughts";
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
  const setIcon = (icon?: PageIcon) => setProp("icon", icon);
  const setCover = (cover?: PageCover) => setProp("cover", cover);

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
      insertQuote: (quote) => editorRef.current?.insertQuote(quote),
      reveal: (anchor) => editorRef.current?.reveal(anchor),
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
    return () => unregisterPage(page.id);
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
            <div className="absolute bottom-full -ms-2 mb-1 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/head:opacity-100 has-data-popup-open:opacity-100">
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
                <Button
                  aria-label="Add description"
                  className="text-muted-foreground"
                  onClick={() => {
                    setAdding(true);
                    setProp("description", "");
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <AlignLeft />
                  <Label>Add description</Label>
                </Button>
              )}
            </div>
            <textarea
              aria-label="Title"
              className="block w-full resize-none overflow-hidden bg-transparent font-bold font-heading text-[36px] leading-[1.2] tracking-tight outline-none placeholder:text-muted-foreground/60"
              onFocus={() => editorRef.current?.clearBlocks()}
              onChange={(e) => {
                const value = e.currentTarget.value.replace(/\n/g, "");
                setTitle(value);
                patchSummary(page.id, { title: value });
                queue({ title: value });
              }}
              onKeyDown={toBody}
              placeholder={role === "essay" ? "Essay title" : "Untitled"}
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
        {templateOf && (
          <p className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
            <LayoutTemplate className="size-4" />
            Template for {typeOf(templateOf).plural}: new ones start as a copy of this page.
          </p>
        )}
        <PropertyPanel page={{ ...page, ...pageOf(page.id), title, typeId, properties: props }} setProp={setProp} setType={setType} typeId={typeId} values={props} />
        {day && <DailyBar day={day} />}
        {typeId === "tag" && <TagPanel id={page.id} />}
        <div className="ll-page-body pt-3" ref={bodyRef}>
          <BlockEditor
            assets={assets}
            content={page.content}
            onAsk={openAsk}
            onChange={(read) => {
              queue({ content: read });
              touchLive(page.id);
            }}
            links={linkHost}
            notes={role ? undefined : notes}
            onCites={onCites}
            onExitTop={() => titleRef.current?.focus()}
            onFocusChange={setInBody}
            onStats={counting ? (stats) => setPageStats(page.id, stats) : undefined}
            openLink={openHref}
            quoteTo={quoteTo}
            quotes={quotes}
            ref={editorRef}
            style={pageStyle(props)}
            writing={editorWriting(writing, typeId)}
          />
        </div>
        {day && <CreatedThisDay day={day} id={page.id} />}
        <Backlinks id={page.id} title={title} />
      </div>
    </div>
  );
}
