import type { Art } from "@/lib/art/model";
import { openArtifactPane, wsKey } from "@/lib/workspaces";

// Opening an artifact: the pane already showing it comes forward;
// otherwise a tab after the chat it was opened from, or with split, beside
// that chat. The board is the worktree's gallery, a pane of its own.

type From = { wsKey: string; tab: string; pane: string };

export function openArtifact(a: Pick<Art, "id" | "title" | "box" | "path" | "kind">, opts: { split?: boolean; from?: From } = {}) {
  openArtifactPane({ kind: "artifact", id: a.id, title: a.title, art: a.kind }, wsKey(a.box, a.path), opts.split ? "split" : "tab", opts.from);
}

// openBoard shows a worktree's board (wt, a workspace key), with focus the
// artifact it leads with.
export function openBoard(wt: string, opts: { focus?: string; split?: boolean; from?: From } = {}) {
  openArtifactPane({ kind: "artifact", title: "Artifacts", focus: opts.focus ?? "" }, wt, opts.split ? "split" : "tab", opts.from);
}
