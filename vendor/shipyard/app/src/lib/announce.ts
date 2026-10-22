import { create } from "zustand";

// What a screen reader should hear when something changes out of sight: an
// agent finished, needs you, or failed. Toasts are heard already (base-ui's
// viewport is a live region; urgent ones are alerts); this is for the rest,
// such as a notification the centre keeps without a toast. Two regions, in
// components/announcer.tsx: polite waits for a pause, assertive doesn't.

interface Said {
  polite: string;
  assertive: string;
}

export const useAnnouncer = create<Said>()(() => ({ polite: "", assertive: "" }));

let timer = 0;

// announce says text once. The same words twice in a row are said twice:
// the region is emptied first, so the reader hears a change.
export function announce(text: string, urgent = false) {
  const key = urgent ? "assertive" : "polite";
  useAnnouncer.setState({ [key]: "" } as Partial<Said>);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => useAnnouncer.setState({ [key]: text } as Partial<Said>), 60);
}
