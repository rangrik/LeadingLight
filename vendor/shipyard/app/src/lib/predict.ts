// Predictive local echo, after Mosh's (mosh.org) terminaloverlay: on a slow
// link the terminal shows what you type before the box echoes it, and checks
// every guess against what the box then draws. The box always wins: a guess
// it contradicts is taken back with every other guess still waiting, and
// guessing stays off until the box confirms one again.
//
// This module is the engine and nothing else: no DOM, no emulator. It reads
// the emulator's screen through Screen after each piece of output, and says
// what to draw on top of it (overlay()). Guesses are never written into the
// emulator, so the real screen can't be corrupted by a wrong one.
//
// What is guessed: printable characters typed at the cursor, Backspace, and
// Left and Right on the current line. Nothing else: Enter, Tab, control keys,
// Up and Down, Escape sequences and pastes only make the guesses that follow
// "tentative" (below).
//
// Epochs (Mosh's design). Every guess belongs to an epoch. A key whose effect
// can't be guessed (Enter, Tab, Ctrl-R, a mismatch) starts a new epoch, and
// guesses in an epoch the box hasn't confirmed yet are made but not shown.
// When the box draws one of them where it was guessed, its epoch is confirmed
// and the rest of it shows. So after Enter the first key of the next line
// shows when its echo comes back, and the ones after it show at once. A
// password prompt never echoes: its guesses are never confirmed, so none of
// them ever shows, and they expire.
//
// Mosh's server tells the client which keystrokes it has seen ("echo ack"),
// and a guess not on screen by then is wrong. The box here sends no such
// thing, so the engine infers one: the box answers keys in order, so once a
// key's echo is confirmed every key typed before it has been handled too.
// Failing that, a guess is due a little over one measured round trip after
// its key (lateMs), and one not on screen by then is wrong. A guess is wrong
// sooner when the box writes something else over its cell and moves on.
//
// While echoes are in flight the screen shows the box a few keys behind.
// Each cell's guesses are kept until their keys are known to be handled, so
// what shows is always the line as typed (as of the newest confirmed epoch),
// not a mix of the two. The tests replay jittery links (80-2000 ms, changing
// from key to key) to check that.

// Screen is what the engine reads of the emulator: the active screen at the
// bottom of its history (the engine stops guessing while it is scrolled
// back), with 0-based cells.
export interface Screen {
  readonly cols: number;
  readonly rows: number;
  readonly cursorX: number;
  readonly cursorY: number;
  readonly cursorVisible: boolean;
  // The alternate screen: a full-screen program (vim, less, htop).
  readonly alternate: boolean;
  // The text in a cell; " " for an empty one.
  cell(x: number, y: number): string;
}

// adaptive shows guesses only on a slow link (as Mosh does); always shows
// them whenever they're confirmed; never makes none.
export type PredictMode = "adaptive" | "always" | "never";

export interface OverlayCell {
  x: number;
  y: number;
  ch: string;
}

// What to draw over the terminal: guessed cells, where the cursor is
// guessed to be (when it differs from the real one), and whether to mark
// the guesses as unconfirmed (an underline on a slow link).
export interface Overlay {
  cells: OverlayCell[];
  cursor?: { x: number; y: number };
  flagged: boolean;
}

export const EMPTY_OVERLAY: Overlay = { cells: [], flagged: false };

// Keys, as the engine sees what a terminal sends.
export type Key = { kind: "char"; ch: string } | { kind: "backspace" } | { kind: "left" } | { kind: "right" } | { kind: "enter" } | { kind: "other" };

// parseKeys splits what a keystroke (or a paste) sends into keys. Anything
// it can't name is "other", which only makes later guesses tentative.
export function parseKeys(data: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === "\x1b") {
      // A bracketed paste: one "other", whatever it holds.
      if (data.startsWith("\x1b[200~", i)) {
        const end = data.indexOf("\x1b[201~", i + 6);
        i = end < 0 ? data.length : end + 6;
        keys.push({ kind: "other" });
        continue;
      }
      const next = data[i + 1];
      if (next === "[" || next === "O") {
        // CSI (ESC [ params final) or SS3 (ESC O final): arrows come both
        // ways, SS3 in application cursor mode.
        let j = i + 2;
        while (j < data.length && next === "[" && /[0-9;:<=>?\x20-\x2f]/.test(data[j])) j++;
        const final = data[j];
        const params = data.slice(i + 2, j);
        i = Math.min(j + 1, data.length);
        if (params === "" && final === "C") keys.push({ kind: "right" });
        else if (params === "" && final === "D") keys.push({ kind: "left" });
        else keys.push({ kind: "other" });
        continue;
      }
      // Alt-something, or a lone Escape.
      i += next === undefined ? 1 : 2;
      keys.push({ kind: "other" });
      continue;
    }
    if (c === "\x7f" || c === "\b") keys.push({ kind: "backspace" });
    else if (c === "\r") keys.push({ kind: "enter" });
    else {
      const cp = data.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      i += ch.length;
      keys.push(narrow(cp) ? { kind: "char", ch } : { kind: "other" });
      continue;
    }
    i++;
  }
  return keys;
}

// narrow is true for characters that take exactly one cell everywhere:
// printable ASCII, Latin-1, Latin Extended and IPA. Wide (CJK, emoji),
// combining and control characters aren't guessed.
function narrow(cp: number): boolean {
  return (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa1 && cp < 0x2b0 && cp !== 0xad);
}

// Timing, in ms. Mosh's trigger is 20-30 ms of round trip; here guesses show
// above about 60 ms (with hysteresis), and are underlined above 80 ms, as in
// Mosh. A guess still waiting after GLITCH_MS shows them on a fast link
// too, for a while (a hiccup).
export const SHOW_ABOVE_MS = 60;
const HIDE_BELOW_MS = 40;
const FLAG_ABOVE_MS = 80;
const UNFLAG_BELOW_MS = 50;
const GLITCH_MS = 250;
const GLITCH_REPAIR_COUNT = 10;
const GLITCH_REPAIR_MIN_INTERVAL = 150;
const GLITCH_FLAG_MS = 5000;
// A guess is due this long after its key before the first round trip has
// been measured. Nothing shows before a confirmation anyway.
const FIRST_LATE_MS = 3000;
const MIN_LATE_MS = 250;
const MAX_LATE_MS = 6000;
// Past due, a guess whose cell shows what it should (or what an earlier
// key put there) waits this much longer for an acknowledgement: the round
// trip on a relayed link can jump from 100 ms to 2 s, and dropping it early
// would let a late echo show through.
const HARD_MS = 6000;

interface CellGuess {
  row: number;
  col: number;
  ch: string;
  // A cell whose content can't be known (pushed in from off the line). Never
  // drawn; it only waits out its time.
  unknown: boolean;
  // A cell moved over by an insert or a delete in the middle of a line:
  // drawn like any guess, but what is to the right of the cursor is the
  // program's (a prompt on the right, a suggestion), so it is never the
  // reason for a rollback or a confirmation. It goes once its key is known
  // to have reached the box.
  moved: boolean;
  // What the cell held when each guess for it was made, and what the
  // earlier guesses for it were: the box may show any of these on its way.
  originals: string[];
  earlier: string[];
  // The guess this one replaced: what the cell shows while this one's epoch
  // is tentative, and what it goes back to if that epoch is taken back.
  prev?: CellGuess;
  epoch: number;
  at: number;
  due: number;
}

interface CursorGuess {
  row: number;
  col: number;
  // After Enter: the row it was pressed on. Once the real cursor has left
  // that row for another than this one, Enter went somewhere else.
  from?: number;
  // After Enter on the last line: the screen as it was. Once that line
  // shows higher up, where it wasn't before, the screen has scrolled: Enter
  // is done, and the cursor should be here.
  scrolled?: string[];
  // Enter is known to be done: the cursor is here, or this guess is wrong.
  done?: boolean;
  epoch: number;
  // When it was made, and when a key last moved it.
  born: number;
  at: number;
  due: number;
}

type Validity = "pending" | "correct" | "nocredit" | "wrong";

function rowText(s: Screen, y: number): string {
  let t = "";
  for (let x = 0; x < s.cols; x++) t += s.cell(x, y);
  return t.trimEnd();
}

export class PredictionEngine {
  mode: PredictMode;
  private cells: CellGuess[] = [];
  private cursors: CursorGuess[] = [];
  private epoch = 1;
  private confirmed = 0;
  private cols = 0;
  private rows = 0;
  private alternate = false;
  // Round trip, smoothed (RFC 6298), from keystroke to echo.
  private srttMs: number | undefined;
  private rttvarMs = 0;
  private srttTrigger = false;
  private flagging = false;
  private glitch = 0;
  private lastQuick = -Infinity;
  // After guesses are taken back, keys typed before then may still be on
  // their way, and the real cursor is behind where they will land: a guess
  // from it would be in the wrong place, and could even be "confirmed" by
  // one of them landing there. So nothing is guessed until those keys have
  // had time to arrive (each key typed meanwhile extends the wait).
  private lastKeyAt = -Infinity;
  private staleUntil = -Infinity;
  // When the newest key known to have reached the box was typed.
  private ackedAt = -Infinity;
  // Where typing started on the current line: the end of a prompt.
  private lineStart: { row: number; col: number } | undefined;
  // Confirmed guesses, and times guesses that showed were taken back.
  readonly stats = { confirmed: 0, rolledBack: 0 };

  constructor(mode: PredictMode = "adaptive") {
    this.mode = mode;
  }

  // The smoothed round trip from a keystroke to its echo, once measured.
  get rtt(): number | undefined {
    return this.srttMs;
  }

  // How many guesses wait for the box.
  get pending(): number {
    return this.cells.length + this.cursors.length;
  }

  // reset takes back every guess. Later ones are tentative until the box
  // confirms one. since is when the key last known to have reached the box
  // was typed: any typed after it may still be on their way.
  reset(since = -Infinity): void {
    if (this.showing && this.shown().some((x) => x.guess)) this.stats.rolledBack++;
    this.cells = [];
    this.cursors = [];
    this.lineStart = undefined;
    this.becomeTentative();
    this.goStale(since);
  }

  private goStale(since: number) {
    if (this.lastKeyAt > since) this.staleUntil = Math.max(this.staleUntil, this.lastKeyAt + this.lateMs());
  }

  private becomeTentative() {
    this.epoch++;
  }

  private lateMs(): number {
    if (this.srttMs === undefined) return FIRST_LATE_MS;
    return Math.min(MAX_LATE_MS, Math.max(MIN_LATE_MS, this.srttMs + 4 * this.rttvarMs + 100));
  }

  private sample(ms: number) {
    if (this.srttMs === undefined) {
      this.srttMs = ms;
      this.rttvarMs = ms / 2;
      return;
    }
    this.rttvarMs = 0.75 * this.rttvarMs + 0.25 * Math.abs(this.srttMs - ms);
    this.srttMs = 0.875 * this.srttMs + 0.125 * ms;
  }

  // input takes what the person typed, before it is sent, with the screen as
  // it is now (null when it can't be read, or is scrolled back).
  input(data: string, screen: Screen | null, now: number): void {
    if (this.mode === "never") return;
    if (!screen) {
      this.reset();
      return;
    }
    this.update(screen, now);
    for (const key of parseKeys(data)) this.key(key, screen, now);
  }

  private key(key: Key, s: Screen, now: number) {
    this.lastKeyAt = now;
    if (now < this.staleUntil) {
      this.staleUntil = now + this.lateMs();
      this.becomeTentative();
      return;
    }
    // A cursor the program has hidden (a full-screen program drawing its own,
    // as Claude Code does) or one past the last column: nowhere to guess.
    const at = this.cursorAt(s);
    if (at && this.lineStart?.row !== at.row) this.lineStart = { ...at };
    if (key.kind === "other") {
      this.becomeTentative();
      return;
    }
    if (!at) {
      this.becomeTentative();
      return;
    }
    const due = now + this.lateMs();
    switch (key.kind) {
      case "enter":
        this.becomeTentative();
        this.newline(s, now, due);
        return;
      case "left":
        if (!this.inInput(at)) return this.becomeTentative();
        this.moveCursor(at.row, at.col - 1, now, due);
        return;
      case "right":
        // Only over text: at the end of a line Right does nothing in a shell
        // (or takes a whole suggestion, in fish and zsh).
        if (at.col >= s.cols - 1 || (this.view(s, at.row, at.col) === " " && this.view(s, at.row, at.col + 1) === " ")) return this.becomeTentative();
        this.moveCursor(at.row, at.col + 1, now, due);
        return;
      case "backspace":
        this.backspace(at, s, now, due);
        return;
      case "char":
        this.insert(key.ch, at, s, now, due);
        return;
    }
  }

  // inInput is whether the cell before the cursor is part of what was typed
  // on this line: Backspace and Left at the start of a shell's input do
  // nothing, and guessing them would eat into the prompt.
  private inInput(at: { row: number; col: number }): boolean {
    if (at.col === 0) return false;
    return !this.lineStart || this.lineStart.row !== at.row || at.col - 1 >= this.lineStart.col;
  }

  // cursorAt is where the next key lands: the newest guessed cursor, else
  // the real one.
  private cursorAt(s: Screen): { row: number; col: number } | undefined {
    const last = this.cursors.at(-1);
    if (last) return { row: last.row, col: last.col };
    if (!s.cursorVisible || s.cursorX >= s.cols || s.cursorY >= s.rows) return undefined;
    return { row: s.cursorY, col: s.cursorX };
  }

  // moveCursor guesses the cursor at row, col: one guess per epoch, moved
  // along by each key.
  private moveCursor(row: number, col: number, now: number, due: number) {
    const last = this.cursors.at(-1);
    if (last && last.epoch === this.epoch) {
      last.row = row;
      last.col = col;
      last.at = now;
      last.due = due;
    } else this.cursors.push({ row, col, epoch: this.epoch, born: now, at: now, due });
  }

  // view is a cell as it will be once every guess lands: the newest guess
  // for it, else the screen. undefined for a cell that can't be known.
  private view(s: Screen, row: number, col: number): string | undefined {
    if (col < 0 || col >= s.cols) return " ";
    const g = this.find(row, col);
    if (g) return g.unknown ? undefined : g.ch;
    return s.cell(col, row);
  }

  private find(row: number, col: number): CellGuess | undefined {
    for (let i = this.cells.length - 1; i >= 0; i--) {
      const g = this.cells[i];
      if (g.row === row && g.col === col) return g;
    }
    return undefined;
  }

  // guess replaces a cell's guess with a new one, keeping what it held
  // before each guess.
  private guess(s: Screen, row: number, col: number, ch: string | undefined, now: number, due: number, moved = false): CellGuess {
    const old = this.find(row, col);
    const originals = old ? [...old.originals] : [];
    originals.push(s.cell(col, row));
    const earlier = old ? [...old.earlier, ...(old.unknown ? [] : [old.ch])] : [];
    if (old) this.cells.splice(this.cells.indexOf(old), 1);
    const g: CellGuess = { row, col, ch: ch ?? " ", unknown: ch === undefined, moved, originals, earlier, prev: old, epoch: this.epoch, at: now, due };
    this.cells.push(g);
    return g;
  }

  // textEnd is the last column of the text that starts at col, where two
  // blanks in a row end it: what an insert or a delete moves. A prompt on
  // the right (zsh's RPROMPT) is past the gap and stays where it is.
  private textEnd(s: Screen, row: number, col: number): number {
    let end = col - 1;
    for (let x = col; x < s.cols; x++) {
      const here = this.view(s, row, x);
      if (here === " " && this.view(s, row, x + 1) === " ") break;
      end = x;
    }
    return end;
  }

  private insert(ch: string, at: { row: number; col: number }, s: Screen, now: number, due: number) {
    const { row, col } = at;
    // The last column is tricky: a shell puts the character there, an
    // editor may show a wrap mark. Guess, but tentatively.
    if (col + 1 >= s.cols) this.becomeTentative();
    const end = this.textEnd(s, row, col);
    // In a full-screen program, typing into the middle of a line (vim's
    // insert mode, a form) is guessed only once it is confirmed: the
    // program redraws the rest of the line its own way.
    if (s.alternate && end >= col) this.becomeTentative();
    // Text to the right moves along one.
    const moved: (string | undefined)[] = [];
    if (!s.alternate) for (let x = col; x <= end && x + 1 < s.cols; x++) moved.push(this.view(s, row, x));
    this.guess(s, row, col, ch, now, due);
    moved.forEach((c, i) => this.guess(s, row, col + 1 + i, c, now, due, true));
    if (col < s.cols - 1) this.moveCursor(row, col + 1, now, due);
    else {
      this.becomeTentative();
      this.newline(s, now, due);
    }
  }

  private backspace(at: { row: number; col: number }, s: Screen, now: number, due: number) {
    const { row, col } = at;
    if (!this.inInput(at)) return this.becomeTentative();
    const end = this.textEnd(s, row, col);
    if (s.alternate && end >= col) this.becomeTentative();
    // The cell before the cursor takes the one under it, the text further
    // right moves back one, and its last cell empties.
    const after: (string | undefined)[] = [];
    if (!s.alternate) for (let x = col + 1; x <= end; x++) after.push(this.view(s, row, x));
    const first = end >= col ? this.view(s, row, col) : " ";
    this.guess(s, row, col - 1, first, now, due);
    if (end >= col && !s.alternate) {
      after.forEach((c, i) => this.guess(s, row, col + i, c, now, due, true));
      this.guess(s, row, end, " ", now, due, true);
    }
    this.moveCursor(row, col - 1, now, due);
  }

  // newline guesses the cursor at the start of the next line (tentatively:
  // what Enter does depends on the program). On a shell's last line the
  // screen scrolls, and every guess moves up with it; a full-screen program
  // on its last line (less's prompt) doesn't scroll, so nothing is guessed.
  private newline(s: Screen, now: number, due: number) {
    const at = this.cursorAt(s);
    if (!at) return;
    if (at.row >= s.rows - 1 && s.alternate) return;
    if (at.row < s.rows - 1) {
      this.moveCursor(at.row + 1, 0, now, due);
      this.cursors.at(-1)!.from = at.row;
      return;
    }
    // On the last line, Enter scrolls the screen: by how much depends on
    // what the program prints. Guesses already made stay where they are
    // until the scroll shows (see settleScroll).
    const before = Array.from({ length: s.rows }, (_, y) => rowText(s, y));
    let line = "";
    for (let x = 0; x < s.cols; x++) line += this.view(s, at.row, x) ?? "\0";
    before[at.row] = line.trimEnd();
    this.moveCursor(at.row, 0, now, due);
    this.cursors.at(-1)!.scrolled = before;
  }

  // settleScroll, after Enter on the last line: once the lines above it
  // change, Enter is done. If the line Enter was pressed on shows higher up,
  // the screen scrolled by that much, and the guesses made before Enter
  // move up with it; if it can't be found (scrolled off, or cleared), they
  // are dropped. Either way Enter's own guess is then checked.
  private settleScroll(s: Screen) {
    const c = this.cursors.at(-1);
    if (!c?.scrolled) return;
    const before = c.scrolled;
    const row = c.row;
    let changed = false;
    for (let y = 0; y < row && !changed; y++) changed = rowText(s, y) !== before[y];
    if (!changed) return;
    let k = 0;
    for (let y = row - 1; y >= 0 && !k; y--) if (before[y] !== before[row] && rowText(s, y) === before[row]) k = row - y;
    const older = (e: number) => e < c.epoch;
    // A cell guessed again after Enter is another cell: what it held before
    // Enter moved away with the scroll.
    for (const g of this.cells) {
      if (!older(g.epoch)) {
        let x: CellGuess = g;
        while (x.prev && !older(x.prev.epoch)) x = x.prev;
        x.prev = undefined;
      }
    }
    if (k) {
      for (const g of this.cells) if (older(g.epoch)) for (let x: CellGuess | undefined = g; x; x = x.prev) x.row -= k;
      for (const o of this.cursors) if (o !== c && older(o.epoch)) o.row -= k;
      this.cells = this.cells.filter((g) => g.row >= 0);
      this.cursors = this.cursors.filter((o) => o.row >= 0);
    } else {
      this.cells = this.cells.filter((g) => !older(g.epoch));
      this.cursors = this.cursors.filter((o) => o === c || !older(o.epoch));
    }
    c.scrolled = undefined;
    c.done = true;
  }

  // update checks every guess against the screen after output has been
  // parsed, and on a timer (guesses expire without any output, as at a
  // password prompt).
  update(s: Screen | null, now: number): void {
    if (this.mode === "never") {
      if (this.pending) this.reset();
      return;
    }
    if (!s) {
      if (this.pending) this.reset();
      return;
    }
    this.triggers();
    // A resize, or a switch to or from the alternate screen, moves
    // everything: start again.
    if (s.cols !== this.cols || s.rows !== this.rows || s.alternate !== this.alternate) {
      this.cols = s.cols;
      this.rows = s.rows;
      this.alternate = s.alternate;
      this.reset();
      return;
    }

    this.settleScroll(s);
    for (const g of [...this.cells]) {
      if (!this.cells.includes(g)) continue;
      let v = this.validity(g, s, now);
      // The box answers in order: a key's echo can't be on screen before
      // the echo of a key typed earlier. A match that would be is a
      // coincidence (a repeated letter landing where another was guessed).
      if (v === "correct" && !this.inOrder(g, s)) v = "pending";
      if (v === "wrong") {
        if (g.epoch > this.confirmed) {
          this.killEpoch(g.epoch, g.at);
          continue;
        }
        this.reset(g.at);
        return;
      }
      if (v === "correct") {
        if (g.epoch > this.confirmed) this.confirmed = g.epoch;
        this.ackedAt = Math.max(this.ackedAt, g.at);
        this.stats.confirmed++;
        this.sample(now - g.at);
        if (now - g.at < GLITCH_MS && this.glitch > 0 && now - GLITCH_REPAIR_MIN_INTERVAL >= this.lastQuick) {
          this.glitch--;
          this.lastQuick = now;
        }
      }
      if (v === "correct" || v === "nocredit") {
        this.drop(g);
        continue;
      }
      // Still waiting: a long wait shows guesses even on a fast link.
      if (now - g.at >= GLITCH_FLAG_MS) this.glitch = GLITCH_REPAIR_COUNT * 2;
      else if (now - g.at >= GLITCH_MS && this.glitch < GLITCH_REPAIR_COUNT) this.glitch = GLITCH_REPAIR_COUNT;
    }

    // The cursor: the newest guess must be right by its time. Once it is
    // settled, so are the older ones; an older one goes once its keys have
    // reached the box, or it is past due.
    const last = this.cursors.at(-1);
    const v = last && this.cursorValidity(last, s, now);
    if (last && v === "wrong") {
      // Late: its last key reached the box. Elsewhere after Enter: Enter did.
      const since = now >= last.due ? last.at : last.born;
      if (last.epoch > this.confirmed) this.killEpoch(last.epoch, since);
      else {
        this.reset(since);
        return;
      }
    } else if (v === "correct") this.cursors = [];
    else this.cursors = this.cursors.filter((c) => c === last || (c.at > this.ackedAt && this.cursorValidity(c, s, now) === "pending"));

    // The real cursor somewhere no guess expects it (output from elsewhere
    // moved it): take back what shows rather than guess on a stale line.
    if (this.shown().some((x) => x.guess) && !this.expects(s)) this.reset();
  }

  private inOrder(g: CellGuess, s: Screen): boolean {
    return this.cells.every((o) => o === g || o.at >= g.at || o.moved || o.unknown || s.cell(o.col, o.row) === o.ch);
  }

  private triggers() {
    const rtt = this.srttMs ?? 0;
    if (rtt > SHOW_ABOVE_MS) this.srttTrigger = true;
    else if (this.srttTrigger && rtt <= HIDE_BELOW_MS && !this.pending) this.srttTrigger = false;
    if (rtt > FLAG_ABOVE_MS) this.flagging = true;
    else if (rtt <= UNFLAG_BELOW_MS) this.flagging = false;
  }

  private expects(s: Screen): boolean {
    const y = s.cursorY;
    return this.cells.some((g) => g.row === y) || this.cursors.some((c) => c.row === y);
  }

  // validity checks a guess against its cell. The box answers keys in
  // order, so once a later key's echo is confirmed (ackedAt) this key has
  // been handled too, and its cell must be right; that is the "echo ack"
  // Mosh's server sends. Without one, a guess is late at its due time, and
  // HARD_MS after it (hard), settled whatever the cell shows.
  private validity(g: CellGuess, s: Screen, now: number): Validity {
    if (g.row < 0 || g.row >= s.rows || g.col >= s.cols) return "wrong";
    const late = now >= g.due;
    const acked = g.at <= this.ackedAt;
    const hard = now >= g.due + HARD_MS;
    // A moved cell is the program's to draw: it never decides anything.
    if (g.moved) return acked || hard ? "nocredit" : "pending";
    if (g.unknown) return late || acked ? "nocredit" : "pending";
    const cur = s.cell(g.col, g.row);
    if (cur === g.ch) {
      // The cell held this before (it was there already, or typed, deleted
      // and typed again): no telling yet whether this key put it there. It
      // stays, drawn as it is, until the key is known to be handled.
      // A blank is too easy to match by accident to confirm anything.
      if (g.ch === " " || g.originals.includes(g.ch) || g.earlier.includes(g.ch)) return acked || hard ? "nocredit" : "pending";
      return "correct";
    }
    if (acked) return "wrong";
    // The box wrote something else there and moved on.
    const past = s.cursorY > g.row || (s.cursorY === g.row && s.cursorX > g.col);
    if (past && !g.originals.includes(cur) && !g.earlier.includes(cur)) return "wrong";
    // Due, and the cell shows what an earlier key put there: the link is
    // slower than it was, and this key is still on its way.
    if (late) return g.earlier.includes(cur) && !hard ? "pending" : "wrong";
    return "pending";
  }

  // cursorValidity: the real cursor may pass where a guess has it while
  // earlier keys land, so a match settles the guess only once its last key
  // is known to be handled, or long after it was due.
  private cursorValidity(c: CursorGuess, s: Screen, now: number): Validity {
    if (c.row >= s.rows || c.col >= s.cols) return "wrong";
    if (s.cursorX === c.col && s.cursorY === c.row) return c.at <= this.ackedAt || c.done || now >= c.due + HARD_MS ? "correct" : "pending";
    if (c.from !== undefined && s.cursorY !== c.from && s.cursorY !== c.row) return "wrong";
    if (c.done) return "wrong";
    return now >= c.due ? "wrong" : "pending";
  }

  private drop(g: CellGuess) {
    this.cells = this.cells.filter((x) => x !== g);
  }

  // killEpoch takes back the guesses of a tentative epoch (and any after
  // it) that turned out wrong. With no guessed cursor left, the next key is
  // guessed from the real cursor.
  private killEpoch(epoch: number, since: number) {
    this.cells = this.cells.flatMap((g) => {
      let x: CellGuess | undefined = g;
      while (x && x.epoch >= epoch) x = x.prev;
      return x ? [x] : [];
    });
    this.cursors = this.cursors.filter((c) => c.epoch < epoch);
    this.lineStart = undefined;
    this.becomeTentative();
    this.goStale(since);
  }

  // Whether guesses show now (they are made either way, to measure the
  // round trip and confirm epochs).
  get showing(): boolean {
    if (this.mode === "never") return false;
    if (this.mode === "always") return true;
    return this.srttTrigger || this.glitch > 0;
  }

  // shown is what each cell shows: the screen as the newest confirmed epoch
  // leaves it. That is a cell's newest guess from that epoch or before, and
  // for a cell only guessed since, what it held before: keys in a tentative
  // epoch may be wrong, and their echoes landing must not show either.
  private shown(): { row: number; col: number; ch: string; guess: boolean }[] {
    const out: { row: number; col: number; ch: string; guess: boolean }[] = [];
    for (const g of this.cells) {
      let x: CellGuess = g;
      while (x.epoch > this.confirmed && x.prev) x = x.prev;
      if (x.epoch > this.confirmed) {
        if (this.confirmed > 0) out.push({ row: g.row, col: g.col, ch: x.originals[0], guess: false });
      } else if (!x.unknown) out.push({ row: g.row, col: g.col, ch: x.ch, guess: true });
    }
    return out;
  }

  // overlay is what to draw on top of the screen now.
  overlay(s: Screen | null): Overlay {
    if (!s || !this.showing) return EMPTY_OVERLAY;
    const cells = this.shown()
      .filter((g) => g.row >= 0 && g.row < s.rows && g.col < s.cols && g.ch !== s.cell(g.col, g.row))
      .map((g) => ({ x: g.col, y: g.row, ch: g.ch }));
    // The cursor as of the newest confirmed epoch, like the cells.
    const last = [...this.cursors].reverse().find((c) => c.epoch <= this.confirmed);
    const cursor = last && (last.col !== s.cursorX || last.row !== s.cursorY) ? { x: last.col, y: last.row } : undefined;
    if (!cells.length && !cursor) return EMPTY_OVERLAY;
    return { cells, cursor, flagged: this.flagging || this.glitch > GLITCH_REPAIR_COUNT };
  }

  // nextDeadline is when update() should next run without output: the
  // earliest guess due, or a wait about to count as a glitch.
  nextDeadline(now: number): number | undefined {
    let next = Infinity;
    const later = (t: number) => {
      if (t > now) next = Math.min(next, t);
    };
    // Every guess is settled by its hard time, even one taken back to
    // (an earlier guess for a cell, after its epoch was taken back) with
    // that time already past: check again then, or at once.
    const settle = (t: number) => (next = Math.min(next, Math.max(t, now + 1)));
    for (const g of this.cells) {
      later(g.due);
      settle(g.due + HARD_MS);
      if (this.glitch < GLITCH_REPAIR_COUNT) later(g.at + GLITCH_MS);
      if (this.glitch <= GLITCH_REPAIR_COUNT) later(g.at + GLITCH_FLAG_MS);
    }
    for (const c of this.cursors) {
      later(c.due);
      settle(c.due + HARD_MS);
    }
    return next === Infinity ? undefined : next;
  }
}
