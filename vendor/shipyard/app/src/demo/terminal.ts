import type { BerthEvent, Session, TerminalConnection, TerminalHandlers } from "@/lib/api";

// The live demo's agents: what each has been doing, what it asks, and what
// it says when done. The terminals and the dashboard's cards both read from
// here, so they tell the same story. Nothing runs anywhere.

interface Deps {
  session(): Session | undefined;
  // What was last sent to the session (an answer from the board, say).
  answered(): string | undefined;
  send(text: string): Promise<unknown>;
  listen(fn: (e: BerthEvent) => void): () => void;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// What each agent did before its state now.
const WORK: Record<string, string[]> = {
  "checkout-fix-claude": [
    `${dim(">")} The payment webhook gives up too early. Fix the retries.`,
    "",
    `${orange("●")} Read(${bold("apps/web/lib/payments/webhook.ts")})`,
    dim("  ⎿  Read 212 lines"),
    "",
    `${green("●")} Update(${bold("apps/web/lib/payments/webhook.ts")})`,
    `${dim("  ⎿  Updated with ")}${green("12 additions")}${dim(" and ")}${red("3 removals")}`,
    "",
  ],
  "qa-deck-codex": [`${dim("›")} Build the QA deck and check every story renders`, "", "• Ran pnpm install", dim("  └ Done in 8.2s"), ""],
  "search-perf-claude": [
    `${dim(">")} Make search results render faster on big categories`,
    "",
    `${orange("●")} Read(${bold("apps/web/components/search/SearchResults.tsx")})`,
    `${green("●")} Update(${bold("apps/web/components/search/ProductGrid.tsx")})`,
    "",
  ],
  "judge-v2-claude": [`${dim(">")} Run judge v2 on the labelled set and compare it with v1`, "", `${orange("●")} Bash(${bold("python -m evals.run --judge v2 --set labelled")})`, dim("  ⎿  200 samples · 8 workers"), ""],
  "ci-flake-claude": [`${dim(">")} Find out why the checkout e2e test flakes on CI`, "", `${orange("●")} Read(${bold("apps/web/e2e/checkout.e2e.ts")})`, ""],
};

// What a waiting agent asks. The last line before the choices is what the
// dashboard's card shows.
const QUESTIONS: Record<string, string> = {
  "checkout-fix-claude":
    "● Retries are capped at 3, with backoff, and 429s now count as retryable.\n  A slow provider outage would still hold the order lock for the whole backoff.\n\n  Cap the total retry time too?\n❯ 1. Yes, cap it at 30s\n  2. No, leave it",
  "qa-deck-codex": "• Storybook wants port 6006, which search-perf is using.\n\n  Run the deck on 6007 instead?\n› 1. Yes, use 6007\n  2. No, stop search-perf's storybook",
};

const RUNNING: Record<string, string> = {
  "checkout-fix-claude": "✻ Running the payment tests… (esc to interrupt)",
  "qa-deck-codex": "• Building stories… 27 of 41",
  "judge-v2-claude": "● Scoring… 143 of 200",
};

const DONE: Record<string, string[]> = {
  "checkout-fix-claude": ["● Retries now stop after 30s in total, and a test covers a slow", "  outage. All 214 tests pass."],
  "qa-deck-codex": ["• All 41 stories render. The deck is on port 6007."],
  "search-perf-claude": ["● A 500-product category renders in ~45ms, from ~180ms. The", "  search tests pass."],
  "judge-v2-claude": ["● Judge v2 agrees with people on 91% of samples (v1: 84%).", "  The report is in reports/judge-v2.md."],
  "ci-flake-claude": ["● Two tests shared port 3100; each now takes its own.", "  20 runs in a row pass."],
  "order-export-claude": ["● Admins can export orders as CSV, filtered by date and", "  status. All 214 tests pass."],
  "order-export-claude-3": ["● Six tests cover the export job, large exports included.", "  They pass."],
};

// What an agent shows after an answer, a beat apart.
const AFTER: Record<string, string[]> = {
  "checkout-fix-claude": [`${green("●")} Update(${bold("apps/web/lib/payments/webhook.ts")})`, dim("  ⎿  Capped the total retry time at 30s"), "", `${orange("●")} Bash(${bold("pnpm test payments")})`, dim("  ⎿  PASS  payments/webhook.test.ts (14 tests)")],
  "qa-deck-codex": ["• Moved the deck to port 6007", "• Building stories… 41 of 41"],
};

// demoScreen is a demo agent's screen as the box would report it, for the
// dashboard's cards; undefined leaves the shared fixtures to answer.
export function demoScreen(s: Session): string | undefined {
  const st = s.agent_state;
  if (st === "waiting" && QUESTIONS[s.name]) return QUESTIONS[s.name];
  if (st === "running" && RUNNING[s.name]) return [...(WORK[s.name] ?? []), RUNNING[s.name]].map(plain).join("\n");
  if (st === "finished" && DONE[s.name]) return [...DONE[s.name], "", "✻ Done"].join("\n");
  return undefined;
}

export function demoAttach(box: string, name: string, h: TerminalHandlers, deps: Deps): TerminalConnection {
  const timers: number[] = [];
  let open = true;
  let line = "";
  const s0 = deps.session();
  const agent = s0?.agent;
  const shellPrompt = `${green(`me@${box}`)}:${cyan((s0?.dir ?? "~").replace(/^\/home\/me/, "~"))}$ `;
  let state = s0?.agent_state;

  // Lines go out a beat apart, in order, however they were queued.
  let queue = Promise.resolve();
  const say = (lines: string[], gap = 70) => {
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          let i = 0;
          const next = () => {
            if (!open || i >= lines.length) return resolve();
            h.onData(lines[i++].replace(/\n/g, "\r\n") + "\r\n");
            timers.push(window.setTimeout(next, gap));
          };
          next();
        }),
    );
  };
  const write = (text: string) => {
    queue = queue.then(() => {
      if (open) h.onData(text);
    });
  };
  const prompt = () => write(agent ? `${bold("❯")} ` : shellPrompt);
  const question = () => (QUESTIONS[name] ?? "● Should I go on?\n❯ 1. Yes\n  2. No").split("\n").map((l) => (/^\s*[❯›]\s*\d/.test(l) ? cyan(l) : l));

  const show = (st: string | undefined) => {
    if (st === "waiting") return say(question());
    if (st === "running") return say([dim(RUNNING[name] ?? "✻ Working… (esc to interrupt)")]);
    if (st === "finished") say([...(DONE[name] ?? ["● Done."]), "", dim("✻ Done"), ""]);
    prompt();
  };

  timers.push(window.setTimeout(() => h.onOpen(), 120));
  timers.push(
    window.setTimeout(() => {
      h.onData("\x1b[2J\x1b[H");
      const banner = agent ? [`${orange("✻")} ${bold(agent === "codex" ? "Codex" : "Claude Code")} on ${cyan(box)}  ${dim(s0?.dir ?? "")}`, ""] : [];
      say([...banner, ...(agent && state !== "idle" ? (WORK[name] ?? []) : [])], 40);
      show(agent ? state : undefined);
    }, 180),
  );

  // Follow the agent: an answer from the board, the script, a new prompt.
  const stop = deps.listen(() => {
    const next = deps.session()?.agent_state;
    if (!open || next === state) return;
    const was = state;
    state = next;
    if (next === "running") {
      if (was === "waiting") say([dim(`  ⎿  ${deps.answered() === "2" ? "No" : "Yes"}`), ""]);
      say(was === "waiting" ? (AFTER[name] ?? [`${orange("●")} On it.`]) : [`${orange("●")} On it.`], 600);
      return;
    }
    show(next);
  });

  return {
    send(data) {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      // Arrow keys and the like: nothing to move here.
      if (text.startsWith("\x1b")) return;
      for (const ch of text) {
        if (agent && state === "waiting") {
          if (ch === "1" || ch === "2") void deps.send(ch);
          else if (ch === "\r") void deps.send("1");
          continue;
        }
        if (ch === "\r") {
          const typed = line.trim();
          line = "";
          h.onData("\r\n");
          if (!agent) {
            if (typed) h.onData(dim("demo: nothing runs here") + "\r\n");
            prompt();
          } else if (typed && state !== "running") void deps.send(typed);
          else if (!typed) prompt();
        } else if (ch === "\x7f") {
          if (line) {
            line = line.slice(0, -1);
            h.onData("\b \b");
          }
        } else if (ch >= " ") {
          line += ch;
          h.onData(ch);
        }
      }
    },
    resize() {},
    close() {
      open = false;
      stop();
      timers.forEach(clearTimeout);
      h.onClose(true);
    },
  };
}
