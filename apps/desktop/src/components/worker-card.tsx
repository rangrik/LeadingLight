// From synara (MIT, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro) at 29b11e105200:
// apps/web/src/components/chat/SubagentRunCard.tsx. Changes: COSS Button and Spinner, lucide icons;
// the runtime's workers (sessions a lead started, its reports) instead of Synara's threads; one
// row per worker with its agent, live state or outcome and answer; Stop and Open on the row; no
// nesting, backgrounding or folding.
import { Check, CircleAlert, Square } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { cn } from "@leadinglight/ui/lib/utils";

// One worker: live (its session's state) or done (its report).
export type WorkerRow = { session: string; agent?: string; live?: "working" | "waiting"; status?: string; duration?: string; answer?: string; error?: string };

const NAME: Record<string, string> = { claude: "Claude", codex: "Codex" };
const ENDED: Record<string, string> = { finished: "Done", interrupted: "Stopped", error: "Failed", failed: "Failed", exited: "Ended" };

// The workers a turn started, as synara's card shows a turn's subagents.
export function WorkerCard({ rows, prefix = "", onStop, onOpen }: { rows: WorkerRow[]; prefix?: string; onStop: (session: string) => void; onOpen?: (session: string) => void }) {
  const running = rows.filter((r) => r.live).length;
  return (
    <div className="mt-2 rounded-xl border bg-background p-1.5" data-testid="workers">
      <p className="px-1.5 pt-0.5 pb-1 text-muted-foreground text-xs">
        {rows.length === 1 ? "1 worker" : `${rows.length} workers`}
        {running > 0 && ` · ${running} running`}
      </p>
      {rows.map((r) => {
        const failed = !r.live && (r.status === "error" || r.status === "failed");
        return (
          <div className="group flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-0.5 transition-colors duration-150 ease-out hover:bg-accent" key={r.session}>
            <button aria-label={`Open ${r.session}`} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default" disabled={!onOpen} onClick={() => onOpen?.(r.session)} type="button">
              {/* Named in its folder: the folder's own prefix says nothing here. */}
              <span className="min-w-0 truncate font-medium">{r.session.startsWith(prefix) ? r.session.slice(prefix.length) : r.session}</span>
              {r.agent && <span className="shrink-0 text-muted-foreground text-xs">{NAME[r.agent] ?? r.agent}</span>}
              <span className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-xs", failed ? "text-destructive-foreground" : "text-muted-foreground")}>
                {r.live ? <Spinner className="size-3 shrink-0" /> : failed ? <CircleAlert className="size-3 shrink-0" /> : <Check className="size-3 shrink-0" />}
                <span className="shrink-0">{r.live === "waiting" ? "Waiting for you" : r.live ? "Working" : (ENDED[r.status ?? ""] ?? r.status)}</span>
                {r.duration && <span className="shrink-0 tabular-nums">· {r.duration}</span>}
                {(r.error || r.answer) && <span className="min-w-0 truncate">→ {r.error || r.answer}</span>}
              </span>
            </button>
            {r.live && (
              <Button aria-label={`Stop ${r.session}`} onClick={() => onStop(r.session)} size="xs" variant="ghost">
                <Square className="size-2.5 fill-current" />
                Stop
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
