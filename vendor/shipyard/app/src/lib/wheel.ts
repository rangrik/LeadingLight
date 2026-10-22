// The mouse wheel over a terminal pane, sent to tmux as SGR wheel reports
// (what a native terminal sends once tmux turns mouse reporting on).
//
// Each report makes the program redraw: Claude Code its whole full-screen
// view, tmux its copy-mode view. A trackpad flick fires a wheel event every
// few milliseconds, and a report for each one queued dozens of redraws
// (300 KB for one flick) behind each other: on a slower link the screen
// kept scrolling for seconds after the fingers stopped. So reports are
// batched: at most one batch a frame, and at most two in flight, so a new
// batch waits for the redraw of the one before last. Notches that pile up
// meanwhile go in the next batch, so the distance is kept and the screen is
// never more than a redraw behind.
//
// tmux ends each redraw with the end of a synchronized update (ESC [?2026l),
// which says the redraw is all here. Without one (an older tmux), output
// that goes quiet does; and a batch that gets no redraw at all (the top or
// bottom of the view) lets the next one go after a timeout.

export interface WheelClock {
  now(): number;
  // Runs fn on the next animation frame, or after ms; each returns a cancel.
  frame(fn: () => void): () => void;
  later(fn: () => void, ms: number): () => void;
}

export interface WheelOptions {
  // Pixels of wheel delta per report: two or three per mouse notch.
  step: number;
  // The most reports in one batch.
  maxBatch: number;
  // The most reports owed: past this a flick's excess is dropped rather
  // than scrolled long after it ended (a box that stopped answering).
  maxOwed: number;
  // Bytes of output that make a redraw (a cursor blink is a few dozen).
  redraw: number;
  // Output quiet this long after a redraw began means it is done.
  quiet: number;
  // A redraw that never goes quiet (an agent printing as you scroll).
  busy: number;
  // No redraw at all.
  timeout: number;
  // How many batches may be in flight: two keeps a slow link busy without
  // queueing more than one redraw behind the one arriving.
  window: number;
  // A frame: a wheel event this long after the last batch goes at once.
  frame: number;
}

export const WHEEL_DEFAULTS: WheelOptions = { step: 40, maxBatch: 16, maxOwed: 48, redraw: 512, quiet: 16, busy: 150, timeout: 200, window: 2, frame: 16 };

export const browserClock: WheelClock = {
  now: () => performance.now(),
  frame: (fn) => {
    const h = requestAnimationFrame(() => fn());
    return () => cancelAnimationFrame(h);
  },
  later: (fn, ms) => {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};

// A wheel event's delta in pixels, whatever unit it came in.
export function wheelPixels(e: { deltaY: number; deltaMode: number }, pageHeight: number): number {
  return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * pageHeight : e.deltaY;
}

// One SGR wheel report: button 64 is up, 65 down; col and row are 1-based.
export function wheelReport(up: boolean, col: number, row: number): string {
  return `\x1b[<${up ? 64 : 65};${col};${row}M`;
}

const SYNC_END = "\x1b[?2026l";
const SYNC_END_BYTES = Array.from(SYNC_END, (c) => c.charCodeAt(0));

// Whether a chunk of output ends a synchronized update.
export function endsFrame(chunk: string | Uint8Array): boolean {
  if (typeof chunk === "string") return chunk.endsWith(SYNC_END);
  const n = SYNC_END_BYTES.length;
  if (chunk.length < n) return false;
  for (let i = 0; i < n; i++) if (chunk[chunk.length - n + i] !== SYNC_END_BYTES[i]) return false;
  return true;
}

export class WheelBatcher {
  private readonly send: (data: string) => void;
  private readonly clock: WheelClock;
  private readonly o: WheelOptions;
  private pending = 0;
  private col = 1;
  private row = 1;
  // When each batch in flight went, oldest first; and the oldest one's
  // redraw so far.
  private flights: number[] = [];
  private lastSent = -Infinity;
  private bytes = 0;
  private redrawAt = -1;
  private lastOutput = -1;
  private cancel: (() => void) | undefined;
  private disposed = false;

  constructor(send: (data: string) => void, clock: WheelClock = browserClock, options: Partial<WheelOptions> = {}) {
    this.send = send;
    this.clock = clock;
    this.o = { ...WHEEL_DEFAULTS, ...options };
  }

  // A wheel event of px pixels (negative is up) over cell col,row.
  wheel(px: number, col: number, row: number): void {
    if (this.disposed || !px) return;
    // Turning back drops what was still owed the other way.
    if (this.pending && Math.sign(px) !== Math.sign(this.pending)) this.pending = 0;
    const cap = this.o.maxOwed * this.o.step;
    this.pending = Math.max(-cap, Math.min(cap, this.pending + px));
    this.col = col;
    this.row = row;
    // A notch on its own (a mouse wheel) goes at once; a trackpad's stream
    // of events is gathered into one batch per frame.
    if (!this.cancel && this.clock.now() - this.lastSent >= this.o.frame) this.tick();
    else this.arm(0);
  }

  // Output from the session arrived.
  output(chunk: string | Uint8Array): void {
    if (!this.flights.length) return;
    const now = this.clock.now();
    this.bytes += chunk.length;
    this.lastOutput = now;
    if (this.bytes < this.o.redraw) return;
    const began = this.redrawAt < 0;
    if (began) this.redrawAt = now;
    const landed = endsFrame(chunk);
    if (landed) this.land();
    // Notches waiting on the timeout can go sooner now.
    if ((began || landed) && Math.abs(this.pending) >= this.o.step) {
      this.cancel?.();
      this.cancel = undefined;
      this.arm(this.flights.length < this.o.window ? 0 : this.wait(now));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel?.();
    this.cancel = undefined;
  }

  // The oldest batch's redraw is in.
  private land(): void {
    this.flights.shift();
    this.bytes = 0;
    this.redrawAt = -1;
  }

  // How long until the oldest batch in flight counts as landed anyway.
  private wait(now: number): number {
    const o = this.o;
    if (this.redrawAt < 0) return this.flights[0] + o.timeout - now;
    return Math.min(this.lastOutput + o.quiet, this.redrawAt + o.busy) - now;
  }

  // Look again on the next frame, after ms if that is later.
  private arm(ms: number): void {
    if (this.cancel || this.disposed) return;
    const run = () => {
      this.cancel = undefined;
      this.tick();
    };
    this.cancel = ms > 0 ? this.clock.later(() => (this.cancel = this.clock.frame(run)), ms) : this.clock.frame(run);
  }

  private tick(): void {
    const n = Math.min(this.o.maxBatch, Math.trunc(Math.abs(this.pending) / this.o.step));
    if (!n || this.disposed) return;
    const now = this.clock.now();
    while (this.flights.length >= this.o.window) {
      const wait = this.wait(now);
      if (wait > 0) return this.arm(wait);
      // Output gone quiet is every batch's redraw in, not just the oldest's.
      if (this.redrawAt >= 0) this.flights.length = 1;
      this.land();
    }
    const up = this.pending < 0;
    this.send(wheelReport(up, this.col, this.row).repeat(n));
    this.pending += (up ? 1 : -1) * n * this.o.step;
    this.flights.push(now);
    this.lastSent = now;
    // The rest goes on a later frame, once a redraw is in if the window is full.
    if (Math.abs(this.pending) >= this.o.step) this.arm(0);
  }
}
