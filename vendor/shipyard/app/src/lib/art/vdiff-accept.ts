import { useEffect } from "react";
import { create } from "zustand";

import type { Art } from "@/lib/art/model";
import { useStore } from "@/lib/store";

// Accept as baseline: a visual diff's after-shots become its worktree's
// "accepted" baseline on the box (POST …/shots/accept, internal/box/
// shots.go), which later compares with --base accepted measure against.
// The box remembers which diff and version it took, so every view can say
// "Accepted as baseline".

export interface Baseline {
  name: string;
  taken: string;
  commit?: string;
  shots: number;
  from?: string;
  from_version?: number;
}

const enc = encodeURIComponent;
const wtPath = (a: Pick<Art, "location" | "worktree">) => `worktrees/${enc(a.location)}/${enc(a.worktree)}/shots`;
const keyOf = (a: Pick<Art, "box" | "location" | "worktree">) => `${a.box}/${a.location}/${a.worktree}`;

const useBaselines = create<{ byWt: Record<string, Baseline[] | undefined> }>(() => ({ byWt: {} }));
const loading = new Set<string>();

export async function loadBaselines(a: Pick<Art, "box" | "location" | "worktree">): Promise<void> {
  const c = useStore.getState().client;
  const k = keyOf(a);
  if (!c || loading.has(k)) return;
  loading.add(k);
  try {
    const list = (await c.box<Baseline[] | null>(a.box, "GET", `${wtPath(a)}/baselines`)) ?? [];
    useBaselines.setState((s) => ({ byWt: { ...s.byWt, [k]: list } }));
  } catch {
    useBaselines.setState((s) => ({ byWt: { ...s.byWt, [k]: [] } }));
  } finally {
    loading.delete(k);
  }
}

// useAccepted is the worktree's accepted baseline, if it has one.
export function useAccepted(a: Art): Baseline | undefined {
  const k = keyOf(a);
  const list = useBaselines((s) => s.byWt[k]);
  const n = a.versions[a.versions.length - 1]?.n;
  useEffect(() => {
    void loadBaselines(a);
    // A new version may have been accepted elsewhere (berthd shots accept).
  }, [k, n]);
  return list?.find((b) => b.name === "accepted");
}

export async function acceptBaseline(a: Art): Promise<void> {
  const c = useStore.getState().client;
  if (!c) throw new Error("not connected");
  await c.box(a.box, "POST", `${wtPath(a)}/accept`, { artifact: a.id });
  await loadBaselines(a);
}
