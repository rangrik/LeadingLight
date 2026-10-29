import assert from "node:assert/strict";
import { test } from "node:test";
import { attachVoiceAsset } from "../../../../packages/editor/src/voice-save.ts";

const asset = { url: "asset://localhost/take.m4a", name: "take.m4a", mime: "audio/mp4", size: 42 };
const voice = { type: "voiceRecording", attrs: { recordingId: "take", src: null, transcribed: false } };
// Seam: late audio writes patch their own block without replacing later text or reviving a deleted take.
test("a detached take keeps current text and leaves deleted or replaced recordings alone", () => {
  const text = { type: "paragraph", content: [{ type: "text", text: "Edited after leaving the recorder." }] };
  const doc = { type: "doc", content: [text, voice] };
  const next = attachVoiceAsset(doc, "take", asset)!;
  assert.deepEqual(next.content?.[0], text);
  assert.equal(next.content?.[1].attrs?.src, asset.url);
  assert.equal(next.content?.[1].attrs?.transcribed, false);
  assert.equal(voice.attrs.src, null);
  assert.equal(attachVoiceAsset({ type: "doc", content: [text] }, "take", asset), null);
  assert.equal(attachVoiceAsset({ type: "doc", content: [{ ...voice, attrs: { recordingId: "another" } }] }, "take", asset), null);
  assert.equal(attachVoiceAsset(next, "take", { ...asset, url: "replacement" }), null);
});
