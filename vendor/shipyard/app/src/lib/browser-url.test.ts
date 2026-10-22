// node --experimental-strip-types --test src/lib/browser-url.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { boxAliases, describeBerthUrl, portUrl, resolveBrowserInput } from "./browser-url.ts";
import { liveServices } from "./worktree-services.ts";

const ref = { box: "devl", location: "shop", worktree: "checkout", path: "/w/shop-checkout" };

test("a worktree's page is the laptop's proxy name for it, never the box's loopback", () => {
  const services = [{ location: "shop", worktree: "checkout", path: ref.path, port: 41020 }];
  assert.equal(portUrl(41020, { ref, services }), "http://checkout.shop.devl.localhost:1377/");
  assert.equal(portUrl(5555, { ref, services }), "http://5555.devl.localhost:1377/");
  assert.equal(portUrl(41020, { ref, services, urlPort: 80 }), "http://checkout.shop.devl.localhost/");
  assert.equal(resolveBrowserInput("41020", { ref, services }), "http://checkout.shop.devl.localhost:1377/");
});

test("the toolbar names a box by its paired name, also from a URL the box wrote with its own", () => {
  const boxes = ["devl", "cal"];
  const aliases = boxAliases([
    { name: "devl", self: "devbox" },
    { name: "cal", self: "Dev-Sean" },
  ]);
  assert.deepEqual(aliases, { devbox: "devl", "dev-sean": "cal" });
  assert.deepEqual(describeBerthUrl("http://checkout.shop.devbox.localhost:1377/x", boxes, aliases), { box: "devl", location: "shop", worktree: "checkout" });
  assert.deepEqual(describeBerthUrl("http://cal.dev-sean.localhost:1377/", boxes, aliases), { box: "cal", location: "cal" });
  assert.deepEqual(describeBerthUrl("http://3000.devl.localhost:1377/", boxes, aliases), { box: "devl", port: 3000 });
  assert.equal(describeBerthUrl("http://a.b.elsewhere.localhost:1377/", boxes, aliases), undefined);
});

test("a box's own name never shadows a paired box, and two boxes can't share one", () => {
  assert.deepEqual(boxAliases([{ name: "devl", self: "cal" }, { name: "cal", self: "cal" }]), {});
  assert.deepEqual(boxAliases([{ name: "a", self: "ubuntu" }, { name: "b", self: "ubuntu" }]), {});
});

test("a listener the box can't name on the worktree's own port is its dev server", () => {
  const services = [
    { location: "shop", worktree: "checkout", path: ref.path, port: 41020 },
    { location: "shop", worktree: "checkout", path: ref.path, port: 41021, process: "/opt/chrome/chrome-headless-shell --remote-debugging-port=0" },
  ];
  const rows = liveServices(services, { ref, services }, 41020);
  assert.equal(rows[0].label, "Dev server");
  assert.equal(rows[0].kind, "dev");
  assert.equal(rows[0].url, "http://checkout.shop.devl.localhost:1377/");
  assert.equal(rows[1].kind, "other");
});
