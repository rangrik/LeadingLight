// Case and accents don't count: "sonke" finds "Sönke".
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// How well a query names something, lower is better: 0 the whole name, 1 its start, 2 a word's
// start, 2.5 its words' first letters ("fl", Feedback loops), then 3 to 4 for its letters in order
// from a word's start, closer together lower. Undefined when it doesn't.
export function rank(query: string, name: string): number | undefined {
  const q = fold(query);
  const n = fold(name);
  if (!q || !n) return;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (new RegExp(`[^\\p{L}\\p{N}]${escape(q)}`, "u").test(n)) return 2;
  const bare = q.replace(/[^\p{L}\p{N}]/gu, "");
  const starts = [...n.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu)].map((m) => m.index);
  if (bare.length > 1 && starts.map((i) => n[i]).join("").includes(bare)) return 2.5;
  let best = Infinity;
  for (const from of starts.filter((i) => n[i] === bare[0])) {
    let at = from;
    for (const ch of bare.slice(1)) if ((at = n.indexOf(ch, at + 1)) < 0) break;
    if (at >= 0) best = Math.min(best, at - from);
  }
  return best < Infinity ? 3 + Math.min(best, 99) / 100 : undefined;
}
