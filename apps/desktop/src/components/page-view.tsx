import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { assets } from "@/lib/assets";
import { openLink } from "@/lib/links";
import type { LLObject, ObjectPatch } from "@/lib/objects";
import { trackFlush } from "@/lib/saving";

// The body is read only when a save runs, not on every keystroke.
type Pending = { title?: string; content?: () => EditorDoc };

const SAVE_DELAY_MS = 500;

export function PageView({
  page,
  onRename,
  onSave,
}: {
  page: LLObject;
  onRename: (id: string, title: string) => void;
  onSave: (id: string, patch: ObjectPatch) => Promise<void>;
}) {
  const [title, setTitle] = useState(page.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);

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

  // The title wraps like a heading instead of clipping.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Blank page space belongs to the page: with no block active (and no popup open), a click at
  // the title's height goes to the title, below it into the body (see placeAt). The title,
  // blocks and controls handle their own clicks.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    const editor = editorRef.current;
    const title = titleRef.current;
    if (!editor || !title || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || editor.hasFocus()) return;
    if (document.activeElement?.closest("[role=dialog], [role=menu], [role=listbox]")) return;
    if ((e.target as HTMLElement).closest(".ProseMirror, .ll-handle, textarea, input, button, a, [role]")) return;
    if (e.clientY <= title.getBoundingClientRect().bottom) {
      e.preventDefault();
      title.focus();
      title.setSelectionRange(title.value.length, title.value.length);
    } else if (editor.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };

  return (
    <div className="min-h-full" onMouseDown={onBlankMouseDown}>
      <div className="mx-auto w-full max-w-[760px] px-16 pt-10 pb-8">
        <textarea
          aria-label="Title"
          className="block w-full resize-none overflow-hidden bg-transparent font-bold font-heading text-[36px] leading-[1.2] tracking-tight outline-none placeholder:text-muted-foreground/60"
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
          placeholder="Untitled"
          ref={titleRef}
          rows={1}
          value={title}
        />
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
    </div>
  );
}
