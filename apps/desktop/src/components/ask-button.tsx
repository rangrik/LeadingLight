import { Sparkles } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { isClaude, useAiPrefs } from "~/lib/ai-prefs";
import { closeAsk, toggleAsk, useAsk } from "~/lib/ask";
import { useKeysFor } from "~/lib/keymap";
import { liveEditor } from "~/lib/live";

// The Ask button in a page card's header, beside its Writing menu: Claude or GPT for that page.
export function AskButton({ page, className }: { page: string; className?: string }) {
  const { open, page: asked } = useAsk();
  const who = isClaude(useAiPrefs().model) ? "Claude" : "GPT";
  const keys = useKeysFor()("ask");
  const mine = open && asked?.id === page;
  const click = () => {
    if (mine) return closeAsk();
    // Its page becomes the one asked about: its editor taking focus registers it (page-view.tsx).
    if (asked?.id !== page) liveEditor(page)?.refocus();
    toggleAsk();
  };
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={`Ask ${who}`} aria-pressed={mine} className={cn("size-7", className)} onClick={click} size="icon" variant="ghost" />}>
        <Sparkles />
      </TooltipTrigger>
      <TooltipPopup>
        Ask {who} <Kbd>{keys}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
