import { cn } from "@leadinglight/ui/lib/utils";

// One side of the page area. When the window has no room for both sides, the side not being
// worked in folds to a slim strip with its title; a click opens it again. Folded content stays
// mounted, so a quote can still land in a folded essay.
export function Pane({
  label,
  folded,
  onUnfold,
  onFocus,
  header,
  className,
  children,
}: {
  label: string;
  folded: boolean;
  onUnfold: () => void;
  onFocus: () => void;
  header?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("relative flex min-w-0 flex-col", folded ? "w-11 shrink-0" : "flex-1", className)}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      {folded && (
        <button
          className="flex h-full w-full cursor-pointer items-start justify-center pt-4 text-muted-foreground text-sm transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
          onClick={onUnfold}
          type="button"
        >
          <span className="max-h-full truncate [writing-mode:vertical-rl]">{label}</span>
        </button>
      )}
      {!folded && header}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", folded && "hidden")} data-scroller>
        {children}
      </div>
    </section>
  );
}
