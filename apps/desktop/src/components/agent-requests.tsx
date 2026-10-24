// From synara (MIT, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro) at 29b11e105200:
// apps/web/src/components/chat/ComposerChoiceRow.tsx, UserInputQuestionForm.tsx and
// ComposerPendingApprovalPanel.tsx. Changes: COSS tokens, Kbd for the number chip and lucide
// icons; one request per card, answered through the runtime's requests (lib/project-runtime/
// requests.ts) with a line saying where the answer is; number keys only inside the card, so two
// open requests can't answer each other; "Other" as a field in the card; no Computer scopes.
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref, useRef } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { cn } from "@leadinglight/ui/lib/utils";
import type { Answer, Delivery, RuntimeRequest } from "~/lib/project-runtime/requests";

type Tone = "neutral" | "primary" | "destructive";

function ChoiceRow({ shortcut, label, description, selected, tone = "neutral", disabled, trailing, onSelect }: { shortcut: number | null; label: string; description?: string; selected?: boolean; tone?: Tone; disabled?: boolean; trailing?: ReactNode; onSelect: () => void }) {
  return (
    <button
      aria-label={description && description !== label ? `${label}, ${description}` : label}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ease-out",
        selected ? "bg-accent" : tone === "destructive" ? "hover:bg-destructive/8" : "hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      {shortcut !== null && <Kbd className={cn(selected && "bg-foreground text-background", tone === "primary" && !selected && "text-primary", tone === "destructive" && !selected && "text-destructive-foreground")}>{shortcut}</Kbd>}
      <span className="min-w-0 flex-1 leading-snug">
        <span className="font-medium">{label}</span>
        {description && description !== label && <span className="ms-1.5 text-muted-foreground">{description}</span>}
      </span>
      {trailing}
    </button>
  );
}

// Digits pick from the card in focus only; typing in its field is typing.
const digit = (e: KeyboardEvent, count: number) => {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea")) return -1;
  const n = Number.parseInt(e.key, 10);
  return n >= 1 && n <= count ? n - 1 : -1;
};

const LINE: Partial<Record<Delivery, string>> = {
  sending: "Sending…",
  recorded: "Sent. Waiting for the agent to take it.",
  elsewhere: "Answered from another window.",
};

// Where the answer is on its way, and a way to try again when it didn't go.
export function DeliveryLine({ delivery, error, onRetry }: { delivery: Delivery; error?: string; onRetry: () => void }) {
  if (delivery === "failed")
    return (
      <p className="mt-2 flex items-center gap-2 text-destructive-foreground text-xs">
        Not sent{error ? `: ${error}` : ""}.
        <Button onClick={onRetry} size="xs" variant="outline">
          Try again
        </Button>
      </p>
    );
  return LINE[delivery] ? <p className="mt-2 text-muted-foreground text-xs">{LINE[delivery]}</p> : null;
}

type QuestionProps = {
  request: RuntimeRequest;
  answer: Answer;
  index: number;
  busy: boolean;
  onAnswer: (answer: Answer, index: number, submit: boolean) => void;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

// One question at a time, as synara's form: options to pick (several when it says so), your own
// words instead, and back and next across several questions. The last one sends them all.
export function QuestionCard({ request, answer, index, busy, onAnswer, children, ref }: QuestionProps) {
  const qs = request.questions ?? [];
  const q = qs[index];
  const timer = useRef<number | null>(null);
  if (!q) return null;
  const mine = answer.answers?.[index] ?? {};
  const picked = new Set(mine.picks ?? []);
  const answered = (k: number) => !!(answer.answers?.[k]?.picks?.length || answer.answers?.[k]?.other?.trim());
  const set = (next: { picks?: string[]; other?: string }) => qs.map((_, k) => (k === index ? next : (answer.answers?.[k] ?? {})));
  const last = index === qs.length - 1;
  const advance = (a: Answer) => onAnswer(a, last ? index : index + 1, last);
  const pick = (label: string) => {
    if (q.multi) return onAnswer({ answers: set({ picks: picked.has(label) ? [...picked].filter((l) => l !== label) : [...picked, label] }) }, index, false);
    const next = { answers: set({ picks: [label] }) };
    onAnswer(next, index, false);
    // A single choice moves on by itself, as in synara, a moment after it shows.
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => advance(next), 200);
  };
  return (
    <div
      aria-label="Question"
      className="mx-2 mb-2 rounded-xl border bg-background p-3 shadow-xs/5 outline-none"
      onKeyDown={(e) => {
        const n = digit(e, q.options?.length ?? 0);
        if (n < 0 || busy) return;
        e.preventDefault();
        pick(q.options![n].label);
      }}
      ref={ref}
      role="group"
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium leading-snug">{q.question}</p>
        {qs.length > 1 && (
          <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <Button aria-label="Previous question" disabled={index === 0 || busy} onClick={() => onAnswer(answer, index - 1, false)} size="icon-xs" variant="ghost">
              <ChevronLeft />
            </Button>
            <span className="px-0.5 text-xs tabular-nums">
              {index + 1} of {qs.length}
            </span>
            <Button aria-label="Next question" disabled={last || !answered(index) || busy} onClick={() => onAnswer(answer, index + 1, false)} size="icon-xs" variant="ghost">
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {q.multi && <p className="mt-1 text-muted-foreground text-xs">Choose one or more.</p>}
      {(q.options?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-0.5">
          {q.options!.map((o, k) => (
            <ChoiceRow
              description={o.description}
              disabled={busy}
              key={o.label}
              label={o.label}
              onSelect={() => pick(o.label)}
              selected={picked.has(o.label)}
              shortcut={k < 9 ? k + 1 : null}
              trailing={picked.has(o.label) ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
            />
          ))}
        </div>
      )}
      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter right after a pick: the pick's own move on would send it a second time.
          if (timer.current) window.clearTimeout(timer.current);
          if (answered(index)) advance(answer);
        }}
      >
        <Input aria-label="Your own answer" disabled={busy} onChange={(e) => onAnswer({ answers: set({ picks: q.multi ? mine.picks : [], other: e.currentTarget.value }) }, index, false)} placeholder="Or type your own answer" size="sm" value={mine.other ?? ""} />
        {(q.multi || mine.other?.trim()) && (
          <Button disabled={busy || !answered(index)} size="sm" type="submit">
            {last ? "Send" : "Next"}
          </Button>
        )}
      </form>
      {children}
    </div>
  );
}

const PROMPT: Record<string, string> = { Bash: "The agent wants to run a command", Edit: "The agent wants to change a file", Write: "The agent wants to write a file", ExitPlanMode: "The agent has a plan and is ready to start" };
const ACTIONS: Record<"approval" | "plan", { choice: string; label: string; description: string; tone: Tone }[]> = {
  approval: [
    { choice: "allow", label: "Allow once", description: "Just this request", tone: "primary" },
    { choice: "allow_always", label: "Always allow in this chat", description: "Don't ask again for this kind of step while the agent runs", tone: "neutral" },
    { choice: "deny", label: "Decline", description: "The agent goes on without it", tone: "destructive" },
  ],
  plan: [
    { choice: "accept_edits", label: "Start, accepting edits", description: "It changes files without asking", tone: "primary" },
    { choice: "approve_each", label: "Start, asking for each edit", description: "", tone: "neutral" },
    { choice: "deny", label: "Keep planning", description: "", tone: "neutral" },
  ],
};

// What the agent wants to do, in its own words where it gave them. Codex sends its own command beside
// the shell that runs it, and a file change's edits beside its approval (runtime 0.3.30-ll.8).
const s = (v: unknown) => (typeof v === "string" ? v : "");
function detail(r: RuntimeRequest): string {
  const input = (r.input ?? {}) as Record<string, unknown>;
  const actions = (Array.isArray(input.commandActions) ? input.commandActions : []) as { command?: string }[];
  const changes = (Array.isArray(input.changes) ? input.changes : []) as { path?: string; diff?: string; kind?: { type?: string } }[];
  const how = (c: (typeof changes)[number]) => ({ add: " (new file)", delete: " (deleted)" })[c.kind?.type ?? ""] ?? "";
  // A new or deleted file's diff is its whole text; its lines are marked as a change's are.
  const marked = (c: (typeof changes)[number]) => ({ add: "+", delete: "-" })[c.kind?.type ?? ""];
  const lines = (c: (typeof changes)[number]) => (marked(c) ? s(c.diff).replace(/\n$/, "").split("\n").map((l) => `${marked(c)}${l}`).join("\n") : s(c.diff));
  if (changes.length) return changes.map((c) => `${s(c.path).split("/").at(-1)}${how(c)}\n${lines(c)}`.trim()).join("\n\n");
  // Codex's other fields are only ids.
  const rest = "threadId" in input ? "" : Object.keys(input).length ? JSON.stringify(input, null, 2) : "";
  // A plan shows in the turn above its card, so it isn't repeated here.
  if (r.kind === "plan") return "";
  return s(actions[0]?.command) || s(input.command) || s(input.file_path) || rest;
}

export function ApprovalCard({ request, busy, onChoose, children, ref }: { request: RuntimeRequest; busy: boolean; onChoose: (choice: string) => void; children?: ReactNode; ref?: Ref<HTMLDivElement> }) {
  // Codex's "always" is for this very command; Claude's for steps of its kind.
  const exact = "threadId" in ((request.input ?? {}) as object) && request.tool === "Bash";
  const actions = ACTIONS[request.kind === "plan" ? "plan" : "approval"].map((a) =>
    request.kind === "plan" && a.choice === "deny" ? { ...a, choice: "keep_planning" } : exact && a.choice === "allow_always" ? { ...a, description: "Don't ask again for this command while the agent runs" } : a,
  );
  const text = detail(request);
  const why = s((request.input as Record<string, unknown> | undefined)?.reason);
  return (
    <div
      aria-label="Approval"
      className="mx-2 mb-2 rounded-xl border bg-background p-3 shadow-xs/5 outline-none"
      onKeyDown={(e) => {
        const n = digit(e, actions.length);
        if (n < 0 || busy) return;
        e.preventDefault();
        onChoose(actions[n].choice);
      }}
      ref={ref}
      role="group"
      tabIndex={-1}
    >
      <p className="font-medium leading-snug">{PROMPT[request.tool ?? ""] ?? `The agent wants to use ${request.tool}`}</p>
      {why && <p className="mt-1 text-muted-foreground text-xs">{why}</p>}
      {text && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-2 font-mono text-xs">{text}</pre>}
      <div className="mt-2 space-y-0.5">
        {actions.map((a, k) => (
          <ChoiceRow description={a.description} disabled={busy} key={a.choice} label={a.label} onSelect={() => onChoose(a.choice)} shortcut={k + 1} tone={a.tone} />
        ))}
      </div>
      {children}
    </div>
  );
}
