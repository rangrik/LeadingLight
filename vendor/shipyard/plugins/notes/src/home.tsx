import { type HomeWidgetProps, useStorage } from "@berth/plugin";
import { Button, Icon, Textarea, WidgetEmpty, cn } from "@berth/plugin/ui";
import { useState } from "react";

// The Notes widget on Home: one note kept on this Mac (the plugin's
// storage), for what doesn't belong to a worktree. Lines written "- [ ]"
// are a checklist, ticked with a click; the rest is text. Click Edit (or
// the note) to change it, Escape or a click away to stop.

const TASK = /^(\s*[-*]\s+)\[( |x|X)\]\s?(.*)$/;

export function toggleLine(text: string, i: number): string {
  const lines = text.split("\n");
  const m = TASK.exec(lines[i] ?? "");
  if (!m) return text;
  lines[i] = `${m[1]}[${m[2] === " " ? "x" : " "}] ${m[3]}`;
  return lines.join("\n");
}

export function HomeNote({ size, preview }: HomeWidgetProps) {
  const [text, setText] = useStorage("home-note", "");
  const [editing, setEditing] = useState(false);
  if (editing && !preview) {
    return (
      <div className="flex h-full flex-col px-1 pb-0.5">
        <Textarea
          unstyled
          autoFocus
          spellCheck={false}
          aria-label="Home note"
          value={text}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value.slice(0, 4000))}
          onBlur={() => setEditing(false)}
          onKeyDown={(e: React.KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setEditing(false))}
          placeholder={"Release on Thursday\n- [ ] QA deck signed off\n- [ ] Tell support about the CSV export"}
          className="flex min-h-0 flex-1 rounded-md bg-muted/40 text-[13px] leading-6 [&_textarea]:h-full [&_textarea]:resize-none [&_textarea]:px-2 [&_textarea]:py-1 [&_textarea]:[field-sizing:fixed]"
        />
      </div>
    );
  }
  if (!text.trim()) return <WidgetEmpty scene="bottle" title="A note for Home" hint="Plans, a checklist, things to remember. Kept on this Mac." action="Write one" onAction={() => setEditing(true)} compact={size === "s" || size === "m"} />;
  const lines = text.split("\n");
  return (
    <div className="group/note relative flex h-full flex-col overflow-hidden px-2">
      {lines.map((l, i) => {
        const m = TASK.exec(l);
        if (!m)
          return (
            <p key={i} className={cn("min-h-5 truncate text-[13px] leading-6", i === 0 && "font-medium")}>
              {l}
            </p>
          );
        const done = m[2] !== " ";
        return (
          <button key={i} type="button" role="checkbox" aria-checked={done} onClick={() => setText(toggleLine(text, i))} className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-sm text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border", done && "border-foreground bg-foreground text-background")}>{done && <Icon name="Check" className="size-2.5" />}</span>
            <span className={cn("truncate", done && "text-muted-foreground line-through")}>{m[3]}</span>
          </button>
        );
      })}
      <Button size="xs" variant="outline" className="absolute right-1 bottom-0 opacity-0 focus-visible:opacity-100 group-hover/note:opacity-100" onClick={() => setEditing(true)}>
        <Icon name="Pencil" className="size-3" />
        Edit
      </Button>
    </div>
  );
}
