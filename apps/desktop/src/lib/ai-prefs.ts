import { localPrefs } from "~/lib/local-prefs";

// Settings › AI and the agent panel's corner, kept on this Mac.
export type Corner = "br" | "bl" | "tr" | "tl";
export type AiPrefs = { model: "opus" | "sonnet" | "haiku"; effort: "low" | "medium" | "high"; corner: Corner; panelW: number; panelH: number };

const prefs = localPrefs<AiPrefs>("ll.ai", { model: "opus", effort: "medium", corner: "br", panelW: 380, panelH: 460 });

export const aiPrefs = prefs.get;
export const setAiPrefs = prefs.set;
export const useAiPrefs = prefs.use;
