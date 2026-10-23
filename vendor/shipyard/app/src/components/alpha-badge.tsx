import { Tip } from "@/components/tip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

// AlphaBadge marks the Linux app as an alpha (lib/platform.ts), beside the
// app's name in the sidebar and in Settings → About. In the sidebar it opens
// About, where "Report a Linux bug" is.
export function AlphaBadge({ className, link }: { className?: string; link?: boolean }) {
  const badge = (
    <Badge
      variant="warning"
      size="sm"
      data-testid="alpha-badge"
      className={cn("uppercase tracking-wide", className)}
      render={link ? <button type="button" onClick={() => useStore.getState().setView({ kind: "settings", section: "about" })} /> : undefined}
    >
      Alpha
    </Badge>
  );
  return link ? <Tip label="The Linux app is an alpha. Report what breaks from Settings → About.">{badge}</Tip> : badge;
}
