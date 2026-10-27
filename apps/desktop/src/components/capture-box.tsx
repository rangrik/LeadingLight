import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import type { LinkHost } from "@leadinglight/editor/links";
import { CalendarDays, Check, Folder, Hash, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { PagePicker } from "~/components/property-value";
import { assets } from "~/lib/assets";
import { type Draft, TAG } from "~/lib/capture";
import { isKey, useKeysFor } from "~/lib/keymap";
import { pageLabel } from "~/lib/labels";
import { COLORS } from "~/lib/page-meta";
import { iconFor, pageOf } from "~/lib/space";
import { readCapture } from "~/lib/tail";

// Where the box sends what is typed: lib/capture.ts in the main window, called directly in a
// browser, or over Tauri's events from the panel (capture.tsx). links is what "@" offers there,
// and create makes the picker's projects there.
export type CaptureHost = {
  save: (draft: Draft) => Promise<string | null>;
  open: (id: string) => void;
  close: () => void;
  links: LinkHost;
  create?: (title: string, typeId: string) => Promise<string>;
};

const SAVE_DELAY_MS = 300;
// Tail's guess waits for a pause in typing, since each one is a model turn.
const GUESS_DELAY_MS = 600;
// COSS's popup surface (packages/editor/src/ui.tsx), at the box's 14 px radius.
const SURFACE =
  "relative rounded-[14px] border bg-popover not-dark:bg-clip-padding text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[13px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";
// Something open over the editor (a menu, a picker): it takes Escape first, and a click in it
// is not a click outside the box. These mount outside the box's DOM; one fading out is closed.
export const POPUP = ":is([role=listbox], [role=menu], [data-slot=popover-popup], [data-slot=menu-popup]):not([data-closed])";

// The capture box (features/capture.feature): a header bar over a title line and the block
// editor, saving as you type.
export function CaptureBox({ host, className }: { host: CaptureHost; className?: string }) {
  const [title, setTitle] = useState("");
  const [hasBody, setHasBody] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Tail's read of the words (docs/TAIL.md): a task, and the project it seems to be for.
  const [guess, setGuess] = useState<{ task: boolean; project: string | null }>({ task: false, project: null });
  const keysFor = useKeysFor();
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  // Saves run one after another: the first names the page the rest update. The body is read
  // only when a save runs.
  const id = useRef<string | null>(null);
  const draft = useRef<{ title: string; body: (() => EditorDoc) | null; project: string | null; task?: boolean }>({ title: "", body: null, project: null });
  const version = useRef(0);
  const savedVersion = useRef(0);
  const chain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The words last sent for a guess; an answer about older words is dropped.
  const asked = useRef({ text: "", timer: undefined as ReturnType<typeof setTimeout> | undefined, opened: Date.now() });

  useEffect(() => titleRef.current?.focus(), []);

  // "Saved" shows once the idea is saved and stays, rather than blinking on every key.
  const save = () => {
    clearTimeout(timer.current);
    const at = version.current;
    if (at !== savedVersion.current) {
      chain.current = chain.current
        .then(async () => {
          const got = await host.save({ ...draft.current, id: id.current, body: draft.current.body?.() ?? null });
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
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    const a = asked.current;
    clearTimeout(a.timer);
    a.timer = setTimeout(() => {
      const text = `${draft.current.title}\n${editorRef.current?.text() ?? ""}`;
      if (text === a.text) return;
      a.text = text;
      void readCapture(text, a.opened).then((g) => a.text === text && setGuess(g));
    }, GUESS_DELAY_MS);
  };
  const pick = (next: string | null) => {
    draft.current.project = next;
    setProject(next);
    touched();
  };
  // Closing never waits: a save under way finishes on its own.
  const close = () => {
    void save();
    host.close();
  };
  const open = () => void save().then((got) => got && host.open(got));
  // Before the editor sees the key: Escape closes the box unless a menu is open in it, ⌘↩ saves
  // and closes, ⇧⌘↩ opens the idea beside, Tab from the title goes into the body, and Shift+Tab
  // stops at the picker, the box's first stop, so the keyboard never leaves the box.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      if (document.querySelector(POPUP) || target.closest("[role=toolbar]")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (isKey(e.nativeEvent, "nod")) {
      // ⌃↩ is the box's own: a task in the project, when tail offers one.
      e.preventDefault();
      e.stopPropagation();
      if (!offer) return;
      draft.current = { ...draft.current, project: offer, task: true };
      version.current++;
      close();
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) open();
      else close();
    } else if (e.key === "Tab" && !e.shiftKey && target === titleRef.current) {
      e.preventDefault();
      editorRef.current?.focus("start");
    } else if (e.key === "Tab" && e.shiftKey && target.closest("header")) {
      e.preventDefault();
    }
  };
  // Blank space under the last line belongs to the body.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    // The box is a dialog itself, so only roles inside it count as controls.
    if ((e.target as HTMLElement).closest(".ProseMirror, button, a, input, [role]:not([role=dialog])")) return;
    if (editorRef.current?.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };
  const empty = !title.trim() && !hasBody;
  const picked = project ? pageOf(project) : undefined;
  // The person's pick wins over the guess.
  const guessed = !picked && guess.task && guess.project ? pageOf(guess.project) : undefined;
  const offer = guess.task ? (project ?? guess.project) : null;

  return (
    <div aria-label="New idea" className={cn(SURFACE, "flex flex-col", className)} onKeyDownCapture={onKeyDownCapture} role="dialog">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b px-5 text-[13px] text-muted-foreground leading-5">
        <Lightbulb className={cn("size-4", COLORS.yellow.text)} />
        <span>New idea</span>
        <span aria-hidden>·</span>
        <CalendarDays className={cn("size-4", COLORS.blue.text)} />
        <span>In Today</span>
        <span aria-hidden>·</span>
        <Hash className="size-4" />
        <span>{TAG}</span>
        {/* Takes only the room left, so a long project name gives way, not the words before it. */}
        <span className="flex min-w-0 flex-1 justify-end">
          <PagePicker
            create={host.create}
            exclude={project ? [project] : []}
            label="Project"
            onClear={project ? () => pick(null) : undefined}
            onPick={pick}
            popup={{ align: "end", finalFocus: titleRef }}
            trigger={
              <Button aria-label="Project" className={cn("-me-2 min-w-0 shrink gap-2 font-normal text-[13px] sm:text-[13px]", !picked && "text-muted-foreground")} size="xs" variant="ghost">
                {picked ? <RowIcon icon={iconFor(picked)} /> : <Folder className="size-4" />}
                <span className="truncate">{picked ? pageLabel(picked.title) : guessed ? `${pageLabel(guessed.title)}?` : "No project"}</span>
              </Button>
            }
            typeId="project"
          />
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-3.5">
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
        <footer className="mt-2 flex h-5 items-center gap-3 text-[13px] text-muted-foreground leading-5">
          {!empty && (
            <span aria-hidden={!saved} className={cn("flex items-center gap-1.5 transition-opacity duration-150", saved ? "opacity-100" : "opacity-0")}>
              <Check className="size-4" />
              Saved
            </span>
          )}
          <span className="ms-auto flex items-center gap-3">
            {!empty && (
              <>
                {offer && (
                  <span className="flex items-center gap-1.5">
                    <Kbd>{keysFor("nod")}</Kbd>
                    Task in {pageLabel(pageOf(offer)?.title ?? "")}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Kbd>⇧⌘↩</Kbd>
                  Open beside
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>⌘↩</Kbd>
                  Save
                </span>
              </>
            )}
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              Close
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}
