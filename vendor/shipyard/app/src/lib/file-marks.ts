// What the File tab marks in its margin: the lines the agent changed this
// turn (against the file as the turn found it, from the box), the lines
// you changed and haven't saved, and, when the agent wrote the file under
// your edits, the lines its version differs on. Line numbers are 1-based,
// in the text you see. Pure, so node's test runner reads it
// (file-marks.test.ts).
import { diffArrays } from "diff";

export type Mark = "added" | "modified" | "own";

export interface Changes {
  // By line number in the new text.
  lines: Map<number, Mark>;
  // Lines after which something was removed (0: before the first line).
  deleted: Set<number>;
  // Each run of changed lines, where it starts and ends in the new text.
  hunks: { from: number; to: number }[];
  added: number;
  removed: number;
}

// A diff past this many edits is not worked out line by line: every line
// counts as changed.
const MAX_EDIT = 4000;

const linesOf = (t: string) => t.split("\n");

// changes is what turned before into after, line by line. No before is a
// new file: every line added.
export function changes(before: string | undefined, after: string): Changes {
  const a = linesOf(after);
  const lines = new Map<number, Mark>();
  const deleted = new Set<number>();
  let added = 0;
  let removed = 0;
  if (before == null) {
    for (let k = 0; k < a.length; k++) lines.set(k + 1, "added");
    return { lines, deleted, hunks: hunksOf(lines, deleted), added: after === "" ? 0 : a.length - (after.endsWith("\n") ? 1 : 0), removed: 0 };
  }
  const b = linesOf(before);
  const parts = diffArrays(b, a, { maxEditLength: MAX_EDIT });
  if (!parts) {
    for (let k = 0; k < a.length; k++) lines.set(k + 1, "modified");
    return { lines, deleted, hunks: hunksOf(lines, deleted), added: a.length, removed: b.length };
  }
  // Each run of removals and additions sits between equal lines; its first
  // lines pair up as modified.
  let j = 0;
  let del = 0;
  let add = 0;
  let at = 0;
  const flush = () => {
    for (let k = 0; k < add; k++) lines.set(at + k + 1, k < del ? "modified" : "added");
    if (del > add) deleted.add(at + add);
    removed += del;
    added += add;
    del = add = 0;
  };
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (!p.added && !p.removed) {
      flush();
      j += n;
      at = j;
      continue;
    }
    if (!del && !add) at = j;
    if (p.removed) del += n;
    else {
      add += n;
      j += n;
    }
  }
  flush();
  return { lines, deleted, hunks: hunksOf(lines, deleted), added, removed };
}

function hunksOf(lines: Map<number, Mark>, deleted: Set<number>) {
  const hunks: { from: number; to: number }[] = [];
  const nums = [...new Set([...lines.keys(), ...[...deleted].map((d) => Math.max(1, d))])].sort((x, y) => x - y);
  for (const k of nums) {
    const last = hunks[hunks.length - 1];
    if (last && k <= last.to + 1) last.to = k;
    else hunks.push({ from: k, to: k });
  }
  return hunks;
}

// lineMap pairs the lines two texts share (diff-equal), from's line to
// to's, 1-based.
export function lineMap(from: string, to: string): Map<number, number> {
  const map = new Map<number, number>();
  if (from === to) {
    const n = linesOf(from).length;
    for (let k = 1; k <= n; k++) map.set(k, k);
    return map;
  }
  const parts = diffArrays(linesOf(from), linesOf(to), { maxEditLength: MAX_EDIT });
  if (!parts) return map;
  let i = 0;
  let j = 0;
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (p.added) j += n;
    else if (p.removed) i += n;
    else for (let k = 0; k < n; k++) map.set(++i, ++j);
  }
  return map;
}

// agentMarks is what the agent changed this turn as it lies in your text
// now. turnBefore is the file as the turn found it (null: the turn made
// it; undefined: the turn didn't touch it), agentText the agent's latest
// version, base what your edits are against and text what you see. The
// agent's lines carry their kind; lines you changed and haven't saved are
// "own"; what you saved yourself is unmarked. Its counts are the agent's
// alone.
export function agentMarks(turnBefore: string | null | undefined, agentText: string, base: string, text: string): Changes {
  const unsaved = changes(base, text);
  const lines = new Map<number, Mark>();
  const deleted = new Set<number>();
  let added = 0;
  let removed = 0;
  if (turnBefore !== undefined) {
    const agent = changes(turnBefore ?? undefined, agentText);
    const map = lineMap(agentText, text);
    for (const [k, kind] of agent.lines) {
      const n = map.get(k);
      if (n !== undefined && !unsaved.lines.has(n)) lines.set(n, kind);
    }
    for (const d of agent.deleted) {
      const n = d === 0 ? 0 : map.get(d);
      if (n !== undefined) deleted.add(n);
    }
    added = agent.added;
    removed = agent.removed;
  }
  const hunks = hunksOf(lines, deleted);
  for (const n of unsaved.lines.keys()) lines.set(n, "own");
  return { lines, deleted, hunks, added, removed };
}

// conflictLines are the lines of your text the agent's new version changes
// (or writes new lines after): not the lines you changed yourself.
export function conflictLines(base: string, text: string, theirs: string): number[] {
  const diff = changes(theirs, text);
  const mine = changes(base, text);
  const out = new Set<number>();
  for (const n of diff.lines.keys()) if (!mine.lines.has(n)) out.add(n);
  for (const d of diff.deleted) if (d >= 1 && !mine.lines.has(d)) out.add(d);
  return [...out].sort((a, b) => a - b);
}

// patchText is the smallest replacement that turns from into to: the
// common start and end kept, so the editor's cursor and scroll stay put
// when the agent's write arrives.
export function patchText(from: string, to: string): { from: number; to: number; insert: string } | undefined {
  if (from === to) return undefined;
  let s = 0;
  const max = Math.min(from.length, to.length);
  while (s < max && from.charCodeAt(s) === to.charCodeAt(s)) s++;
  let e = 0;
  while (e < max - s && from.charCodeAt(from.length - 1 - e) === to.charCodeAt(to.length - 1 - e)) e++;
  return { from: s, to: from.length - e, insert: to.slice(s, to.length - e) };
}
