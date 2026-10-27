import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import handler from "../api/photos.mjs";

const originalFetch = globalThis.fetch;
const originalKey = process.env.UNSPLASH_ACCESS_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.UNSPLASH_ACCESS_KEY;
  else process.env.UNSPLASH_ACCESS_KEY = originalKey;
});
const request = (query = "mountain") => new Request(`https://service.test/api/photos?query=${query}`);
const select = (body) => new Request("https://service.test/api/photos", { method: "POST", body });
const raw = { urls: { raw: "https://images.unsplash.com/photo-1?ixid=referral", thumb: "https://images.unsplash.com/photo-1?w=200" }, user: { name: "Ann Lee", links: { html: "https://unsplash.com/@ann" } }, links: { download_location: "https://api.unsplash.com/photos/abc/download?ixid=referral" } };

// Seam: only the service authenticates; selections keep Unsplash's exact download attribution.
test("search hides the key, caches results, and reports every signed selection", async () => {
  process.env.UNSPLASH_ACCESS_KEY = "test-only-key";
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ results: [raw] });
  };
  const response = await handler.fetch(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const body = await response.text();
  assert.ok(!body.includes("test-only-key"));
  const [photo] = JSON.parse(body);
  assert.equal(photo.name, "Ann Lee");
  assert.match(photo.url, /ixid=referral/);
  assert.equal(calls[0].options.headers.Authorization, "Client-ID test-only-key");
  assert.equal(new URL(calls[0].url).searchParams.get("orientation"), "landscape");
  for (let i = 0; i < 2; i++) {
    const used = await handler.fetch(select(photo.used));
    assert.equal(used.status, 204);
    assert.equal(used.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, raw.links.download_location);
  assert.equal(calls[1].options.redirect, "error");
});

// Seam: untrusted input must never turn the service into an arbitrary authenticated proxy.
test("rejects invalid searches, forged or expired tokens and foreign download URLs", async () => {
  process.env.UNSPLASH_ACCESS_KEY = "test-only-key";
  globalThis.fetch = () => { assert.fail("Rejected input reached Unsplash"); };
  const token = (url, expires) => {
    const payload = Buffer.from(JSON.stringify({ url, expires })).toString("base64url");
    return `${payload}.${createHmac("sha256", "test-only-key").update(payload).digest("base64url")}`;
  };
  for (const body of ["forged", "https://attacker.test", "x".repeat(4097), token(raw.links.download_location, 1), token("https://attacker.test/photos/abc/download", Date.now() + 1000)]) {
    assert.equal((await handler.fetch(select(body))).status, 400);
  }
  for (const query of ["", "x".repeat(201)]) assert.equal((await handler.fetch(request(query))).status, 400);
  assert.equal((await handler.fetch(new Request("https://service.test/api/photos", { method: "DELETE" }))).status, 405);
});

test("configuration, quota and upstream errors do not expose credentials or get cached", async () => {
  delete process.env.UNSPLASH_ACCESS_KEY;
  assert.equal((await handler.fetch(request())).status, 503);
  process.env.UNSPLASH_ACCESS_KEY = "test-only-key";
  for (const [upstream, expected] of [[401, 503], [403, 429], [429, 429], [500, 503]]) {
    globalThis.fetch = async () => new Response("test-only-key", { status: upstream });
    const response = await handler.fetch(request());
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes("test-only-key"));
  }
  globalThis.fetch = async () => { throw new Error("network"); };
  assert.equal((await handler.fetch(request())).status, 503);
});
