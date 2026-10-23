// node --experimental-strip-types --test src/lib/box-routes.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import type { BoxRoute } from "@berth/plugin";
import { canTurnOff, routeSummary, viaRoute } from "./box-routes.ts";

const routes: BoxRoute[] = [
  { id: "paired", kind: "tailscale", label: "Tailscale", state: "up", latency_ms: 140 },
  { id: "ssh", kind: "ssh", label: "SSH", detail: "alex@devl", state: "up", latency_ms: 24, active: true },
  { id: "direct:192.168.1.20:7444", kind: "direct", label: "Direct", state: "down" },
  { id: "ssh2", kind: "ssh", label: "SSH", state: "off", suggested: true },
];

test("the route in use comes first, and routes that are off aren't named", () => {
  assert.equal(routeSummary({ routes }), "via SSH, 24 ms · Tailscale, 140 ms · Direct, down");
  assert.equal(viaRoute({ routes }), "via SSH");
  assert.equal(routeSummary({}), "");
  assert.equal(viaRoute({}), undefined);
});

test("a box keeps one route on", () => {
  assert.equal(canTurnOff({ routes }, "ssh"), true);
  const one: BoxRoute[] = [{ id: "paired", kind: "tailscale", label: "Tailscale", state: "up", active: true }, { id: "ssh", kind: "ssh", label: "SSH", state: "off" }];
  assert.equal(canTurnOff({ routes: one }, "paired"), false);
});
