// node --experimental-strip-types --test src/lib/devtools-model.test.ts (pnpm test)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { appendConsole, appendNetwork, type ConsoleEntry, consoleMessage, errorCount, failed, fromAgent, type NetEntry, parseReport, requestMessage, shortAt, statusText } from "./devtools-model.ts";

// The page's script, as the native webview and the proxy run it.
const SCRIPT = readFileSync(new URL("../../../internal/proxy/devtools.js", import.meta.url), "utf8");

interface FakePage {
  win: Record<string, unknown> & { console: Record<string, (...a: unknown[]) => unknown> };
  run(js: string): unknown;
  fire(type: string, ev: unknown): void;
  tick(): void;
  logged: unknown[][];
  posted: { msg: Record<string, unknown>; origin: string }[];
  address: () => string | undefined;
}

// page runs the script in a window of its own: native (no parent), or a
// frame with a name and a parent origin.
function page(opts: { frame?: { name: string; parent: string } } = {}): FakePage {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const logged: unknown[][] = [];
  const posted: { msg: Record<string, unknown>; origin: string }[] = [];
  const timers: (() => void)[] = [];
  let address: string | undefined;
  const real = Object.fromEntries(["log", "info", "warn", "error", "debug", "trace", "assert"].map((m) => [m, (...a: unknown[]) => void logged.push([m, ...a])]));
  const win: FakePage["win"] = {
    console: real,
    URL,
    name: opts.frame?.name ?? "",
    location: { href: "http://checkout.shop.devl.localhost:1377/cart?__berth_devtools=1", ancestorOrigins: opts.frame ? [opts.frame.parent] : [] },
    history: { state: null, replaceState: (_s: unknown, _t: unknown, u: string) => void (address = u) },
    performance: { timeOrigin: 1000.4 },
    setTimeout: (f: () => void) => timers.push(f),
    addEventListener: (t: string, f: (e: unknown) => void) => void (listeners[t] ??= []).push(f),
  };
  win.window = win;
  win.parent = opts.frame ? { postMessage: (msg: Record<string, unknown>, origin: string) => posted.push({ msg, origin }) } : win;
  vm.createContext(win);
  vm.runInContext(SCRIPT, win);
  return {
    win,
    run: (js) => vm.runInContext(js, win),
    fire: (type, ev) => listeners[type]?.forEach((f) => f(ev)),
    tick: () => timers.splice(0).forEach((f) => f()),
    logged,
    posted,
    address: () => address,
  };
}

const drain = (p: FakePage) => p.run("window.__berthDevtools.drain()") as string;

test("the native page's console comes back in reports, and still reaches the page's console", () => {
  const p = page();
  p.run(`console.log("hello", 42, {cart: [1, 2], a: {b: {c: 1}}}); console.info("%s has %d items%c", "cart", 3.7, "color: red")`);
  p.run(`function boom() { console.error(new TypeError("Cannot read properties of undefined (reading 'total')")); } boom();`);
  p.run(`for (let i = 0; i < 2; i++) console.warn("careful"); const o = {}; o.self = o; console.debug(o); console.assert(1 === 2, "math", "broke")`);
  assert.equal(p.logged.length, 7, "every call reached the page's own console");
  // The flag that asked for the script is off the page's address.
  assert.equal(p.address(), "/cart");

  const r = parseReport(drain(p));
  assert.ok(r);
  assert.equal(r.t0, 1000);
  assert.equal(r.href, "http://checkout.shop.devl.localhost:1377/cart?__berth_devtools=1");
  assert.deepEqual(
    r.entries.map((e) => [e.level, e.text, e.count]),
    [
      ["log", "hello 42 {cart: [1, 2], a: {b: {…}}}", 1],
      ["info", "cart has 3 items", 1],
      ["error", "TypeError: Cannot read properties of undefined (reading 'total')", 1],
      ["warn", "careful", 2],
      ["debug", "{self: [Circular]}", 1],
      ["error", "Assertion failed: math broke", 1],
    ],
  );
  const err = r.entries[2];
  assert.match(err.stack ?? "", /boom/, "the error's own stack");
  assert.doesNotMatch(err.stack ?? "", /__berthHook|^TypeError/);
  assert.match(r.entries[3].stack ?? "", /\S/, "a warning carries where it was logged");
  assert.equal(r.entries[3].stack?.includes("__berthHook"), false);
  assert.equal(r.entries[0].stack, undefined, "a log has no stack");

  // Nothing new: nothing to send.
  assert.equal(drain(p), "");
  p.run(`console.log("again")`);
  const next = parseReport(drain(p));
  assert.equal(next?.doc, r.doc, "the same document");
  assert.deepEqual(next?.entries.map((e) => e.text), ["again"]);
});

test("uncaught errors, rejections and failed resources are errors", () => {
  const p = page();
  drain(p);
  const err = p.run(`(function thrower() { try { null.x } catch (e) { return e } })()`) as Error;
  p.fire("error", { target: p.win, error: err, message: "Uncaught TypeError", filename: "http://shop.localhost/src/cart.tsx", lineno: 42, colno: 17 });
  p.fire("error", { target: p.win, error: null, message: "Script error.", filename: "", lineno: 0, colno: 0 });
  p.fire("unhandledrejection", { reason: p.run(`new Error("payment failed")`) });
  p.fire("unhandledrejection", { reason: { code: 402 } });
  p.fire("error", { target: { tagName: "IMG", src: "http://shop.localhost/logo.png" } });
  const r = parseReport(drain(p));
  assert.deepEqual(
    r?.entries.map((e) => [e.source, e.text]),
    [
      ["uncaught", `Uncaught TypeError: ${err.message}`],
      ["uncaught", "Uncaught Script error."],
      ["rejection", "Uncaught (in promise) Error: payment failed"],
      ["rejection", "Uncaught (in promise) {code: 402}"],
      ["resource", "Failed to load img http://shop.localhost/logo.png"],
    ],
  );
  assert.equal(r?.entries[0].at, "http://shop.localhost/src/cart.tsx:42:17");
  assert.match(r?.entries[0].stack ?? "", /thrower/);
  assert.ok(r?.entries.every((e) => e.level === "error"));
});

test("the page can't take the drain away or make it return something else", () => {
  const p = page();
  p.run(`try { window.__berthDevtools = { drain: () => 42 } } catch (e) {} try { delete window.__berthDevtools } catch (e) {}`);
  assert.equal(typeof drain(p), "string");
  // A second copy of the script (a page that runs it twice) does nothing.
  p.run(SCRIPT);
  p.run(`console.log("once")`);
  assert.equal(p.logged.length, 1);
  assert.deepEqual(parseReport(drain(p))?.entries.map((e) => e.text), ["once"]);
});

test("a frame the app named posts its reports to the app, and only to it", () => {
  const p = page({ frame: { name: "berth-devtools:pane1", parent: "http://localhost:1434" } });
  p.run(`console.error("in a frame")`);
  p.tick();
  assert.equal(p.posted.length, 1);
  const { msg, origin } = p.posted[0];
  assert.equal(origin, "http://localhost:1434");
  assert.equal(msg.berth, "devtools");
  assert.equal(msg.id, "pane1");
  assert.deepEqual(parseReport(msg)?.entries.map((e) => e.text), ["in a frame"]);

  // A frame the app didn't name, or whose parent isn't the app, is left alone.
  for (const frame of [{ name: "", parent: "http://localhost:1434" }, { name: "berth-devtools:pane1", parent: "https://evil.example" }]) {
    const q = page({ frame });
    q.run(`console.error("x")`);
    q.tick();
    assert.equal(q.posted.length, 0);
    assert.equal(q.run("typeof window.__berthDevtools"), "undefined");
    assert.equal(q.address(), undefined);
  }
});

test("a report from the page is checked field by field", () => {
  assert.equal(parseReport("not json"), undefined);
  assert.equal(parseReport({ entries: [] }), undefined);
  assert.equal(parseReport(null), undefined);
  const r = parseReport({ doc: "d1", t0: "soon", href: 5, entries: [null, { level: "fatal", text: "x".repeat(5000), count: -3, stack: 7 }, { level: "warn", text: "w", source: "console", time: 3, count: 2 }], dropped: 4 });
  assert.ok(r);
  assert.equal(r.t0, 0);
  assert.equal(r.href, "");
  assert.equal(r.dropped, 4);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].level, "log");
  assert.equal(r.entries[0].count, 1);
  assert.equal(r.entries[0].text.length, 4001);
  assert.equal(r.entries[0].stack, undefined);
  assert.deepEqual(r.entries[1], { level: "warn", text: "w", source: "console", time: 3, count: 2 });
});

const entry = (text: string, level: ConsoleEntry["level"] = "error"): ConsoleEntry => ({ level, text, source: "console", time: 1, count: 1 });

test("a repeat counts up, and the list keeps the newest", () => {
  const list = appendConsole([entry("a")], [entry("a"), entry("b"), entry("b", "warn")]);
  assert.deepEqual(list.map((e) => [e.text, e.level, e.count]), [["a", "error", 2], ["b", "error", 1], ["b", "warn", 1]]);
  const many = appendConsole([], Array.from({ length: 1200 }, (_, i) => entry(String(i))));
  assert.equal(many.length, 1000);
  assert.equal(many[0].text, "200");
});

const net = (seq: number, start: number, status: number, extra: Partial<NetEntry> = {}): NetEntry => ({ seq, start, method: "GET", host: "checkout.shop.devl.localhost", path: `/${seq}`, status, type: "fetch", ms: 12, size: 300, ...extra });

test("network entries come in order, once, from the page's load on", () => {
  let list = appendNetwork([], [net(2, 200, 200), net(1, 100, 200), net(3, 50, 200)], 90);
  assert.deepEqual(list.map((n) => n.seq), [1, 2]);
  list = appendNetwork(list, [net(2, 200, 200), net(4, 300, 500)], 90);
  assert.deepEqual(list.map((n) => n.seq), [1, 2, 4]);
});

test("the badge counts console errors and failed requests", () => {
  assert.equal(failed(net(1, 0, 500)), true);
  assert.equal(failed(net(1, 0, 404)), true);
  assert.equal(failed(net(1, 0, 304)), false);
  assert.equal(failed(net(1, 0, 0, { error: "devl could not reach port 3000" })), true);
  assert.equal(failed(net(1, 0, 0, { error: "canceled" })), false, "the page gave up on it");
  assert.equal(statusText(net(1, 0, 0, { error: "canceled" })), "canceled");
  assert.equal(statusText(net(1, 0, 0, { error: "boom" })), "failed");
  const c = [entry("a"), { ...entry("b"), count: 3 }, entry("w", "warn")];
  assert.equal(errorCount(c, [net(1, 0, 500), net(2, 0, 200)]), 5);
});

test("what the agent is sent says what happened, where, and on which page", () => {
  const e: ConsoleEntry = { level: "error", text: "Uncaught TypeError: x is undefined", stack: "render@http://shop/src/cart.tsx:42:17\nmount@http://shop/src/main.tsx:3:1", source: "uncaught", at: "http://shop/src/cart.tsx:42:17", time: 1, count: 2 };
  const m = consoleMessage(e, "http://checkout.shop.devl.localhost:1377/cart");
  assert.match(m, /^In my browser, the page http:\/\/checkout\.shop\.devl\.localhost:1377\/cart threw an uncaught error \(2 times\):/);
  assert.match(m, /```\nUncaught TypeError: x is undefined\n {4}at http:\/\/shop\/src\/cart\.tsx:42:17\n {4}render@/);
  assert.match(m, /Please find the cause and fix it\.$/);
  assert.match(consoleMessage(e, "http://p/", "  It happens on checkout.  "), /```\n\nIt happens on checkout\.$/);

  const r = net(7, 0, 500, { method: "POST", path: "/api/checkout?x=1", mime: "application/json", ms: 182, size: 39, body: '{"error":"payment provider timed out"}' });
  const rm = requestMessage(r, "http://checkout.shop.devl.localhost:1377/cart");
  assert.match(rm, /POST http:\/\/checkout\.shop\.devl\.localhost:1377\/api\/checkout\?x=1\n→ 500 · fetch · application\/json · 182 ms · 39 B/);
  assert.match(rm, /The response began:\n```\n\{"error":"payment provider timed out"\}\n```/);
  assert.match(requestMessage(net(1, 0, 0, { error: "devl could not reach port 3000" }), "http://p/"), /→ no answer \(devl could not reach port 3000\)/);
  assert.equal(shortAt("http://shop.localhost:1377/src/cart.tsx?t=123:42:17"), "cart.tsx:42");
});

test("the agent's browser's lines read as the drawer's", () => {
  const d = fromAgent({
    running: true,
    console: [
      { seq: 1, level: "error", text: "cart total is undefined", count: 2 },
      { seq: 2, level: "warning", text: "slow", count: 1 },
    ],
    failures: [
      { seq: 1, text: "500 POST http://checkout.shop.devl.localhost:1377/api/cart?x=1" },
      { seq: 2, text: "net::ERR_CONNECTION_REFUSED GET http://localhost:9999/x" },
    ],
  });
  assert.deepEqual(d.console.map((e) => [e.level, e.count]), [["error", 2], ["warn", 1]]);
  assert.deepEqual(d.network.map((n) => [n.method, n.host, n.path, n.status, n.error]), [
    ["POST", "checkout.shop.devl.localhost:1377", "/api/cart?x=1", 500, undefined],
    ["GET", "localhost:9999", "/x", 0, "net::ERR_CONNECTION_REFUSED"],
  ]);
  assert.equal(errorCount(d.console, d.network), 4);
});
