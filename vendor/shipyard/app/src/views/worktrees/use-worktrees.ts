import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEventLog } from "@/lib/events";
import { errorMessage } from "@/lib/format";
import { useStore } from "@/lib/store";
import { refOf, selectWorktree } from "@/lib/workspaces";
import { type WorktreeStatus, worktreesApi } from "@/lib/worktrees";

export interface Row extends WorktreeStatus {
  box: string;
  // box/location/name, unique across boxes.
  key: string;
}

// openWorktree shows a row's worktree in the workspace.
export function openWorktree(row: Row) {
  const loc = useStore.getState().boxes[row.box]?.locations?.find((l) => l.name === row.location);
  const wt = loc?.worktrees?.find((w) => w.path === row.path);
  if (!loc || !wt) return;
  selectWorktree(refOf(row.box, loc, wt));
  useStore.getState().setView({ kind: "workspace" });
}

export const rowKey = (box: string, location: string, name: string) => `${box}/${location}/${name}`;

// useWorktrees lists every worktree on every online box, and refetches a box
// when its worktrees, sessions or agents change.
export function useWorktrees() {
  const client = useStore((s) => s.client);
  const status = useStore((s) => s.status);
  const boxes = useMemo(() => status?.boxes.filter((b) => b.state === "online").map((b) => b.name) ?? [], [status]);
  const [byBox, setByBox] = useState<Record<string, Row[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (box: string) => {
      if (!client) return;
      try {
        const list = await worktreesApi.list(client, box);
        setByBox((s) => ({ ...s, [box]: list.map((w) => ({ ...w, box, key: rowKey(box, w.location, w.name) })) }));
        setErrors(({ [box]: _, ...rest }) => rest);
      } catch (err) {
        setErrors((s) => ({ ...s, [box]: errorMessage(err) }));
      }
    },
    [client],
  );

  const key = boxes.join(",");
  useEffect(() => {
    const list = key.split(",").filter(Boolean);
    void Promise.all(list.map(load)).then(() => setLoaded(true));
  }, [key, load]);

  // A burst of events on a box costs one refetch.
  const timers = useRef<Record<string, number>>({});
  const latest = useEventLog((s) => s.events[0]);
  useEffect(() => {
    const e = latest;
    if (!e?.box || !/^(worktree|session|agent|location)\./.test(e.type)) return;
    const box = e.box;
    window.clearTimeout(timers.current[box]);
    timers.current[box] = window.setTimeout(() => void load(box), 400);
  }, [latest, load]);

  // patch applies what an action returned without waiting for a refetch.
  const patch = useCallback((box: string, location: string, name: string, p: Partial<WorktreeStatus>) => {
    setByBox((s) => ({ ...s, [box]: (s[box] ?? []).map((r) => (r.location === location && r.name === name ? { ...r, ...p } : r)) }));
  }, []);

  const rows = useMemo(() => boxes.flatMap((b) => byBox[b] ?? []), [boxes, byBox]);
  return { rows, boxes, errors, loaded, reload: load, patch };
}
