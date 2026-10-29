import assert from "node:assert/strict";
import { test } from "node:test";
import { assetFilename, assetHash, dataAsset, MAX_ASSET_BYTES, mimeFromName, nativeAssetFilename, packAssets, toBase64, unpackAssets, type AssetWriter } from "./sync-assets.ts";
import { alignSyncChange, ownsSyncLibrary, portableHistoryEntry } from "./sync-policy.ts";
import type { HistoryEntry } from "./history-types";
import type { LLObject } from "./store";

const bytes = new TextEncoder().encode("Portable PDF fixture");
const mime = "application/pdf";
const data = `data:${mime};base64,${toBase64(bytes)}`;
const read = async () => ({ bytes, mime });
const browser: AssetWriter = async (asset, body) => `data:${asset.mime};base64,${toBase64(body)}`;
const page = (url: string, revision = "one"): LLObject => ({ id: "page", typeId: "page", title: "Fixture", content: null, properties: { file: { url, name: "fixture.pdf", mime } }, createdAt: 1, updatedAt: 1, revision });

// The wire identity must ignore local paths and include bytes plus MIME across page/catalog media.
test("attachments deduplicate across devices, history and catalog without altering text", async () => {
  const first = { before: page("asset://localhost/Mac/assets/one.pdf"), after: page(data), catalog: { icon: { src: "asset://localhost/iPad/assets/two.pdf", mime } }, text: "asset://localhost/private/notes" };
  const packed = await packAssets(first, read);
  assert.equal(packed.assets.items.length, 1);
  const reference = packed.value.after.properties.file as { url: string };
  assert.match(reference.url, /^ll-asset:sha256:[a-f0-9]{64}$/);
  assert.equal((packed.value.before.properties.file as { url: string }).url, reference.url);
  assert.equal(packed.value.catalog.icon.src, reference.url);
  assert.equal(packed.value.text, first.text);
  assert.equal((first.before.properties.file as { url: string }).url, "asset://localhost/Mac/assets/one.pdf");
  assert.notEqual(await assetHash({ bytes, mime }), await assetHash({ bytes, mime: "text/plain" }));
  assert.notEqual(await assetHash({ bytes, mime }), await assetHash({ bytes: new Uint8Array([1]), mime }));
  assert.equal(mimeFromName("photo.JPEG"), "image/jpeg");
  assert.equal(mimeFromName("note.md"), "text/markdown");
  assert.equal(mimeFromName("recording.m4a"), "audio/mp4");

  const native = await unpackAssets(packed.value, packed.assets, async (asset) => `asset://localhost/current/assets/${assetFilename(asset)}`);
  assert.match((native.after.properties.file as { url: string }).url, /\/sha256-[a-f0-9]{64}\.pdf$/);
  assert.deepEqual((await packAssets(native, read)).value, packed.value);
  const web = await unpackAssets(packed.value, packed.assets, browser);
  assert.equal((web.after.properties.file as { url: string }).url, data);
  assert.deepEqual((await packAssets(web, read)).value, packed.value);
  const legacy = await unpackAssets({ url: data, mime }, undefined, async (asset) => assetFilename(asset));
  assert.match(legacy.url, /^sha256-[a-f0-9]{64}\.pdf$/);
});

// Invalid incoming media must fail before the first filesystem or history write.
test("missing, malformed, corrupted and oversized attachments never reach the writer", async () => {
  const packed = await packAssets({ url: data }, read);
  let writes = 0;
  const writer: AssetWriter = async () => { writes++; return "unexpected"; };
  const asset = packed.assets.items[0];
  for (const bundle of [
    { v: 2, items: [asset] },
    { v: 1, items: [] },
    { v: 1, items: [{ ...asset, size: asset.size + 1 }] },
    { v: 1, items: [{ ...asset, data: toBase64(new Uint8Array(asset.size)) }] },
    { v: 1, items: [{ ...asset, id: "a".repeat(64) }] },
    { v: 1, items: [{ ...asset, size: MAX_ASSET_BYTES + 1 }] },
    { v: 1, items: [asset, asset] },
    { v: 1, items: Array(257).fill(asset) },
  ]) await assert.rejects(unpackAssets(packed.value, bundle, writer));
  for (const url of ["ll-asset:sha256:../fixture.pdf", "ll-asset:unknown", "asset://localhost/other/assets/file.pdf", "file:///private/file", "blob:temporary"]) {
    await assert.rejects(unpackAssets([{ url: packed.value.url }, { url }], packed.assets, writer));
  }
  assert.equal(writes, 0);
  await assert.rejects(packAssets({ url: "asset://localhost/missing.pdf" }, async () => { throw new Error("Attachment missing"); }), /missing/);
  assert.throws(() => dataAsset("data:application/pdf;base64,AB=="), /invalid/);
  assert.throws(() => dataAsset("data:application/pdf;base64,%QQ"), /invalid/);
});

// Native reads reconstruct app-relative paths; encoded traversal and other containers are never read.
test("native asset filenames stay inside the current application assets folder", () => {
  const mac = "/Users/fixture/Library/Application Support/com.leadinglight.app/assets";
  assert.equal(nativeAssetFilename(`asset://localhost/${encodeURIComponent(`${mac}/a file.pdf`)}`, mac), "a file.pdf");
  assert.equal(nativeAssetFilename(`http://asset.localhost${mac}/file.pdf`, mac), "file.pdf");
  const base = "/var/mobile/Containers/Data/Application";
  const ios = `${base}/NEW/Library/Application Support/com.leadinglight.app/assets`;
  assert.equal(nativeAssetFilename(`asset://localhost${base}/OLD/Library/Application%20Support/com.leadinglight.app/assets/file.pdf`, ios, true), "file.pdf");
  for (const url of [
    `asset://localhost${mac}/../outside.pdf`, `asset://localhost${mac}/%2e%2e/outside.pdf`,
    `asset://localhost${mac}/%2fother%2ffile.pdf`, `asset://localhost${mac}/%5coutside.pdf`,
    `asset://localhost${mac}/file.pdf?query=1`, `asset://localhost${mac}/file.pdf#hash`,
    `asset://user:pass@localhost${mac}/file.pdf`, `file://${mac}/file.pdf`,
    "asset://localhost/outside/assets/file.pdf", `asset://localhost${mac}/%zz`,
  ]) assert.throws(() => nativeAssetFilename(url, mac), url);
  assert.throws(() => nativeAssetFilename(`asset://localhost${base}/OLD/Library/Application%20Support/another.app/assets/file.pdf`, ios, true));
  assert.throws(() => nativeAssetFilename(`asset://localhost${base}/OLD/Library/Application%20Support/com.leadinglight.app/assets/file.pdf`, ios));
});

// Equal media must advance revision aliases; otherwise the next genuine edit falsely conflicts.
test("canonical pages align safe revisions while preserving concurrent edit conflicts", async () => {
  const current = page("asset://localhost/Mac/assets/one.pdf", "local");
  const before = page(data, "remote-before"), after = page(data, "remote-after");
  const canonical = (await packAssets({ current, before, after }, read)).value;
  const aligned = alignSyncChange(current, { before, after }, canonical);
  assert.equal(aligned.change.before, current);
  assert.equal(aligned.unchanged, false);
  const advanced = { ...after, properties: current.properties };
  const next = { ...after, title: "Next remote edit", revision: "next" };
  const nextCanonical = (await packAssets({ current: advanced, before: after, after: next }, read)).value;
  assert.equal(alignSyncChange(advanced, { before: after, after: next }, nextCanonical).change.before, advanced);
  assert.equal(alignSyncChange(advanced, { before, after }, (await packAssets({ current: advanced, before, after }, read)).value).unchanged, true);
  const concurrent = { ...current, title: "My offline edit" };
  const result = alignSyncChange(concurrent, { before, after: next }, (await packAssets({ current: concurrent, before, after: next }, read)).value);
  assert.equal(result.change.before, before);
  assert.equal(result.unchanged, false);
});

// A previously saved key for another account must never unlock this local library's uploads.
test("sync requires the signed-in account to own the bound library", () => {
  assert.equal(ownsSyncLibrary("A", "A"), true);
  for (const [owner, bound] of [["B", "A"], ["A", null], [null, "A"], ["", ""]]) assert.equal(ownsSyncLibrary(owner, bound), false);
});

// A persisted baseline must serialize as creation on every retry, not only in its first session.
test("baseline upload retries keep the original page identity", () => {
  const before = page(data), after = { ...before, revision: "baseline:fixture" };
  const entry: HistoryEntry = { id: after.revision, action: after.revision, label: "Existing page", author: { kind: "unknown", name: "Origin unknown" }, at: 1, changes: [{ before, after }] };
  const first = portableHistoryEntry(entry);
  const restarted = portableHistoryEntry(JSON.parse(JSON.stringify(entry)) as HistoryEntry);
  assert.deepEqual(first, restarted);
  assert.equal(restarted.changes[0].before, null);
  assert.equal(restarted.changes[0].after?.id, before.id);
  assert.equal(entry.changes[0].before, before);
  const ordinary = { ...entry, id: "edit:fixture" };
  assert.equal(portableHistoryEntry(ordinary), ordinary);
});
