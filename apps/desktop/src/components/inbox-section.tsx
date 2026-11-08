import type { ReactNode } from "react";

// One of the Inbox's sections (features/bar.feature): a small header with its count, then its rows.
// after: what the section adds to its header (Needs you's project menu).
export function InboxSection({ id, title, count, after, children }: { id: string; title: string; count: number; after?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} data-section={id}>
      <div className="flex h-8 items-center gap-2 px-4">
        <h3 className="flex items-baseline gap-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {title} <span className="tabular-nums">{count}</span>
        </h3>
        {after}
      </div>
      {children}
    </section>
  );
}
