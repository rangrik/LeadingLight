# Notes

A worktree panel ("Notes") with a scratchpad for that worktree. It saves as
you type (or with ⌘S) to `.berth/notes.md` inside the worktree on the box, so
the notes travel with the work rather than this laptop, and agents working
there can read them: "check .berth/notes.md". The file is added to the
repository's `info/exclude`, so it is never committed by accident.

Text travels base64-encoded through `orchestrate.exec`, so any character
survives the shell. Notes are capped at 40,000 characters.

SDK used: `addWorktreePanel`, `addCommand`, `openPanel`, `orchestrate.exec`,
`worktreeLocation`, and the UI kit's `Textarea`.
