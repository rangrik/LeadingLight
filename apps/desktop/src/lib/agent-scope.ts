// Which pages a project's agents may read (features/project-context.feature): the project page and
// what it reaches by links, a few steps out. Tags and daily notes are read but never walked
// through: nearly everything is tagged, so walking a tag would open the whole space.

export type Graph = {
  // Links in its text and its relation values.
  out: (id: string) => Promise<string[]>;
  // Pages whose relation values hold it, and its own pages (Thoughts, essay, reports).
  back: (id: string) => string[];
  // Pages whose text mentions it; asked for the project page only.
  mentions: (id: string) => Promise<string[]>;
  hub: (id: string) => boolean;
  exists: (id: string) => boolean;
};

export async function scopeOf(root: string, g: Graph, depth = 4, cap = 400): Promise<Set<string>> {
  const seen = new Set([root]);
  let edge = [root];
  for (let d = 0; d < depth && edge.length; d++) {
    const next: string[] = [];
    for (const id of edge) {
      if (g.hub(id)) continue;
      const near = [...(await g.out(id)), ...g.back(id), ...(id === root ? await g.mentions(id) : [])];
      for (const n of near) {
        if (seen.has(n) || !g.exists(n) || seen.size >= cap) continue;
        seen.add(n);
        next.push(n);
      }
    }
    edge = next;
  }
  return seen;
}
