import { create } from "zustand";

import { type BoxCaller, type LoopOutcome, type LoopPhase, type LoopProgress, type LoopResult, loopRun, loop as runLoop } from "@/lib/orchestrate-core";
import { boxHasRuns, scheduleRuns } from "@/lib/runs";

// A loop on a box with runs is a run of the loop template on the box: it
// keeps going when the app quits or the laptop sleeps, and the loops panel
// shows it from the box's runs on any device. On an older box the loop runs
// here in the app, as it always did; this store tracks both while the app
// started them.

export interface Loop {
  id: string;
  box: string;
  session: string;
  check: string;
  round: number;
  max: number;
  phase: LoopPhase;
  // Set once the loop has ended.
  outcome?: LoopOutcome;
  message: string;
  // The last check's exit code and the end of its output.
  exitCode?: number;
  output?: string;
  started: number;
  ended?: number;
  // The box's run, for a loop that runs there.
  runId?: string;
  cancel(): void;
}

export const isLive = (l: Loop) => !l.outcome;

export const useLoops = create<{ loops: Loop[] }>()(() => ({ loops: [] }));

const update = (id: string, patch: Partial<Loop>) =>
  useLoops.setState((s) => ({ loops: s.loops.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

export function dismissLoop(id: string) {
  useLoops.setState((s) => ({ loops: s.loops.filter((l) => l.id !== id) }));
}

const OUTPUT_TAIL = 4000;

export interface StartLoop {
  box: string;
  session: string;
  location: string;
  prompt: string;
  check: string;
  max: number;
  signal?: AbortSignal;
  onProgress?(p: LoopProgress): void;
}

let next = 0;

// startLoop runs a loop in the background and tracks it; the promise settles
// with its result, for callers (plugins) that want to await it.
export function startLoop(call: BoxCaller, o: StartLoop): { id: string; done: Promise<LoopResult> } {
  const abort = new AbortController();
  o.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const id = `loop-${Date.now().toString(36)}-${next++}`;
  useLoops.setState((s) => ({
    loops: [
      ...s.loops,
      { id, box: o.box, session: o.session, check: o.check, round: 1, max: o.max, phase: o.prompt ? "prompting" : "checking", message: "Starting…", started: Date.now(), cancel: () => abort.abort() },
    ],
  }));
  const onBox = boxHasRuns(o.box);
  const runner = onBox ? loopRun : runLoop;
  const done = runner(call, {
    ...o,
    signal: abort.signal,
    onStarted: (run: { id: string }) => {
      update(id, { runId: run.id });
      scheduleRuns(o.box, 0);
    },
    onProgress: (p) => {
      update(id, { round: p.round, phase: p.phase, message: p.message });
      o.onProgress?.(p);
    },
    onCheck: (c) => update(id, { exitCode: c.exitCode, output: c.output.length > OUTPUT_TAIL ? `…${c.output.slice(-OUTPUT_TAIL)}` : c.output }),
  }).then((res) => {
    update(id, { outcome: res.outcome, message: res.message, round: res.rounds, ended: Date.now() });
    if (onBox) scheduleRuns(o.box, 0);
    return res;
  });
  return { id, done };
}
