// node --experimental-strip-types --test src/lib/predict.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Overlay, PredictionEngine, type PredictMode, type Screen, parseKeys } from "./predict.ts";

// VT is just enough of a terminal to replay what a shell, vim and less send:
// printing with auto-wrap (the cursor stays in the last column until the
// next character, as in Ghostty), CR, LF with scrolling, BS, and the CSI
// sequences below. Colours are ignored.
class VT implements Screen {
  cursorX = 0;
  cursorY = 0;
  cursorVisible = true;
  alternate = false;
  private main: string[][];
  private alt: string[][];
  private wrapPending = false;
  private saved = { x: 0, y: 0 };
  private esc = "";

  cols: number;
  rows: number;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.main = this.blank();
    this.alt = this.blank();
  }

  private blank() {
    return Array.from({ length: this.rows }, () => Array<string>(this.cols).fill(" "));
  }

  private get grid() {
    return this.alternate ? this.alt : this.main;
  }

  cell(x: number, y: number) {
    return this.grid[y]?.[x] ?? " ";
  }

  line(y: number) {
    return this.grid[y].join("").trimEnd();
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.main = this.blank();
    this.alt = this.blank();
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);
  }

  private lf() {
    if (this.cursorY < this.rows - 1) this.cursorY++;
    else {
      this.grid.shift();
      this.grid.push(Array<string>(this.cols).fill(" "));
    }
  }

  write(data: string) {
    for (const ch of data) {
      if (this.esc) {
        this.esc += ch;
        if (this.esc === "\x1b[" || (this.esc.startsWith("\x1b[") && !/[@-~]/.test(ch))) continue;
        if (this.esc.startsWith("\x1b[")) this.csi(this.esc.slice(2, -1), ch);
        else if (this.esc === "\x1b7") this.saved = { x: this.cursorX, y: this.cursorY };
        else if (this.esc === "\x1b8") ({ x: this.cursorX, y: this.cursorY } = this.saved);
        this.esc = "";
        continue;
      }
      if (ch === "\x1b") this.esc = ch;
      else if (ch === "\r") {
        this.cursorX = 0;
        this.wrapPending = false;
      } else if (ch === "\n") {
        this.lf();
        this.wrapPending = false;
      } else if (ch === "\b") {
        if (this.wrapPending) this.wrapPending = false;
        else if (this.cursorX > 0) this.cursorX--;
      } else if (ch >= " ") {
        if (this.wrapPending) {
          this.cursorX = 0;
          this.lf();
          this.wrapPending = false;
        }
        this.grid[this.cursorY][this.cursorX] = ch;
        if (this.cursorX === this.cols - 1) this.wrapPending = true;
        else this.cursorX++;
      }
    }
  }

  private csi(params: string, final: string) {
    const priv = params.startsWith("?");
    const nums = (priv ? params.slice(1) : params).split(";").map((n) => (n === "" ? 0 : Number(n)));
    const n = Math.max(1, nums[0] || 0);
    const row = this.grid[this.cursorY];
    this.wrapPending = false;
    switch (final) {
      case "C":
        this.cursorX = Math.min(this.cols - 1, this.cursorX + n);
        break;
      case "D":
        this.cursorX = Math.max(0, this.cursorX - n);
        break;
      case "A":
        this.cursorY = Math.max(0, this.cursorY - n);
        break;
      case "B":
        this.cursorY = Math.min(this.rows - 1, this.cursorY + n);
        break;
      case "H":
        this.cursorY = Math.min(this.rows - 1, Math.max(1, nums[0] || 1) - 1);
        this.cursorX = Math.min(this.cols - 1, Math.max(1, nums[1] || 1) - 1);
        break;
      case "K":
        for (let x = nums[0] === 2 ? 0 : this.cursorX; x < this.cols; x++) row[x] = " ";
        break;
      case "J":
        if (nums[0] === 2) for (const r of this.grid) r.fill(" ");
        break;
      case "P":
        row.splice(this.cursorX, n);
        while (row.length < this.cols) row.push(" ");
        break;
      case "@":
        row.splice(this.cursorX, 0, ...Array<string>(n).fill(" "));
        row.length = this.cols;
        break;
      case "h":
      case "l":
        if (priv && nums[0] === 25) this.cursorVisible = final === "h";
        if (priv && nums[0] === 1049) {
          if (final === "h") {
            this.saved = { x: this.cursorX, y: this.cursorY };
            this.alt = this.blank();
            this.alternate = true;
          } else {
            this.alternate = false;
            ({ x: this.cursorX, y: this.cursorY } = this.saved);
          }
        }
        break;
    }
  }
}

// A trace: keys the person typed and what the box sent back, each at its
// time in ms.
type Event = [at: number, kind: "key" | "out", data: string];

interface Frame {
  at: number;
  overlay: Overlay;
  lines: string[];
  shown: string[];
  cursor: [number, number];
}

// composite is the screen as the person sees it: the emulator's cells with
// the overlay drawn on top.
function composite(vt: VT, o: Overlay): string[] {
  const rows = Array.from({ length: vt.rows }, (_, y) => Array.from({ length: vt.cols }, (_, x) => vt.cell(x, y)));
  for (const c of o.cells) rows[c.y][c.x] = c.ch;
  return rows.map((r) => r.join("").trimEnd());
}

// play replays a trace the way TerminalView drives the engine: input()
// before a key is sent, update() after output is parsed and when a guess
// falls due (its timer), and a frame recorded after each.
function play(events: Event[], opts: { cols?: number; rows?: number; prompt?: string; mode?: PredictMode; engine?: PredictionEngine; vt?: VT; start?: number } = {}) {
  const vt = opts.vt ?? new VT(opts.cols ?? 40, opts.rows ?? 8);
  const e = opts.engine ?? new PredictionEngine(opts.mode ?? "adaptive");
  if (opts.prompt) vt.write(opts.prompt);
  let now = opts.start ?? 0;
  e.update(vt, now);
  const frames: Frame[] = [];
  const record = () => {
    const overlay = e.overlay(vt);
    frames.push({ at: now, overlay, lines: Array.from({ length: vt.rows }, (_, y) => vt.line(y)), shown: composite(vt, overlay), cursor: overlay.cursor ? [overlay.cursor.x, overlay.cursor.y] : [vt.cursorX, vt.cursorY] });
  };
  const advance = (to: number) => {
    for (;;) {
      const d = e.nextDeadline(now);
      if (d === undefined || d > to) break;
      now = d;
      e.update(vt, now);
      record();
    }
    now = Math.max(now, to);
  };
  const sorted = events.map((ev, i) => [ev, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]);
  for (const [[at, kind, data]] of sorted) {
    advance(at);
    if (kind === "key") e.input(data, vt, now);
    else {
      vt.write(data);
      e.update(vt, now);
    }
    record();
  }
  advance(now + 20_000);
  record();
  // What the person saw at a time: the last frame at or before it.
  const at = (t: number) => frames.filter((f) => f.at <= t).at(-1)!;
  return { vt, e, frames, at, end: now };
}

// typed is a person typing keys every gap ms from start, and a shell
// echoing each rtt ms later (echo says what it sends back for a key).
function typed(keys: string[], start: number, gap: number, rtt: number, echo: (k: string) => string = (k) => k): Event[] {
  return keys.flatMap((k, i) => {
    const at = start + i * gap;
    const back = echo(k);
    return back === "" ? [[at, "key", k] as Event] : [[at, "key", k] as Event, [at + rtt, "out", back] as Event];
  });
}

// What readline (bash) sends back for the keys used here, at the end of
// the line.
const readline = (k: string) => (k === "\x7f" ? "\b\x1b[K" : k === "\x1b[D" ? "\b" : k);

const PROMPT = "me@acme:~$ ";
const chars = (s: string) => [...s];

test("parseKeys names the keys it can guess and nothing else", () => {
  assert.deepEqual(parseKeys("ab"), [
    { kind: "char", ch: "a" },
    { kind: "char", ch: "b" },
  ]);
  assert.deepEqual(parseKeys("\x7f\b"), [{ kind: "backspace" }, { kind: "backspace" }]);
  assert.deepEqual(parseKeys("\x1b[D\x1bOC"), [{ kind: "left" }, { kind: "right" }]);
  assert.deepEqual(parseKeys("\r"), [{ kind: "enter" }]);
  assert.deepEqual(parseKeys("é"), [{ kind: "char", ch: "é" }]);
  for (const other of ["\t", "\x03", "\x12", "\x1b[A", "\x1b[1;5D", "\x1bb", "\x1b", "中", "😀"]) assert.deepEqual(parseKeys(other), [{ kind: "other" }], JSON.stringify(other));
  // A bracketed paste is one key, whatever it holds.
  assert.deepEqual(parseKeys("\x1b[200~ls -la\r\x1b[201~"), [{ kind: "other" }]);
});

test("a shell line shows as it is typed, and every guess is confirmed", () => {
  const r = play(typed(chars("ls -la"), 0, 100, 300, readline), { prompt: PROMPT });
  // The first key: no round trip measured yet, and nothing confirmed.
  assert.equal(r.at(50).shown[0], PROMPT.trimEnd());
  assert.equal(r.at(50).overlay.cells.length, 0);
  // Its echo measures 300 ms and confirms the epoch: what was typed since
  // shows at once, underlined (a slow link), the cursor after it.
  const f = r.at(350);
  assert.equal(f.lines[0], PROMPT + "l");
  assert.equal(f.shown[0], PROMPT + "ls -");
  assert.equal(f.overlay.flagged, true);
  assert.deepEqual(f.cursor, [PROMPT.length + 4, 0]);
  // While typing: the line as typed so far, never anything else.
  for (const fr of r.frames.filter((x) => x.at >= 300 && x.at < 800)) assert.ok(("ls -la").startsWith(fr.shown[0].slice(PROMPT.length)), fr.shown[0]);
  // Done: the box's own screen, no overlay left.
  assert.equal(r.vt.line(0), PROMPT + "ls -la");
  assert.deepEqual(r.e.overlay(r.vt).cells, []);
  assert.equal(r.e.pending, 0);
  assert.equal(r.e.stats.rolledBack, 0);
  // The space is a blank: too easy to match by chance to confirm anything.
  assert.equal(r.e.stats.confirmed, 5);
  assert.equal(Math.round(r.e.rtt!), 300);
});

test("after Enter the next line's first key waits for its echo, then the rest show", () => {
  const e = new PredictionEngine();
  const first = play(typed(chars("ls"), 0, 100, 300, readline), { prompt: PROMPT, engine: e });
  const vt = first.vt;
  const t = first.end;
  const events: Event[] = [
    [t, "key", "\r"],
    [t + 300, "out", "\r\na.txt  b.txt\r\n" + PROMPT],
    ...typed(chars("pwd"), t + 400, 100, 300, readline),
  ];
  const r = play(events, { engine: e, vt, start: t });
  // Typed before its echo: tentative, so nothing shows.
  assert.equal(r.at(t + 450).shown[2], PROMPT.trimEnd());
  // The p came back: w and d show before theirs.
  assert.equal(r.at(t + 710).shown[2], PROMPT + "pwd");
  assert.equal(r.at(t + 710).lines[2], PROMPT + "p");
  assert.equal(r.e.stats.rolledBack, 0);
  assert.equal(r.vt.line(2), PROMPT + "pwd");
  assert.equal(r.e.pending, 0);
});

test("Backspace takes the last character back before the box does", () => {
  const keys = [...chars("lss"), "\x7f", ...chars(" -l")];
  const r = play(typed(keys, 0, 100, 300, readline), { prompt: PROMPT });
  // The Backspace at 300, after the first echo: the line already reads ls.
  const f = r.at(310);
  assert.equal(f.shown[0], PROMPT + "ls");
  assert.deepEqual(f.cursor, [PROMPT.length + 2, 0]);
  assert.equal(r.at(410).shown[0], PROMPT + "ls");
  assert.equal(r.at(510).shown[0], PROMPT + "ls -");
  assert.equal(r.vt.line(0), PROMPT + "ls -l");
  assert.equal(r.e.stats.rolledBack, 0);
  assert.equal(r.e.pending, 0);
});

test("Left moves the cursor, and typing in the middle of a line moves the rest along", () => {
  const e = new PredictionEngine();
  const first = play(typed(chars("echo hllo"), 0, 50, 300, readline), { prompt: PROMPT, engine: e });
  const t = first.end;
  // readline: Left is a backspace; an insert rewrites the rest of the line
  // and steps back over it.
  const events: Event[] = [
    ...typed(["\x1b[D", "\x1b[D", "\x1b[D"], t, 60, 300, readline),
    [t + 200, "key", "e"],
    [t + 500, "out", "ello\b\b\b"],
  ];
  const r = play(events, { engine: e, vt: first.vt, start: t });
  const before = r.at(t + 130);
  assert.deepEqual(before.cursor, [PROMPT.length + 6, 0]);
  assert.equal(before.lines[0], PROMPT + "echo hllo");
  const typedE = r.at(t + 210);
  assert.equal(typedE.shown[0], PROMPT + "echo hello");
  assert.deepEqual(typedE.cursor, [PROMPT.length + 7, 0]);
  assert.equal(r.vt.line(0), PROMPT + "echo hello");
  assert.equal(r.e.stats.rolledBack, 0);
  assert.equal(r.e.pending, 0);
});

test("a password prompt never echoes: its guesses never show and never confirm", () => {
  const e = new PredictionEngine();
  const warm = play(typed(chars("sudo true"), 0, 80, 300, readline), { prompt: PROMPT, engine: e });
  const t = warm.end;
  const confirmed = e.stats.confirmed;
  const events: Event[] = [
    [t, "key", "\r"],
    [t + 300, "out", "\r\n[sudo] password for me: "],
    // Typed quickly once the prompt is up, and again slowly.
    ...typed(chars("hunter2"), t + 350, 40, 0, () => ""),
    ...typed(chars("swordfish"), t + 2000, 700, 0, () => ""),
    [t + 9000, "key", "\r"],
    [t + 9300, "out", "\r\n" + PROMPT],
  ];
  const r = play(events, { engine: e, vt: warm.vt, start: t });
  for (const f of r.frames) assert.deepEqual(f.overlay.cells, [], `at ${f.at - t}: ${f.shown[1]}`);
  for (const f of r.frames) assert.equal(f.shown[1], f.lines[1]);
  assert.equal(e.stats.confirmed, confirmed);
  assert.equal(e.stats.rolledBack, 0);
  assert.equal(r.vt.line(1), "[sudo] password for me:");
  assert.equal(e.pending, 0);
});

test("vim in the alternate screen: nothing wrong shows, and typed text does once confirmed", () => {
  const e = new PredictionEngine();
  const warm = play(typed(chars("vim notes"), 0, 80, 300, readline), { prompt: PROMPT, rows: 6, engine: e });
  const t = warm.end;
  const screen = "\x1b[?1049h\x1b[2J\x1b[H\r\n~\r\n~\r\n~\r\n~\r\n\"notes\" [New]\x1b[H";
  const events: Event[] = [
    [t, "key", "\r"],
    [t + 300, "out", screen],
    // i: insert mode, which vim says on its last line, not where you type.
    [t + 600, "key", "i"],
    [t + 900, "out", "\x1b[6;1H-- INSERT --\x1b[K\x1b[1;1H"],
    // Then text, echoed where it is typed.
    ...typed(chars("hello world"), t + 1200, 90, 300),
    // Esc, then normal-mode keys that move the cursor and print nothing.
    [t + 2500, "key", "\x1b"],
    [t + 2800, "out", "\x1b[6;1H\x1b[K\x1b[1;11H"],
    ...typed(chars("bbw"), t + 3000, 150, 300, (k) => (k === "b" ? "\x1b[1;7H" : "\x1b[1;1H")),
    // :q↵ is drawn on the last line.
    [t + 4000, "key", ":"],
    [t + 4300, "out", "\x1b[6;1H:"],
    [t + 4100, "key", "q"],
    [t + 4400, "out", "q"],
    [t + 4200, "key", "\r"],
    [t + 4500, "out", "\x1b[?1049l\r\n" + PROMPT],
  ];
  const r = play(events, { engine: e, vt: warm.vt, start: t });
  assert.equal(e.stats.rolledBack, 0);
  // The i itself never showed, on row 0 or anywhere.
  for (const f of r.frames.filter((x) => x.at < t + 1200)) assert.deepEqual(f.overlay.cells, []);
  // Some of "hello world" showed ahead of its echo.
  assert.ok(r.frames.some((f) => f.at > t + 1200 && f.at < t + 2500 && f.overlay.cells.length > 0));
  for (const f of r.frames.filter((x) => x.at > t + 1200 && x.at < t + 2500)) assert.ok("hello world".startsWith(f.shown[0]), f.shown[0]);
  // Normal mode's keys and the :q never showed where they were typed.
  for (const f of r.frames.filter((x) => x.at > t + 2500)) assert.deepEqual(f.overlay.cells, [], `at ${f.at - t}`);
  assert.equal(r.vt.alternate, false);
  assert.equal(e.pending, 0);
});

test("less in the alternate screen: keys that scroll never show, a search does once confirmed", () => {
  const e = new PredictionEngine();
  const warm = play(typed(chars("less log"), 0, 80, 300, readline), { prompt: PROMPT, rows: 5, engine: e });
  const t = warm.end;
  const page = (n: number) => `\x1b[H\x1b[2J${[0, 1, 2, 3].map((i) => `line ${n + i}`).join("\r\n")}\r\n:`;
  const events: Event[] = [
    [t, "key", "\r"],
    [t + 300, "out", "\x1b[?1049h" + page(1)],
    ...typed(chars("jjj"), t + 600, 120, 300).map(([at, kind, d], i): Event => (kind === "out" ? [at, kind, page(2 + Math.floor(i / 2))] : [at, kind, d])),
    [t + 1500, "key", "/"],
    [t + 1800, "out", "\r\x1b[K/"],
    ...typed(chars("error"), t + 2400, 100, 300),
    // ↵ searches (and redraws the page), q quits.
    [t + 3000, "key", "\r"],
    [t + 3300, "out", page(7)],
    [t + 3400, "key", "q"],
    [t + 3700, "out", "\x1b[?1049l\r\n" + PROMPT],
  ];
  const r = play(events, { engine: e, vt: warm.vt, start: t });
  assert.equal(e.stats.rolledBack, 0);
  for (const f of r.frames.filter((x) => x.at < t + 1500)) assert.deepEqual(f.overlay.cells, []);
  // The search shows ahead of the box once its first echo confirmed it.
  assert.ok(r.frames.some((f) => f.overlay.cells.length > 0 && f.shown[4].startsWith("/")));
  for (const f of r.frames.filter((x) => x.at > t + 1500 && x.at < t + 3000)) assert.ok("/error".startsWith(f.shown[4]), f.shown[4]);
  // After the search ran, q (which quits) never showed.
  for (const f of r.frames.filter((x) => x.at >= t + 3100)) assert.deepEqual(f.overlay.cells, []);
  assert.equal(e.pending, 0);
});

test("output from elsewhere mid-typing takes the guesses back, and the box's screen wins", () => {
  const e = new PredictionEngine();
  const warm = play(typed(chars("ls"), 0, 100, 300, readline), { prompt: PROMPT, engine: e });
  const t = warm.end;
  // zsh's job notice in the middle of a line: it moves the line down and
  // reprints what reached it so far.
  const notice = "\r\x1b[K[1]  + done       sleep 1\r\n" + PROMPT + "echo h";
  const events: Event[] = [
    [t, "key", "\x7f"],
    [t + 300, "out", "\b\x1b[K"],
    [t + 350, "key", "\x7f"],
    [t + 650, "out", "\b\x1b[K"],
    ...typed(chars("echo hi there"), t + 700, 100, 300, readline),
    [t + 1550, "out", notice],
  ];
  const r = play(events, { engine: e, vt: warm.vt, start: t });
  // Guesses showed before the notice...
  assert.ok(r.at(t + 1540).overlay.cells.length > 0);
  // ...and none after it, over the notice or anywhere.
  const after = r.at(t + 1550);
  assert.deepEqual(after.overlay.cells, []);
  assert.equal(after.shown[0], "[1]  + done       sleep 1");
  assert.equal(e.stats.rolledBack, 1);
  // Guessing waits for the next confirmation: the key right after shows
  // nothing until its echo.
  assert.deepEqual(r.at(t + 1610).overlay.cells, []);
  assert.equal(r.vt.line(0), "[1]  + done       sleep 1");
  assert.equal(r.vt.line(1), PROMPT + "echo hi there");
  assert.equal(e.pending, 0);
  assert.deepEqual(r.e.overlay(r.vt).cells, []);
});

test("a line that wraps: the last column and the next line are guessed only once confirmed", () => {
  const cols = 20;
  const e = new PredictionEngine();
  const text = "abcdefghijklmnopqrstuvwxyz";
  const r = play(typed(chars(text), 0, 100, 300), { prompt: "$ ", cols, engine: e });
  assert.equal(e.stats.rolledBack, 0);
  for (const f of r.frames) {
    const shown = f.shown[0].slice(2) + f.shown[1];
    assert.ok(text.startsWith(shown), `at ${f.at}: ${JSON.stringify(f.shown.slice(0, 2))}`);
  }
  // The last column (typed at 1700) shows only once its echo is back...
  assert.equal(r.at(1750).shown[0], "$ " + text.slice(0, 17));
  // ...and on the next line, once its first character's echo is.
  assert.ok(r.frames.some((f) => f.at > 2100 && f.at < 2600 && f.overlay.cells.some((c) => c.y === 1)));
  assert.equal(r.vt.line(0), "$ " + text.slice(0, 18));
  assert.equal(r.vt.line(1), text.slice(18));
  assert.equal(e.pending, 0);
});

test("a fast link shows nothing in Adaptive, and everything confirmed in Always", () => {
  const keys = chars("git status");
  const adaptive = play(typed(keys, 0, 100, 20, readline), { prompt: PROMPT });
  for (const f of adaptive.frames) assert.deepEqual(f.overlay.cells, []);
  assert.equal(Math.round(adaptive.e.rtt!), 20);
  const always = play(typed(keys, 0, 10, 20, readline), { prompt: PROMPT, mode: "always" });
  assert.ok(always.frames.some((f) => f.overlay.cells.length > 0));
  assert.ok(always.frames.every((f) => !f.overlay.flagged));
  assert.equal(always.e.stats.rolledBack, 0);
});

test("Never makes no guesses at all", () => {
  const r = play(typed(chars("ls -la"), 0, 100, 400, readline), { prompt: PROMPT, mode: "never" });
  for (const f of r.frames) assert.deepEqual(f.overlay.cells, []);
  assert.equal(r.e.rtt, undefined);
  assert.equal(r.e.pending, 0);
});

test("a hidden cursor (a program drawing its own, like Claude Code) gets no guesses", () => {
  const e = new PredictionEngine("always");
  const r = play([...typed(chars("fix the bug"), 0, 100, 300, (k) => `\x1b[?25l${k}\x1b[?25h`.replace(/\x1b\[\?25h$/, ""))], { prompt: "\x1b[?25l> ", engine: e });
  for (const f of r.frames) assert.deepEqual(f.overlay.cells, []);
  assert.equal(e.stats.confirmed, 0);
});

test("scrolled back, resized or unreadable: every guess is taken back", () => {
  const e = new PredictionEngine("always");
  const vt = new VT(40, 8);
  vt.write(PROMPT);
  e.update(vt, 0);
  e.input("l", vt, 0);
  vt.write("l");
  e.update(vt, 300);
  e.input("s", vt, 310);
  assert.equal(e.overlay(vt).cells.length, 1);
  e.update(null, 320);
  assert.equal(e.pending, 0);
  assert.deepEqual(e.overlay(vt).cells, []);
  e.input("x", vt, 330);
  vt.resize(30, 8);
  e.update(vt, 340);
  assert.equal(e.pending, 0);
});

test("a guess the box never confirms expires after about a round trip", () => {
  const e = new PredictionEngine("always");
  const vt = new VT(40, 8);
  vt.write(PROMPT);
  e.update(vt, 0);
  e.input("a", vt, 0);
  vt.write("a");
  e.update(vt, 200);
  // Typed, then the program stops echoing (stty -echo from a script).
  e.input("b", vt, 1000);
  assert.equal(e.overlay(vt).cells.length, 1);
  let now = 1000;
  for (let d = e.nextDeadline(now); d !== undefined; d = e.nextDeadline(now)) e.update(vt, (now = d));
  assert.ok(now > 1000 && now < 1000 + 1000, `taken back at ${now}`);
  assert.deepEqual(e.overlay(vt).cells, []);
  assert.equal(e.stats.rolledBack, 1);
});

test("at the bottom of the screen, Enter scrolls and the guesses move up with it", () => {
  const e = new PredictionEngine();
  const vt = new VT(40, 4);
  vt.write("a\r\nb\r\nc\r\n" + PROMPT);
  const keys = [...chars("ls"), "\r", ...chars("pwd")];
  const r = play(
    [
      ...typed(chars("ls"), 0, 100, 400, readline),
      [200, "key", "\r"],
      [600, "out", "\r\nx.txt\r\n" + PROMPT],
      ...typed(chars("pwd"), 700, 100, 400, readline),
    ],
    { engine: e, vt },
  );
  void keys;
  assert.equal(e.stats.rolledBack, 0);
  assert.equal(r.vt.line(1), PROMPT + "ls");
  assert.equal(r.vt.line(3), PROMPT + "pwd");
  // pwd showed on the new bottom line before its echo.
  assert.ok(r.frames.some((f) => f.shown[3] === PROMPT + "pwd" && f.lines[3] !== PROMPT + "pwd"));
  assert.equal(e.pending, 0);
});

// A seeded random number generator, so a failure can be replayed.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// shell is readline at the end of what you type, and in the middle of it:
// what it sends back for each key, and what the line reads after it.
function shell() {
  let line = "";
  let at = 0;
  return (k: string): string => {
    const rest = line.slice(at);
    if (k === "\x7f") {
      if (!at) return "\x07";
      line = line.slice(0, at - 1) + rest;
      at--;
      return "\b" + rest + "\x1b[K" + "\b".repeat(rest.length);
    }
    if (k === "\x1b[D") return at ? (at--, "\b") : "\x07";
    if (k === "\x1b[C") return at < line.length ? line[at++] : "\x07";
    line = line.slice(0, at) + k + rest;
    at++;
    return k + rest + "\b".repeat(rest.length);
  };
}

// fuzz types random keys over a link whose round trip changes from key to
// key (jump: anywhere in 80-2000 ms each time; drift: a walk through it),
// the box answering in order, and returns how many frames showed a line
// that was never typed. The line must end as typed, with nothing left over.
function fuzz(seeds: number, opts: { keys: string; edit?: boolean; drift?: boolean }) {
  let bad = 0;
  let frames = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rand = rng(seed);
    const answer = shell();
    const states = [""];
    let line = "";
    let at = 0;
    const events: Event[] = [];
    let t = 0;
    let echoAt = 0;
    let rtt = 80 + rand() * 1920;
    for (let i = 0; i < 40; i++) {
      const r = rand();
      const k = opts.edit && r < 0.12 ? "\x1b[D" : opts.edit && r < 0.2 ? "\x1b[C" : r < 0.33 ? "\x7f" : opts.keys[Math.floor(rand() * opts.keys.length)];
      t += 30 + rand() * 250;
      rtt = opts.drift ? Math.min(2000, Math.max(80, rtt + (rand() - 0.5) * 100)) : 80 + rand() * 1920;
      echoAt = Math.max(echoAt, t + rtt);
      events.push([t, "key", k], [echoAt, "out", answer(k)]);
      if (k === "\x7f" && at) (line = line.slice(0, at - 1) + line.slice(at)), at--;
      else if (k === "\x1b[D") at = Math.max(0, at - 1);
      else if (k === "\x1b[C") at = Math.min(line.length, at + 1);
      else if (k !== "\x7f") (line = line.slice(0, at) + k + line.slice(at)), at++;
      states.push(line);
    }
    const r = play(events, { prompt: PROMPT, cols: 100 });
    for (const f of r.frames) {
      frames++;
      if (!states.some((s) => s.trimEnd() === f.shown[0].slice(PROMPT.length))) bad++;
    }
    assert.equal(r.vt.line(0), (PROMPT + line).trimEnd(), `seed ${seed}`);
    assert.equal(r.e.pending, 0, `seed ${seed}`);
    assert.deepEqual(r.e.overlay(r.vt).cells, [], `seed ${seed}`);
  }
  return { bad, frames };
}

test("on a jittery link (80-2000 ms, in order), typing and Backspace only ever show what was typed", () => {
  assert.equal(fuzz(200, { keys: "abcdefgh  " }).bad, 0);
  assert.equal(fuzz(200, { keys: "abcdefgh  ", drift: true }).bad, 0);
});

test("on a jittery link, editing in the middle of a line settles right and almost never shows a line never typed", () => {
  // Words: what an insert moves along is guessed exactly.
  const words = fuzz(200, { keys: "abcdefgh", edit: true });
  assert.ok(words.bad / words.frames < 0.001, `${words.bad} of ${words.frames}`);
  // Two spaces in a row end what an insert moves (so a prompt on the right
  // stays put), which in the middle of a line can show the rest unmoved for
  // a moment, until its echo lands.
  const spaced = fuzz(200, { keys: "abcdefgh  ", edit: true, drift: true });
  assert.ok(spaced.bad / spaced.frames < 0.03, `${spaced.bad} of ${spaced.frames}`);
});
