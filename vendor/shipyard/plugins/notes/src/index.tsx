import { definePlugin, worktreeLocation, type WorktreePanelProps } from "@berth/plugin";
import { Button, Icon, Spinner, Textarea, Tooltip, TooltipPopup, TooltipTrigger, cn } from "@berth/plugin/ui";

import { HomeNote } from "./home";
import { useCallback, useEffect, useRef, useState } from "react";

// Notes: a scratchpad for each worktree. It lives in the worktree itself, as
// .berth/notes.md, so it travels with the work rather than this laptop, and
// the agents working there can read it ("see .berth/notes.md"). Git ignores
// it through the repository's info/exclude, so it is never committed by
// accident.

export const FILE = ".berth/notes.md";
const LIMIT = 40_000; // what one exec request comfortably carries

export default definePlugin((berth) => {
  berth.addWorktreePanel({ id: "notes", title: "Notes", icon: "NotebookPen", Component: NotesPanel });
  berth.addCommand({ id: "open", title: "Open this worktree's notes", group: "Notes", run: () => berth.openPanel("notes") });
  berth.addHomeWidget({
    id: "note",
    title: "Notes",
    description: "A note or checklist that stays on Home, kept on this Mac.",
    icon: "NotebookPen",
    category: "You",
    sizes: ["m", "s", "t", "l"],
    source: "Kept on this Mac; nothing is read",
    Component: HomeNote,
  });
});

// base64 of UTF-8 text, so any note survives the trip through a shell.
function toBase64(text: string) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// The write and the git exclude happen in one command on the box.
export function saveCommand(text: string) {
  return [
    "mkdir -p .berth",
    `printf %s '${toBase64(text)}' | base64 -d > ${FILE}.tmp && mv ${FILE}.tmp ${FILE}`,
    `x="$(git rev-parse --git-common-dir 2>/dev/null)/info/exclude"; [ -d "$(dirname "$x")" ] && { grep -qxF '${FILE}' "$x" 2>/dev/null || echo '${FILE}' >> "$x"; }; true`,
  ].join(" && ");
}

type Save = "loading" | "saved" | "unsaved" | "saving" | "error";

function NotesPanel({ berth, box, location, worktree, main }: WorktreePanelProps) {
  const where = worktreeLocation({ location, worktree, main });
  const [text, setText] = useState("");
  const [state, setState] = useState<Save>("loading");
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef("");

  const exec = useCallback((command: string) => berth.orchestrate.exec(box, where, command, "30s"), [berth, box, where]);

  useEffect(() => {
    let live = true;
    exec(`cat ${FILE} 2>/dev/null; true`)
      .then((r) => {
        if (!live) return;
        setText(r.output);
        latest.current = r.output;
        setState("saved");
      })
      .catch((err) => {
        if (!live) return;
        setError(String(err?.message ?? err));
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [exec]);

  const save = useCallback(async () => {
    const value = latest.current;
    setState("saving");
    try {
      const r = await exec(saveCommand(value));
      if (r.exit_code !== 0) throw new Error(r.output.trim() || `exit ${r.exit_code}`);
      setError(undefined);
      // Typing while it saved leaves it unsaved, and saves again.
      setState(latest.current === value ? "saved" : "unsaved");
      if (latest.current !== value) timer.current = setTimeout(() => void save(), 800);
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setState("error");
    }
  }, [exec]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (value: string) => {
    if (value.length > LIMIT) return;
    setText(value);
    latest.current = value;
    setState("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };

  if (state === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" /> Opening notes…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <Icon name="NotebookPen" className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-sm">Notes</span>
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-help font-mono text-muted-foreground" />}>{FILE}</TooltipTrigger>
          <TooltipPopup className="max-w-72">Kept in this worktree on {box} and never committed. Agents here can read it: ask them to check {FILE}.</TooltipPopup>
        </Tooltip>
        <span className={cn("ml-auto", state === "error" ? "text-destructive" : "text-muted-foreground")}>
          {state === "saving" ? "Saving…" : state === "unsaved" ? "Edited" : state === "error" ? "Not saved" : "Saved"}
        </span>
        {state === "error" && (
          <Button size="xs" variant="outline" onClick={() => void save()}>
            Retry
          </Button>
        )}
      </header>
      {error && <p className="border-b bg-destructive/6 px-3 py-1.5 font-mono text-destructive text-xs">{error}</p>}
      <Textarea
        unstyled
        spellCheck={false}
        value={text}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            clearTimeout(timer.current);
            void save();
          }
        }}
        placeholder={`Plans, links, things to remember about ${worktree}…\n\nAgents working here can read this file too.`}
        className="flex min-h-0 flex-1 font-mono text-[13px] leading-6 [&_textarea]:h-full [&_textarea]:resize-none [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:[field-sizing:fixed]"
      />
    </div>
  );
}
