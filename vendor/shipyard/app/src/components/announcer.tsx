import { useAnnouncer } from "@/lib/announce";

// Announcer is the window's live regions (lib/announce.ts), off screen.
export function Announcer() {
  const { polite, assertive } = useAnnouncer();
  return (
    <div className="sr-only" data-testid="announcer">
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="announce-polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="announce-assertive">
        {assertive}
      </div>
    </div>
  );
}
