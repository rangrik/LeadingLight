import { BlockEditor, type BlockEditorHandle, type EditorDoc, type QuoteTarget } from "@leadinglight/editor/editor";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { assets } from "@/lib/assets";
import { pageStyle } from "@/lib/labels";
import { roleOf } from "@/lib/linked";
import type { LLObject, ObjectPatch } from "@/lib/objects";
import { trackFlush } from "@/lib/saving";
import { useThoughts } from "@/lib/thoughts";

// The body is read only when a save runs, not on every keystroke.
type Pending = { title?: string; content?: () => EditorDoc };

const SAVE_DELAY_MS = 500;

export type PageHandle = Pick<BlockEditorHandle, "insertQuote" | "reveal">;

export function PageView({
  page,
  onRename,
  onSave,
  onOpen,
  onNote,
  quoteTo,
  quotes,
  onCites,
  reveal,
  ref,
}: {
  page: LLObject;
  onRename: (id: string, title: string) => void;
  onSave: (id: string, patch: ObjectPatch) => Promise<void>;
  // Opens a link: in-app ones (ll:) in the app, the rest outside.
  onOpen: (href: string) => void;
  // A sidenote was added; `thoughts` is the page's Thoughts page when this note made it.
  onNote: (thoughts?: LLObject) => void;
  quoteTo?: QuoteTarget;
  // See BlockEditor: which of this page's quotes its essay still holds, and the quotes it holds.
  quotes?: string[] | null;
  onCites?: (ids: string[]) => void;
  // An anchor to scroll to once the page is shown.
  reveal?: string;
  ref?: Ref<PageHandle>;
}) {
  const [title, setTitle] = useState(page.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  // A Thoughts page or an essay takes no sidenotes of its own.
  const child = Boolean(roleOf(page));
  const notes = useThoughts(page, onNote);

  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    const { title, content } = pending.current;
    pending.current = {};
    if (title === undefined && !content) return;
    const patch: ObjectPatch = {};
    if (title !== undefined) patch.title = title;
    if (content) patch.content = content();
    await onSave(page.id, patch);
  };

  const queue = (patch: Pending) => {
    Object.assign(pending.current, patch);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

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

  useImperativeHandle(ref, () => ({
    insertQuote: (quote) => editorRef.current?.insertQuote(quote),
    reveal: (id) => editorRef.current?.reveal(id),
  }));

  // Notes load after the text, so wait for them before scrolling to an anchor.
  useEffect(() => {
    if (!reveal || (!notes && !child)) return;
    const frame = requestAnimationFrame(() => editorRef.current?.reveal(reveal));
    return () => cancelAnimationFrame(frame);
  }, [reveal, notes, child]);

  // The title wraps like a heading instead of clipping, also when its pane changes width.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    let width = -1;
    const fit = () => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title]);

  // Blank page space belongs to the page: with no block active (and no popup open), a click at
  // the title's height goes to the title, below it into the body (see placeAt). The title,
  // blocks and controls handle their own clicks.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    const editor = editorRef.current;
    const title = titleRef.current;
    if (!editor || !title || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || editor.hasFocus()) return;
    if (document.activeElement?.closest("[role=dialog], [role=menu], [role=listbox]")) return;
    if ((e.target as HTMLElement).closest(".ProseMirror, .ll-handle, .ll-note, .ll-toc, textarea, input, button, a, [role]")) return;
    if (e.clientY <= title.getBoundingClientRect().bottom) {
      e.preventDefault();
      title.focus();
      title.setSelectionRange(title.value.length, title.value.length);
    } else if (editor.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };

  // With sidenotes the column widens on the right for the margin (a 32px gutter, then 224px of
  // notes), keeping the text 632px wide, and the whole stays centred. When the space left of the
  // centred column can't hold the contents rail (editor.css), the column moves right for it.
  return (
    <div className="@container min-h-full" onMouseDown={onBlankMouseDown}>
      <div className="mx-auto w-full max-w-[760px] px-16 pt-10 pb-8 transition-[max-width,padding] duration-200 ease-out has-[[data-notes]]:max-w-[968px] has-[[data-notes]]:pr-4 has-[[data-notes]]:*:mr-[256px] @max-[880px]:has-[.ll-toc]:pl-[124px] @max-[1088px]:has-[[data-notes]_.ll-toc]:pl-[124px]">
        <textarea
          aria-label="Title"
          className="block w-full resize-none overflow-hidden bg-transparent font-bold font-heading text-[36px] leading-[1.2] tracking-tight outline-none placeholder:text-muted-foreground/60"
          onFocus={() => editorRef.current?.clearBlocks()}
          onChange={(e) => {
            const value = e.currentTarget.value.replace(/\n/g, "");
            setTitle(value);
            onRename(page.id, value);
            queue({ title: value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              editorRef.current?.focus("start");
            }
          }}
          placeholder={roleOf(page) === "essay" ? "Essay title" : "Untitled"}
          ref={titleRef}
          rows={1}
          value={title}
        />
        <div className="mt-3">
          <BlockEditor
            assets={assets}
            content={page.content}
            notes={child ? undefined : notes}
            onChange={(read) => queue({ content: read })}
            onExitTop={() => titleRef.current?.focus()}
            openLink={onOpen}
            onCites={onCites}
            quoteTo={quoteTo}
            quotes={quotes}
            ref={editorRef}
            style={pageStyle(page)}
          />
        </div>
      </div>
    </div>
  );
}
