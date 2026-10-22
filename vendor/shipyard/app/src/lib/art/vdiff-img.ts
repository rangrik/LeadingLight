import { useEffect, useState } from "react";

import { type Art, artBase } from "@/lib/art/model";
import { IMG_NAME } from "@/lib/art/vdiff";
import { useStore } from "@/lib/store";

// A visual diff's images: read from the box with its credentials (GET
// …/artifacts/{id}/img/{name}, internal/box/artifactsapi.go) and shown from
// blob: URLs, so no image sits on an origin of its own and nothing the
// agent wrote runs. An image is named by its content, so one read serves
// every version, card and tab; the newest few hundred are kept.

const MAX = 300;
const urls = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const listeners = new Map<string, Set<() => void>>();

const keyOf = (a: Pick<Art, "box" | "id">, name: string) => `${a.box}/${a.id}/${name}`;

function keep(k: string, url: string) {
  urls.set(k, url);
  while (urls.size > MAX) {
    const [old, u] = urls.entries().next().value as [string, string];
    urls.delete(old);
    URL.revokeObjectURL(u);
  }
  for (const f of listeners.get(k) ?? []) f();
}

export function vdImageUrl(a: Pick<Art, "box" | "id" | "location" | "worktree">, name: string): Promise<string> {
  const k = keyOf(a, name);
  const have = urls.get(k);
  if (have) return Promise.resolve(have);
  let p = inflight.get(k);
  if (!p) {
    const c = useStore.getState().client;
    if (!c || !IMG_NAME.test(name)) return Promise.reject(new Error("no image"));
    p = c
      .boxBlob(a.box, `${artBase(a)}/${encodeURIComponent(a.id)}/img/${name}`)
      .then((b) => {
        const url = URL.createObjectURL(b.type === "image/png" || b.type.startsWith("image/") ? b : new Blob([b], { type: "image/png" }));
        keep(k, url);
        return url;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

// useVdImage is an image's blob: URL, or undefined while it loads (or when
// it can't be read: a version since dropped).
export function useVdImage(a: Pick<Art, "box" | "id" | "location" | "worktree">, name?: string): string | undefined {
  const k = name ? keyOf(a, name) : "";
  const [, tick] = useState(0);
  const url = k ? urls.get(k) : undefined;
  useEffect(() => {
    if (!name || url) return;
    const f = () => tick((n) => n + 1);
    let set = listeners.get(k);
    if (!set) listeners.set(k, (set = new Set()));
    set.add(f);
    vdImageUrl(a, name).catch(() => {});
    return () => {
      set.delete(f);
    };
  }, [k, url, name, a]);
  return url;
}
