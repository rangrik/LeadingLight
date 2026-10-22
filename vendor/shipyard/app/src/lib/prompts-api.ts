import type { BerthPrompts } from "@berth/plugin";

import { BUILTINS, STARTERS, askedVariables, fill, newPromptId, openBroadcast, openPromptPicker, segments, sessionValues, usePrompts } from "@/lib/prompts";

// makePromptsApi is the saved-prompts library as plugins see it (berth.prompts).
export function makePromptsApi(): BerthPrompts {
  const values = (v: Record<string, string | undefined>, t?: { box: string; session: string }) => (t ? { ...sessionValues(t.box, t.session), ...v } : v);
  return {
    list: () => usePrompts.getState().prompts,
    load: async () => {
      await usePrompts.getState().load();
      return usePrompts.getState().prompts;
    },
    save: (prompts) => usePrompts.getState().save(prompts),
    subscribe: (listener) => usePrompts.subscribe(listener),
    starters: STARTERS,
    builtins: BUILTINS,
    variables: askedVariables,
    fill: (body, v, t) => fill(body, values(v, t)),
    segments: (body, v, t) => segments(body, values(v, t)),
    newId: newPromptId,
    openPicker: (o) => openPromptPicker(o),
    openBroadcast: (o) => openBroadcast(o),
  };
}
