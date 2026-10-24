import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import type { LinkHost } from "@leadinglight/editor/links";
import { CalendarDays, Check, Hash, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { cn } from "@leadinglight/ui/lib/utils";
import { assets } from "~/lib/assets";
import { type Draft, TAG } from "~/lib/capture";
import { COLORS } from "~/lib/page-meta";

// Where the box sends what is typed: lib/capture.ts in the main window, called directly in a
// browser, or over Tauri's events from the panel (capture.tsx). links is what "@" offers there.
export type CaptureHost = {
  save: (draft: Draft) => Promise<string | null>;
  open: (id: string) => void;
  close: () => void;
  links: LinkHost;
};

const SAVE_DELAY_MS = 300;
// COSS's popup surface (packages/editor/src/ui.tsx), at the box's 14 px radius.
const SURFACE =
  "relative rounded-[14px] border bg-popover not-dark:bg-clip-padding text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[13px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";
// Something open over the editor (a menu, a picker): it takes Escape first, and a click in it
// is not a click outside the box. These mount outside the box's DOM.
export const POPUP = "[role=listbox], [role=menu], [data-slot=popover-popup], [data-slot=menu-popup]";

// The capture box (features/capture.feature): a title line over the block editor, saving as you type.
export function CaptureBox({ host, className }: { host: CaptureHost; className?: string }) {
  const [title, setTitle] = useState("");
  const [hasBody, setHasBody] = useState(false);
  const [saved, setSaved] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  // Saves run one after another: the first names the page the rest update. The body is read
  // only when a save runs.
  const id = useRef<string | null>(null);
  const draft = useRef<{ title: string; body: (() => EditorDoc) | null }>({ title: "", body: null });
  const version = useRef(0);
  const savedVersion = useRef(0);
  const chain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => titleRef.current?.focus(), []);

  // "Saved" shows once the idea is saved and stays, rather than blinking on every key.
  const save = () => {
    clearTimeout(timer.current);
    const at = version.current;
    if (at !== savedVersion.current) {
      chain.current = chain.current
        .then(async () => {
          const got = await host.save({ id: id.current, title: draft.current.title, body: draft.current.body?.() ?? null });
          if (got) id.current = got;
          savedVersion.current = at;
          setSaved(Boolean(got));
        })
        .catch((err) => {
          console.error(err);
          setSaved(false);
        });
    }
    return chain.current.then(() => id.current);
  };
  const touched = () => {
    version.current++;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  };
  // Closing never waits: a save under way finishes on its own.
  const close = () => {
    void save();
    host.close();
  };
  const open = () => void save().then((got) => got && host.open(got));
  // Before the editor sees the key: Escape closes the box unless a menu is open in it, ⌘↩
  // opens the idea, and Tab from the title goes into the body (Tab never leaves the editor).
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      if (document.querySelector(POPUP) || target.closest("[role=toolbar]")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      open();
    } else if (e.key === "Tab" && target === titleRef.current) {
      e.preventDefault();
      editorRef.current?.focus("start");
    }
  };
  // Blank space under the last line belongs to the body.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ProseMirror, button, a, input, [role]")) return;
    if (editorRef.current?.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };
  const empty = !title.trim() && !hasBody;

  return (
    <div aria-label="New idea" className={cn(SURFACE, "flex flex-col px-5 pt-4 pb-3.5", className)} onKeyDownCapture={onKeyDownCapture} role="dialog">
      <input
        aria-label="Idea"
        autoComplete="off"
        className="h-7 w-full bg-transparent font-semibold text-[18px] leading-7 outline-none placeholder:text-muted-foreground/60"
        onChange={(e) => {
          draft.current.title = e.currentTarget.value;
          setTitle(e.currentTarget.value);
          touched();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.metaKey) return;
          e.preventDefault();
          editorRef.current?.focus("start");
        }}
        placeholder="Type your idea"
        ref={titleRef}
        value={title}
      />
      <div className="ll-capture mt-1 min-h-0 flex-1 overflow-y-auto" onMouseDown={onBlankMouseDown}>
        <BlockEditor
          assets={assets}
          content={null}
          label="Notes"
          links={host.links}
          onChange={(read) => {
            draft.current.body = read;
            setHasBody(Boolean(editorRef.current?.text().trim()));
            touched();
          }}
          onExitTop={() => titleRef.current?.focus()}
          placeholder="It saves as you go and shows up in Today."
          ref={editorRef}
        />
      </div>
      <footer className="mt-2 flex h-5 items-center gap-1.5 text-[13px] text-muted-foreground leading-5">
        <Lightbulb className={cn("size-4", COLORS.yellow.text)} />
        <span>New idea</span>
        <span aria-hidden>·</span>
        <CalendarDays className={cn("size-4", COLORS.blue.text)} />
        <span>Linked in Today</span>
        <span aria-hidden>·</span>
        <Hash className="size-4" />
        <span>{TAG}</span>
        <span className="ms-auto flex items-center gap-3">
          {!empty && (
            <span aria-hidden={!saved} className={cn("flex items-center gap-1 transition-opacity duration-150", saved ? "opacity-100" : "opacity-0")}>
              <Check className="size-4" />
              Saved
            </span>
          )}
          {!empty && (
            <span className="flex items-center gap-1.5">
              <Kbd>⌘↩</Kbd>
              Open
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            Close
          </span>
        </span>
      </footer>
    </div>
  );
}
