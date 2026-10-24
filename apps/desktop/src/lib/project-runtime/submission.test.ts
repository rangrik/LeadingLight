import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptMessageSubmission, beginMessageSubmission, getActiveMessageSubmissions, observeMessageSubmissionCanonical, rejectMessageSubmission } from "./submission.ts";

// From Paseo's model.test.ts: the seam between the send's answer and the agent's own record.
test("a sent message stays sending until the record has it", () => {
  const accepted = acceptMessageSubmission(beginMessageSubmission([], { clientMessageId: "c1" }), "c1");
  assert.deepEqual(getActiveMessageSubmissions(accepted).map((s) => s.clientMessageId), ["c1"]);
  assert.deepEqual(observeMessageSubmissionCanonical(accepted, ["c1"]), []);
});

test("a transport error after the agent has it doesn't take it back", () => {
  const seen = observeMessageSubmissionCanonical(beginMessageSubmission([], { clientMessageId: "c1" }), ["c1"]);
  assert.deepEqual(rejectMessageSubmission(seen, "c1"), { outcome: "accepted", submissions: [] });
  assert.equal(rejectMessageSubmission(beginMessageSubmission([], { clientMessageId: "c2" }), "c2").outcome, "rejected");
  assert.throws(() => beginMessageSubmission(beginMessageSubmission([], { clientMessageId: "c3" }), { clientMessageId: "c3" }));
});
