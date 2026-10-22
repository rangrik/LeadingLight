import { ApiError, type BerthEvent, type Session, type Status } from "@/lib/api";
import type { QueueItem } from "@/lib/queue";

// The laptop agent's offline prompt queue, in mock mode (?mock=1): a box
// that is away to start with and prompts waiting for it, a failed one, and
// a way to take any box offline and bring it back (the queue popover's
// Simulate row) so the whole flow can be seen.

type Emit = (e: Omit<BerthEvent, "time">) => void;

interface Ctx {
  status: Status;
  sessions: Record<string, Session[]>;
  emit: Emit;
  delay: <T>(v: T) => Promise<T>;
  send(box: string, session: string, text: string, enter: boolean): Promise<unknown>;
}

let ctx: Ctx | undefined;
let seq = 0;
const items: QueueItem[] = [];
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function initMockQueue(c: Ctx, fresh: boolean) {
  ctx = c;
  if (fresh || items.length) return;
  // old-vps is offline in the fixtures; it had an agent before it went.
  c.sessions["old-vps"] ??= [
    { name: "api-claude", location: "api", dir: "/srv/api", command: "claude", created: ago(400), attached: 0, exited: false, agent: "claude", agent_state: "finished", state_since: ago(40) },
  ];
  const add = (it: Omit<QueueItem, "seq" | "enter" | "wait">) => items.push({ enter: true, wait: true, seq: ++seq, ...it });
  add({ id: "q-smoke", box: "old-vps", session: "api-claude", text: "Once the deploy finishes, run the smoke tests against staging and paste the failures here.", state: "queued", created: ago(26) });
  add({ id: "q-bump", box: "old-vps", session: "api-claude", text: "Then bump the API version in openapi.yaml and regenerate the client.", state: "queued", created: ago(24) });
  // The live demo starts without a failure in its status bar.
  if (!__BERTH_DEMO__) add({
    id: "q-gone",
    box: "gpu",
    session: "evals-judge-claude",
    text: "Re-run the judge on the 50 hardest cases with temperature 0 and compare to yesterday's numbers.",
    state: "failed",
    error: "evals-judge-claude is no longer running on gpu.",
    created: ago(130),
    attempts: 0,
  });
}

const changed = () => {
  const failed = items.filter((i) => i.state === "failed").length;
  ctx?.emit({ type: "queue.changed", data: { queued: items.length - failed, failed } });
};

const failedEvent = (it: QueueItem) => ctx?.emit({ type: "queue.failed", box: it.box, error: it.error, data: { id: it.id, box: it.box, session: it.session, reason: it.error } });

function listed(): QueueItem[] {
  const failed = new Set<string>();
  return items.map((it) => {
    const k = `${it.box}/${it.session}`;
    if (it.state === "failed") {
      failed.add(k);
      return { ...it };
    }
    return { ...it, blocked: failed.has(k) || undefined };
  });
}

const online = (box: string) => ctx?.status.boxes.find((b) => b.name === box)?.state === "online";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One delivery run per box at a time; prompts go oldest first, and a failed
// one holds the rest for its session, as on the agent.
const running = new Set<string>();

async function deliver(box: string) {
  if (!ctx || running.has(box)) return;
  running.add(box);
  try {
    await sleep(900);
    for (;;) {
      if (!online(box)) return;
      const heads = new Map<string, QueueItem>();
      for (const it of items) if (it.box === box && !heads.has(it.session)) heads.set(it.session, it);
      const it = [...heads.values()].find((x) => x.state === "queued" || x.state === "waiting");
      if (!it) return;
      const s = ctx.sessions[box]?.find((x) => x.name === it.session);
      if (!s || s.exited) {
        it.state = "failed";
        it.error = s ? `${it.session} has exited on ${box}.` : `${it.session} is no longer running on ${box}.`;
        changed();
        failedEvent(it);
        continue;
      }
      // Busy, or at a question (typing would answer it): hold it, as the
      // agent does.
      const busy = () => s.agent_state === "running" || s.agent_state === "waiting";
      if (it.wait && busy()) {
        it.state = "waiting";
        changed();
        const until = Date.now() + 6000;
        while (busy() && Date.now() < until && items.includes(it)) await sleep(250);
        if (!items.includes(it)) continue;
      }
      await sendOne(it);
      await sleep(600);
    }
  } finally {
    running.delete(box);
  }
}

async function sendOne(it: QueueItem): Promise<QueueItem> {
  it.state = "sending";
  it.attempts = (it.attempts ?? 0) + 1;
  it.last_attempt = new Date().toISOString();
  changed();
  try {
    await ctx!.send(it.box, it.session, it.text, it.enter);
    items.splice(items.indexOf(it), 1);
    changed();
    ctx!.emit({ type: "queue.delivered", box: it.box, data: { id: it.id, box: it.box, session: it.session, attempts: it.attempts } });
    return { ...it, state: "delivered" };
  } catch (err) {
    it.state = "failed";
    it.error = /no session/.test(String(err)) ? `${it.session} is no longer running on ${it.box}.` : String(err instanceof Error ? err.message : err);
    changed();
    failedEvent(it);
    return { ...it };
  }
}

// queueCall answers /v1/queue the way the agent does.
export function queueCall(method: string, path: string, body?: unknown): Promise<unknown> | undefined {
  if (!ctx || !path.startsWith("/v1/queue")) return undefined;
  const { delay } = ctx;
  if (method === "GET" && path === "/v1/queue") return delay(listed());
  if (method === "POST" && path === "/v1/queue") {
    const r = body as { id?: string; box: string; session: string; text: string; enter?: boolean; wait?: boolean };
    const had = r.id ? items.find((x) => x.id === r.id) : undefined;
    if (had) return delay(had);
    if (!r.text?.trim()) return Promise.reject(new ApiError("nothing to send", 400));
    const it: QueueItem = { id: r.id ?? `q-${Date.now().toString(36)}`, box: r.box, session: r.session, text: r.text, enter: r.enter ?? true, wait: r.wait ?? true, state: "queued", created: new Date().toISOString(), seq: ++seq };
    items.push(it);
    changed();
    if (online(r.box)) void deliver(r.box);
    return delay(it);
  }
  const m = /^\/v1\/queue\/([^/]+)(?:\/(retry|send))?$/.exec(path);
  const it = m ? items.find((x) => x.id === decodeURIComponent(m[1])) : undefined;
  if (m && !it) return Promise.reject(new ApiError("no queued prompt with that id", 404));
  if (!it || !m) return undefined;
  if (it.state === "sending") return Promise.reject(new ApiError("that prompt is being sent right now", 409));
  if (method === "DELETE" && !m[2]) {
    items.splice(items.indexOf(it), 1);
    changed();
    if (online(it.box)) void deliver(it.box);
    return delay(it);
  }
  if ((method === "POST" && m[2] === "retry") || (method === "PATCH" && !m[2])) {
    const ch = (body ?? {}) as { box?: string; session?: string; text?: string };
    const from = it.box;
    Object.assign(it, { box: ch.box ?? it.box, session: ch.session ?? it.session, text: ch.text ?? it.text, state: "queued", error: undefined });
    changed();
    if (online(it.box)) void deliver(it.box);
    if (from !== it.box && online(from)) void deliver(from);
    return delay(it);
  }
  if (method === "POST" && m[2] === "send") {
    if (!online(it.box)) return Promise.reject(new ApiError(`${it.box} is offline; the prompt stays queued until it is back`, 409));
    return sendOne(it).then((r) => {
      void deliver(r.box);
      return r;
    });
  }
  return undefined;
}

// ---- Simulating a box going away -------------------------------------------

export function mockBoxes(): { name: string; online: boolean }[] {
  return ctx?.status.boxes.map((b) => ({ name: b.name, online: b.state === "online" })) ?? [];
}

// mockSetBoxOnline takes a box offline or brings it back, with the events
// the agent would publish; coming back delivers what was queued for it.
export function mockSetBoxOnline(name: string, up: boolean) {
  const b = ctx?.status.boxes.find((x) => x.name === name);
  if (!ctx || !b || (b.state === "online") === up) return;
  b.state = up ? "online" : "offline";
  b.since = new Date().toISOString();
  b.error = up ? undefined : "dial tcp: connect: no route to host";
  b.latency_ms = up ? 40 : undefined;
  ctx.emit({ type: up ? "box.connected" : "box.disconnected", box: name, error: b.error });
  if (up) void deliver(name);
}
