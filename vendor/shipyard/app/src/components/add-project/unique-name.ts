import { locationName } from "@/lib/projects";
import { useStore } from "@/lib/store";

// uniqueName is a project name for a folder that no project on the box has
// yet: shop, then shop-2, shop-3…
export function uniqueName(box: string, base: string): string {
  const taken = new Set((useStore.getState().boxes[box]?.locations ?? []).map((l) => l.name));
  const name = locationName(base) || "project";
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name}-${i}`)) return `${name}-${i}`;
}

// shortPath writes a path under home with ~.
export const shortPath = (path: string, home?: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);
