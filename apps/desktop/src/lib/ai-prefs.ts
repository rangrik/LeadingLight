import { localPrefs } from "~/lib/local-prefs";

// Settings › AI and the agent panel's place, kept on this Mac. A model is one of Claude Code's
// aliases, which follow the newest of each, or a GPT model Codex offers (lib/codex.ts).
export type Corner = "br" | "bl" | "tr" | "tl";
export type Side = "left" | "right";
export type Access = "ask" | "auto" | "full";
export type AiPrefs = { model: string; effort: string; access: Access; plan: boolean; pinned: Side | null; corner: Corner; panelW: number; panelH: number; tail: Partial<TailPrefs> };
// Tail (docs/TAIL.md): Off, Quiet or Normal, its own model and effort, and Reads on, the types
// where the person chose other than Writing's Use on (Settings › AI › Tail).
export type TailPrefs = { mode: "off" | "quiet" | "normal"; model: string; effort: string; readsOn: Record<string, boolean> };
const TAIL: TailPrefs = { mode: "normal", model: "gpt-6.1-sol", effort: "high", readsOn: {} };

export const MODELS: { value: string; label: string }[] = [
  { value: "fable", label: "Fable" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];
export const EFFORTS: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];
export const CLAUDE_EFFORTS = EFFORTS.slice(0, 5);
export const ACCESS: { value: Access; label: string; description: string }[] = [
  { value: "ask", label: "Ask for approval", description: "Claude asks before changing a page or using the web" },
  { value: "auto", label: "Approve for me", description: "Claude Code's auto mode: a classifier approves or blocks each action and asks you when unsure" },
  { value: "full", label: "Full access", description: "Claude changes pages and uses the web without asking" },
];
// With GPT the app runs the page tools itself, and Codex searches the web on its side.
export const GPT_ACCESS: Record<Access, string> = {
  ask: "GPT asks before changing a page; Codex searches the web without asking",
  auto: "Codex has no classifier for the app's tools, so GPT asks, as with Ask for approval",
  full: "GPT changes pages without asking",
};
export const labelOf = (list: { value: string; label: string }[], value: string) => list.find((x) => x.value === value)?.label ?? value;
export const isClaude = (model: string) => MODELS.some((m) => m.value === model);

const prefs = localPrefs<AiPrefs>("ll.ai", { model: "opus", effort: "medium", access: "ask", plan: false, pinned: "right", corner: "br", panelW: 400, panelH: 540, tail: {} });

// The floating panel's box in the page area, as agent-panel.tsx places it (12 px in, top corners
// under the header band), so the pages under it can make room (pane-area.tsx).
const EDGE = 12;
export function floatBox(p: AiPrefs, area: { w: number; h: number }, header: number) {
  const width = Math.min(p.panelW, area.w - 2 * EDGE);
  const height = Math.min(p.panelH, area.h - header - EDGE);
  return { left: p.corner.endsWith("l") ? EDGE : area.w - EDGE - width, top: p.corner.startsWith("t") ? header : area.h - EDGE - height, width, height };
}

export const aiPrefs = prefs.get;
export const setAiPrefs = prefs.set;
export const useAiPrefs = prefs.use;
export const onAiPrefs = prefs.subscribe;
export const tailPrefs = (): TailPrefs => ({ ...TAIL, ...prefs.get().tail });
export const setTailPrefs = (patch: Partial<TailPrefs>) => prefs.set({ tail: { ...prefs.get().tail, ...patch } });
