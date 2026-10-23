// The ⌘P picker's fuzzy match, as the box ranks files
// (internal/box/worktreefiles.go fuzzyScore): every letter of the query in
// order, rewarded for runs, word starts and landing in the file's own
// name, so "paywh" finds payments/webhook.ts before apps/…/web/…/hooks.
// Pure, so node's test runner reads it (file-match.test.ts).

export interface Match {
  path: string;
  score: number;
  // Indexes into path of the matched letters, for marking them.
  hits: number[];
}

const isUpper = (c: string | undefined) => !!c && c >= "A" && c <= "Z";

// fuzzy matches q against path, or undefined when a letter is missing. An
// empty q matches everything, scoring nothing.
export function fuzzy(q: string, path: string): Match | undefined {
  const s = q.toLowerCase().replace(/\s+/g, "");
  if (!s) return { path, score: 0, hits: [] };
  const p = path.toLowerCase().length === path.length ? path.toLowerCase() : path;
  const base = path.lastIndexOf("/") + 1;
  let best: { hits: number[]; score: number } | undefined;
  // Greedy from each place the first letter could match, the best kept.
  for (let st = p.indexOf(s[0]); st >= 0; st = p.indexOf(s[0], st + 1)) {
    const hits: number[] = [];
    let i = st;
    for (const ch of s) {
      const at = p.indexOf(ch, i);
      if (at < 0) break;
      hits.push(at);
      i = at + 1;
    }
    if (hits.length < s.length) break;
    let score = 0;
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k];
      score += 1;
      if (k > 0 && hits[k - 1] === h - 1) score += 4;
      if (h === 0 || "/._-".includes(path[h - 1]) || isUpper(path[h])) score += 3;
      if (h >= base) score += 2;
      if (k > 0) score -= Math.min(3, (h - hits[k - 1] - 1) * 0.05);
    }
    if (!best || score > best.score) best = { hits, score };
  }
  if (!best) return undefined;
  return { path, score: best.score - path.length * 0.02, hits: best.hits };
}

// rank orders paths for q, best first: the agent's files this turn and the
// ones you opened lately lifted a little, then shorter paths.
export function rank(q: string, paths: string[], lift: (path: string) => number = () => 0): Match[] {
  const out: Match[] = [];
  for (const p of paths) {
    const m = fuzzy(q, p);
    if (m) out.push({ ...m, score: m.score + lift(p) });
  }
  return out.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
}

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
