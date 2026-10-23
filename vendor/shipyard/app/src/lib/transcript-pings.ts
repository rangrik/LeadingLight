import { create } from "zustand";

import type { BerthEvent } from "@/lib/api";

// transcript.changed: a box saw an agent write to the transcript a chat is
// showing (box: transcriptwatch.go), a few times a second while it writes.
// The chat reads it at once (lib/transcript-feed). It is kept here rather
// than in the event log, which it would crowd: the log keeps the last 200
// events, and other parts look there for theirs.

export const useTranscriptPings = create<{ at: Record<string, number> }>()(() => ({ at: {} }));

export function noteTranscriptChanged(e: BerthEvent) {
  const session = (e.data?.session ?? e.data?.name) as string | undefined;
  if (!e.box || !session) return;
  const key = `${e.box}|${session}`;
  useTranscriptPings.setState((s) => ({ at: { ...s.at, [key]: Date.now() } }));
}
