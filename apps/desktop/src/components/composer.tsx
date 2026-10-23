import { AtSign, Bot, ChevronDown, FileText, SendHorizontal, Slash, Square, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { cn } from "@leadinglight/ui/lib/utils";
import type { Agent } from "~/lib/agents";
import { type AiPrefs, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import type { PageRef } from "~/lib/ask";

// The panel's composer, in synara's spirit: "@" mentions an agent or another page (kept as
// chips above the field), "/" offers things to do with the words, and the footer holds the
// model and effort beside Send. Enter sends, Shift+Enter breaks the line.

export type Mention = { kind: "agent"; id: string; name: string } | { kind: "page"; id: string; name: string };

export type Command = { id: string; label: string; question: string; send: boolean };
export const COMMANDS: Command[] = [
  { id: "explain", label: "Explain", question: "Explain this", send: true },
  { id: "summarize", label: "Summarize", question: "Summarize this", send: true },
  { id: "shorten", label: "Shorten", question: "Shorten this", send: true },
  { id: "expand", label: "Expand", question: "Expand this with more detail", send: true },
  { id: "grammar", label: "Fix grammar", question: "Fix the grammar and spelling, changing nothing else", send: true },
  { id: "rewrite", label: "Rewrite", question: "Rewrite this more clearly", send: true },
  { id: "translate", label: "Translate", question: "Translate this into ", send: false },
];

type Row = { id: string; title: string; secondary?: string | null; icon: React.ReactNode; pick(): void };
type Trigger = { kind: "mention" | "command"; query: string; start: number; end: number };

// The trigger under the caret: "@" after a space or the start, "/" at the start only.
function triggerAt(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (m) return { kind: "mention", query: m[1], start: caret - m[1].length - 1, end: caret };
  const c = /^\/([^\s/]*)$/.exec(before);
  if (c) return { kind: "command", query: c[1], start: 0, end: caret };
  return null;
}

const MODELS: { value: AiPrefs["model"]; label: string }[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];
const EFFORTS: { value: AiPrefs["effort"]; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const label = (list: { value: string; label: string }[], value: string) => list.find((x) => x.value === value)?.label ?? value;

export function Composer({
  ready,
  busy,
  placeholder,
  agents,
  pages,
  mentions,
  onMentions,
  onSend,
  onStop,
  fieldRef,
}: {
  ready: boolean;
  busy: boolean;
  placeholder: string;
  agents: Agent[];
  pages: PageRef[];
  mentions: Mention[];
  onMentions: (m: Mention[]) => void;
  onSend: (question: string) => void;
  onStop: () => void;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const prefs = useAiPrefs();
  const [draft, setDraft] = useState("");
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const field = () => fieldRef.current;
  const read = () => {
    const el = field();
    if (!el) return;
    setTrigger(triggerAt(el.value, el.selectionStart ?? el.value.length));
    setActive(0);
  };

  const add = (m: Mention) => {
    if (!mentions.some((x) => x.kind === m.kind && x.id === m.id)) onMentions([...mentions, m]);
  };
  const strip = () => {
    if (!trigger) return;
    setDraft((d) => (d.slice(0, trigger.start) + d.slice(trigger.end)).replace(/^\s+/, ""));
    setTrigger(null);
    requestAnimationFrame(() => field()?.focus());
  };

  const q = trigger?.query.toLowerCase() ?? "";
  const rows: Row[] =
    trigger?.kind === "mention"
      ? [
          ...agents
            .filter((a) => a.name.toLowerCase().includes(q))
            .map((a) => ({ id: `agent:${a.id}`, title: a.name, secondary: a.description, icon: <Bot />, pick: () => (add({ kind: "agent", id: a.id, name: a.name }), strip()) })),
          ...pages
            .filter((p) => p.title.toLowerCase().includes(q))
            .slice(0, 8)
            .map((p) => ({ id: `page:${p.id}`, title: p.title || "Untitled", secondary: "Page", icon: <FileText />, pick: () => (add({ kind: "page", id: p.id, name: p.title || "Untitled" }), strip()) })),
        ]
      : trigger?.kind === "command"
        ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)).map((c) => ({
            id: c.id,
            title: c.label,
            secondary: c.question.trim(),
            icon: <Slash />,
            pick: () => {
              setTrigger(null);
              if (c.send) {
                setDraft("");
                onSend(c.question);
              } else {
                setDraft(c.question);
                requestAnimationFrame(() => {
                  const el = field();
                  el?.focus();
                  el?.setSelectionRange(c.question.length, c.question.length);
                });
              }
            },
          }))
        : [];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const send = () => {
    const question = draft.trim();
    if (!question || busy || !ready) return;
    setDraft("");
    setTrigger(null);
    onSend(question);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && rows.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        rows[active]?.pick();
        return;
      }
    }
    if (e.key === "Escape" && trigger) {
      e.stopPropagation();
      setTrigger(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="relative shrink-0 border-t">
      {trigger && (
        <div
          className="absolute right-2 bottom-full left-2 z-10 mb-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          data-testid="composer-menu"
          ref={listRef}
          role="listbox"
        >
          {rows.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{trigger.kind === "mention" ? "No agent or page by that name." : "No such command."}</p>}
          {rows.map((r, i) => (
            <div
              aria-selected={i === active}
              className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm", i === active && "bg-accent text-accent-foreground")}
              data-active={i === active ? "" : undefined}
              key={r.id}
              onMouseDown={(e) => {
                e.preventDefault();
                r.pick();
              }}
              onMouseEnter={() => setActive(i)}
              role="option"
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{r.icon}</span>
              <span className="truncate">{r.title}</span>
              {r.secondary && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.secondary}</span>}
            </div>
          ))}
        </div>
      )}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pt-2">
          {mentions.map((m) => (
            <span className="flex h-6 items-center gap-1 rounded-md bg-accent pr-1 pl-1.5 text-xs text-accent-foreground" data-testid="composer-chip" key={`${m.kind}:${m.id}`}>
              {m.kind === "agent" ? <Bot className="size-3" /> : <FileText className="size-3" />}@{m.name}
              <button aria-label={`Remove ${m.name}`} className="rounded p-0.5 hover:bg-background/60" onClick={() => onMentions(mentions.filter((x) => x !== m))} type="button">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-1 p-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          aria-label="Question"
          className="flex-1 [&_textarea]:max-h-32 [&_textarea]:min-h-8 [&_textarea]:resize-none"
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            read();
          }}
          onClick={read}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => (e.key === "ArrowLeft" || e.key === "ArrowRight" ? read() : undefined)}
          placeholder={placeholder}
          ref={fieldRef}
          rows={1}
          value={draft}
        />
        {busy ? (
          <Button aria-label="Stop" onClick={onStop} size="icon-sm" type="button" variant="outline">
            <Square />
          </Button>
        ) : (
          <Button aria-label="Send" disabled={!ready || !draft.trim()} size="icon-sm" type="submit">
            <SendHorizontal />
          </Button>
        )}
      </form>
      <div className="flex items-center gap-1 px-2 pb-1.5">
        <Menu>
          <MenuTrigger render={<Button aria-label="Model and effort" className="h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground" size="sm" variant="ghost" />}>
            {label(MODELS, prefs.model)} · {label(EFFORTS, prefs.effort)}
            <ChevronDown className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start" side="top">
            <MenuGroup>
              <MenuGroupLabel>Model</MenuGroupLabel>
              <MenuRadioGroup onValueChange={(v) => setAiPrefs({ model: v as AiPrefs["model"] })} value={prefs.model}>
                {MODELS.map((m) => (
                  <MenuRadioItem closeOnClick={false} key={m.value} value={m.value}>
                    {m.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuGroup>
              <MenuGroupLabel>Effort</MenuGroupLabel>
              <MenuRadioGroup onValueChange={(v) => setAiPrefs({ effort: v as AiPrefs["effort"] })} value={prefs.effort}>
                {EFFORTS.map((m) => (
                  <MenuRadioItem closeOnClick={false} key={m.value} value={m.value}>
                    {m.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          <AtSign className="inline size-3" /> agent or page · / commands
        </span>
      </div>
    </div>
  );
}
