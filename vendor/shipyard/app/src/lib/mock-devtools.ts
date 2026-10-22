import type { AgentDevtools, NetEntry } from "@/lib/devtools-model";

// The mock laptop proxy's request log (GET /v1/proxy/requests): the acme
// shop's checkout-fix worktree's cart page, with a checkout that fails and
// an image that isn't there. The requests happen as the page is first
// asked about, so they count as since it loaded.

type Fixture = Omit<NetEntry, "seq" | "start" | "host"> & { at: number };

const cart: Fixture[] = [
  { at: 0, method: "GET", path: "/cart", status: 200, type: "document", mime: "text/html", ms: 64, size: 8_602 },
  { at: 70, method: "GET", path: "/assets/index-3f2a91.js", status: 200, type: "script", mime: "text/javascript", ms: 31, size: 145_220 },
  { at: 72, method: "GET", path: "/assets/index-9c1d07.css", status: 200, type: "style", mime: "text/css", ms: 12, size: 18_410 },
  { at: 110, method: "GET", path: "/fonts/inter-var.woff2", status: 304, type: "font", ms: 6, size: 0 },
  { at: 140, method: "GET", path: "/api/cart", status: 200, type: "fetch", mime: "application/json", ms: 48, size: 1_204 },
  { at: 150, method: "GET", path: "/images/mug-ceramic.png", status: 404, type: "image", mime: "text/plain", ms: 3, size: 9, body: "Not found" },
  { at: 152, method: "GET", path: "/@vite/hmr", status: 101, type: "websocket", ms: 2, size: 0 },
  { at: 190, method: "GET", path: "/api/recommendations?limit=4", status: 200, type: "fetch", mime: "application/json", ms: 210, size: 2_311 },
  { at: 230, method: "GET", path: "/api/session", status: 0, type: "fetch", ms: 120, size: 0, error: "canceled" },
  { at: 260, method: "POST", path: "/api/checkout", status: 500, type: "fetch", mime: "application/json", ms: 182, size: 61, body: '{"error":"payment provider timed out","code":"PSP_TIMEOUT"}' },
];

const logs = new Map<string, NetEntry[]>();

export function mockDevtoolsCall(method: string, path: string): unknown {
  if (method !== "GET" || !path.startsWith("/v1/proxy/requests?")) return undefined;
  const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
  const host = q.get("host") ?? "";
  const after = Number(q.get("after") ?? 0);
  if (!logs.has(host)) {
    const now = Date.now();
    logs.set(host, host.startsWith("checkout-fix.") ? cart.map(({ at, ...f }, i) => ({ ...f, seq: i + 1, start: now + at, host })) : []);
  }
  const list = logs.get(host)!;
  return { requests: list.filter((n) => n.seq > after), last: list.length };
}

// The agent's own browser on devl, on the same page: what its box keeps
// (GET …/browser/devtools).
export const mockAgentDevtools: AgentDevtools = {
  running: true,
  url: "http://checkout-fix.shop.devl.localhost:1377/cart",
  console: [
    { seq: 1, level: "warning", text: "Image with src /images/mug-ceramic.png has no width or height", count: 1 },
    { seq: 2, level: "error", text: "TypeError: Cannot read properties of undefined (reading 'total')", count: 2 },
  ],
  failures: [
    { seq: 1, text: "404 GET http://checkout-fix.shop.devl.localhost:1377/images/mug-ceramic.png" },
    { seq: 2, text: "500 POST http://checkout-fix.shop.devl.localhost:1377/api/checkout" },
  ],
};
