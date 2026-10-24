import type { Question } from "./transcript";

// What an agent in a project chat asks (features/agent-interactions.feature): the runtime's
// requests, each named by its agent process and the agent's own id. The person's answer is kept
// with a command id of its own until the request settles, so a reload, a lost reply or a second
// click sends it once. An answer to a request whose agent ended stays as an expired draft and is
// never sent to another request.

export type RequestState = "pending" | "recorded" | "resolved" | "cancelled" | "expired";
export type RuntimeRequest = {
  id: string;
  generation: number;
  kind: "question" | "approval" | "plan";
  blocking: boolean;
  tool?: string;
  tool_use?: string;
  helper?: string;
  input?: unknown;
  questions?: Question[];
  choices?: { key: string; label: string }[];
  state: RequestState;
  command?: string;
  opened: number;
  settled?: number;
};
export type Answer = { answers?: { picks?: string[]; other?: string }[]; choice?: string; message?: string };
export type Draft = { command: string; answer: Answer; questions?: Question[]; expired?: boolean };
// The answer's way to the agent, as its card shows it.
export type Delivery = "pending" | "sending" | "recorded" | "resolved" | "failed" | "elsewhere" | "cancelled" | "expired";
export type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;

const rank: Record<RequestState, number> = { pending: 0, recorded: 1, resolved: 2, cancelled: 2, expired: 2 };

// A later read never takes a request back: one already answered stays answered.
export function mergeRequests(known: RuntimeRequest[], fresh: RuntimeRequest[]): RuntimeRequest[] {
  const out = new Map(known.map((r) => [r.id, r]));
  for (const r of fresh) {
    const k = out.get(r.id);
    if (!k || rank[r.state] >= rank[k.state]) out.set(r.id, r);
  }
  return [...out.values()].sort((a, b) => a.opened - b.opened);
}

export function deliveryOf(r: RuntimeRequest, draft: Draft | undefined, sending: boolean, failed: boolean): Delivery {
  if (r.state === "resolved" || r.state === "cancelled" || r.state === "expired") return r.state;
  if (r.command && r.command !== draft?.command) return "elsewhere";
  if (r.state === "recorded" || r.command) return "recorded";
  return sending ? "sending" : failed ? "failed" : "pending";
}

export type Outcome = { delivery: Delivery; request?: RuntimeRequest; error?: string };

// Sends an answer once. The draft keeps its command until the outcome is known: after a lost
// reply the same command goes again, and the runtime tells its receipt rather than answer twice.
export async function sendAnswer(call: Call, session: string, r: RuntimeRequest, draft: Draft): Promise<Outcome> {
  let res: { status: number; body: unknown };
  try {
    res = await call("POST", `/v1/sessions/${session}/requests/${encodeURIComponent(r.id)}/respond`, { command: draft.command, ...draft.answer });
  } catch (e) {
    // Unknown: kept as sending; reconcile() asks the runtime what became of it.
    return { delivery: "sending", error: e instanceof Error ? e.message : String(e) };
  }
  const body = (res.body ?? {}) as { request?: RuntimeRequest; receipt?: { state?: string; error?: string }; error?: string };
  const req = body.request;
  if (res.status === 200 && body.receipt?.state !== "refused") return { delivery: req ? deliveryOf(req, draft, false, false) : "recorded", request: req };
  if (res.status === 410) return { delivery: "expired", request: req };
  if (res.status === 409 && req) return { delivery: deliveryOf(req, draft, false, false), request: req, error: body.error };
  return { delivery: "failed", request: req, error: body.receipt?.error ?? body.error ?? `The runtime answered ${res.status}` };
}

// After a lost reply or a reload: what the runtime says became of the draft's command.
export async function reconcile(call: Call, session: string, r: RuntimeRequest, draft: Draft): Promise<Outcome> {
  const res = await call("GET", `/v1/sessions/${session}/requests`).catch(() => null);
  const now = res?.status === 200 ? (res.body as RuntimeRequest[]).find((x) => x.id === r.id) : undefined;
  if (!now) return { delivery: res ? "expired" : "sending" };
  // Still pending with no answer of ours taken: the same command again, which can't answer twice.
  if (now.state === "pending" && !now.command) return sendAnswer(call, session, now, draft);
  return { delivery: deliveryOf(now, draft, false, false), request: now };
}

// An expired draft as words for the composer, so nothing typed is lost (after synara's
// restoreUserInputDraft).
export function restoreDraft(draft: Draft): string {
  if (!draft.questions?.length) return draft.answer.message ?? "";
  return draft.questions
    .map((q, i) => {
      const a = draft.answer.answers?.[i];
      const words = [...(a?.picks ?? []), ...(a?.other ? [a.other] : [])].join(", ");
      return words ? `${q.question}\n${words}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
