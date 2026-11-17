// The browser space's engine: native pages in the Mac app (src-tauri/src/native_browser.rs), or,
// for QA in the browser build only, a stand-in whose pages are plain placeholders drawn in the DOM.
import { isDesktop } from "~/lib/platform";
import { createStore } from "~/lib/state";

export type PageState = { id: string; url: string; title: string; loading: boolean; progress: number; back: boolean; forward: boolean; failed: string | null };
// id is empty when the app opens the tab itself (a ⌘-click); else the page made it (window.open).
export type Opened = { id: string; opener: string; url: string; front: boolean };
export type Rect = { x: number; y: number; w: number; h: number };
export type Action = "load" | "back" | "forward" | "reload" | "stop" | "zoom";
// What the page script does (lib/page-tools.ts asks for it); refs are read_tab's item numbers.
export type PageOp = { kind: "read" } | { kind: "target"; ref: number; submit?: boolean } | { kind: "click"; ref: number } | { kind: "type"; ref: number; text: string; submit?: boolean } | { kind: "scroll"; down: boolean; ref?: number } | { kind: "mark"; ref: number; text: string } | { kind: "unmark" };
type Events = { state(s: PageState): void; icon(id: string, icon: string): void; opened(o: Opened): void; key(front: boolean): void; focused(): void };

export interface Engine {
  native: boolean;
  open(id: string, url?: string): Promise<void>;
  navigate(id: string, action: Action, url?: string, zoom?: number): Promise<void>;
  show(id: string, rect: Rect, width: number, radius: number): Promise<void>;
  hide(): Promise<void>;
  focus(id: string): Promise<void>;
  close(id: string): Promise<void>;
  freeze(id: string): Promise<string>;
  copiedLink(read: boolean): Promise<string | null>;
  away(): Promise<void>;
  page(id: string, op: PageOp): Promise<unknown>;
  shot(id: string): Promise<string>;
  edge(id: string, on: boolean): Promise<void>;
  listen(on: Events): Promise<() => void>;
}

// The QA flag: Playwright sets it; people using the browser build never see the space.
export const STANDIN_KEY = "ll.browser.standin";
export const standin = (() => {
  try { return localStorage.getItem(STANDIN_KEY) === "1"; } catch { return false; }
})();

// In order, so a hide or a move never reaches a view before the open that makes it.
let queue: Promise<unknown> = Promise.resolve();
function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const next = queue.then(async () => (await import("@tauri-apps/api/core")).invoke<T>(`native_browser_${command}`, args));
  queue = next.catch(() => {});
  return next;
}

const native: Engine = {
  native: true,
  open: (id, url) => call("open", { id, url }),
  navigate: (id, action, url, zoom) => call("navigate", { id, action, url, zoom }),
  show: (id, r, width, radius) => call("show", { id, x: r.x, y: r.y, w: r.w, h: r.h, width, radius }),
  hide: () => call("hide"),
  focus: (id) => call("focus", { id }),
  close: (id) => call("close", { id }),
  // Not queued: a picture can take a moment, and a show after it must not wait.
  freeze: async (id) => (await import("@tauri-apps/api/core")).invoke<string>("native_browser_freeze", { id }),
  copiedLink: async (read) => (await import("@tauri-apps/api/core")).invoke<string | null>("native_browser_copied_link", { read }),
  away: () => call("away"),
  async page(id, op) {
    const answer = JSON.parse(await (await import("@tauri-apps/api/core")).invoke<string>("native_browser_eval", { id, script: `(${PAGE})(${JSON.stringify(op)})` }));
    if (answer?.error) throw new Error(answer.error);
    return answer;
  },
  shot: async (id) => (await import("@tauri-apps/api/core")).invoke<string>("native_browser_shot", { id }),
  edge: (id, on) => call("edge", { id, on }),
  async listen(on) {
    const { listen } = await import("@tauri-apps/api/event");
    const offs = await Promise.all([
      listen<PageState>("native-browser://state", (e) => on.state(e.payload)),
      listen<{ id: string; icon: string }>("native-browser://icon", (e) => on.icon(e.payload.id, e.payload.icon)),
      listen<Opened>("native-browser://opened", (e) => on.opened(e.payload)),
      listen("native-browser://focused", () => on.focused()),
      listen<boolean>("ll:browser-key", (e) => on.key(e.payload)),
    ]);
    return () => offs.forEach((off) => off());
  },
};

// Pages that load at once, with a title from their address; a host ending in .invalid fails.
function makeStandin(): Engine {
  const pages = new Map<string, { list: string[]; at: number }>();
  let events: Events | undefined;
  const title = (url: string) => {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname : decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? u.hostname);
  };
  const emit = (id: string, loading: boolean) => {
    const page = pages.get(id);
    const url = page?.list[page.at] ?? "";
    const failed = !loading && /\.invalid$/.test(url ? new URL(url).hostname : "") ? "A server with the specified hostname could not be found." : null;
    events?.state({ id, url, title: url && !failed ? title(url) : "", loading, progress: loading ? 0.4 : 1, back: !!page && page.at > 0, forward: !!page && page.at < page.list.length - 1, failed });
  };
  const visit = (id: string) => {
    emit(id, true);
    window.setTimeout(() => emit(id, false), 120);
  };
  return {
    native: false,
    async open(id, url) {
      if (!pages.has(id)) pages.set(id, { list: [], at: -1 });
      if (url) await this.navigate(id, "load", url);
    },
    async navigate(id, action, url) {
      const page = pages.get(id);
      if (!page) throw new Error("No native page is open.");
      if (action === "load" && url) { page.list = [...page.list.slice(0, page.at + 1), url]; page.at++; }
      else if (action === "back" && page.at > 0) page.at--;
      else if (action === "forward" && page.at < page.list.length - 1) page.at++;
      else if (action !== "reload") return;
      visit(id);
    },
    show: async (id, rect) => { standinBounds.set(rect); standinShown.set(id); },
    hide: async () => standinShown.set(""),
    focus: async () => {},
    close: async (id) => void pages.delete(id),
    // A clear picture, so the page under it still reads while the app's flow runs as in the Mac app.
    freeze: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    copiedLink: async () => null,
    away: async () => {},
    // A page with an Annual button, an email field and a password field; the presses and typing it
    // took are counted on the page, for QA to see that nothing happened before the person allowed it.
    async page(id, op) {
      const page = pages.get(id);
      const url = page?.list[page.at] ?? "";
      const items = [{ n: 1, kind: "button", label: "Annual" }, { n: 2, kind: "field", label: "Email" }, { n: 3, kind: "field", label: "Password", password: true }, { n: 4, kind: "button", label: "Sign in" }];
      const it = "ref" in op && op.ref ? items[op.ref - 1] : undefined;
      if ("ref" in op && op.kind !== "scroll" && !it) throw new Error("That item is gone from the page. Read the tab again.");
      if (op.kind === "read") return { url, title: url ? title(url) : "", selected: "", text: `A stand-in page at ${url}.`, cut: false, items };
      if (op.kind === "target") return { kind: it!.kind, label: it!.label, password: !!it!.password, risky: it!.label === "Sign in" };
      if (op.kind === "mark" || op.kind === "unmark") return standinMarks.set({ ...standinMarks.get(), [id]: op.kind === "mark" ? `${it!.label}: ${op.text}` : "" }), {};
      if (op.kind === "scroll") return { y: 0, height: 800, view: 800 };
      standinDone.set({ ...standinDone.get(), [id]: (standinDone.get()[id] ?? 0) + 1 });
      return {};
    },
    shot: async () => "",
    edge: async () => {},
    async listen(on) {
      events = on;
      return () => { events = undefined; };
    },
  };
}

export const standinDone = createStore<Record<string, number>>({});
export const standinMarks = createStore<Record<string, string>>({});
// The tab whose page the stand-in shows "live", as the Mac app shows one native view.
export const standinShown = createStore("");
export const standinBounds = createStore<Rect | null>(null);

// The page script, run in the native view's client world: it shares the page's DOM, not its
// scripts. It numbers the links, buttons and fields it reads, and acts on them by number. Never
// reads a password's value, never types into one, and says what signs in, pays or sends.
const PAGE = String.raw`function (op) {
  try {
    var g = window.__llPage || (window.__llPage = { doc: null, refs: [] });
    if (g.doc !== document) { g.doc = document; g.refs = []; }
    var clean = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
    var FIELD = /^(text|search|email|url|tel|number|date|datetime-local|month|week|time|password)$/i;
    var type = function (el) { return (el.getAttribute("type") || "text").toLowerCase(); };
    var kind = function (el) {
      if (el.tagName === "A") return "link";
      if (el.tagName === "SELECT") return "choice";
      if (el.tagName === "TEXTAREA" || el.isContentEditable) return "field";
      if (el.tagName === "INPUT") return type(el) === "hidden" ? "" : type(el) === "checkbox" || type(el) === "radio" ? "checkbox" : FIELD.test(type(el)) ? "field" : "button";
      return "button";
    };
    var password = function (el) { return el.tagName === "INPUT" && type(el) === "password"; };
    // What a person reads on it; a site's access-key hint ("[alt-shift-t]", "[^⌥t]") is not a name.
    var label = function (el) {
      var field = kind(el) === "field" || el.tagName === "SELECT";
      var own = field ? (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("placeholder") : el.innerText || (el.tagName === "INPUT" ? el.value : "");
      var named = el.getAttribute("aria-label") || own || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "";
      return clean(named).replace(/\s*\[(?:\^|⌃|⌥|alt|ctrl|shift|cmd|⌘|option)[^\]]*\]$/i, "").slice(0, 80);
    };
    var RISK = /(sign ?in|log ?in|sign ?up|register|\bpay\b|payment|buy|purchase|place order|checkout|check out|subscribe|\bsend\b|submit|\bpost\b|publish|confirm|delete|transfer|donate|book now)/i;
    var form = function (el) { return el.form || el.closest("form"); };
    var sends = function (f) { return !!f && !!f.querySelector("input[type=password], [autocomplete^=cc-], textarea, input[type=email]"); };
    var risky = function (el, submit) {
      if (RISK.test(label(el)) || /^cc-/.test(el.getAttribute("autocomplete") || "")) return true;
      var f = form(el);
      var submits = submit || (kind(el) === "button" && f && el.type === "submit");
      return !!(submits && sends(f)) || !!(f && f.querySelector("input[type=password]") && kind(el) === "button");
    };
    var shown = function (el) { var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; var s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none"; };
    var at = function (ref) { var el = g.refs[ref - 1]; if (!el || !el.isConnected) throw new Error("That item is gone from the page. Read the tab again."); return el; };
    var r = {};
    if (op.kind === "read") {
      var els = Array.prototype.slice.call(document.querySelectorAll("a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=option], [contenteditable=''], [contenteditable=true]")).filter(function (el) { return kind(el) && shown(el); }).slice(0, 200);
      g.refs = els;
      var text = String(document.body ? document.body.innerText : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
      r = { url: location.href, title: document.title, selected: clean(String(getSelection())).slice(0, 2000), text: text.slice(0, 20000), cut: text.length > 20000, items: els.map(function (el, i) {
        var it = { n: i + 1, kind: kind(el), label: label(el) };
        if (el.tagName === "A") it.href = el.href;
        if (password(el)) it.password = true; else if (kind(el) === "field" && el.value) it.value = clean(el.value).slice(0, 80);
        if (el.disabled) it.disabled = true;
        return it;
      }) };
    } else if (op.kind === "target") {
      var t = at(op.ref);
      r = { kind: kind(t), label: label(t), password: password(t), risky: risky(t, op.submit) };
    } else if (op.kind === "click") {
      var c = at(op.ref);
      c.scrollIntoView({ block: "center" });
      if (c.focus) c.focus();
      c.click();
    } else if (op.kind === "type") {
      var f = at(op.ref);
      if (password(f)) throw new Error("Claude never types into a password field.");
      f.scrollIntoView({ block: "center" });
      f.focus();
      if (f.isContentEditable) { document.execCommand("selectAll"); document.execCommand("insertText", false, op.text); }
      else { f.value = op.text; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); }
      if (op.submit) { var ff = form(f); if (ff && ff.requestSubmit) ff.requestSubmit(); else f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true })); }
    } else if (op.kind === "scroll") {
      if (op.ref) at(op.ref).scrollIntoView({ block: "center" }); else window.scrollBy(0, (op.down ? 1 : -1) * innerHeight * 0.8);
      r = { y: Math.round(scrollY), height: document.documentElement.scrollHeight, view: innerHeight };
    } else if (op.kind === "mark" || op.kind === "unmark") {
      if (g.mark) { g.mark.remove(); g.mark = null; }
      if (op.kind === "mark") {
        var m = at(op.ref);
        m.scrollIntoView({ block: "center" });
        var b = m.getBoundingClientRect();
        var host = document.createElement("div");
        host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
        var root = host.attachShadow({ mode: "closed" });
        var ring = document.createElement("div");
        ring.style.cssText = "position:fixed;border:2px solid -apple-system-blue;border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb,-apple-system-blue 25%,transparent);left:" + (b.left - 4) + "px;top:" + (b.top - 4) + "px;width:" + (b.width + 8) + "px;height:" + (b.height + 8) + "px";
        var tag = document.createElement("div");
        tag.textContent = op.text;
        tag.style.cssText = "position:fixed;background:-apple-system-blue;color:white;font:500 12px/22px -apple-system,system-ui,sans-serif;padding:0 8px;border-radius:6px;white-space:nowrap;left:" + Math.min(b.right + 12, innerWidth - 220) + "px;top:" + (b.right + 232 > innerWidth ? b.bottom + 10 : b.top + b.height / 2 - 11) + "px";
        root.append(ring, tag);
        document.documentElement.appendChild(host);
        g.mark = host;
      }
    }
    return JSON.stringify(r);
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
}`;

// The Mac app's engine, the stand-in under the QA flag, or none (the old streamed pane).
export const engine: Promise<Engine | null> = isDesktop.then((mac) => (mac ? native : standin ? makeStandin() : null));
