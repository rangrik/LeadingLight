import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import type { Queued } from "~/lib/project-runtime/chat";

// A message the runtime holds until the agent's turn ends (features/project-chat.feature, slice
// 12): shown where it will go, after the turns, with the two things to do about it. Sent into the
// running turn (step) or typed at the turn's end (turn), it waits here only until the agent reads it.
export function QueuedMessage({ q, who, sent, onSendNow, onRemove }: { q: Queued; who: string; sent?: "step" | "turn"; onSendNow?: () => Promise<void>; onRemove?: () => Promise<void> }) {
  const [busy, setBusy] = useState<"send" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const note = useRef<HTMLParagraphElement>(null);
  // Under a tall card the line can sit below the fold.
  useEffect(() => void (error && note.current?.scrollIntoView({ block: "nearest" })), [error]);
  const run = (what: "send" | "remove", fn?: () => Promise<void>) => {
    if (!fn) return;
    setBusy(what);
    setError(null);
    fn().catch((err) => setError(String(err.message ?? err))).finally(() => setBusy(null));
  };
  return (
    <div className="mt-4 flex flex-col items-end gap-1" data-testid={sent ? "sent-message" : "queued-message"}>
      <div className="max-w-[85%] rounded-2xl border border-dashed px-3 py-2 text-foreground/80">
        <p className="whitespace-pre-wrap break-words">{q.preview}</p>
      </div>
      <div className="flex min-h-6 items-center gap-1 text-muted-foreground text-xs">
        <Clock className="size-3" />
        {sent ? (
          <span>{sent === "step" ? `Sent · ${who} reads it after this step` : `Sent · ${who} starts on it`}</span>
        ) : (
          <>
            <span className="me-1">Queued · sends when {who} finishes</span>
            <Button disabled={busy !== null} onClick={() => run("send", onSendNow)} size="xs" variant="ghost">
              Send now
            </Button>
            <Button disabled={busy !== null} onClick={() => run("remove", onRemove)} size="xs" variant="ghost">
              Remove
            </Button>
          </>
        )}
      </div>
      {error && (
        <p className="scroll-mb-3 text-destructive-foreground text-xs" ref={note}>
          {error}
        </p>
      )}
    </div>
  );
}
