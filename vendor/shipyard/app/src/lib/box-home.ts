import { create } from "zustand";

import { toastManager } from "@/components/ui/toast";
import type { BoxStatus } from "@/lib/api";
import { updateBoxes } from "@/lib/outdated";
import { load, save } from "@/lib/storage";
import { useStore } from "@/lib/store";

// A box's home: a terminal on a box that belongs to no worktree, started in
// the home folder of the user berthd runs as (POST /v1/sessions with
// "home": true, on boxes that list "session.home"). It opens as a tab over
// Home, in the box's home workspace (lib/workspaces.ts homeKey). ⌘T and
// "New terminal" with no worktree in focus ask which box, unless only one
// is online; the last box picked is the default next time.

export const HOME_CAPABILITY = "session.home";

const LAST = "berth.homeBox";

export const lastHomeBox = (): string | undefined => load<string | undefined>(LAST, undefined);
export const rememberHomeBox = (box: string) => save(LAST, box);

// homeBlocker says why a terminal can't open in box's home, or undefined
// when it can. A box whose info hasn't arrived yet is given the benefit of
// the doubt; its answer says if it can't.
export function homeBlocker(box: string): string | undefined {
  const st = useStore.getState();
  const status = st.status?.boxes.find((b) => b.name === box);
  if (!status) return `${box} isn't one of your boxes`;
  if (status.state !== "online") return status.state === "connecting" ? `${box} is still connecting` : `${box} is offline`;
  const caps = st.boxes[box]?.info?.capabilities;
  if (caps && !caps.includes(HOME_CAPABILITY)) return `${box} runs an older berthd`;
  return undefined;
}

// refuseHome says so in a toast when a terminal can't open in box's home,
// with Update for a box that only needs a newer berthd, and returns true.
export function refuseHome(box: string): boolean {
  const why = homeBlocker(box);
  if (!why) return false;
  const old = why.endsWith("older berthd");
  toastManager.add({
    title: `Can't open a terminal on ${box}`,
    description: old ? `${why}, from before terminals outside a worktree. Update it, then try again.` : why,
    type: "error",
    actionProps: old ? { children: "Update", onClick: () => void updateBoxes([box]) } : undefined,
  });
  return true;
}

// pickableBoxes is every box in the order the picker lists them: the last
// one picked first, then the others online, then the ones that can't.
export function pickableBoxes(boxes: BoxStatus[]): { box: BoxStatus; blocked?: string }[] {
  const last = lastHomeBox();
  const all = boxes.map((box) => ({ box, blocked: homeBlocker(box.name) }));
  const rank = (x: (typeof all)[number]) => (x.blocked ? 2 : x.box.name === last ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b));
}

// The box picker's state: open, or not.
export const useBoxPicker = create<{ open: boolean }>(() => ({ open: false }));
export const openBoxPicker = () => useBoxPicker.setState({ open: true });
export const closeBoxPicker = () => useBoxPicker.setState({ open: false });
