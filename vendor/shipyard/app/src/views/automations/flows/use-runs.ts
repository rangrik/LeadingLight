import { useCallback, useEffect, useState } from "react";

import { useEventLog } from "@/lib/events";
import { type FlowRun, flowsApi } from "@/lib/flows";
import { useStore } from "@/lib/store";

export interface BoxRun extends FlowRun {
  box: string;
}

// useRuns keeps the recent runs of every box's flows, newest first,
// refetching a box when one of its flows starts or finishes.
export function useRuns(boxes: string[]) {
  const client = useStore((s) => s.client);
  const [byBox, setByBox] = useState<Record<string, FlowRun[]>>({});

  const load = useCallback(
    async (box: string) => {
      if (!client) return;
      try {
        const runs = await flowsApi.runs(client, box, undefined, 100);
        setByBox((s) => ({ ...s, [box]: runs }));
      } catch {
        // A box from before flows has none to show.
      }
    },
    [client],
  );

  const key = boxes.join(",");
  useEffect(() => {
    for (const b of key.split(",").filter(Boolean)) void load(b);
  }, [key, load]);

  const latest = useEventLog((s) => s.events.find((e) => e.type === "flow.started" || e.type === "flow.finished"));
  useEffect(() => {
    if (latest?.box) void load(latest.box);
  }, [latest, load]);

  const all: BoxRun[] = Object.entries(byBox)
    .flatMap(([box, runs]) => runs.map((r) => ({ ...r, box })))
    .sort((a, b) => b.started.localeCompare(a.started));

  // lastRun finds a flow's most recent run in its scope.
  const lastRun = (box: string, scope: string, id: string) => (byBox[box] ?? []).find((r) => r.flow === id && r.scope === scope);

  return { runs: all, lastRun, reload: load };
}
