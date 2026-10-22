import { useEffect, useState } from "react";

import { type Away, awayFrom } from "@/lib/net";
import { useStore } from "@/lib/store";

// A box that is away: the laptop agent tries it again on a backoff and says
// when in its status (retry_at). useAway counts down to that try, once a
// second while the box is away, so a pane says "Reconnecting to devl… Next
// try in 6s" rather than only that the box is offline.
//
// A try that fails sets the next retry_at but sends no event (only coming
// back does, box.connected), and the backstop refresh comes once a minute
// (hooks/use-berth-connection), so once a try is due the status is read
// again here, to count down to the next one rather than say "Trying now…"
// until then. Only while a pane shows the box away and the window shows.
export function useAway(box: string): Away {
  const st = useStore((s) => s.status?.boxes.find((b) => b.name === box));
  const [now, setNow] = useState(() => Date.now());
  const away = !!st && st.state !== "online";
  useEffect(() => {
    if (!away) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      const at = Date.now();
      setNow(at);
      const due = Date.parse(useStore.getState().status?.boxes.find((b) => b.name === box)?.retry_at ?? "");
      if (Number.isFinite(due) && at - due > DUE_GRACE_MS) readStatusSoon();
    }, 1000);
    return () => window.clearInterval(t);
  }, [away, box]);
  return awayFrom(st, now);
}

// A try takes a moment; past this, the status is read again.
const DUE_GRACE_MS = 1500;
// However many panes count down, the status is read at most this often.
const STATUS_EVERY_MS = 3000;
let statusAt = 0;
function readStatusSoon() {
  if (Date.now() - statusAt < STATUS_EVERY_MS) return;
  statusAt = Date.now();
  void useStore.getState().refreshStatus();
}

// tryNow asks the agent to try box at once (an older agent tries every
// box), then reads everything again.
export async function tryNow(box: string) {
  const { client, refreshAll } = useStore.getState();
  if (!client) return;
  try {
    await client.laptop("POST", `/v1/refresh?box=${encodeURIComponent(box)}`);
  } catch {
    // The status read below says how it went.
  }
  await refreshAll();
}
