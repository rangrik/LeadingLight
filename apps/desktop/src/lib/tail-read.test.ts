import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprint, nextRead, reader } from "./tail-read.ts";

// The seam: what reaches the model. The same words must never go twice on a page, changed words
// once, and a block finished during a turn only after it, if still unsent.
test("a wording is sent once; one turn at a time", async () => {
  const sent = new Set<string>();
  const turns: string[] = [];
  let end = () => {};
  const read = reader({ sent: (f) => sent.has(f), go: (f) => (sent.add(f), turns.push(f), new Promise<void>((r) => (end = r))) });
  const settle = () => new Promise((r) => setTimeout(r));
  read(fingerprint("Call Sam before Friday."));
  read(fingerprint("  call Sam before  Friday. "));
  read(fingerprint("Ask Sam about the beans."));
  read(fingerprint("Ask Sam about the beans."));
  assert.deepEqual(turns, ["call sam before friday."]);
  end();
  await settle();
  assert.deepEqual(turns, ["call sam before friday.", "ask sam about the beans."]);
  end();
  await settle();
  read(fingerprint("Call Sam before Friday."));
  read(fingerprint("Call Sam before Monday."));
  assert.deepEqual(turns.slice(2), ["call sam before monday."]);
});

// The seam: when a block is read. Enter at its end reads it at once; a full stop waits the short
// time, anything else the long one; an empty line no Enter made reads nothing.
test("Enter reads the block it finished at once; quiet reads the one edited", () => {
  const w = { stop: 10_000, quiet: 20_000 };
  assert.deepEqual(nextRead(3, 4, "", true, w), { block: 3, wait: 0 });
  assert.equal(nextRead(4, 4, "", true, w), null);
  assert.deepEqual(nextRead(4, 4, "Ask Sam about the beans.", false, w), { block: 4, wait: 10_000 });
  assert.deepEqual(nextRead(4, 4, "Ask Sam about the stakes", false, w), { block: 4, wait: 20_000 });
});
