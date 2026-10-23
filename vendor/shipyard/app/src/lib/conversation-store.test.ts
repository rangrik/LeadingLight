// node --experimental-strip-types --test src/lib/conversation-store.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { onSpill, useConversations } from "./conversation-store.ts";

import type { TranscriptItem } from "./transcript.ts";

// Items as a box names them: by where their line starts in the record.
const at = (off: number, text = `said at ${off}`) => ({ kind: "text", id: `cl@${off}.1`, text, off }) as TranscriptItem;
const offs = (key: string) => (useConversations.getState().items[key] ?? []).map((it) => (it as { off?: number }).off);
const reset = () => useConversations.setState({ items: {} });

test("a window read afresh keeps what the chat held before it and nothing twice", () => {
  reset();
  const s = useConversations.getState();
  s.merge("cal/a", [at(100), at(200), at(300), at(400)]);
  // The box restarted: its window starts at 300, and has more since.
  s.resync("cal/a", [at(300, "said again"), at(400), at(500)], 300);
  assert.deepEqual(offs("cal/a"), [100, 200, 300, 400, 500]);
  const third = useConversations.getState().items["cal/a"][2];
  assert.equal(third.kind === "text" ? third.text : "", "said again");
});

test("a window past what the chat held is filled in between, in order", () => {
  reset();
  const s = useConversations.getState();
  s.merge("cal/b", [at(100), at(200)]);
  s.resync("cal/b", [at(600), at(700)], 600);
  assert.deepEqual(offs("cal/b"), [100, 200, 600, 700]);
  // The pages read before the window's start, some already held.
  s.fill("cal/b", [at(200), at(300), at(400), at(500)]);
  assert.deepEqual(offs("cal/b"), [100, 200, 300, 400, 500, 600, 700]);
});

test("a rewound turn the window no longer has goes", () => {
  reset();
  const s = useConversations.getState();
  s.merge("cal/c", [at(100), at(200), at(300)]);
  s.resync("cal/c", [at(200), at(350)], 200);
  assert.deepEqual(offs("cal/c"), [100, 200, 350]);
});

test("another conversation (after /clear) starts afresh", () => {
  reset();
  const s = useConversations.getState();
  s.merge("cal/d", [at(100), at(200)]);
  s.resync("cal/d", [at(50)], 50, true);
  assert.deepEqual(offs("cal/d"), [50]);
});

test("items let go past what a chat keeps are handed on, oldest first", () => {
  reset();
  const spilled: number[] = [];
  onSpill((key, items) => {
    if (key === "cal/e") spilled.push(...items.map((it) => (it as { off?: number }).off!));
  });
  const s = useConversations.getState();
  s.merge("cal/e", Array.from({ length: 300 }, (_, i) => at((i + 1) * 10)));
  assert.deepEqual(spilled, []);
  s.merge("cal/e", [at(3010), at(3020)]);
  assert.deepEqual(spilled, [10, 20]);
  const kept = offs("cal/e");
  assert.equal(kept.length, 300);
  assert.equal(kept[0], 30);
  assert.equal(kept[299], 3020);
  onSpill(undefined);
});
