import { createContext } from "react";

// PaneContext is the pane something is drawn in: its tab's workspace, and
// the worktree the pane belongs to (paneWorktree), which in a tab that mixes
// worktrees need not be the tab's. A plugin's useCurrentWorktree() reads
// it, so a panel shows its own pane's worktree.
export interface PaneInfo {
  wsKey: string;
  tab: string;
  pane: string;
  worktree: string;
}

export const PaneContext = createContext<PaneInfo | undefined>(undefined);
