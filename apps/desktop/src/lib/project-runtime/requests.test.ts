import assert from "node:assert/strict";
import { test } from "node:test";
import { type Call, mergeRequests, reconcile, restoreDraft, type RuntimeRequest, sendAnswer } from "./requests.ts";

// A runtime that answers as requests.go does: one answer per request, receipts by command.
function runtime(r: RuntimeRequest) {
  const receipts = new Map<string, string>();
  let written = 0;
  const call: Call = async (method, _path, body) => {
    if (method === "GET") return { status: 200, body: [r] };
    const { command } = body as { command: string };
    if (receipts.has(command)) return { status: 200, body: { receipt: { state: "written" }, request: r } };
    if (r.state === "expired") return { status: 410, body: { request: r } };
    if (r.command) return { status: 409, body: { request: r } };
    receipts.set(command, r.id);
    r = { ...r, command, state: "recorded" };
    written++;
    return { status: 200, body: { receipt: { state: "written" }, request: r } };
  };
  return { call, written: () => written, set: (p: Partial<RuntimeRequest>) => (r = { ...r, ...p }) };
}
const asked: RuntimeRequest = { id: "4-r1", generation: 4, kind: "question", blocking: true, state: "pending", opened: 1, questions: [{ question: "Colour?", options: [{ label: "Blue" }] }] };
const draft = { command: "c1", answer: { answers: [{ picks: ["Blue"] }] }, questions: asked.questions };

// The seam: whatever the clicks and the connection do, the agent gets one answer.
test("two sends at once, and a lost reply, answer once", async () => {
  const rt = runtime(asked);
  const [a, b] = await Promise.all([sendAnswer(rt.call, "s", asked, draft), sendAnswer(rt.call, "s", asked, draft)]);
  assert.equal(a.delivery, "recorded");
  assert.equal(b.delivery, "recorded");
  assert.equal(rt.written(), 1);
  // The reply lost after the runtime took it: asked again, it's ours, nothing more is written.
  assert.equal((await reconcile(rt.call, "s", asked, draft)).delivery, "recorded");
  assert.equal(rt.written(), 1);
});

test("lost before the runtime had it, the same command goes again; elsewhere and expired say so", async () => {
  const rt = runtime(asked);
  const down: Call = async () => {
    throw new Error("offline");
  };
  assert.equal((await sendAnswer(down, "s", asked, draft)).delivery, "sending");
  assert.equal((await reconcile(rt.call, "s", asked, draft)).delivery, "recorded");
  assert.equal(rt.written(), 1);
  const other = runtime({ ...asked, command: "theirs", state: "recorded" });
  assert.equal((await sendAnswer(other.call, "s", asked, draft)).delivery, "elsewhere");
  const gone = runtime({ ...asked, state: "expired" });
  assert.equal((await sendAnswer(gone.call, "s", asked, draft)).delivery, "expired");
  assert.equal(restoreDraft(draft), "Colour?\nBlue");
});

test("a later stale read doesn't bring an answered question back", () => {
  const resolved = { ...asked, state: "resolved" as const };
  assert.equal(mergeRequests([resolved], [asked])[0].state, "resolved");
});
