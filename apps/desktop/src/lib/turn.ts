import { type AskRequest, ask, cancel, type Line, reply } from "~/lib/agent";
import type { Agent } from "~/lib/agents";
import { type Access, aiPrefs, isClaude } from "~/lib/ai-prefs";
import type { AskPage, Quote } from "~/lib/ask";
import { buildPrompt, type NoteText, type Seen, SYSTEM } from "~/lib/ask-prompt";
import { effortFor } from "~/lib/codex";
import { GPT_TOOLS, runTool, serve } from "~/lib/note-tools";
import { type Item, patchThread, type Thread, threadOf } from "~/lib/threads";

// One turn of a thread, with Claude (Claude Code's stream-json) or GPT (Codex's app server):
// their lines become the thread's items, and their requests are answered, page tools by
// lib/note-tools.ts and approvals by the person (answer()).

const CHANGES = /^(mcp__notes__)?(edit_page|insert_text|write_page|create_page)$/;
const PLANNED = "The person now sees your plan, with a button to go ahead. Stop here and wait for them.";
const PLANNING = "Plan mode: change nothing yet. Write the plan, then call ExitPlanMode.";
const GPT_PLAN = "Plan mode: change nothing yet. Read what you need, write a short plan, and stop; the person will say when to go ahead.";
const DECLINED = "The person declined this.";

type Provider = "claude" | "codex";
// asked: when a change began waiting on the person; that wait isn't the agent's work. For GPT:
// the prompt (and one with the note, should its thread be gone), and Codex's thread and turn.
type Turn = {
  pageId: string;
  threadId: string;
  provider: Provider;
  access: Access;
  plan: boolean;
  planned: boolean;
  declined: boolean;
  seen?: Seen;
  asked?: number;
  pending?: (allow: boolean) => Promise<void>;
  gpt?: { prompt: string; fresh: string; freshSeen: Seen; model: string; effort: string; resume?: string; thread?: string; turn?: string };
};
const turns = new Map<string, Turn>();

const items = (t: Turn, f: (list: Item[]) => Item[]) => patchThread(t.pageId, t.threadId, (th) => ({ ...th, items: f([...th.items]) }));
const outputOf = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? "").join("\n") : "");
const lastOf = (list: Item[], kind: Item["kind"]) => list.reduce((at, i, k) => (i.kind === kind ? k : at), -1);
// A thread keeps a session for each, so switching to the other and back continues both.
const session = (th: Thread, p: Provider) => (p === "codex" ? { id: th.codexId, seen: th.codexSeen ?? {} } : { id: th.sessionId, seen: th.seen });

// Mentioned pages are read after the thread is marked busy, so a second send can't slip in.
export async function sendTurn(o: { page: AskPage; threadId: string; question: string; quote: Quote | null; pages: Promise<NoteText[]>; agent?: Agent }) {
  const { page, threadId, question, quote } = o;
  const prefs = aiPrefs();
  const th = threadOf(page.id, threadId);
  if (!th || th.busy) return;
  const id = crypto.randomUUID();
  // A mentioned agent's model wins, and with it its provider.
  const model = o.agent?.model ?? prefs.model;
  const provider: Provider = isClaude(model) ? "claude" : "codex";
  const turn: Turn = { pageId: page.id, threadId, provider, access: prefs.access, plan: prefs.plan, planned: false, declined: false };
  turns.set(id, turn);
  // The answer is about the words quoted with it; a follow-up without a quote is about the
  // thread, so Replace goes away until words are quoted again.
  patchThread(page.id, threadId, (t) => ({
    ...t,
    busy: id,
    started: Date.now(),
    updated: Date.now(),
    quote,
    note: undefined,
    title: t.title || question,
    items: [...t.items, { kind: "user", text: question, ...(quote && { quote: quote.text }) }],
  }), true);
  const note = { id: page.id, title: page.title(), text: page.text() };
  const pages = await o.pages.catch(() => []);
  if (!turns.has(id)) return;
  const s = session(th, provider);
  const input = { note, pages, agent: o.agent?.prompt ?? null, quote: quote?.text ?? null, question };
  const { prompt, seen } = buildPrompt({ seen: s.seen, ...input });
  turn.seen = seen;
  const effort = effortFor(model, prefs.effort);
  if (provider === "codex") {
    const fresh = buildPrompt({ seen: {}, ...input });
    const planned = (p: string) => (prefs.plan ? `${GPT_PLAN}\n\n${p}` : p);
    turn.gpt = { prompt: planned(prompt), fresh: planned(fresh.prompt), freshSeen: fresh.seen, model, effort, resume: s.id };
  }
  const req: AskRequest = { id, prompt, system: SYSTEM, model, effort, access: prefs.plan ? "plan" : prefs.access, resume: s.id, provider };
  await ask(req, (e) => {
    if (!turns.has(id)) return;
    if (e.type === "error") finish(id, "failed", e.message);
    else if (provider === "codex") onCodex(id, e.line);
    else onLine(id, e.line);
  }).catch((err: unknown) => finish(id, "failed", err instanceof Error ? err.message : String(err)));
}

function onLine(id: string, line: Line) {
  const t = turns.get(id);
  // A subagent's own lines stay inside its step.
  if (!t || line.parent_tool_use_id) return;
  if (line.type === "stream_event") items(t, (list) => streamed(list, line.event));
  else if (line.type === "assistant") {
    for (const b of line.message?.content ?? []) if (b.type === "tool_use") items(t, (list) => list.map((i) => (i.kind === "tool" && i.id === b.id ? { ...i, input: b.input ?? {} } : i)));
  } else if (line.type === "user") {
    for (const b of line.message?.content ?? []) {
      if (b.type !== "tool_result") continue;
      const status = b.is_error ? "failed" : "done";
      items(t, (list) => list.map((i) => (i.kind === "tool" && i.id === b.tool_use_id ? { ...i, status: i.status === "declined" ? i.status : status, output: outputOf(b.content) } : i)));
    }
  } else if (line.type === "control_request") void control(id, t, line);
  else if (line.type === "result") finish(id, line.is_error ? "failed" : "done", line.is_error ? String(line.result ?? line.errors?.join("\n") ?? "Claude Code reported an error") : undefined, line);
}

// Thinking, text and the start of each step, as they stream.
function streamed(list: Item[], ev: Line): Item[] {
  const at = list.length - 1;
  const last = list[at];
  if (ev?.type === "content_block_start") {
    const b = ev.content_block;
    if (b?.type === "thinking") list.push({ kind: "thinking", text: "", start: Date.now() });
    // Each text block its own paragraph, so two in a row don't run together.
    else if (b?.type === "text") list.push({ kind: "text", text: "" });
    else if ((b?.type === "tool_use" || b?.type === "server_tool_use") && b.name !== "ExitPlanMode") list.push({ kind: "tool", id: b.id, name: b.name, input: {}, status: "running" });
  } else if (ev?.type === "content_block_delta") {
    const d = ev.delta;
    if (d?.type === "thinking_delta" && last?.kind === "thinking") list[at] = { ...last, text: last.text + d.thinking };
    else if (d?.type === "text_delta") {
      if (last?.kind === "text") list[at] = { ...last, text: last.text + d.text };
      else list.push({ kind: "text", text: d.text });
    }
  } else if (ev?.type === "content_block_stop" && last?.kind === "thinking" && !last.end) list[at] = { ...last, end: Date.now() };
  return list;
}

async function control(id: string, t: Turn, line: Line) {
  const r = line.request ?? {};
  const respond = (response: object) => reply(id, { type: "control_response", response: { subtype: "success", request_id: line.request_id, response } });
  if (r.subtype === "mcp_message") return respond({ mcp_response: await serve(t.pageId, r.message) });
  if (r.subtype !== "can_use_tool") return reply(id, { type: "control_response", response: { subtype: "error", request_id: line.request_id, error: "Not supported here" } });
  if (r.tool_name === "ExitPlanMode") {
    t.planned = true;
    return respond({ behavior: "deny", message: PLANNED });
  }
  if (t.plan && CHANGES.test(r.tool_name)) return respond({ behavior: "deny", message: PLANNING });
  if (threadOf(t.pageId, t.threadId)?.allowed.includes(r.tool_name)) return respond({ behavior: "allow", updatedInput: r.input });
  wait(t, { requestId: line.request_id, tool: r.tool_name, input: r.input ?? {}, toolUseId: r.tool_use_id });
}

function wait(t: Turn, approval: NonNullable<Thread["approval"]>) {
  t.asked = Date.now();
  patchThread(t.pageId, t.threadId, (th) => ({ ...th, approval }));
}

// GPT: the app's own requests are answered in order (initialize, the thread, the turn); Codex's
// requests are page tools, which the app runs, gating changes itself, or else declined.
function onCodex(id: string, line: Line) {
  const t = turns.get(id);
  const g = t?.gpt;
  if (!t || !g) return;
  const send = (method: string, rid: number, params: object) => reply(id, { method, id: rid, params });
  const thread = () =>
    g.resume
      ? send("thread/resume", 1, { threadId: g.resume, approvalPolicy: "never", sandbox: "read-only" })
      : send("thread/start", 1, { model: g.model, approvalPolicy: "never", sandbox: "read-only", developerInstructions: SYSTEM, dynamicTools: GPT_TOOLS });
  const m: string | undefined = line.method;
  const p = line.params ?? {};
  if (!m) {
    if (line.id === 0) return void thread();
    if (line.id === 1) {
      // A thread Codex no longer has: a new one, sent the note again.
      if (line.error && g.resume) {
        Object.assign(g, { resume: undefined, prompt: g.fresh });
        t.seen = g.freshSeen;
        return void thread();
      }
      if (line.error) return finish(id, "failed", line.error.message ?? "Codex couldn't start the thread");
      g.thread = line.result?.thread?.id;
      return void send("turn/start", 2, { threadId: g.thread, input: [{ type: "text", text: g.prompt, text_elements: [] }], model: g.model, effort: g.effort, summary: "auto" });
    }
    if (line.id === 2 && line.error) return finish(id, "failed", line.error.message ?? "Codex couldn't start the turn");
    if (line.id === 2) g.turn = line.result?.turn?.id;
    return;
  }
  if (line.id !== undefined) {
    if (m === "item/tool/call") return void toolCall(id, t, line.id, p.tool, p.arguments ?? {}, p.callId);
    return void reply(id, { id: line.id, error: { code: -32601, message: "Not supported here" } });
  }
  if (m === "item/started" || m === "item/completed") items(t, (list) => codexItem(list, p.item, m === "item/completed"));
  else if (m === "item/agentMessage/delta")
    items(t, (list) => {
      const k = lastOf(list, "text");
      if (k >= 0) list[k] = { kind: "text", text: (list[k] as { text: string }).text + p.delta };
      return list;
    });
  else if (m === "item/reasoning/summaryTextDelta" || m === "item/reasoning/textDelta")
    items(t, (list) => {
      const k = lastOf(list, "thinking");
      const i = list[k];
      if (i?.kind === "thinking") list[k] = { ...i, text: i.text + p.delta };
      return list;
    });
  else if (m === "turn/completed") {
    const status = p.turn?.status;
    t.planned = t.plan && status === "completed";
    const how = status === "completed" ? "done" : status === "interrupted" ? "stopped" : "failed";
    finish(id, how, how === "failed" ? (p.turn?.error?.message ?? "Codex couldn't finish") : undefined, { session_id: g.thread });
  }
}

function codexItem(list: Item[], item: Line, done: boolean): Item[] {
  if (item?.type === "agentMessage") {
    const k = lastOf(list, "text");
    // Text arrives as deltas; the finished message fills in any that didn't.
    if (!done) list.push({ kind: "text", text: "" });
    else if (k >= 0 && !(list[k] as { text: string }).text) list[k] = { kind: "text", text: item.text ?? "" };
  } else if (item?.type === "reasoning") {
    const k = lastOf(list, "thinking");
    const i = list[k];
    if (!done) list.push({ kind: "thinking", text: "", start: Date.now() });
    else if (i?.kind === "thinking") list[k] = { ...i, end: Date.now(), text: i.text || (item.summary ?? []).join("\n") };
  } else if (["dynamicToolCall", "webSearch", "commandExecution", "fileChange", "mcpToolCall"].includes(item?.type ?? "")) {
    const web = item.type === "webSearch";
    const name = item.type === "dynamicToolCall" ? item.tool : web ? "WebSearch" : item.type;
    const input = item.type === "dynamicToolCall" ? (item.arguments ?? {}) : web ? { query: item.query || item.action?.query || "" } : {};
    if (!done) return [...list, { kind: "tool", id: item.id, name, input, status: "running" }];
    const output = web ? (item.results ?? []).map((r: Line) => [r.domain, r.snippet].filter(Boolean).join(": ")).slice(0, 5).join("\n") : outputOf(item.contentItems);
    const status = item.type === "dynamicToolCall" && item.success === false ? "failed" : "done";
    return list.map((i) => (i.kind === "tool" && i.id === item.id ? { ...i, input: web ? input : i.input, status: i.status === "declined" ? i.status : status, output } : i));
  }
  return list;
}

// A page tool GPT asked for: run at once, or once the person allows it.
async function toolCall(id: string, t: Turn, rid: string | number, name: string, input: Record<string, string>, callId: string) {
  const respond = async (allow: boolean, text = DECLINED) => {
    const r = allow ? await runTool(t.pageId, name, input).catch((e: unknown) => ({ content: [{ type: "text" as const, text: String(e) }], isError: true })) : { content: [{ type: "text" as const, text }], isError: true };
    await reply(id, { id: rid, result: { contentItems: r.content.map((c) => ({ type: "inputText", text: c.text })), success: !r.isError } });
  };
  if (t.plan && CHANGES.test(name)) return respond(false, GPT_PLAN);
  // Codex has no classifier for the app's tools, so Approve for me asks too.
  if (!CHANGES.test(name) || t.access === "full" || threadOf(t.pageId, t.threadId)?.allowed.includes(name)) return respond(true);
  t.pending = respond;
  wait(t, { requestId: rid, tool: name, input, toolUseId: callId });
}

// The person's answer to the change waiting. Declining ends the turn, as in Claude Code.
export function answer(pageId: string, threadId: string, choice: "once" | "thread" | "decline") {
  const th = threadOf(pageId, threadId);
  const a = th?.approval;
  const t = th?.busy ? turns.get(th.busy) : undefined;
  if (!th?.busy || !a || !t) return;
  const busy = th.busy;
  if (t.provider === "codex") {
    void t.pending?.(choice !== "decline").then(() => {
      if (choice === "decline" && t.gpt?.thread && t.gpt.turn) void reply(busy, { method: "turn/interrupt", id: 3, params: { threadId: t.gpt.thread, turnId: t.gpt.turn } });
    });
    t.pending = undefined;
  } else {
    const response = choice === "decline" ? { behavior: "deny", message: DECLINED, interrupt: true } : { behavior: "allow", updatedInput: a.input };
    void reply(busy, { type: "control_response", response: { subtype: "success", request_id: a.requestId, response } });
  }
  t.declined ||= choice === "decline";
  // The clock moves on by the wait, so the turn's time is the agent's alone.
  const waited = Date.now() - (t.asked ?? Date.now());
  t.asked = undefined;
  patchThread(pageId, threadId, (x) => ({
    ...x,
    started: (x.started ?? Date.now()) + waited,
    approval: undefined,
    allowed: choice === "thread" ? [...x.allowed, a.tool] : x.allowed,
    items: choice === "decline" ? x.items.map((i) => (i.kind === "tool" && i.id === a.toolUseId ? { ...i, status: "declined" } : i)) : x.items,
  }));
}

export function stopTurn(pageId: string, threadId: string) {
  const busy = threadOf(pageId, threadId)?.busy;
  if (!busy) return;
  void cancel(busy);
  finish(busy, "stopped");
}

function finish(id: string, how: "done" | "stopped" | "failed", error?: string, result?: Line) {
  const t = turns.get(id);
  if (!t) return;
  turns.delete(id);
  const now = Date.now();
  const kept = (th: Thread) => {
    const seen = how === "done" && t.seen;
    return t.provider === "codex"
      ? { codexId: result?.session_id ?? th.codexId, codexSeen: seen || th.codexSeen }
      : { sessionId: result?.session_id ?? th.sessionId, seen: seen || th.seen };
  };
  patchThread(
    t.pageId,
    t.threadId,
    (th) => ({
      ...th,
      ...kept(th),
      busy: undefined,
      started: undefined,
      approval: undefined,
      updated: now,
      items: [
        ...th.items.map((i) => (i.kind === "tool" && i.status === "running" ? { ...i, status: "failed" as const } : i.kind === "thinking" && !i.end ? { ...i, end: now } : i)),
        { kind: "end", ms: Math.max(0, now - (th.started ?? now) - (t.asked ? now - t.asked : 0)), how: t.declined ? "stopped" : how, ...(error && !t.declined && { error }), ...(t.planned && { plan: true }) },
      ],
    }),
    true,
  );
}
