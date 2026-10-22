import { PromptPicker } from "@/components/prompts/prompt-picker";

// PromptDialogs is the saved-prompt picker, opened from anywhere with
// openPromptPicker (lib/prompts). A prompt for several agents is the
// composer's (openBroadcast, lib/composer).
export function PromptDialogs() {
  return (
    <>
      <PromptPicker />
    </>
  );
}
