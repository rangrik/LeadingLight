# Git changes

A worktree panel ("Changes", from the tab strip's +) showing what changed in
the worktree: the branch and how far it is ahead of or behind its upstream,
each changed file with its line counts, and its diff, unified or side by
side. Commit and push are behind a confirmation; nothing else writes.

Everything runs as `git` on the box, in the worktree, through
`berth.orchestrate.exec`, so it shows what the agent working there sees.
It refreshes when an agent in the worktree finishes a turn.

SDK used: `addWorktreePanel` (with `icon`), `addCommand`, `openPanel`,
`orchestrate.exec`, `useEvent`, `worktreeLocation`, `notify`, and the UI kit's
`ToggleGroup`, `Textarea` and `AlertDialog`. The parsing lives in
`src/git.ts`, apart from the UI.
