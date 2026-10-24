import { Sparkles } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { isClaude, useAiPrefs } from "~/lib/ai-prefs";
import { toggleAsk, useAsk } from "~/lib/ask";

// The Ask button at the window's top right, beside the Writing menu: Claude for the page in front.
export function AskButton() {
  const { open, page } = useAsk();
  const who = isClaude(useAiPrefs().model) ? "Claude" : "GPT";
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={`Ask ${who}`} aria-pressed={open} className="size-7" disabled={!page} onClick={toggleAsk} size="icon" variant="ghost" />}>
        <Sparkles />
      </TooltipTrigger>
      <TooltipPopup>
        Ask {who} <Kbd>⌘J</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
