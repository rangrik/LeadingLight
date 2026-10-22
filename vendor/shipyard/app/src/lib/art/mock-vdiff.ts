import VD_V1 from "@/lib/art/mock-vdiff/46ab3c4e1b-v1.json?raw";
import VD_V2 from "@/lib/art/mock-vdiff/46ab3c4e1b-v2.json?raw";
import VD_CLEAR from "@/lib/art/mock-vdiff/39fdf22244-v1.json?raw";
import { VD_CLEAR_ID, VD_ID } from "@/lib/art/mock-vdiff-chat";

// Mock mode's visual diffs: real runs of `berthd shots compare` against
// acme's shop (a scratch box; manifests in mock-vdiff/, their images in
// e2e/fixtures/vdiff-img/, served at /__mock-vdiff/ by the dev and
// preview servers only, so no build ships them). The search-perf agent
// moves the hero's call to action into a search field and adds filters to
// /search (v1: /search scrolls sideways on phones, /account throws), fixes
// both (v2), and after Accept as baseline compares again: all clear.

export { VD_CLEAR_ID, VD_ID };

export interface VdSeed {
  id: string;
  title: string;
  key: string;
  versions: { body: string; ago: number; note?: string }[];
}

export const VD_SEEDS: VdSeed[] = [
  {
    id: VD_ID,
    title: "Visual changes: search-perf vs main",
    key: "visualdiff:main",
    versions: [
      { body: VD_V1, ago: 58, note: "first pass" },
      { body: VD_V2, ago: 52, note: "filters collapse on phones; account fixed" },
    ],
  },
  { id: VD_CLEAR_ID, title: "Visual changes: search-perf vs accepted", key: "visualdiff:accepted", versions: [{ body: VD_CLEAR, ago: 47 }] },
];

export const VD_V2_BODY = VD_V2;

// A grey placeholder where the fixtures aren't served (a build's mock
// mode, the demo).
const placeholder = () => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="100%" height="100%" fill="#e4e4e7"/></svg>`], { type: "image/svg+xml" });

export async function vdiffImage(path: string): Promise<Blob | undefined> {
  const m = /\/artifacts\/[0-9a-f]{10}\/img\/([0-9a-f]{16}\.png)$/.exec(path);
  if (!m) return undefined;
  try {
    const res = await fetch(`/__mock-vdiff/${m[1]}`);
    if (res.ok && res.headers.get("content-type")?.startsWith("image/")) return await res.blob();
  } catch {
    // Not served here.
  }
  return placeholder();
}

// The worktree's baselines: turn-start from the start of the turn; Accept
// as baseline adds "accepted".
const baselines: { name: string; taken: string; commit?: string; shots: number; from?: string; from_version?: number }[] = [{ name: "turn-start", taken: new Date(Date.now() - 60 * 60_000).toISOString(), commit: "3a7b95d", shots: 18 }];

export function vdiffShotsCall(method: string, path: string, body: unknown, latest: (id: string) => number | undefined): unknown | undefined {
  if (!/^worktrees\/shop\/search-perf\/shots\//.test(path)) return undefined;
  if (method === "GET" && path.endsWith("/baselines")) return baselines;
  if (method === "POST" && path.endsWith("/accept")) {
    const id = (body as { artifact?: string } | undefined)?.artifact ?? "";
    const n = latest(id);
    if (!n) throw new Error(`no visual diff ${id}`);
    const i = baselines.findIndex((b) => b.name === "accepted");
    if (i >= 0) baselines.splice(i, 1);
    baselines.unshift({ name: "accepted", taken: new Date().toISOString(), commit: "e60622c", shots: 18, from: id, from_version: n });
    return { text: `accepted ${id} v${n} as shop/search-perf's baseline: 18 shots`, artifact: id, version: n };
  }
  return undefined;
}
