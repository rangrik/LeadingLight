import { createHmac, timingSafeEqual } from "node:crypto";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const sign = (value, key) => createHmac("sha256", key).update(value).digest("base64url");
const downloadURL = (value) => {
  const url = new URL(value);
  if (url.origin !== "https://api.unsplash.com" || url.username || url.password || !/^\/photos\/[\w-]+\/download$/.test(url.pathname)) throw new Error("Invalid photo");
  return url;
};

// Signed selection tokens prevent clients from making arbitrary requests with our key.
function tokenFor(location, key) {
  const payload = Buffer.from(JSON.stringify({ url: downloadURL(location).href, expires: Date.now() + 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

function selectedURL(token, key) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid token");
  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid signature");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!Number.isFinite(data.expires) || data.expires <= Date.now()) throw new Error("Expired token");
  return downloadURL(data.url);
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, OPTIONS" });
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return json({ error: "unavailable" }, 503);
    let url;
    if (request.method === "POST") {
      if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Invalid selection" }, 400);
      try {
        const token = await request.text();
        if (token.length > 4096) return json({ error: "Invalid selection" }, 400);
        url = selectedURL(token, key);
      } catch {
        return json({ error: "Invalid selection" }, 400);
      }
    } else {
      const query = new URL(request.url).searchParams.get("query")?.trim();
      if (!query || query.length > 200) return json({ error: "Invalid search" }, 400);
      url = new URL("https://api.unsplash.com/search/photos");
      url.search = new URLSearchParams({ query, per_page: "24", orientation: "landscape", content_filter: "high" }).toString();
    }
    try {
      const upstream = await fetch(url, {
        headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if ([403, 429].includes(upstream.status)) return json({ error: "limit" }, 429);
      if (!upstream.ok) return json({ error: "unavailable" }, 503);
      if (request.method === "POST") return new Response(null, { status: 204, headers });
      const { results } = await upstream.json();
      const photos = results.map((photo) => {
        const url = new URL(photo.urls.raw);
        url.searchParams.set("w", "2400");
        url.searchParams.set("q", "80");
        return { thumb: photo.urls.thumb, url: url.href, name: photo.user.name, profile: photo.user.links.html, used: tokenFor(photo.links.download_location, key) };
      });
      return json(photos, 200, { "Cache-Control": "public, max-age=0, s-maxage=3600" });
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  },
};
