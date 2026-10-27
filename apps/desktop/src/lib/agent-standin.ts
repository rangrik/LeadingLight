import type { AgentEvent, AskRequest, Line } from "~/lib/agent";

// Claude Code's and Codex's part in a browser build, where neither is: fixed steps sent as the
// same lines each speaks (Claude's stream-json with control requests, Codex's app-server
// JSON-RPC), so the panel, the approvals and the page tools run for real. What it does for which
// question is listed in features/ask.feature.

type Run = { emit: (line: Line) => void; waiting: Map<string, (answer: Line) => void>; asked: (msg: Line) => void; stopped: boolean };
const runs = new Map<string, Run>();
let n = 0;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (text: string) => text.split(/(?<=\s)/);

export function ask(req: AskRequest, onEvent: (e: AgentEvent) => void) {
  const run: Run = { emit: (line) => void (run.stopped || onEvent({ type: "line", line })), waiting: new Map(), asked: () => {}, stopped: false };
  runs.set(req.id, run);
  const turn = req.tail ? tail : play;
  void (req.provider === "codex" ? codex(req, run, turn) : turn(req, run, claude(req, run))).finally(() => runs.delete(req.id));
}

// The app's message: an answer to a request the stand-in made, or (Codex) a request of its own.
export function reply(id: string, message: Line) {
  const run = runs.get(id);
  if (!run) return;
  const key = String(message.response?.request_id ?? message.id);
  const waiting = message.method ? undefined : run.waiting.get(key);
  if (waiting) {
    run.waiting.delete(key);
    waiting(message.response?.response ?? message.result ?? {});
  } else run.asked(message);
}

export function cancel(id: string) {
  const run = runs.get(id);
  if (!run) return;
  run.stopped = true;
  for (const w of run.waiting.values()) w({});
}

const request = (run: Run, key: string, line: Line) => {
  const answer = new Promise<Line>((r) => run.waiting.set(key, r));
  run.emit(line);
  return answer;
};

// What a turn is made of, in either tool's words. tool() is false when the person declined,
// which ends the turn.
type Dialect = {
  stream: (kind: "text" | "thinking", text: string) => Promise<void>;
  tool: (name: string, input: object, change?: boolean) => Promise<boolean>;
  plan: () => Promise<void>;
  // text: the answer as a whole, which Claude Code's result line carries.
  end: (status?: string, text?: string) => void;
};

function claude(req: AskRequest, run: Run): Dialect {
  const ev = (event: Line) => run.emit({ type: "stream_event", event });
  const ask = (r: Line) => {
    const id = `req-${++n}`;
    return request(run, id, { type: "control_request", request_id: id, request: r });
  };
  const start = Date.now();
  return {
    async stream(kind, text) {
      ev({ type: "content_block_start", content_block: { type: kind } });
      for (const w of words(text)) {
        if (run.stopped) return;
        ev({ type: "content_block_delta", delta: kind === "text" ? { type: "text_delta", text: w } : { type: "thinking_delta", thinking: w } });
        await pause(30);
      }
      ev({ type: "content_block_stop" });
    },
    // Asks first when it changes something and the access says to, as Claude Code would.
    async tool(name, input, change = false) {
      const id = `toolu_${++n}`;
      const full = name === "WebSearch" ? name : `mcp__notes__${name}`;
      ev({ type: "content_block_start", content_block: { type: "tool_use", id, name: full } });
      run.emit({ type: "assistant", message: { content: [{ type: "tool_use", id, name: full, input }] } });
      await pause(200);
      const result = (content: string, is_error = false) => run.emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content }] } });
      if (change && (req.access === "ask" || req.access === "plan")) {
        const answer = await ask({ subtype: "can_use_tool", tool_name: full, input, tool_use_id: id });
        if (answer.behavior !== "allow") return (result(answer.message ?? "Declined", true), !answer.interrupt);
      }
      if (name === "WebSearch") return (result("Stand-in web results: nothing real was searched."), true);
      const res = await ask({ subtype: "mcp_message", server_name: "notes", message: { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: input } } });
      result(res.mcp_response?.result?.content?.[0]?.text ?? "", !!res.mcp_response?.result?.isError);
      return true;
    },
    async plan() {
      await ask({ subtype: "can_use_tool", tool_name: "ExitPlanMode", input: {}, tool_use_id: `toolu_${++n}` });
    },
    end(_status, text) {
      run.emit({ type: "result", subtype: "success", is_error: false, duration_ms: Date.now() - start, session_id: req.resume ?? `stand-in-${++n}`, ...(text !== undefined && { result: text }) });
    },
  };
}

// Codex: answers the app's initialize, thread and turn requests, then plays the turn. The app
// runs and gates the page tools itself; web search happens on Codex's side, unasked.
async function codex(req: AskRequest, run: Run, answer: typeof play) {
  const thread = req.resume ?? `stand-in-thread-${++n}`;
  const turn = `stand-in-turn-${++n}`;
  let interrupted = false;
  const started = new Promise<void>((go) => {
    run.asked = (msg) => {
      if (msg.method === "thread/start" || msg.method === "thread/resume") run.emit({ id: msg.id, result: { thread: { id: thread } } });
      else if (msg.method === "turn/start") {
        run.emit({ id: msg.id, result: { turn: { id: turn, status: "inProgress" } } });
        go();
      } else if (msg.method === "turn/interrupt") {
        interrupted = true;
        run.emit({ id: msg.id, result: {} });
      }
    };
  });
  run.emit({ id: 0, result: { userAgent: "stand-in" } });
  await started;
  const note = (method: string, params: Line) => run.emit({ method, params: { threadId: thread, turnId: turn, ...params } });
  const d: Dialect = {
    async stream(kind, text) {
      const id = `${kind}-${++n}`;
      note("item/started", { item: kind === "text" ? { type: "agentMessage", id, text: "", phase: "final_answer" } : { type: "reasoning", id, summary: [], content: [] } });
      for (const w of words(text)) {
        if (run.stopped) return;
        note(kind === "text" ? "item/agentMessage/delta" : "item/reasoning/summaryTextDelta", { itemId: id, delta: w });
        await pause(30);
      }
      note("item/completed", { item: kind === "text" ? { type: "agentMessage", id, text, phase: "final_answer" } : { type: "reasoning", id, summary: [text], content: [] } });
    },
    async tool(name, input) {
      const id = `exec-${++n}`;
      if (name === "WebSearch") {
        note("item/started", { item: { type: "webSearch", id, query: "", action: null, results: null } });
        await pause(200);
        const query = (input as { query: string }).query;
        note("item/completed", { item: { type: "webSearch", id, query, action: { type: "search", query }, results: [{ type: "text_result", domain: "example.org", snippet: "Stand-in result: nothing real was searched." }] } });
        return true;
      }
      note("item/started", { item: { type: "dynamicToolCall", id, namespace: null, tool: name, arguments: input, status: "inProgress", contentItems: null, success: null } });
      const rid = `call-${++n}`;
      const r = await request(run, rid, { id: rid, method: "item/tool/call", params: { threadId: thread, turnId: turn, callId: id, namespace: null, tool: name, arguments: input } });
      note("item/completed", { item: { type: "dynamicToolCall", id, namespace: null, tool: name, arguments: input, status: "completed", contentItems: r.contentItems ?? [], success: r.success ?? false } });
      // A declined change is followed by the app's turn/interrupt.
      await pause(50);
      return !interrupted;
    },
    async plan() {},
    end(status = "completed") {
      note("turn/completed", { turn: { id: turn, status: interrupted ? "interrupted" : status, error: null, durationMs: 0 } });
    },
  };
  await answer(req, run, d);
}

// A tail turn: the prototype's word rules found the candidates and guessed their slots, so the
// stand-in shows the first few as guessed, filing ideas where the page about the person says most
// go; ?tail=garbled answers words, not JSON. In a dev build each turn's message and answer go to
// __tail.log: what would have left the app.
async function tail(req: AskRequest, _run: Run, d: Dialect) {
  let answer = "";
  let trigger = "";
  try {
    const m = JSON.parse(req.prompt) as { trigger: string; about?: string[]; pages: { ref: string; title: string }[]; candidates: { id: string; kind: string; guess?: object }[] };
    trigger = m.trigger;
    const most = m.about?.map((s) => / Most ideas go to (.+)\.$/.exec(` ${s}`)?.[1]).find(Boolean);
    const project = most && m.pages.find((p) => p.title === most)?.ref;
    const show = m.candidates.slice(0, trigger === "beat" ? 3 : 1).map((c) => ({ id: c.id, ...c.guess, ...(c.kind === "ideas" && project && { project }) }));
    answer = new URLSearchParams(location.search).get("tail") === "garbled" ? "Here are a few things worth a look." : JSON.stringify({ show });
  } catch {
    // Not a message tail sends: no answer.
  }
  if (import.meta.env.DEV) (window as unknown as { __tail?: { log?: object[] } }).__tail?.log?.push({ trigger, model: req.model, resume: req.resume ?? null, system: req.system, message: req.prompt, answer });
  await d.stream("text", answer);
  d.end(undefined, answer);
}

async function play(req: AskRequest, run: Run, d: Dialect) {
  const quote = /^> (.*)$/m.exec(req.prompt)?.[1];
  const question = req.prompt.split("\n\n").at(-1) ?? "";
  await d.stream("thinking", "Reading the question and the page.");
  if (!run.stopped) await d.tool("read_page", {});
  if (run.stopped) return;
  if (req.access === "plan") {
    await d.stream("text", `**Plan**\n\n1. ${quote ? `Make “${quote}” bold.` : "Make the change."}\n2. Say what changed.`);
    await d.plan();
  } else if (quote && /\b(change|bold)\b/i.test(question)) {
    if (await d.tool("edit_page", { find: quote, replace: `**${quote}**` }, true)) await d.stream("text", `Made “${quote}” bold.`);
  } else if (/new page/i.test(question)) {
    if (await d.tool("create_page", { title: "Stand-in page", markdown: "Made by the stand-in." }, true)) await d.stream("text", "Made a new page.");
  } else if (/\bsearch\b/i.test(question)) {
    await d.tool("search_pages", { query: question.replace(/^.*?\bsearch\s+(for\s+)?/i, "") });
    await d.stream("text", "Those are the pages that match.");
  } else if (/\bweb\b/i.test(question)) {
    if (await d.tool("WebSearch", { query: quote ?? question }, true)) await d.stream("text", "Nothing real was looked up: this is the stand-in.");
  } else
    await d.stream(
      "text",
      quote
        ? `**About “${quote}”**\n\nA stand-in answer: the browser build has no Claude Code or Codex. In the Mac app, the answer comes through your own sign-in.\n\n- One point about it\n- Another point`
        : "A stand-in answer about the whole page. In the Mac app, the answer comes through your own sign-in.",
    );
  if (!run.stopped) d.end();
}
