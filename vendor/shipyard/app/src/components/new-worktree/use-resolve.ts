import { useEffect, useRef, useState } from "react";

import { plainError } from "@/lib/errors";
import { type Branch, projectsApi, type ResolveKind, type Resolution } from "@/lib/projects";
import { useStore } from "@/lib/store";

// useResolve asks the box what an input means (a PR, an issue, a branch, a
// new name), 250ms after typing stops. Answers to older inputs are dropped.
export function useResolve(box: string, location: string, input: string, kind: ResolveKind) {
  const [resolution, setResolution] = useState<Resolution>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const text = input.trim();
    setError(undefined);
    if (!box || !location || !text) {
      setResolution(undefined);
      setPending(false);
      return;
    }
    setPending(true);
    const t = setTimeout(async () => {
      const client = useStore.getState().client;
      if (!client) return;
      try {
        const r = await projectsApi.resolve(client, box, location, text, kind);
        if (n === seq.current) setResolution(r);
      } catch (err) {
        if (n === seq.current) {
          setResolution(undefined);
          setError(plainError(err));
        }
      } finally {
        if (n === seq.current) setPending(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [box, location, input, kind]);

  return { resolution, pending, error };
}

// useBranches lists a location's branches, for the Branch tab and the base.
export function useBranches(box: string, location: string, enabled: boolean) {
  const [data, setData] = useState<{ default?: string; branches: Branch[] }>();
  useEffect(() => {
    if (!enabled || !box || !location) return;
    let live = true;
    const client = useStore.getState().client;
    if (!client) return;
    projectsApi
      .branches(client, box, location)
      .then((r) => live && setData({ default: r.default, branches: r.branches ?? [] }))
      .catch(() => live && setData({ branches: [] }));
    return () => {
      live = false;
    };
  }, [box, location, enabled]);
  return data;
}
