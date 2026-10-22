import { guessSessionName, sessionName } from "@/lib/derive";
import { useStore } from "@/lib/store";

// useSessionName is sessionName for a session known by box and id, or a
// name made from the id until the box has listed it.
export function useSessionName(box: string, session: string, place = false): string {
  return useStore((s) => {
    const b = s.boxes[box];
    const found = b?.sessions?.find((x) => x.name === session);
    return found ? sessionName(found, { sessions: b?.sessions, locations: b?.locations, place }) : guessSessionName(session);
  });
}

// useSessionTitle is a session's title (what its work is called), when it
// has one: for lists that name a worktree and can lead with the work.
export function useSessionTitle(box: string, session?: string): string | undefined {
  return useStore((s) => (session ? s.boxes[box]?.sessions?.find((x) => x.name === session)?.title?.trim() || undefined : undefined));
}
