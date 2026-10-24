import { ArrowUp, AtSign, Bot, Check, ChevronDown, FileText, Gauge, Hand, ListChecks, Paperclip, Plus, ShieldAlert, ShieldCheck, Slash, Square, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import {
  Composer as Frame,
  ComposerActionGroup,
  ComposerActions,
  ComposerInput,
  ComposerItem,
  ComposerList,
  ComposerPopup,
  ComposerSubmit,
  ComposerToken,
  type ComposerTrigger,
  type ComposerValue,
  getComposerText,
  useComposerContext,
} from "@leadinglight/ui/components/composer";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Menu, MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Slider } from "@leadinglight/ui/components/slider";
import { cn } from "@leadinglight/ui/lib/utils";
import type { Agent } from "~/lib/agents";
import { ACCESS, type Access, type AiPrefs, EFFORTS, GPT_ACCESS, isClaude, labelOf, MODELS, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { INSTALL } from "~/lib/clis";
import { codex, effortFor, effortsFor, loadCodex } from "~/lib/codex";
import { openLink } from "~/lib/links";
import type { PageRef } from "~/lib/ask";

// The panel's composer: COSS's, laid out after synara's. "@" mentions an agent or another page
// as a token in the text, "/" offers things to do with the words; under the field are + and the
// access menu, then the model and effort and a round Send. Enter sends, Shift+Enter breaks the line.

export type Mention = { kind: "agent" | "page"; id: string; name: string };
// What a chat runs with. Without it the composer edits Settings › AI; a project chat keeps its own.
export type ChatSettings = Pick<AiPrefs, "model" | "effort" | "access" | "plan"> & {
  onChange: (p: Partial<Pick<AiPrefs, "model" | "effort" | "access" | "plan">>) => void;
  // Not offered now (a project chat's model while its turn runs, or with no agent running).
  locked?: boolean;
  // Only one agent's models: a started project chat keeps its agent.
  models?: "claude" | "gpt";
  // The access a chat's agent has, in its words; others aren't offered.
  accessChoices?: { value: Access; description: string }[];
};

export type Command = { id: string; label: string; question: string; send: boolean; description?: string };
export const COMMANDS: Command[] = [
  { id: "explain", label: "Explain", question: "Explain this", send: true },
  { id: "summarize", label: "Summarize", question: "Summarize this", send: true },
  { id: "shorten", label: "Shorten", question: "Shorten this", send: true },
  { id: "expand", label: "Expand", question: "Expand this with more detail", send: true },
  { id: "grammar", label: "Fix grammar", question: "Fix the grammar and spelling, changing nothing else", send: true },
  { id: "rewrite", label: "Rewrite", question: "Rewrite this more clearly", send: true },
  { id: "translate", label: "Translate", question: "Translate this into ", send: false },
];

const ACCESS_ICON: Record<Access, typeof Hand> = { ask: Hand, auto: ShieldCheck, full: ShieldAlert };
const round = "size-7 rounded-full sm:size-7";
// The footer's popups render outside the field's card but bubble through it in React, where
// its click-to-focus-the-field would take the keyboard from them.
const own = { onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(), onClick: (e: React.SyntheticEvent) => e.stopPropagation() };
// Words that give way first when the panel is narrow.
const wide = "hidden @[22rem]/panel:inline";

const mentionsIn = (value: ComposerValue): Mention[] =>
  value.flatMap((p) => (p.type === "mention" && (p.kind === "agent" || p.kind === "page") ? [{ kind: p.kind, id: p.id.slice(p.kind.length + 1), name: p.label }] : []));

export function Composer({
  ready,
  busy,
  placeholder,
  agents,
  pages,
  onSend,
  onStop,
  fieldRef,
  commands = COMMANDS,
  restore,
  settings,
  files,
}: {
  ready: boolean;
  busy: boolean;
  placeholder: string;
  agents: Agent[];
  pages: PageRef[];
  onSend: (question: string, mentions: Mention[]) => void;
  onStop: () => void;
  fieldRef: RefObject<HTMLDivElement | null>;
  // A project chat has none of the page's own (they ask about the note in view).
  commands?: Command[];
  // Words given back: a message not sent, or an answer that can't go now.
  restore?: { text: string; at: number } | null;
  settings?: ChatSettings;
  // Files to go with the next message (a project chat's), and taking one off or adding more.
  files?: { names: string[]; add: (f: File[]) => void; remove: (i: number) => void };
}) {
  const prefs = useAiPrefs();
  const s = settings ?? { ...prefs, onChange: setAiPrefs };
  const [value, setValue] = useState<ComposerValue>([]);
  useEffect(() => void (restore && setValue([{ type: "text", text: restore.text }])), [restore?.at]);
  const triggers: ComposerTrigger[] = [
    {
      character: "@",
      items: [
        ...agents.map((a) => ({ id: `agent:${a.id}`, label: a.name, description: a.description ?? undefined, kind: "agent", icon: <Bot /> })),
        ...pages.map((p) => ({ id: `page:${p.id}`, label: p.title || "Untitled", description: "Page", kind: "page", icon: <FileText /> })),
      ],
    },
    { character: "/", items: commands.map((c) => ({ id: c.id, label: c.label, description: c.description ?? c.question.trim(), type: "action" as const, icon: <Slash /> })) },
  ];
  const send = (draft: ComposerValue) => {
    const question = getComposerText(draft).trim();
    if (!question || busy || !ready) return;
    setValue([]);
    onSend(question, mentionsIn(draft));
  };

  return (
    <Frame
      className="mx-2 mb-2 [--composer-max-rows:6]"
      onAction={(item) => {
        const c = commands.find((x) => x.id === item.id);
        if (!c) return;
        if (c.send) {
          setValue([]);
          if (ready && !busy) onSend(c.question, mentionsIn(value));
        } else setValue([{ type: "text", text: c.question }]);
      }}
      onSubmit={send}
      onValueChange={setValue}
      submitDisabled={!ready || busy}
      triggers={triggers}
      value={value}
    >
      {files && files.names.length > 0 && (
        <div className="flex flex-wrap gap-1 px-[calc(var(--composer-padding)+1px)] pt-2" {...own}>
          {files.names.map((name, i) => (
            <Button aria-label={`Take off ${name}`} key={`${name}:${i}`} onClick={() => files.remove(i)} size="xs" variant="outline">
              <FileText />
              <span className="max-w-40 truncate">{name}</span>
              <X className="opacity-60" />
            </Button>
          ))}
        </div>
      )}
      <ComposerInput
        aria-label="Question"
        placeholder={placeholder}
        ref={fieldRef}
        renderToken={(t) => <ComposerToken icon={t.kind === "agent" ? <Bot /> : <FileText />} token={t} variant="chip" />}
      />
      <ComposerPopup data-testid="composer-menu">
        <ComposerList>
          {(item) => (
            <ComposerItem key={item.id} value={item}>
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">{item.icon}</span>
              <span className="shrink-0 truncate">{item.label}</span>
              {item.description && <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{item.description}</span>}
            </ComposerItem>
          )}
        </ComposerList>
      </ComposerPopup>
      <ComposerActions>
        <ComposerActionGroup className="flex-nowrap">
          <AddMenu back={fieldRef} commands={commands.length > 0} files={files?.add} mentions={agents.length + pages.length > 0} s={s} />
          <AccessMenu back={fieldRef} s={s} />
        </ComposerActionGroup>
        <ComposerActionGroup align="end" className="min-w-0 flex-nowrap">
          <ModelPicker back={fieldRef} s={s} />
          {busy ? (
            <Button aria-label="Stop" className={round} onClick={onStop} size="icon-sm" variant="outline">
              <Square className="size-2.5 fill-current" />
            </Button>
          ) : (
            <ComposerSubmit
              render={
                <Button aria-label="Send" className={round} size="icon-sm">
                  <ArrowUp />
                </Button>
              }
            />
          )}
        </ComposerActionGroup>
      </ComposerActions>
    </Frame>
  );
}

// "+": mention something, run a command, or plan first. Plan mode shows as a chip beside it.
type Back = { back: RefObject<HTMLDivElement | null>; s: ChatSettings };

function AddMenu({ back, s, mentions, commands, files }: Back & { mentions: boolean; commands: boolean; files?: (f: File[]) => void }) {
  const { insertTrigger } = useComposerContext();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button aria-label="Add" className={round} size="icon-sm" variant="ghost" />}>
          <Plus />
        </MenuTrigger>
        <MenuPopup align="start" className="w-64" finalFocus={back} side="top" {...own}>
          {/* Only what there is to add: a project chat has no pages or agents, and takes files. */}
          {(mentions || commands || files) && (
            <>
              <MenuGroup>
                <MenuGroupLabel>Add</MenuGroupLabel>
                {files && (
                  <MenuItem onClick={() => picker.current?.click()}>
                    <Paperclip />
                    Files…
                  </MenuItem>
                )}
                {mentions && (
                  <MenuItem onClick={() => insertTrigger("@")}>
                    <AtSign />
                    Page or agent
                  </MenuItem>
                )}
                {commands && (
                  <MenuItem onClick={() => insertTrigger("/")}>
                    <Slash />
                    Command
                  </MenuItem>
                )}
              </MenuGroup>
              <MenuSeparator />
            </>
          )}
          <MenuCheckboxItem checked={s.plan} onCheckedChange={(plan) => s.onChange({ plan })} variant="switch">
            <span className="flex flex-col">
              Plan mode
              <span className="text-muted-foreground text-xs">Claude plans first and changes nothing</span>
            </span>
          </MenuCheckboxItem>
        </MenuPopup>
      </Menu>
      {/* The system's own file panel, opened from Files…; never shown itself. */}
      {files && (
        <input
          className="hidden"
          multiple
          onChange={(e) => {
            files(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
          ref={picker}
          type="file"
        />
      )}
      {s.plan && (
        <Button aria-label="Turn Plan mode off" className="h-7 gap-1 rounded-full px-2 text-info-foreground sm:h-7" onClick={() => s.onChange({ plan: false })} size="sm" variant="ghost">
          <ListChecks />
          <span className={wide}>Plan</span>
          <X className={cn("size-3.5 opacity-60", wide)} />
        </Button>
      )}
    </>
  );
}

function AccessMenu({ back, s }: Back) {
  const Icon = ACCESS_ICON[s.access];
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Access: ${labelOf(ACCESS, s.access)}`}
            className={cn("h-7 min-w-0 gap-1 rounded-full px-2 sm:h-7", s.access === "full" ? "text-warning-foreground" : "text-muted-foreground")}
            size="sm"
            variant="ghost"
          />
        }
      >
        <Icon />
        {/* With Plan on, the chip beside it needs the room. */}
        <span className={cn("truncate", s.plan ? "hidden" : wide)}>{labelOf(ACCESS, s.access)}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80" finalFocus={back} side="top" {...own}>
        <MenuRadioGroup onValueChange={(v) => s.onChange({ access: v as Access })} value={s.access}>
          {ACCESS.flatMap((a) => {
            const own = s.accessChoices ? s.accessChoices.find((x) => x.value === a.value) : { description: isClaude(s.model) ? a.description : GPT_ACCESS[a.value] };
            if (!own) return [];
            const I = ACCESS_ICON[a.value];
            const description = own.description;
            return (
              <MenuRadioItem className={cn("py-2", a.value === "full" && "text-warning-foreground")} closeOnClick key={a.value} value={a.value}>
                <span className="flex items-start gap-2">
                  <I className="mt-0.5" />
                  <span className="flex flex-col">
                    {a.label}
                    <span className={cn("text-xs", a.value === "full" ? "text-warning-foreground/80" : "text-muted-foreground")}>{description}</span>
                  </span>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

// The model, Claude's and the GPT ones Codex offers, with ⌘1… while open, and the effort as a
// slider of that model's stops (synara's).
function ModelPicker({ back, s }: Back) {
  const cx = codex.use();
  useEffect(() => void loadCodex(), []);
  const gpt = cx.models.map((m) => ({ value: m.id, label: m.name }));
  const all = [...(s.models === "gpt" ? [] : MODELS), ...(s.models === "claude" ? [] : gpt)];
  const claude = isClaude(s.model);
  const efforts = effortsFor(s.model);
  const effort = effortFor(s.model, s.effort);
  const step = Math.max(0, efforts.indexOf(effort));
  const pick = (model: string) => s.onChange({ model, effort: effortFor(model, s.effort) });
  const row = (m: { value: string; label: string }, i: number) => (
    <Button
      aria-checked={s.model === m.value}
      className="w-full justify-start gap-2 px-2 font-normal"
      key={m.value}
      onClick={() => pick(m.value)}
      role="radio"
      size="sm"
      variant="ghost"
    >
      <Check className={cn(s.model !== m.value && "invisible")} />
      {m.label}
      {i < 9 && <Kbd className="ms-auto">⌘{i + 1}</Kbd>}
    </Button>
  );
  const label = (text: string) => <p className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">{text}</p>;
  return (
    <Popover>
      <PopoverTrigger disabled={s.locked} render={<Button aria-label="Model and effort" className="h-7 min-w-0 shrink gap-1 rounded-full px-2 sm:h-7" size="sm" variant="ghost" />}>
        <span className="truncate">{labelOf(all, s.model)}</span>
        {/* GPT's names are long, so its effort shows only when the panel is wide. */}
        <span className={cn("text-muted-foreground", claude ? wide : "hidden @[28rem]/panel:inline")}>{labelOf(EFFORTS, effort)}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup
        align="end"
        className="w-64 [&_[data-slot=popover-viewport]]:p-1"
        finalFocus={back}
        {...own}
        onKeyDown={(e) => {
          const i = Number(e.key) - 1;
          if (!e.metaKey || !all[i]) return;
          e.preventDefault();
          pick(all[i].value);
        }}
        side="top"
      >
        <div aria-label="Model" role="radiogroup">
          {s.models !== "gpt" && label("Claude")}
          {s.models !== "gpt" && MODELS.map(row)}
          {s.models !== "claude" && label("GPT")}
          {s.models !== "claude" && gpt.map((m, i) => row(m, (s.models === "gpt" ? 0 : MODELS.length) + i))}
          {s.models !== "claude" && cx.state !== "ready" && (
            <p className="px-2 pb-1.5 text-muted-foreground text-xs">
              {cx.state === "checking" ? (
                "Looking for Codex…"
              ) : cx.state === "missing" ? (
                <>
                  Install{" "}
                  <button className="underline" onClick={() => openLink(INSTALL.codex)} type="button">
                    Codex
                  </button>{" "}
                  to use GPT models.
                </>
              ) : (
                <>
                  Run <code className="rounded bg-muted px-1 font-mono">codex login</code> in Terminal to use GPT models.
                </>
              )}
            </p>
          )}
        </div>
        {efforts.length > 1 && (
          <div className="mt-1 border-t px-2 pt-2 pb-1">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <Gauge className="size-4 text-muted-foreground" />
              <span className="flex-1 text-center font-medium">{labelOf(EFFORTS, effort)}</span>
              <span className="size-4" />
            </div>
            <Slider
              getAriaLabel={() => "Effort"}
              max={efforts.length - 1}
              min={0}
              onValueChange={(v) => s.onChange({ effort: efforts[Array.isArray(v) ? v[0] : v] })}
              step={1}
              value={step}
            />
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
