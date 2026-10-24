import { ArrowUp, AtSign, Bot, Check, ChevronDown, FileText, Gauge, Hand, ListChecks, Plus, ShieldAlert, ShieldCheck, Slash, Square, X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
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
import { ACCESS, type Access, EFFORTS, GPT_ACCESS, isClaude, labelOf, MODELS, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { INSTALL } from "~/lib/clis";
import { codex, effortFor, effortsFor, loadCodex } from "~/lib/codex";
import { openLink } from "~/lib/links";
import type { PageRef } from "~/lib/ask";

// The panel's composer: COSS's, laid out after synara's. "@" mentions an agent or another page
// as a token in the text, "/" offers things to do with the words; under the field are + and the
// access menu, then the model and effort and a round Send. Enter sends, Shift+Enter breaks the line.

export type Mention = { kind: "agent" | "page"; id: string; name: string };

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
}) {
  const [value, setValue] = useState<ComposerValue>([]);
  const triggers: ComposerTrigger[] = [
    {
      character: "@",
      items: [
        ...agents.map((a) => ({ id: `agent:${a.id}`, label: a.name, description: a.description ?? undefined, kind: "agent", icon: <Bot /> })),
        ...pages.map((p) => ({ id: `page:${p.id}`, label: p.title || "Untitled", description: "Page", kind: "page", icon: <FileText /> })),
      ],
    },
    { character: "/", items: commands.map((c) => ({ id: c.id, label: c.label, description: c.question.trim(), type: "action" as const, icon: <Slash /> })) },
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
          <AddMenu back={fieldRef} />
          <AccessMenu back={fieldRef} />
        </ComposerActionGroup>
        <ComposerActionGroup align="end" className="min-w-0 flex-nowrap">
          <ModelPicker back={fieldRef} />
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
type Back = { back: RefObject<HTMLDivElement | null> };

function AddMenu({ back }: Back) {
  const prefs = useAiPrefs();
  const { insertTrigger } = useComposerContext();
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button aria-label="Add" className={round} size="icon-sm" variant="ghost" />}>
          <Plus />
        </MenuTrigger>
        <MenuPopup align="start" className="w-64" finalFocus={back} side="top" {...own}>
          <MenuGroup>
            <MenuGroupLabel>Add</MenuGroupLabel>
            <MenuItem onClick={() => insertTrigger("@")}>
              <AtSign />
              Page or agent
            </MenuItem>
            <MenuItem onClick={() => insertTrigger("/")}>
              <Slash />
              Command
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuCheckboxItem checked={prefs.plan} onCheckedChange={(plan) => setAiPrefs({ plan })} variant="switch">
            <span className="flex flex-col">
              Plan mode
              <span className="text-muted-foreground text-xs">Claude plans first and changes nothing</span>
            </span>
          </MenuCheckboxItem>
        </MenuPopup>
      </Menu>
      {prefs.plan && (
        <Button aria-label="Turn Plan mode off" className="h-7 gap-1 rounded-full px-2 text-info-foreground sm:h-7" onClick={() => setAiPrefs({ plan: false })} size="sm" variant="ghost">
          <ListChecks />
          <span className={wide}>Plan</span>
          <X className={cn("size-3.5 opacity-60", wide)} />
        </Button>
      )}
    </>
  );
}

function AccessMenu({ back }: Back) {
  const prefs = useAiPrefs();
  const Icon = ACCESS_ICON[prefs.access];
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Access: ${labelOf(ACCESS, prefs.access)}`}
            className={cn("h-7 min-w-0 gap-1 rounded-full px-2 sm:h-7", prefs.access === "full" ? "text-warning-foreground" : "text-muted-foreground")}
            size="sm"
            variant="ghost"
          />
        }
      >
        <Icon />
        {/* With Plan on, the chip beside it needs the room. */}
        <span className={cn("truncate", prefs.plan ? "hidden" : wide)}>{labelOf(ACCESS, prefs.access)}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80" finalFocus={back} side="top" {...own}>
        <MenuRadioGroup onValueChange={(v) => setAiPrefs({ access: v as Access })} value={prefs.access}>
          {ACCESS.map((a) => {
            const I = ACCESS_ICON[a.value];
            const description = isClaude(prefs.model) ? a.description : GPT_ACCESS[a.value];
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
function ModelPicker({ back }: Back) {
  const prefs = useAiPrefs();
  const cx = codex.use();
  useEffect(() => void loadCodex(), []);
  const gpt = cx.models.map((m) => ({ value: m.id, label: m.name }));
  const all = [...MODELS, ...gpt];
  const claude = isClaude(prefs.model);
  const efforts = effortsFor(prefs.model);
  const effort = effortFor(prefs.model, prefs.effort);
  const step = Math.max(0, efforts.indexOf(effort));
  const pick = (model: string) => setAiPrefs({ model, effort: effortFor(model, prefs.effort) });
  const row = (m: { value: string; label: string }, i: number) => (
    <Button
      aria-checked={prefs.model === m.value}
      className="w-full justify-start gap-2 px-2 font-normal"
      key={m.value}
      onClick={() => pick(m.value)}
      role="radio"
      size="sm"
      variant="ghost"
    >
      <Check className={cn(prefs.model !== m.value && "invisible")} />
      {m.label}
      {i < 9 && <Kbd className="ms-auto">⌘{i + 1}</Kbd>}
    </Button>
  );
  const label = (text: string) => <p className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">{text}</p>;
  return (
    <Popover>
      <PopoverTrigger render={<Button aria-label="Model and effort" className="h-7 min-w-0 shrink gap-1 rounded-full px-2 sm:h-7" size="sm" variant="ghost" />}>
        <span className="truncate">{labelOf(all, prefs.model)}</span>
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
          {label("Claude")}
          {MODELS.map(row)}
          {label("GPT")}
          {gpt.map((m, i) => row(m, MODELS.length + i))}
          {cx.state !== "ready" && (
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
              onValueChange={(v) => setAiPrefs({ effort: efforts[Array.isArray(v) ? v[0] : v] })}
              step={1}
              value={step}
            />
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
