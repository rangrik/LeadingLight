// OutputGate stands between a terminal's connection and its emulator. While
// the terminal shows, output goes straight through. While it is hidden (its
// tab in the background, another worktree in front, the window minimised)
// output is gathered and handed over in one piece every so often, or as
// soon as a lot has gathered, so a noisy program in a hidden tab costs one
// parse a second instead of one per packet, and nothing is drawn. Showing
// the terminal hands over what is waiting first, so it catches up whole
// before its first frame.
//
// Nothing is dropped: the emulator still reads every byte, in order, so the
// screen and its history are right when it comes back. reset() drops what
// is waiting, since a reset clears the screen and history anyway.

export type Chunk = string | Uint8Array;

export interface GateClock {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

const windowClock: GateClock = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

// How long hidden output waits, and how much may wait (bytes, roughly).
export const HIDDEN_FLUSH_MS = 1000;
export const HIDDEN_MAX_BYTES = 512 * 1024;

export class OutputGate {
  private open = true;
  private waiting: Chunk[] = [];
  private bytes = 0;
  private timer = 0;
  private readonly enc = new TextEncoder();
  private readonly sink: (data: Chunk) => void;
  private readonly clock: GateClock;
  private readonly flushMs: number;
  private readonly maxBytes: number;

  constructor(sink: (data: Chunk) => void, clock: GateClock = windowClock, flushMs = HIDDEN_FLUSH_MS, maxBytes = HIDDEN_MAX_BYTES) {
    this.sink = sink;
    this.clock = clock;
    this.flushMs = flushMs;
    this.maxBytes = maxBytes;
  }

  get pending(): number {
    return this.bytes;
  }

  write(d: Chunk) {
    if (this.open) return this.sink(d);
    this.waiting.push(d);
    this.bytes += d.length;
    if (this.bytes >= this.maxBytes) return this.flush();
    // An infinite wait: only a lot waiting, or showing, hands it over.
    if (!this.timer && Number.isFinite(this.flushMs)) this.timer = this.clock.set(() => this.flush(), this.flushMs);
  }

  setOpen(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    if (open) this.flush();
  }

  flush() {
    if (this.timer) this.clock.clear(this.timer);
    this.timer = 0;
    if (!this.waiting.length) return;
    const parts = this.waiting;
    this.waiting = [];
    this.bytes = 0;
    this.sink(parts.length === 1 ? parts[0] : this.join(parts));
  }

  reset() {
    if (this.timer) this.clock.clear(this.timer);
    this.timer = 0;
    this.waiting = [];
    this.bytes = 0;
  }

  // One piece: text stays text when it all is; otherwise bytes, with text
  // encoded as UTF-8 (what the emulators take).
  private join(parts: Chunk[]): Chunk {
    if (parts.every((p) => typeof p === "string")) return (parts as string[]).join("");
    const bufs = parts.map((p) => (typeof p === "string" ? this.enc.encode(p) : p));
    const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of bufs) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  }
}
