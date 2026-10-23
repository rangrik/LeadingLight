import { useCallback, useEffect, useMemo, useState } from "react";

import { boxApi, type Hook, type HooksFile, laptopApi } from "@/lib/api";
import { useEventLog } from "@/lib/events";
import { errorMessage } from "@/lib/format";
import { useStore } from "@/lib/store";

// A machine is where hooks run: "laptop", or a box by name.
export const LAPTOP = "laptop";

export interface MachineHooks {
  machine: string;
  file?: HooksFile;
  loading: boolean;
  error?: string;
}

// useHooks loads every machine's hooks (this laptop, then each online box)
// and saves one machine's whole list at a time, as the API takes it.
export function useHooks() {
  const client = useStore((s) => s.client);
  const status = useStore((s) => s.status);
  const machines = useMemo(() => [LAPTOP, ...(status?.boxes.filter((b) => b.state === "online").map((b) => b.name) ?? [])], [status]);
  const [byMachine, setByMachine] = useState<Record<string, MachineHooks>>({});

  const load = useCallback(
    async (machine: string) => {
      if (!client) return;
      setByMachine((s) => ({ ...s, [machine]: { ...s[machine], machine, loading: true } }));
      try {
        const file = machine === LAPTOP ? await laptopApi.hooks(client) : await boxApi.hooks(client, machine);
        setByMachine((s) => ({ ...s, [machine]: { machine, file: { ...file, hooks: file.hooks ?? [] }, loading: false } }));
      } catch (err) {
        setByMachine((s) => ({ ...s, [machine]: { ...s[machine], machine, loading: false, error: errorMessage(err) } }));
      }
    },
    [client],
  );

  const key = machines.join(",");
  useEffect(() => {
    for (const m of key.split(",")) void load(m);
  }, [key, load]);

  // Someone else (another app window, a box's own CLI) may change them.
  const changed = useEventLog((s) => s.events.find((e) => e.type === "hooks.changed"));
  useEffect(() => {
    if (changed) void load(changed.box ?? LAPTOP);
  }, [changed, load]);

  // save replaces the machine's own hooks; plugins' hooks are left to them.
  const save = useCallback(
    async (machine: string, hooks: Hook[]) => {
      if (!client) throw new Error("not connected");
      const own = hooks.filter((h) => !h.source);
      const file = machine === LAPTOP ? await laptopApi.saveHooks(client, own) : await boxApi.saveHooks(client, machine, own);
      setByMachine((s) => ({ ...s, [machine]: { machine, file: { ...file, hooks: file.hooks ?? [] }, loading: false } }));
    },
    [client],
  );

  return { machines, byMachine, save, reload: load };
}
