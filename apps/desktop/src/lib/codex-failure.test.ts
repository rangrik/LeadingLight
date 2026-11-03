import assert from "node:assert/strict";
import { test } from "node:test";
import { codexFailure, codexFailureMessage } from "./codex-failure.ts";

// The failure event and completion are separate: never show another turn's error or a retry.
test("keeps only the current turn's definitive failure as a completion fallback", () => {
  const failure = codexFailure({ turnId: "one", willRetry: false, error: { message: "Usage limit reached" } });
  assert.equal(codexFailureMessage({ id: "one" }, failure), "Usage limit reached");
  assert.equal(codexFailureMessage({ id: "two" }, failure), "Codex couldn't finish");
  assert.equal(codexFailureMessage({ id: "one", error: { message: "Different failure" } }, failure), "Different failure");
  assert.equal(codexFailure({ turnId: "one", willRetry: true, error: { message: "Reconnecting" } }), undefined);
});
