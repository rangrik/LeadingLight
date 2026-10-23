# Pull request

A worktree panel ("Pull request") for the branch's PR, read with the GitHub
CLI on the box: state, checks (failing and running first; passed ones fold
away past eight), each reviewer's latest review, and the latest comments as
plain text. Without a PR it offers to create one, which pushes the branch
and runs `gh pr create` after a confirmation.

It says plainly when `gh` isn't installed or signed in on the box, or when
the repository isn't on GitHub, instead of showing an error. Checks refresh
every 20 seconds while any are running.

SDK used: `addWorktreePanel`, `addCommand`, `openPanel`, `orchestrate.exec`,
`useEvent`, `openUrl`, `notify`, and the UI kit's `Frame`, `Skeleton`,
`Switch` and `AlertDialog`. `src/gh.ts` holds the parsing.
