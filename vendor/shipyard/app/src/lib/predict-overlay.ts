import type { TerminalColors } from "@/lib/api";
import { EMPTY_OVERLAY, type Overlay, PredictionEngine, type Screen } from "./predict.ts";
import type { TermHandle, TerminalPrefs } from "./terminal.ts";

// EchoPredictor puts predictive local echo (lib/predict) on a terminal: it
// tells the engine what is typed and what the box draws, and draws the
// engine's guesses on a canvas of its own over the terminal's grid. Nothing
// goes into the emulator, so a wrong guess can't corrupt the real screen;
// taking guesses back is clearing a canvas.
//
// Both renderers work the same way: the overlay sits over ghostty-web's
// canvas or xterm.js's screen element, sized to the grid, and is redrawn
// right after the terminal draws a frame, so a confirmed guess hands over to
// the real character in the same frame (no flicker between the two).
//
// Drawing: guessed characters in the theme's own foreground on its
// background, underlined in the foreground at half strength while the link
// is slow (Mosh's mark for "not confirmed yet"). The theme's colours make it
// read in all of them; nothing moves, so Reduce motion has nothing to stop.
export class EchoPredictor {
  readonly engine: PredictionEngine;
  private readonly term: TermHandle;
  private readonly mount: HTMLElement;
  // Made on the first key typed: a terminal nobody types in has none.
  private canvas: HTMLCanvasElement | undefined;
  private colors: TerminalColors;
  private prefs: TerminalPrefs;
  private active = false;
  private timer = 0;
  private frame = 0;
  private fallback = 0;
  private dirty = false;
  private shown = EMPTY_OVERLAY;
  private disposed = false;

  constructor(term: TermHandle, mount: HTMLElement, colors: TerminalColors, prefs: TerminalPrefs) {
    this.term = term;
    this.colors = colors;
    this.prefs = prefs;
    this.engine = new PredictionEngine(prefs.predict);
    this.mount = mount;
    term.onParsed(() => this.parsed());
    term.onDrawn(() => this.drawn());
  }

  // active: the terminal shows, has a live connection, and is one a person
  // types in. Inactive, every guess is taken back.
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.engine.reset();
      this.paint(EMPTY_OVERLAY);
    }
  }

  // setStyle takes new colours and settings (Predict typing among them).
  setStyle(colors: TerminalColors, prefs: TerminalPrefs) {
    this.colors = colors;
    this.prefs = prefs;
    this.engine.mode = prefs.predict;
    this.update();
  }

  // typed takes keys as they go to the box.
  typed(data: string) {
    if (!this.active || this.disposed) return;
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.setAttribute("aria-hidden", "true");
      c.dataset.predictOverlay = "";
      c.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:20;display:none";
      this.mount.appendChild(c);
      this.canvas = c;
    }
    this.engine.input(data, this.term.screen(), performance.now());
    this.afterChange();
    // The terminal draws the key's frame too (a key wakes it); this is in
    // case it doesn't.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.redraw());
  }

  // reset takes everything back: the screen was cleared to be drawn again
  // (a reattach).
  reset() {
    this.engine.reset();
    this.paint(EMPTY_OVERLAY);
  }

  private parsed() {
    if (!this.active || this.disposed || !this.engine.pending) return;
    this.update(false);
  }

  // update checks the guesses against the screen. now: draw at once (no
  // output involved); else wait for the terminal's next frame, so what the
  // box drew and the guesses it settled show together.
  private update(now = true) {
    if (this.disposed) return;
    this.engine.update(this.active ? this.term.screen() : null, performance.now());
    this.afterChange();
    if (now) this.redraw();
    else {
      this.dirty = true;
      window.clearTimeout(this.fallback);
      this.fallback = window.setTimeout(() => this.dirty && this.redraw(), 120);
    }
  }

  private drawn() {
    if (this.dirty || this.shown !== EMPTY_OVERLAY) this.redraw();
  }

  // afterChange sets a timer for the engine's next deadline: guesses expire
  // without output (a password prompt).
  private afterChange() {
    window.clearTimeout(this.timer);
    const next = this.engine.nextDeadline(performance.now());
    if (next !== undefined) this.timer = window.setTimeout(() => this.update(), Math.max(0, next - performance.now()) + 1);
    if (this.canvas) this.canvas.dataset.rtt = this.engine.rtt === undefined ? "" : String(Math.round(this.engine.rtt));
  }

  private redraw() {
    this.dirty = false;
    if (this.disposed) return;
    const s = this.active ? this.term.screen() : null;
    this.paint(this.engine.overlay(s), s);
  }

  private paint(o: Overlay, s?: Screen | null) {
    const c = this.canvas;
    if (!c) return;
    c.dataset.cells = String(o.cells.length);
    c.dataset.flagged = o.flagged ? "true" : "false";
    const same = o === EMPTY_OVERLAY && this.shown === EMPTY_OVERLAY;
    this.shown = o;
    if (same) return;
    const g = o === EMPTY_OVERLAY || !s ? null : this.term.geometry();
    if (!g) {
      c.style.display = "none";
      return;
    }
    // Over the grid, wherever the renderer put it inside the mount.
    const mount = this.mount.getBoundingClientRect();
    const grid = g.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(grid.width * dpr);
    const h = Math.round(grid.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.style.width = `${grid.width}px`;
    c.style.height = `${grid.height}px`;
    c.style.transform = `translate(${grid.left - mount.left}px, ${grid.top - mount.top}px)`;
    c.style.display = "block";
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, grid.width, grid.height);
    ctx.font = `${this.prefs.fontSize}px ${this.prefs.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    const { cellWidth: cw, cellHeight: ch, baseline } = g;
    const { background, foreground, cursor } = this.colors;
    const cellAt = (x: number, y: number, text: string, fg = foreground, bg = background) => {
      ctx.fillStyle = bg;
      ctx.fillRect(x * cw, y * ch, cw, ch);
      if (text !== " ") {
        ctx.fillStyle = fg;
        ctx.fillText(text, x * cw, y * ch + baseline);
      }
    };
    const covered = new Set(o.cells.map((p) => `${p.x},${p.y}`));
    // The real cursor stays where the box has it: covered by its own cell
    // while the guessed one is elsewhere.
    if (o.cursor && s && s.cursorVisible && s.cursorX < s.cols && !covered.has(`${s.cursorX},${s.cursorY}`)) cellAt(s.cursorX, s.cursorY, s.cell(s.cursorX, s.cursorY));
    for (const p of o.cells) cellAt(p.x, p.y, p.ch);
    if (o.flagged) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = foreground;
      const line = Math.max(1, Math.round(dpr)) / dpr;
      for (const p of o.cells) if (p.ch !== " ") ctx.fillRect(p.x * cw, Math.min(p.y * ch + baseline + 2, (p.y + 1) * ch - line), cw, line);
      ctx.globalAlpha = 1;
    }
    if (o.cursor) {
      const { x, y } = o.cursor;
      const under = o.cells.find((p) => p.x === x && p.y === y)?.ch ?? s?.cell(x, y) ?? " ";
      ctx.fillStyle = cursor;
      if (this.prefs.cursorStyle === "block") cellAt(x, y, under, background, cursor);
      else if (this.prefs.cursorStyle === "bar") ctx.fillRect(x * cw, y * ch, Math.max(2, Math.floor(cw * 0.15)), ch);
      else {
        const t = Math.max(2, Math.floor(ch * 0.15));
        ctx.fillRect(x * cw, (y + 1) * ch - t, cw, t);
      }
    }
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fallback);
    cancelAnimationFrame(this.frame);
    this.canvas?.remove();
  }
}
