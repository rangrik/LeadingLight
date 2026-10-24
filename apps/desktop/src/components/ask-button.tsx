import { Sparkles } from "lucide-react";
import { useRef } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { isClaude, useAiPrefs } from "~/lib/ai-prefs";
import { closeAsk, openAsk, useAsk } from "~/lib/ask";
import { liveEditor } from "~/lib/live";

// The Ask button in a page card's header, beside its Writing menu: Claude or GPT for that page.
export function AskButton({ page, className }: { page: string; className?: string }) {
  const { open, page: asked } = useAsk();
  const who = isClaude(useAiPrefs().model) ? "Claude" : "GPT";
  const mine = open && asked?.id === page;
  // Pressing a card brings its page to the front, and the panel with it, before the click: so
  // whether the panel was already on this page is read as the press, or Tab, reaches the card.
  const was = useRef<boolean | null>(null);
  const click = () => {
    const before = was.current ?? mine;
    was.current = null;
    if (before) return closeAsk();
    // Its page becomes the one asked about: its editor taking focus registers it (page-view.tsx).
    if (asked?.id !== page) liveEditor(page)?.refocus();
    openAsk(null);
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Ask ${who}`}
            aria-pressed={mine}
            className={cn("size-7", className)}
            onClick={click}
            onFocusCapture={(e) => e.currentTarget.matches(":focus-visible") && (was.current = mine)}
            onPointerDownCapture={() => (was.current = mine)}
            size="icon"
            variant="ghost"
          />
        }
      >
        <Sparkles />
      </TooltipTrigger>
      <TooltipPopup>
        Ask {who} <Kbd>⌘J</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
