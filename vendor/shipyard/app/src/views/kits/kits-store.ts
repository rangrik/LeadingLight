import { useCallback, useEffect } from "react";
import { create } from "zustand";

import { useEventLog } from "@/lib/events";
import { plainError } from "@/lib/errors";
import { type InstalledKitOn, type KitInfo, type KitTarget, kitsApi } from "@/lib/kits";
import { useStore } from "@/lib/store";

// What the Kits page and the review sheet share: the kits on this laptop,
// where they are installed, and which kit (or link) is being reviewed.

// select, when set, is the projects to start with picked, instead of those
// of the kit's repository.
export type Review = { kind: "link"; src: string; select?: KitTarget[] } | { kind: "kit"; id: string; apply?: boolean; select?: KitTarget[] };

interface KitsState {
  kits?: KitInfo[];
  installed?: InstalledKitOn[];
  error?: string;
  loading: boolean;
  review?: Review;
  // The "Add from link" dialog.
  adding: boolean;
}

export const useKits = create<KitsState>()(() => ({ loading: false, adding: false }));

// openAddKit shows the Kits page with its "Add from link" dialog open.
export function openAddKit() {
  useKits.setState({ adding: true });
  useStore.getState().setView({ kind: "kits" });
}

// openKitLink reviews a kit from a link before anything is kept: a berth://
// link, a pasted repo or gist URL, or a folder.
export function openKitLink(src: string) {
  useKits.setState({ review: { kind: "link", src } });
}

// openKit reviews a kit already kept here; apply opens it on Apply to.
export function openKit(id: string, apply = false, select?: KitTarget[]) {
  useKits.setState({ review: { kind: "kit", id, apply, select } });
}

export function closeReview() {
  useKits.setState({ review: undefined });
}

export async function reloadKits() {
  const client = useStore.getState().client;
  if (!client) return;
  useKits.setState({ loading: true });
  try {
    const [kits, installed] = await Promise.all([kitsApi.list(client), kitsApi.installed(client)]);
    useKits.setState({ kits, installed, error: undefined, loading: false });
  } catch (err) {
    useKits.setState({ error: plainError(err), loading: false });
  }
}

// useKitsData loads kits when first shown and again whenever a kit is added
// or a project's config changes anywhere.
export function useKitsData() {
  const client = useStore((s) => s.client);
  const latest = useEventLog((s) => s.events.find((e) => e.type === "kit.added" || e.type === "config.changed" || e.type === "box.connected"));
  const reload = useCallback(() => void reloadKits(), []);
  useEffect(() => {
    if (client) reload();
  }, [client, latest, reload]);
  return useKits();
}
