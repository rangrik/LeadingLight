import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import { AlignLeft, ImageIcon, Smile } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { CoverBand, CoverPicker } from "@/components/page-cover";
import { IconPicker, PageIconView } from "@/components/page-icon";
import { assets } from "@/lib/assets";
import { openLink } from "@/lib/links";
import type { LLObject, ObjectPatch, ObjectSummary } from "@/lib/objects";
import { type PageCover, type PageIcon, readCover, readIcon } from "@/lib/page-meta";
import { trackFlush } from "@/lib/saving";

// The body is read only when a save runs, not on every keystroke.
type Pending = { title?: string; content?: () => EditorDoc; properties?: Record<string, unknown> };

const SAVE_DELAY_MS = 500;

// Narrow panes show the header controls as icons only.
const Label = ({ children }: { children: string }) => <span className="hidden @md:inline">{children}</span>;

// A textarea that grows with its text instead of scrolling.
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
};

export function PageView({
  page,
  onSummary,
  onSave,
}: {
  page: LLObject;
  onSummary: (id: string, patch: Partial<ObjectSummary>) => void;
  onSave: (id: string, patch: ObjectPatch) => Promise<void>;
}) {
  const [title, setTitle] = useState(page.title);
  const [props, setProps] = useState(page.properties);
  const latest = useRef(page.properties);
  const [adding, setAdding] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);

  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    const { title, content, properties } = pending.current;
    pending.current = {};
    if (title === undefined && !content && !properties) return;
    const patch: ObjectPatch = {};
    if (title !== undefined) patch.title = title;
    if (content) patch.content = content();
    if (properties) patch.properties = properties;
    await onSave(page.id, patch);
  };

  const queue = (patch: Pending) => {
    Object.assign(pending.current, patch);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  // Every other stored property, including ones this version doesn't know, is kept as it was.
  const setProp = (key: string, value: unknown) => {
    const next = { ...latest.current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    latest.current = next;
    setProps(next);
    queue({ properties: next });
  };
  const setIcon = (icon?: PageIcon) => {
    setProp("icon", icon);
    onSummary(page.id, { icon });
  };
  const setCover = (cover?: PageCover) => setProp("cover", cover);

  const icon = readIcon(props.icon);
  const cover = readCover(props.cover);
  const description = typeof props.description === "string" ? props.description : undefined;

  // A brand new page starts in the title. Pending edits are saved when leaving the page, and
  // whenever the app is about to go away (see App).
  useEffect(() => {
    if (!page.title && !page.content) titleRef.current?.focus();
    const untrack = trackFlush(flush);
    return () => {
      untrack();
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => fit(titleRef.current), [title]);
  useLayoutEffect(() => fit(descriptionRef.current), [description]);

  const toBody = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== "ArrowDown") return;
    e.preventDefault();
    editorRef.current?.focus("start");
  };

  return (
    <>
      {cover && <CoverBand cover={cover} onChange={setCover} />}
      {/* The left padding is the block handle's gutter; the right one gives way in narrow panes. */}
      <div className="mx-auto w-full max-w-[760px] ps-16 pe-6 pb-48 @xl:pe-16">
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
              onChange={(e) => {
                const value = e.currentTarget.value.replace(/\n/g, "");
                setTitle(value);
                onSummary(page.id, { title: value });
                queue({ title: value });
              }}
              onKeyDown={toBody}
              placeholder="Untitled"
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
        <div className="mt-3">
          <BlockEditor
            assets={assets}
            content={page.content}
            onChange={(read) => queue({ content: read })}
            onExitTop={() => titleRef.current?.focus()}
            openLink={openLink}
            ref={editorRef}
          />
        </div>
      </div>
    </>
  );
}
