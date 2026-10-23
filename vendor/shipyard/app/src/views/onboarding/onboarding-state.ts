import { create } from "zustand";

import { useStore } from "@/lib/store";

// Onboarding fills the main area while there are no boxes. Once the person
// starts connecting their first box it stays until finished, even after
// that box is paired: adding a repo and starting an agent come after.
// Settings → Developer can bring it back for this window.
//
// It must never show over boxes that exist. Two things used to make it:
//  - "Show onboarding again" was remembered in localStorage, so a forced
//    onboarding outlived the session it was asked for and came back on
//    every launch, boxes or not. It now lasts for this window only
//    (sessionStorage), and the old key is cleared.
//  - Merely showing the welcome step marked onboarding "in progress", so a
//    status that briefly listed no boxes at start-up (the agent still
//    reading them) kept the gate up after the boxes arrived. Now only
//    leaving the welcome step while there are truly no boxes starts it, and
//    the gate drops at once if boxes turn up before then.

const FORCE_KEY = "berth.onboarding.show";

function forcedAtStart(): boolean {
  try {
    // From before it was per window: never honoured, always cleared.
    localStorage.removeItem(FORCE_KEY);
  } catch {
    // Nothing to clear.
  }
  try {
    return sessionStorage.getItem(FORCE_KEY) === "1";
  } catch {
    return false;
  }
}

const useOnboarding = create<{ forced: boolean; inProgress: boolean }>()(() => ({ forced: forcedAtStart(), inProgress: false }));

const noBoxes = (s: ReturnType<typeof useStore.getState>) => !!s.status && s.connection.state === "online" && s.status.boxes.length === 0;

// useOnboardingActive reports whether the onboarding should be on screen.
export function useOnboardingActive(): boolean {
  const { forced, inProgress } = useOnboarding();
  const none = useStore(noBoxes);
  return forced || inProgress || none;
}

// isOnboardingActive is the same answer outside React (shortcuts, say).
export function isOnboardingActive(): boolean {
  const { forced, inProgress } = useOnboarding.getState();
  return forced || inProgress || noBoxes(useStore.getState());
}

// markOnboardingStarted is called when the person leaves the welcome step:
// from then on onboarding stays until finished, so pairing the first box
// doesn't snatch away the steps after it. With boxes already there it does
// nothing; the gate is only the forced one then.
export function markOnboardingStarted() {
  if (useOnboarding.getState().inProgress) return;
  if (!noBoxes(useStore.getState())) return;
  useOnboarding.setState({ inProgress: true });
}

export function finishOnboarding() {
  try {
    sessionStorage.removeItem(FORCE_KEY);
  } catch {
    // Nothing remembered it.
  }
  useOnboarding.setState({ forced: false, inProgress: false });
}

// showOnboardingAgain brings the onboarding back in this window, reloads
// included, until it is finished. A new launch starts without it.
export function showOnboardingAgain() {
  try {
    sessionStorage.setItem(FORCE_KEY, "1");
  } catch {
    // It still shows until a reload.
  }
  useOnboarding.setState({ forced: true });
}
