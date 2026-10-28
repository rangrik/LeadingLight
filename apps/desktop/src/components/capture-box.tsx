import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import type { LinkHost } from "@leadinglight/editor/links";
import { CalendarDays, Check, Folder, Globe, Hash, Lightbulb, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { PagePicker } from "~/components/property-value";
import { assets } from "~/lib/assets";
import { type Draft, type Guess, TAG, type WebSaved } from "~/lib/capture";
import { readText } from "~/lib/capture-text";
import { isKey, useKeysFor } from "~/lib/keymap";
import { pageLabel } from "~/lib/labels";
import { COLORS } from "~/lib/page-meta";
import { iconFor, pageOf } from "~/lib/space";
import { captureTurns } from "~/lib/tail-prompt";
import type { SourceMode } from "~/lib/web-source";

// Where the box sends what is typed: lib/capture.ts in the main window, called directly in a
// browser, or over Tauri's events from the panel (capture.tsx). links is what "@" offers there,
// create makes the picker's projects there, and guess asks tail (lib/tail.ts) there.
export type CaptureHost = {
  save: (draft: Draft) => Promise<string | null>;
  saveWeb: (url: string, mode: SourceMode, project: string | null, signal: AbortSignal) => Promise<WebSaved>;
  open: (id: string) => void;
  close: () => void;
  links: LinkHost;
  create?: (title: string, typeId: string) => Promise<string>;
  guess: (text: string, opened: number) => Promise<Guess>;
  // ⌃↩'s nod at the guess. The panel has none: its nod is counted where it is saved.
  took?: (project: string) => void;
};

const SAVE_DELAY_MS = 300;
// Tail's guess waits for a pause in typing, since each one is a model turn.
const GUESS_DELAY_MS = 1000;
// COSS's popup surface (packages/editor/src/ui.tsx), at the box's 14 px radius.
const SURFACE =
  "relative rounded-[14px] border bg-popover not-dark:bg-clip-padding text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[13px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";
// Something open over the editor (a menu, a picker): it takes Escape first, and a click in it
// is not a click outside the box. These mount outside the box's DOM; one fading out is closed.
export const POPUP = ":is([role=listbox], [role=menu], [data-slot=popover-popup], [data-slot=menu-popup]):not([data-closed])";
// What Save webpage offered (web-sources.feature).
const MODES: [SourceMode, string][] = [["link", "Link only"], ["text", "Text only"], ["media", "Text and media"]];

// The capture box (features/capture.feature, quick-capture.feature): a header bar over a title
// line and the block editor, saving as you type; a lone address saves a webpage instead.
export function CaptureBox({ host, className }: { host: CaptureHost; className?: string }) {
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  // A voice block in the body, and its audio saved.
  const [hasVoice, setHasVoice] = useState(false);
  const [voice, setVoice] = useState(false);
  const [mode, setMode] = useState<SourceMode>("media");
  // The webpage's save: under way, failed, or done with media it couldn't keep.
  const [web, setWeb] = useState<{ busy?: boolean; error?: string; beside?: boolean; done?: string; missing?: number }>({});
  const request = useRef<AbortController | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Tail's read of the words (docs/TAIL.md): a task, and the project it seems to be for.
  const [guess, setGuess] = useState<Guess>({ task: false, project: null });
  const keysFor = useKeysFor();
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);
  // Saves run one after another: the first names the page the rest update. The body is read
  // only when a save runs.
  const id = useRef<string | null>(null);
  const draft = useRef<{ title: string; body: (() => EditorDoc) | null; project: string | null; task?: boolean; took?: boolean; voice?: boolean }>({ title: "", body: null, project: null });
  const version = useRef(0);
  const savedVersion = useRef(0);
  const chain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Tail's turns for this opening of the box; an answer shows while it is open and no project is picked.
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  const [paused] = useState(() => {
    const opened = Date.now();
    return captureTurns({
      words: () => `${draft.current.title}\n${editorRef.current?.text() ?? ""}`,
      ask: (text) => host.guess(text, opened),
      show: (g) => alive.current && !draft.current.project && setGuess(g),
    });
  });
  // However the box goes (Escape, ⌘↩, a click outside, the panel hiding), what it holds is kept.
  const gone = useRef(() => {});
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(pause.current);
      gone.current();
    };
  }, []);

  useEffect(() => titleRef.current?.focus(), []);

  // What the box holds now; a lone address is a webpage, never an idea page.
  const now = () => readText(`${draft.current.title}\n${editorRef.current?.text() ?? ""}`);
  const isWeb = () => now().kind === "address" && !draft.current.voice;
  const address = () => (isWeb() ? now().url : null);
  // The webpage is saved, or on its way: closing doesn't save it again.
  const kept = useRef(false);
  // "Saved" shows once the idea is saved and stays, rather than blinking on every key.
  const save = () => {
    clearTimeout(timer.current);
    const at = version.current;
    if (at !== savedVersion.current && !address()) {
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
    // An address being typed waits: it may yet be a webpage.
    if (now().kind === "words" || draft.current.voice) timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    clearTimeout(pause.current);
    pause.current = setTimeout(() => !draft.current.project && paused(), GUESS_DELAY_MS);
    if (!request.current) setWeb({});
  };
  const pick = (next: string | null) => {
    draft.current.project = next;
    setProject(next);
    touched();
  };
  // Closing keeps what was never saved: a whole address as a webpage (the copy chosen, else its
  // link), anything else as an idea, its words as they are.
  const keep = () => {
    const url = address();
    if (!url) return void save();
    if (request.current || kept.current) return;
    kept.current = true;
    const { project } = draft.current;
    const signal = new AbortController().signal;
    void host
      .saveWeb(url, mode, project, signal)
      .then((got) => {
        if (got.error || !got.id) throw new Error(got.error);
      })
      .catch(() => (mode !== "link" ? host.saveWeb(url, "link", project, signal) : undefined))
      .catch(console.error);
  };
  gone.current = keep;
  // Closing never waits: a save under way finishes on its own. Escape during ⌘↩'s webpage save
  // cancels it, and nothing more is saved of the address (web-sources.feature).
  const close = () => {
    if (request.current) {
      request.current.abort();
      kept.current = true;
    }
    keep();
    host.close();
  };
  const open = () => void save().then((got) => got && host.open(got));
  // ⌘↩ on an address: saved as Save webpage saved it, then closed, or opened beside with ⇧.
  // Media it couldn't keep holds the box open to say so.
  const saveWeb = async (beside: boolean, choice = mode) => {
    if (request.current) return;
    if (web.done) return beside ? host.open(web.done) : host.close();
    const stop = new AbortController();
    request.current = stop;
    setWeb({ busy: true });
    try {
      // An unsafe address goes as typed, so the refusal can say why.
      const { url, words } = now();
      const got = await host.saveWeb(url ?? words, choice, draft.current.project, stop.signal);
      if (got.error || !got.id) throw new Error(got.error ?? "The webpage could not be saved.");
      kept.current = true;
      if (stop.signal.aborted) return;
      if (beside) host.open(got.id);
      else if (got.missing) setWeb({ done: got.id, missing: got.missing });
      else host.close();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (!stop.signal.aborted) setWeb({ beside, error: error === "Failed to fetch" ? "The browser could not fetch this website. Try in the Mac app, or save the link instead." : error });
    } finally {
      request.current = null;
    }
  };
  // Before the editor sees the key: Escape closes the box unless a menu is open in it, ⌘↩ saves
  // and closes, ⇧⌘↩ opens the idea beside, Tab from the title goes into the body, and Shift+Tab
  // stops at the header's first control, so the keyboard never leaves the box.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      if (document.querySelector(POPUP) || target.closest("[role=toolbar]")) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (isKey(e.nativeEvent, "nod")) {
      // ⌃↩ is the box's own: tail's guess taken, a task or an idea in the project.
      e.preventDefault();
      e.stopPropagation();
      if (!offer) return;
      host.took?.(offer);
      draft.current = { ...draft.current, project: offer, task: guess.task, took: true };
      version.current++;
      close();
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (isWeb()) void saveWeb(e.shiftKey);
      else if (e.shiftKey) open();
      else close();
    } else if (e.key === "Tab" && !e.shiftKey && target === titleRef.current) {
      e.preventDefault();
      editorRef.current?.focus("start");
    } else if (e.key === "Tab" && e.shiftKey && target.closest("header") && (!isWeb() || target.closest("[data-slot=segmented-control]"))) {
      e.preventDefault();
    }
  };
  // Blank space under the last line belongs to the body.
  const onBlankMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // The voice block's buttons leave the keyboard where it was, so Escape and ⌘↩ still reach the box.
    if (target.closest("[data-controls] button")) return e.preventDefault();
    // The box is a dialog itself, so only roles inside it count as controls.
    if (target.closest(".ProseMirror, button, a, input, [role]:not([role=dialog])")) return;
    if (editorRef.current?.placeAt(e.clientX, e.clientY)) e.preventDefault();
  };
  const empty = !title.trim() && !bodyText.trim() && !voice;
  const webpage = readText(`${title}\n${bodyText}`).kind === "address" && !voice;
  const picked = project ? pageOf(project) : undefined;
  // The person's pick wins over the guess.
  const guessed = !picked && guess.project ? pageOf(guess.project) : undefined;
  // A project picked for an idea that isn't a task leaves nothing to nod at: ⌘↩ saves it there.
  // The guess is for words, so a webpage has none.
  const offer = !webpage && guess.project && (guess.task || !project) ? (project ?? guess.project) : null;

  return (
    <div aria-label="New idea" className={cn(SURFACE, "flex flex-col", className)} onKeyDownCapture={onKeyDownCapture} role="dialog">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b px-5 text-[13px] text-muted-foreground leading-5">
        {webpage ? (
          <>
            <Globe className="size-4" />
            <span>Webpage</span>
            <span aria-hidden>·</span>
            <SegmentedControl aria-label="What to save" render={<RadioGroupPrimitive disabled={web.busy} onValueChange={(v) => setMode(v as SourceMode)} value={mode} />} size="sm">
              {MODES.map(([value, label]) => (
                <SegmentedControlItem className="text-[13px] sm:text-[13px]" key={value} render={<RadioPrimitive.Root value={value} />}>
                  {label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </>
        ) : (
          <>
            <Lightbulb className={cn("size-4", COLORS.yellow.text)} />
            <span>New idea</span>
            <span aria-hidden>·</span>
            <CalendarDays className={cn("size-4", COLORS.blue.text)} />
            <span>In Today</span>
            <span aria-hidden>·</span>
            <Hash className="size-4" />
            <span>{TAG}</span>
          </>
        )}
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
        {/* data-web: the body's hint is about ideas, so a webpage hides it. */}
        <div className="ll-capture mt-1 min-h-0 flex-1 overflow-y-auto" data-web={webpage || undefined} onMouseDown={onBlankMouseDown}>
          <BlockEditor
            assets={assets}
            content={null}
            label="Notes"
            links={host.links}
            onChange={(read) => {
              draft.current.body = read;
              setBodyText(editorRef.current?.text() ?? "");
              setHasVoice(Boolean(read().content?.some((n) => n.type === "voiceRecording")));
              touched();
            }}
            onExitTop={() => titleRef.current?.focus()}
            onVoiceSaved={() => {
              draft.current.voice = true;
              setVoice(true);
              touched();
            }}
            placeholder="It saves as you go and shows up in Today."
            ref={editorRef}
          />
        </div>
        {webpage && (web.error || web.missing) && (
          <div className="mt-2 flex items-center gap-3 text-[13px] leading-5" role={web.error ? "alert" : "status"}>
            <p className="min-w-0 flex-1">{web.error ?? `Saved. ${web.missing} media file${web.missing === 1 ? "" : "s"} could not be downloaded; the page marks each one.`}</p>
            {web.error && mode !== "link" && (
              <Button onClick={() => void saveWeb(!!web.beside, "link")} size="xs" variant="outline">
                Save link instead
              </Button>
            )}
          </div>
        )}
        <footer className="mt-2 flex h-5 items-center gap-3 text-[13px] text-muted-foreground leading-5">
          {/* Focus goes back to the title, since the mic turns off once the block is in. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Record a voice note"
                  className="-my-0.5 -ms-1"
                  disabled={hasVoice || web.busy}
                  onClick={() => {
                    editorRef.current?.record();
                    titleRef.current?.focus();
                  }}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <Mic className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Record a voice note</TooltipPopup>
          </Tooltip>
          {webpage ? (
            (web.busy || web.done) && (
              <span className="flex items-center gap-1.5" role="status">
                {web.done && <Check className="size-4" />}
                {web.busy ? "Saving webpage…" : "Saved"}
              </span>
            )
          ) : (
            !empty && (
              <span aria-hidden={!saved} className={cn("flex items-center gap-1.5 transition-opacity duration-150", saved ? "opacity-100" : "opacity-0")}>
                <Check className="size-4" />
                Saved
              </span>
            )
          )}
          <span className="ms-auto flex items-center gap-3">
            {!empty && (
              <>
                {offer && (
                  <span className="flex items-center gap-1.5">
                    <Kbd>{keysFor("nod")}</Kbd>
                    {guess.task ? "Task in" : "In"} {pageLabel(pageOf(offer)?.title ?? "")}
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
