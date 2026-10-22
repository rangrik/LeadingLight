// The soak and terminal tests' instruments, installed in the app's page
// before its own scripts (context.addInitScript), in the top frame only:
//
//   intervals    live setIntervals, each with where it was made (the first
//                frame of its stack outside this file)
//   timeouts     setTimeouts made (a wakeup each), and pending now
//   frames       requestAnimationFrame callbacks run
//   sockets      WebSockets open now and opened in all; EventSources
//   fetches      requests made with fetch (the mock agent's are counted by
//                the app itself: window.__berthCalls, lib/mock.ts)
//   listeners    on window and document, by type, added minus removed
//   hidden       window.__soakHide(true) makes the page hidden, as a
//                minimised or covered window is (document.hidden and
//                visibilitychange), without stopping its timers: what the
//                app does about it is what is measured.
//
// window.__soak.read() returns a snapshot.

export const INSTRUMENT = () => {
  if (window !== window.top) return;
  const w = window;
  const where = () => {
    const lines = (new Error().stack ?? "").split("\n").slice(3);
    const l = lines.find((x) => !/instrument|__soak/.test(x)) ?? lines[0] ?? "";
    return l.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^/]+\//, "").replace(/\?[^:)]*/, "");
  };
  const S = {
    intervals: new Map(),
    timeoutsMade: 0,
    timeoutsPending: new Set(),
    frames: 0,
    framesPending: new Set(),
    wsOpen: 0,
    wsMade: 0,
    esOpen: 0,
    fetches: 0,
    fetchByPath: {},
    listeners: { window: {}, document: {} },
    hidden: false,
  };
  const { setInterval: si, clearInterval: ci, setTimeout: st, clearTimeout: ct, requestAnimationFrame: raf, cancelAnimationFrame: caf } = w;
  w.setInterval = function (fn, ms, ...a) {
    const id = si.call(w, fn, ms, ...a);
    S.intervals.set(id, { ms, at: where() });
    return id;
  };
  w.clearInterval = function (id) {
    S.intervals.delete(id);
    return ci.call(w, id);
  };
  w.setTimeout = function (fn, ms, ...a) {
    S.timeoutsMade++;
    const id = st.call(
      w,
      (...x) => {
        S.timeoutsPending.delete(id);
        return typeof fn === "function" ? fn(...x) : undefined;
      },
      ms,
      ...a,
    );
    S.timeoutsPending.add(id);
    return id;
  };
  w.clearTimeout = function (id) {
    S.timeoutsPending.delete(id);
    return ct.call(w, id);
  };
  w.requestAnimationFrame = function (fn) {
    const id = raf.call(w, (t) => {
      S.framesPending.delete(id);
      S.frames++;
      fn(t);
    });
    S.framesPending.add(id);
    return id;
  };
  w.cancelAnimationFrame = function (id) {
    S.framesPending.delete(id);
    return caf.call(w, id);
  };
  const WS = w.WebSocket;
  w.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      S.wsMade++;
      S.wsOpen++;
      let gone = false;
      this.addEventListener("close", () => {
        if (!gone) S.wsOpen--;
        gone = true;
      });
    }
  };
  if (w.EventSource) {
    const ES = w.EventSource;
    w.EventSource = class extends ES {
      constructor(...a) {
        super(...a);
        S.esOpen++;
        const close = this.close.bind(this);
        this.close = () => {
          S.esOpen--;
          close();
        };
      }
    };
  }
  const f = w.fetch;
  w.fetch = function (input, init) {
    S.fetches++;
    try {
      const u = new URL(typeof input === "string" ? input : (input.url ?? String(input)), location.href);
      // A data: URL (ghostty-web's WASM) is its type, not its half-megabyte body.
      const where = u.protocol === "data:" ? `data:${u.pathname.split(/[;,]/)[0]}` : `${u.host === location.host ? "" : u.host}${u.pathname}`;
      const k = `${init?.method ?? "GET"} ${where}`.slice(0, 160);
      S.fetchByPath[k] = (S.fetchByPath[k] ?? 0) + 1;
    } catch {}
    return f.call(w, input, init);
  };
  const count = (target, name) => {
    const add = target.addEventListener;
    const rm = target.removeEventListener;
    const live = new Map();
    const keyOf = (type, fn, opts) => [type, fn, typeof opts === "boolean" ? opts : !!opts?.capture];
    target.addEventListener = function (type, fn, opts) {
      if (fn) {
        const [t, l, c] = keyOf(type, fn, opts);
        let byFn = live.get(l);
        if (!byFn) live.set(l, (byFn = new Set()));
        const k = `${t}|${c}`;
        if (!byFn.has(k)) {
          byFn.add(k);
          S.listeners[name][t] = (S.listeners[name][t] ?? 0) + 1;
          if (opts && typeof opts === "object" && opts.once) {
            // Gone after it runs once; counted down then.
          }
        }
      }
      return add.call(this, type, fn, opts);
    };
    target.removeEventListener = function (type, fn, opts) {
      if (fn) {
        const [t, l, c] = keyOf(type, fn, opts);
        const byFn = live.get(l);
        const k = `${t}|${c}`;
        if (byFn?.delete(k)) S.listeners[name][t]--;
        if (byFn && !byFn.size) live.delete(l);
      }
      return rm.call(this, type, fn, opts);
    };
  };
  count(w, "window");
  count(document, "document");

  const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  const stateDesc = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return S.hidden || hiddenDesc.get.call(this); } });
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return S.hidden ? "hidden" : stateDesc.get.call(this); } });
  w.__soakHide = (on) => {
    if (S.hidden === on) return;
    S.hidden = on;
    document.dispatchEvent(new Event("visibilitychange"));
    w.dispatchEvent(new Event(on ? "blur" : "focus"));
  };

  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  w.__soak = {
    read() {
      const byWhere = {};
      for (const v of S.intervals.values()) {
        const k = `${v.ms}ms ${v.at}`;
        byWhere[k] = (byWhere[k] ?? 0) + 1;
      }
      return {
        intervals: S.intervals.size,
        intervalsByWhere: byWhere,
        timeoutsMade: S.timeoutsMade,
        timeoutsPending: S.timeoutsPending.size,
        frames: S.frames,
        framesPending: S.framesPending.size,
        wsOpen: S.wsOpen,
        wsMade: S.wsMade,
        esOpen: S.esOpen,
        fetches: S.fetches,
        fetchByPath: { ...S.fetchByPath },
        calls: { ...(w.__berthCalls ?? {}) },
        windowListeners: sum(S.listeners.window),
        documentListeners: sum(S.listeners.document),
        listenersByType: { window: { ...S.listeners.window }, document: { ...S.listeners.document } },
        domNodes: document.getElementsByTagName("*").length,
        iframes: document.getElementsByTagName("iframe").length,
        canvases: document.getElementsByTagName("canvas").length,
      };
    },
  };
};

// A stand-in dev server's page for Browser tabs: the proxy's console script
// when the frame asks for it (as internal/proxy/devtools.go adds it), and
// console noise and a request every few seconds while window.__noise (the
// soak turns it off for its quiet minutes, through the frame).
export const noisyPage = (script, title) => `<!doctype html><html><head>${script ? `<script>${script}</script>` : ""}<title>${title} · acme</title></head>
<body style="font:15px system-ui"><h1>${title}</h1><p>Ceramic mug × 2</p><ul id="log"></ul>
<script>
window.__noise = true;
let n = 0;
console.log("${title} ready", { items: 2, currency: "EUR" });
setInterval(() => {
  if (!window.__noise) return;
  n++;
  console.log("poll", n, { at: Date.now() });
  if (n % 5 === 0) console.warn("slow render", n);
  if (n % 7 === 0) fetch("/api/cart?n=" + n).catch(() => {});
  const li = document.createElement("li");
  li.textContent = "tick " + n;
  const log = document.getElementById("log");
  log.prepend(li);
  while (log.children.length > 20) log.lastChild.remove();
}, 1000);
</script></body></html>`;
